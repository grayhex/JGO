//! kem-adapter: owns one KEmulator process in Bridge mode.
//!
//! Handshake order (BridgeFrontendDocs.md; the emulator opens in this order, so do we):
//!   inputpipe (we write) -> statepipe (we read) -> readypipe (we read) -> readpipe (we write)
//! Framebuffer ownership: wait for a byte on readypipe, copy the mmap'ed `screen`
//! file, send the byte back on readpipe immediately, only then encode/forward the copy.
mod proto;

use proto::{read_msg, write_msg};
use std::collections::VecDeque;
use std::ffi::CString;
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const EXIT_NORMAL: u8 = 0;
const EXIT_FAILED_HANDSHAKE: u8 = 1;
const EXIT_SIGNALED: u8 = 2;
const EXIT_KILLED_TIMEOUT: u8 = 3;

struct Config {
    dir: PathBuf,
    width: usize,
    height: usize,
    deflate: bool,
    grace: Duration,
    handshake_timeout: Duration,
    max_cpu_seconds: u64,
    max_file_bytes: u64,
    cmd: Vec<String>,
}

fn parse_args() -> Result<Config, String> {
    let mut args = std::env::args().skip(1);
    let (mut dir, mut w, mut h) = (None, 240usize, 320usize);
    let mut cfg = Config {
        dir: PathBuf::new(),
        width: 0,
        height: 0,
        deflate: false,
        grace: Duration::from_millis(3000),
        handshake_timeout: Duration::from_secs(60),
        max_cpu_seconds: 0,
        max_file_bytes: 0,
        cmd: vec![],
    };
    while let Some(a) = args.next() {
        let mut val = |name: &str| args.next().ok_or(format!("{name} needs a value"));
        match a.as_str() {
            "--dir" => dir = Some(PathBuf::from(val("--dir")?)),
            "--width" => w = val("--width")?.parse().map_err(|_| "bad --width")?,
            "--height" => h = val("--height")?.parse().map_err(|_| "bad --height")?,
            "--enc" => {
                cfg.deflate = match val("--enc")?.as_str() {
                    "raw" => false,
                    "deflate" => true,
                    o => return Err(format!("unknown --enc {o}")),
                }
            }
            "--grace-ms" => {
                cfg.grace =
                    Duration::from_millis(val("--grace-ms")?.parse().map_err(|_| "bad --grace-ms")?)
            }
            "--handshake-timeout-ms" => {
                cfg.handshake_timeout = Duration::from_millis(
                    val("--handshake-timeout-ms")?
                        .parse()
                        .map_err(|_| "bad value")?,
                )
            }
            "--max-cpu-seconds" => {
                cfg.max_cpu_seconds = val("--max-cpu-seconds")?.parse().map_err(|_| "bad value")?
            }
            "--max-file-bytes" => {
                cfg.max_file_bytes = val("--max-file-bytes")?.parse().map_err(|_| "bad value")?
            }
            "--" => {
                cfg.cmd = args.by_ref().collect();
                break;
            }
            o => return Err(format!("unknown argument {o}")),
        }
    }
    cfg.dir = dir.ok_or("--dir is required")?;
    if w == 0 || h == 0 || w > 4096 || h > 4096 {
        return Err("--width/--height out of range".into());
    }
    cfg.width = w;
    cfg.height = h;
    if cfg.cmd.is_empty() {
        return Err("missing command after --".into());
    }
    Ok(cfg)
}

/// Single writer for stdout; control messages are queued, frames use a latest-wins mailbox
/// so a slow consumer can never make the queue grow (stale video frames are dropped).
struct Outbox {
    ctrl: Mutex<VecDeque<(u8, Vec<u8>)>>,
    frame: Mutex<Option<(u32, u64, Vec<u8>)>>,
    /// Bounded: when the consumer is slow the oldest audio is dropped (latency stays bounded).
    audio: Mutex<VecDeque<Vec<u8>>>,
    cv: Condvar,
    dropped: AtomicU32,
    closed: AtomicBool,
}

impl Outbox {
    fn ctrl(&self, ty: u8, payload: Vec<u8>) {
        self.ctrl.lock().unwrap().push_back((ty, payload));
        self.cv.notify_one();
    }
    fn audio(&self, pcm: Vec<u8>) {
        let mut q = self.audio.lock().unwrap();
        if q.len() >= 64 {
            q.pop_front();
        }
        q.push_back(pcm);
        drop(q);
        self.cv.notify_one();
    }
    fn frame(&self, seq: u32, ts: u64, rgba: Vec<u8>) {
        if self
            .frame
            .lock()
            .unwrap()
            .replace((seq, ts, rgba))
            .is_some()
        {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
        self.cv.notify_one();
    }
}

fn now_us() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

fn mkfifo(path: &Path) -> io::Result<()> {
    let c = CString::new(path.to_str().ok_or(io::ErrorKind::InvalidInput)?).unwrap();
    if unsafe { libc::mkfifo(c.as_ptr(), 0o600) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn open_rw(path: &Path, write: bool) -> io::Result<File> {
    // Blocking open on purpose: the order of opens is the handshake.
    OpenOptions::new().read(!write).write(write).open(path)
}

fn spawn_child(cfg: &Config) -> io::Result<Child> {
    let mut c = Command::new(&cfg.cmd[0]);
    c.args(&cfg.cmd[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    c.process_group(0);
    let (cpu, fsize) = (cfg.max_cpu_seconds, cfg.max_file_bytes);
    unsafe {
        c.pre_exec(move || {
            // die with the adapter, even on SIGKILL of the adapter
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            let lim = |res, v: u64| {
                let r = libc::rlimit {
                    rlim_cur: v,
                    rlim_max: v,
                };
                libc::setrlimit(res, &r);
            };
            if cpu > 0 {
                lim(libc::RLIMIT_CPU, cpu);
            }
            if fsize > 0 {
                lim(libc::RLIMIT_FSIZE, fsize);
            }
            lim(libc::RLIMIT_CORE, 0);
            Ok(())
        });
    }
    c.spawn()
}

fn kill_group(pid: u32, sig: i32) {
    unsafe { libc::kill(-(pid as i32), sig) };
}

fn deflate(data: &[u8]) -> Vec<u8> {
    use flate2::{write::DeflateEncoder, Compression};
    let mut e = DeflateEncoder::new(Vec::with_capacity(data.len() / 4), Compression::fast());
    e.write_all(data).ok();
    e.finish().unwrap_or_default()
}

fn pump_lines<R: Read + Send + 'static>(r: R, out: Arc<Outbox>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut r = BufReader::new(r);
        let mut line = Vec::new();
        loop {
            line.clear();
            match r.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    while matches!(line.last(), Some(b'\n' | b'\r')) {
                        line.pop();
                    }
                    line.truncate(8192);
                    out.ctrl(b'L', line.clone());
                }
            }
        }
    })
}

fn main() {
    let cfg = match parse_args() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("kem-adapter: {e}");
            std::process::exit(2);
        }
    };
    let cfg = Arc::new(cfg);
    let out = Arc::new(Outbox {
        ctrl: Mutex::new(VecDeque::new()),
        frame: Mutex::new(None),
        audio: Mutex::new(VecDeque::new()),
        cv: Condvar::new(),
        dropped: AtomicU32::new(0),
        closed: AtomicBool::new(false),
    });

    // --- FIFOs ---------------------------------------------------------------------------
    let names = ["inputpipe", "statepipe", "readypipe", "readpipe"];
    for n in names {
        let p = cfg.dir.join(n);
        let _ = std::fs::remove_file(&p);
        if let Err(e) = mkfifo(&p) {
            eprintln!("kem-adapter: mkfifo {}: {e}", p.display());
            std::process::exit(3);
        }
    }
    let _ = std::fs::remove_file(cfg.dir.join("screen"));
    // virtual sound card: the JVM writes PCM into this FIFO (see runtime/audio). Opened O_RDWR so
    // neither side can block on open and the JVM never sees EPIPE when we are between reads.
    {
        let p = cfg.dir.join("audio");
        let _ = std::fs::remove_file(&p);
        if mkfifo(&p).is_ok() {
            if let Ok(f) = OpenOptions::new().read(true).write(true).open(&p) {
                let out = out.clone();
                thread::spawn(move || {
                    let mut f = f;
                    let mut buf = vec![0u8; 8820]; // 50 ms
                    loop {
                        match f.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => out.audio(buf[..n - n % 4].to_vec()),
                        }
                    }
                });
            }
        }
    }

    // --- stdout writer ---------------------------------------------------------------------
    let writer = {
        let out = out.clone();
        let use_deflate = cfg.deflate;
        thread::spawn(move || {
            let stdout = io::stdout();
            let mut so = io::BufWriter::with_capacity(1 << 20, stdout.lock());
            loop {
                let (ctrl, frame, audio) = {
                    let mut c = out.ctrl.lock().unwrap();
                    loop {
                        let f = out.frame.lock().unwrap().take();
                        let a = out.audio.lock().unwrap().pop_front();
                        if !c.is_empty() || f.is_some() || a.is_some() {
                            break (c.pop_front(), f, a);
                        }
                        if out.closed.load(Ordering::SeqCst) {
                            return;
                        }
                        c = out.cv.wait(c).unwrap();
                    }
                };
                if let Some((ty, p)) = ctrl {
                    if write_msg(&mut so, ty, &[&p]).is_err() {
                        return;
                    }
                }
                if let Some(pcm) = audio {
                    if write_msg(&mut so, b'A', &[&pcm]).is_err() {
                        return;
                    }
                }
                if let Some((seq, ts, rgba)) = frame {
                    let mut hdr = Vec::with_capacity(13);
                    hdr.extend_from_slice(&seq.to_be_bytes());
                    hdr.extend_from_slice(&ts.to_be_bytes());
                    // encoding happens here, off the framebuffer-ownership path
                    let (flag, body) = if use_deflate {
                        (1u8, deflate(&rgba))
                    } else {
                        (0u8, rgba)
                    };
                    hdr.push(flag);
                    if write_msg(&mut so, b'F', &[&hdr, &body]).is_err() {
                        return;
                    }
                }
            }
        })
    };

    // --- child -------------------------------------------------------------------------------
    let mut child = match spawn_child(&cfg) {
        Ok(c) => c,
        Err(e) => {
            out.ctrl(
                b'X',
                exit_payload(-1, EXIT_FAILED_HANDSHAKE, &format!("spawn failed: {e}")),
            );
            finish(&out, writer, &cfg);
            std::process::exit(1);
        }
    };
    let pid = child.id();
    let log_threads = vec![
        pump_lines(child.stdout.take().unwrap(), out.clone()),
        pump_lines(child.stderr.take().unwrap(), out.clone()),
    ];

    let input: Arc<Mutex<Option<File>>> = Arc::new(Mutex::new(None));
    let handshaken = Arc::new(AtomicBool::new(false));
    let quitting = Arc::new(AtomicBool::new(false));
    let kill_deadline: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));

    // --- handshake + readers --------------------------------------------------------------
    {
        let (cfg, out, input, handshaken) =
            (cfg.clone(), out.clone(), input.clone(), handshaken.clone());
        thread::spawn(move || {
            let dir = &cfg.dir;
            let fin = open_rw(&dir.join("inputpipe"), true);
            let fstate = fin.and_then(|i| open_rw(&dir.join("statepipe"), false).map(|s| (i, s)));
            let fready =
                fstate.and_then(|(i, s)| open_rw(&dir.join("readypipe"), false).map(|r| (i, s, r)));
            let all = fready
                .and_then(|(i, s, r)| open_rw(&dir.join("readpipe"), true).map(|a| (i, s, r, a)));
            let (fin, fstate, fready, mut fack) = match all {
                Ok(t) => t,
                Err(e) => {
                    out.ctrl(
                        b'L',
                        format!("kem-adapter: bridge handshake failed: {e}").into_bytes(),
                    );
                    return;
                }
            };
            let len = 4 * cfg.width * cfg.height;
            let screen = match File::open(dir.join("screen"))
                .and_then(|f| unsafe { memmap2::MmapOptions::new().len(len).map(&f) })
            {
                Ok(m) => m,
                Err(e) => {
                    out.ctrl(
                        b'L',
                        format!("kem-adapter: cannot map screen: {e}").into_bytes(),
                    );
                    return;
                }
            };
            *input.lock().unwrap() = Some(fin);
            handshaken.store(true, Ordering::SeqCst);
            let mut ready = Vec::new();
            ready.extend_from_slice(&(cfg.width as u16).to_be_bytes());
            ready.extend_from_slice(&(cfg.height as u16).to_be_bytes());
            out.ctrl(b'R', ready);

            // statepipe reader
            let out_s = out.clone();
            thread::spawn(move || {
                let mut r = BufReader::new(fstate);
                let mut head = [0u8; 5];
                while r.read_exact(&mut head).is_ok() {
                    let n = u32::from_be_bytes([head[1], head[2], head[3], head[4]]) as usize;
                    if n > 16 << 20 {
                        break;
                    }
                    let mut body = vec![0u8; n + 1];
                    body[0] = head[0];
                    if r.read_exact(&mut body[1..]).is_err() {
                        break;
                    }
                    out_s.ctrl(b'S', body);
                }
            });

            // frame loop: ready byte -> copy -> ack -> hand off
            let mut ready = BufReader::with_capacity(64, fready);
            let mut seq = 0u32;
            let mut byte = [0u8; 1];
            let mut rgba = vec![0u8; len];
            while ready.read_exact(&mut byte).is_ok() {
                // the buffer is ours now. Copy (ARGB big-endian bytes -> RGBA) ...
                for (d, s) in rgba
                    .as_chunks_mut::<4>()
                    .0
                    .iter_mut()
                    .zip(screen.as_chunks::<4>().0)
                {
                    d[0] = s[1];
                    d[1] = s[2];
                    d[2] = s[3];
                    d[3] = 0xFF;
                }
                let ts = now_us();
                // ... and give it back right away.
                if fack.write_all(b"\n").is_err() {
                    break;
                }
                seq = seq.wrapping_add(1);
                out.frame(seq, ts, rgba.clone());
            }
        });
    }

    // --- stdin commands -----------------------------------------------------------------
    {
        let (input, quitting, kd, grace) = (
            input.clone(),
            quitting.clone(),
            kill_deadline.clone(),
            cfg.grace,
        );
        thread::spawn(move || {
            let stdin = io::stdin();
            let mut si = stdin.lock();
            let request_quit = |input: &Arc<Mutex<Option<File>>>| {
                quitting.store(true, Ordering::SeqCst);
                input.lock().unwrap().take(); // closing inputpipe is the documented shutdown
                *kd.lock().unwrap() = Some(Instant::now() + grace);
            };
            loop {
                match read_msg(&mut si) {
                    Ok(Some((b'I', line))) => {
                        if line.iter().any(|&b| b == b'\n' || b >= 128) {
                            continue; // protocol is ASCII, one command per line
                        }
                        if let Some(f) = input.lock().unwrap().as_mut() {
                            let mut l = line;
                            l.push(b'\n');
                            let _ = f.write_all(&l);
                        }
                    }
                    Ok(Some((b'Q', _))) => request_quit(&input),
                    Ok(Some((b'K', _))) => kill_group(pid, libc::SIGKILL),
                    Ok(Some(_)) => {}
                    Ok(None) | Err(_) => {
                        // API went away: same as a quit
                        request_quit(&input);
                        return;
                    }
                }
            }
        });
    }

    // --- supervise ------------------------------------------------------------------------
    let started = Instant::now();
    let (code, reason, detail) = loop {
        match child.try_wait() {
            Ok(Some(st)) => {
                use std::os::unix::process::ExitStatusExt;
                if let Some(sig) = st.signal() {
                    break (-1, EXIT_SIGNALED, format!("killed by signal {sig}"));
                }
                let c = st.code().unwrap_or(-1);
                let r = if handshaken.load(Ordering::SeqCst) {
                    EXIT_NORMAL
                } else {
                    EXIT_FAILED_HANDSHAKE
                };
                break (c, r, bridge_exit_meaning(c).to_string());
            }
            Ok(None) => {}
            Err(e) => break (-1, EXIT_SIGNALED, format!("wait failed: {e}")),
        }
        if !handshaken.load(Ordering::SeqCst) && started.elapsed() > cfg.handshake_timeout {
            kill_group(pid, libc::SIGKILL);
            let _ = child.wait();
            break (
                -1,
                EXIT_KILLED_TIMEOUT,
                "bridge handshake timed out".to_string(),
            );
        }
        if let Some(dl) = *kill_deadline.lock().unwrap() {
            if Instant::now() > dl {
                kill_group(pid, libc::SIGKILL);
                let _ = child.wait();
                break (
                    -1,
                    EXIT_KILLED_TIMEOUT,
                    "did not stop within grace period, killed".to_string(),
                );
            }
        }
        thread::sleep(Duration::from_millis(20));
    };
    // whatever is left in the group (child threads/forks) goes away with the leader
    kill_group(pid, libc::SIGKILL);
    for t in log_threads {
        let _ = t.join();
    }
    out.ctrl(b'X', exit_payload(code, reason, &detail));
    finish(&out, writer, &cfg);
    std::process::exit(0);
}

fn finish(out: &Arc<Outbox>, writer: thread::JoinHandle<()>, cfg: &Config) {
    out.closed.store(true, Ordering::SeqCst);
    out.cv.notify_all();
    let _ = writer.join();
    for n in [
        "inputpipe",
        "statepipe",
        "readypipe",
        "readpipe",
        "screen",
        "audio",
    ] {
        let _ = std::fs::remove_file(cfg.dir.join(n));
    }
}

fn exit_payload(code: i32, reason: u8, detail: &str) -> Vec<u8> {
    let mut v = code.to_be_bytes().to_vec();
    v.push(reason);
    v.extend_from_slice(detail.as_bytes());
    v
}

/// Exit codes documented in BridgeFrontendDocs.md.
fn bridge_exit_meaning(code: i32) -> &'static str {
    match code {
        0 => "exited normally",
        1 => "emulator error (MIDlet failed to load or launch)",
        21 => "bridge: FIFO missing",
        22 => "bridge: FIFO connect failure",
        24 => "bridge: framebuffer file creation failed",
        25 => "bridge: statepipe write failed",
        26 => "bridge: readypipe write failed",
        27 => "bridge: readpipe closed unexpectedly",
        28 => "bridge: framebuffer write failed",
        29 => "bridge: inputpipe read failed",
        30 => "bridge: started without a MIDlet",
        _ => "exited with error",
    }
}

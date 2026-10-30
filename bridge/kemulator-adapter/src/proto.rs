//! Framed stdio protocol between the adapter and the Node API.
//! Every message: type (1 byte) | payload length (u32 BE) | payload.
//!
//! adapter -> API (stdout):
//!   'R' ready   : u16 width | u16 height                      (bridge handshake finished)
//!   'F' frame   : u32 seq | u64 ts_us | u8 enc | pixels        (enc 0 = RGBA, 1 = raw-deflate(RGBA))
//!   'S' state   : u8 packet type | body                        (KEmulator statepipe packet, verbatim)
//!   'L' log     : UTF-8 line (KEmulator stdout/stderr)
//!   'X' exit    : i32 exit code | u8 reason | UTF-8 detail     (always the last message)
//! API -> adapter (stdin):
//!   'I' input   : ASCII command line without "\n" (written to inputpipe)
//!   'Q' quit    : graceful stop (closes inputpipe, SIGKILL after the grace period)
//!   'K' kill    : immediate SIGKILL of the process group
use std::io::{self, Read, Write};

pub fn write_msg<W: Write>(w: &mut W, ty: u8, parts: &[&[u8]]) -> io::Result<()> {
    let len: usize = parts.iter().map(|p| p.len()).sum();
    let mut head = [0u8; 5];
    head[0] = ty;
    head[1..].copy_from_slice(&(len as u32).to_be_bytes());
    w.write_all(&head)?;
    for p in parts {
        w.write_all(p)?;
    }
    w.flush()
}

pub fn read_msg<R: Read>(r: &mut R) -> io::Result<Option<(u8, Vec<u8>)>> {
    let mut head = [0u8; 5];
    match r.read_exact(&mut head) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes([head[1], head[2], head[3], head[4]]) as usize;
    if len > 1 << 20 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "oversized message from API"));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;
    Ok(Some((head[0], buf)))
}

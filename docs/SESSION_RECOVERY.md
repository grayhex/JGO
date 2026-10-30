# Session recovery and RMS durability

A WebSocket is a viewer/input connection, not the JVM lifetime. Reloading or closing a tab releases that viewer's keys; a live session remains available until its configured idle timeout (five minutes by default). Reopening the same game reattaches without a new MIDlet launch. Multiple viewers' held keys are reference-counted so one disconnect cannot release another's keys.

Both sides have a heartbeat. The browser responds to offline/online, retries with bounded exponential backoff, and invalidates old sockets/timers/decoded frames by generation. The server terminates peers missing protocol pong responses and releases their keys. Inputs are disabled until a new connection is open. No input replay queue can resurrect an old held key. An ended or missing session stops reconnection; after service restart the UI offers a fresh game start using its saved phone/profile/control preferences.

## Safe stop

Patch `0009-bridge-graceful-stop-durable-rms.patch` implements an explicit Bridge Q command calling the real `MIDlet.invokeDestroyApp(true)`. The Rust supervisor keeps pipes alive while the callback finishes. Before stop, keys are released and the user/log is warned: a process failing to respond within eight seconds is forcibly terminated. A UI Stop/restart or SIGTERM uses this same path. systemd gives the service 30 seconds with KillMode=mixed; concurrent shutdown requests share one promise and new session creation is rejected during draining. Library scans/metadata jobs are cancelled, and game shutdown begins without waiting for a slow cancelled metadata request.

RMS records and their index are written via a temporary file in the same directory, file fsync, atomic rename and directory fsync on the supported Linux filesystem. Previous record files are not truncated by an interrupted overwrite. This is individual-file durability, not a cross-file transaction or protection from failing hardware/filesystems. Keep backups on independent storage. Use a filesystem supporting atomic replacement; failures are reported as RecordStore exceptions, not bypassed.

`jgo update`/stopped backups abort if systemctl stop fails instead of silently replacing a running installation. Game data remains outside the release tree. Existing backup/rollback mechanisms are preserved. The corresponding patch source ships for licensing/reproducibility.

**No save states exist here.** The game must save progress using RMS (including its destroyApp hook). RAM-only game state, progress never saved by the game, power failure and SIGKILL are not claimed recoverable. A JVM cannot be resumed after systemd/service restart; the next launch reads the game's RMS normally.

Browser beforeunload prompts are generic/browser-controlled and may not be shown without user interaction or during a mobile OS kill. They are supplementary: server-side disconnection/heartbeat cleanup does not rely on the prompt or pagehide firing.

## Tests

- `tests/integration/reliability.test.ts`: real destroyApp-only RMS fixture, stop/API restart, idempotent shutdown, multiple viewers, silent peer timeout and an intentionally hung destroyApp forced shut after warning.
- `tests/e2e/recovery.mjs`: Chromium reload, close/reopen tab, offline/online, real OS SIGTERM/restart, RMS and EN/RU persistence. A rejected Stop request keeps the live session attached and does not permit a second process to start as a false restart.
- `tests/lxc/run.sh` → `rms_restart`: actual `systemctl restart jgo`, then container reboot, with a destroyApp-only checkpoint fixture. Runs in the existing LXC CI job. systemd is not PID 1 in the cloud workspace, so the real systemd scenario cannot be executed there; SIGTERM is exercised locally, not described as a systemd run.

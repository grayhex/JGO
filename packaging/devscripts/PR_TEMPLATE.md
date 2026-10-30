# Add JGO (web player for Java ME games)

New script, `ct/jgo.sh` + `install/jgo-install.sh` + `json/jgo.json`. Category 24 (Gaming & Leisure).

## What I read upstream (https://github.com/grayhex/JGO)

* `runtime/Dockerfile` - the real install sequence: KEmulator nnmod is built from the pinned upstream commit `@KEM_COMMIT@` with the patches in `runtime/patches`, the Bridge supervisor is a Rust binary, the API/UI is Node.js (`engines.node` is `@NODE@`), the runtime image needs OpenJDK 21 (headless), Xvfb and Mesa's software GL (M3G / Mascot Capsule).
* `compose.yaml` / `.env.example` - one service, one volume (`/data` -> `/var/lib/jgo`), config keys (`AUTH_TOKEN`, `HOST`, `PORT`, limits) reproduced in `/etc/jgo/jgo.env`.
* `package.json` - Node 22; SQLite is `node:sqlite` (built in), so there is no database to install.
* The Dockerfile builds everything; `.github/workflows/release.yml` builds the same thing in CI, so the script uses `fetch_and_deploy_gh_release ... "prebuild"` instead of rebuilding.

## Facts

* Runtime: Node.js 22 (`setup_nodejs`), OpenJDK 21 headless (apt). No database server. No Docker.
* `var_arm64="no"`: the release ships an x86_64 supervisor and x86_64 LWJGL natives.
* Defaults: 4 CPU, 4096 MB, 20 GB, Debian 13, unprivileged (nesting on, as the engine's default; used for the per-game network namespace).
* The access token is generated with `random_password` and stored in `/etc/jgo/jgo.env`; it is printed once at the end of the install.
* Service: `jgo.service` (+ `jgo-xvfb.service`), user `jgo`, hardened unit, cgroup limits.

## Deviations from AGENTS.md

See the table in `DEVIATIONS.md` of the source repository (non-root service user, apt JRE, `update_script` delegating to the verified `jgo update`, two units). Each has a reason; none is a shortcut.

## Tested

* `tests/lxc/run.sh` in the source repository installs with this exact script, unmodified, on a Debian 13 system container with systemd and the engine at the commit in `tests/lxc/core.pin`, then: authentication, 2D, game audio, M3G on llvmpipe, sandbox/cgroup/network-namespace checks, RMS across restarts and reboot, backup/restore, migration to a second container, update through `ct/jgo.sh` (`PHS_SILENT=1`), rollback of a release that does not start, refusal of a tampered download.
* The same scenarios run in CI on a real unprivileged LXC container.
* On a real Proxmox VE host: not yet; this PR text will be updated after a test install there.

Date: @DATE@

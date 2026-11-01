// Use one explicit Pulse socket for the daemon, EKA2L1's isolated HOME and capture.
// Empty PULSE_* values override libpulse discovery and must never be forwarded.
export function audioEnvironment(env) {
  const runtime = env.XDG_RUNTIME_DIR || '/tmp/mgo-runtime';
  return {
    PATH: env.PATH,
    XDG_RUNTIME_DIR: runtime,
    PULSE_SERVER: env.PULSE_SERVER || `unix:${runtime}/pulse/native`,
    PULSE_RUNTIME_PATH: env.PULSE_RUNTIME_PATH || `${runtime}/pulse`,
    PULSE_SINK: env.PULSE_SINK || 'mgo_sink',
    PULSE_SOURCE: env.PULSE_SOURCE || 'mgo_sink.monitor',
  };
}

/**
 * J2ME key codes (what the web UI sends: digits as their characters, the rest negative) -> key names of the EKA2L1 control
 * API (`GET /v1/keys` lists them: lsk, rsk, ok, up, down, left, right, clear, star, hash, 0-9, call, end ...).
 * Unknown codes are dropped instead of guessed.
 */
const NAMES = new Map<number, string>([
  [-1, 'up'],
  [-2, 'down'],
  [-3, 'left'],
  [-4, 'right'],
  [-5, 'ok'],
  [-6, 'lsk'],
  [-7, 'rsk'],
  [-8, 'clear'],
  [42, 'star'],
  [35, 'hash'],
  [10, 'ok'],
  [13, 'ok'],
]);
for (let d = 0; d <= 9; d++) NAMES.set(48 + d, String(d));

export function ekaKeyName(code: number): string | null {
  return NAMES.get(code) ?? null;
}

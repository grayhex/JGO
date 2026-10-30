import { useEffect, useState } from 'react';
import type { Action, InputController } from '../input';

/** The set of logical actions currently held by any source; re-renders when it changes. */
export function useHeld(input: InputController | undefined): Set<Action> {
  const [held, setHeld] = useState<Set<Action>>(() => new Set());
  useEffect(() => {
    if (!input) { setHeld(new Set()); return; }
    const sync = () => setHeld(input.heldActions());
    sync();
    return input.subscribe(sync);
  }, [input]);
  return held;
}

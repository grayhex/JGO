import { useCallback, useState } from 'react';
import { ROTATIONS, type Rotation } from './geometry';

const key = (gameId: string) => `j2me-web.rotation.${gameId}`;

/** Some games are made for landscape and draw sideways on a portrait screen: the turn is remembered per game, in this browser. */
export function loadRotation(gameId: string): Rotation {
  try {
    const n = Number(localStorage.getItem(key(gameId)));
    return (ROTATIONS as number[]).includes(n) ? (n as Rotation) : 0;
  } catch {
    return 0;
  }
}

export function useRotation(gameId: string): [Rotation, (r: Rotation) => void] {
  const [r, setR] = useState<Rotation>(() => loadRotation(gameId));
  const set = useCallback((next: Rotation) => {
    setR(next);
    try { if (next === 0) localStorage.removeItem(key(gameId)); else localStorage.setItem(key(gameId), String(next)); } catch { /* storage unavailable */ }
  }, [gameId]);
  return [r, set];
}

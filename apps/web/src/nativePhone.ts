import { useCallback, useEffect, useState } from 'react';
import type { GameMeta } from '@j2me-web/protocol';
import { api } from './api';

/** Poll serially: an unreachable service can take longer than one refresh interval. */
export function useNativePhone(game: GameMeta | null) {
  const [value, setValue] = useState<{ id: string; data: Awaited<ReturnType<typeof api.phonePlan>> | null; error: string | null }>({ id: '', data: null, error: null });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(r => r + 1), []);
  const key = `${game?.id}:${game?.settings.symbianDevice}:${game?.settings.emulatedDeviceId}:${game?.settings.skinId}:${revision}`;
  useEffect(() => {
    if (!game || (game.platform ?? 'j2me') === 'j2me') return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { const data = await api.phonePlan(game.id); if (!dead) setValue({ id: key, data, error: null }); }
      catch (e) { if (!dead) setValue({ id: key, data: null, error: (e as Error).message }); }
      if (!dead) timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => { dead = true; clearTimeout(timer); };
  }, [game?.id, game?.platform, game?.settings.symbianDevice, game?.settings.emulatedDeviceId, game?.settings.skinId, revision]);
  return { data: value.id === key ? value.data : null, error: value.id === key ? value.error : null, refresh };
}

import type { SymbianStatus } from '@j2me-web/protocol';
import type { Config } from '../config.js';
import { agentFromConfig, type AgentHealth } from './agentClient.js';

export async function readSymbianStatus(cfg: Config, inspect?: (health: AgentHealth) => void): Promise<SymbianStatus> {
  const agent = agentFromConfig(cfg);
  const base = { experimental: true as const, configured: !!agent, maxFirmwareBytes: cfg.maxFirmwareBytes, maxPackageBytes: cfg.maxPackageBytes };
  const empty = { ...base, reachable: false, emulator: null, firmware: { installed: false, devices: [] }, defaults: {}, inbox: [], busy: false };
  if (!agent) return { ...empty, message: 'SYMBIAN_AGENT_URL is not set' };
  try {
    const h = await agent.health();
    inspect?.(h);
    return { ...base, reachable: true, emulator: h.emulator, firmware: h.firmware, defaults: h.defaults ?? {}, inbox: h.inbox ?? [], busy: h.instance.running, message: null };
  } catch (e) { return { ...empty, message: e instanceof Error ? e.message : String(e) }; }
}

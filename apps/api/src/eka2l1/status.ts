import type { SymbianStatus } from '@j2me-web/protocol';
import type { Config } from '../config.js';
import { agentFromConfig, type AgentHealth } from './agentClient.js';

export async function readSymbianStatus(cfg: Config, inspect?: (health: AgentHealth) => void): Promise<SymbianStatus> {
  const agent = agentFromConfig(cfg);
  const base = { experimental: true as const, configured: !!agent, maxFirmwareBytes: cfg.maxFirmwareBytes, maxPackageBytes: cfg.maxPackageBytes };
  const empty = { ...base, reachable: false, emulator: null, firmware: { installed: false, devices: [] }, defaults: {}, inbox: [], disk: null, busy: false };
  if (!agent) return { ...empty, message: 'SYMBIAN_AGENT_URL is not set' };
  try {
    const h = await agent.health();
    inspect?.(h);
    return { ...base, reachable: true, emulator: h.emulator, firmware: h.firmware, defaults: h.defaults ?? {}, inbox: h.inbox ?? [], disk: h.disk ?? null, busy: h.instance.running, message: null };
  } catch (e) { return { ...empty, message: e instanceof Error ? e.message : String(e) }; }
}

/** The plain-text report about the Symbian service: versions, devices (codes only), limits, the service log and the emulator's last words. */
export async function symbianDiagnosticsText(cfg: Config): Promise<string> {
  const agent = agentFromConfig(cfg);
  const out: string[] = [`MGO Symbian diagnostics, ${new Date().toISOString()}`, `limits: firmware ${Math.round(cfg.maxFirmwareBytes / 1048576)} MB, package ${Math.round(cfg.maxPackageBytes / 1048576)} MB`];
  if (!agent) out.push('service: not configured (SYMBIAN_AGENT_URL is empty)');
  else {
    try {
      const h = await agent.health();
      out.push(`service: reachable, EKA2L1 ${h.emulator ?? 'unknown build'}`, `devices: ${h.firmware.devices.map((d) => `${d.manufacturer} ${d.model} (${d.code})`).join('; ') || 'none'}`, `defaults: ${JSON.stringify(h.defaults ?? {})}`, `inbox: ${(h.inbox ?? []).map((f) => `${f.name} ${f.size}`).join('; ') || 'empty'}`, `disk: ${h.disk ? `${(h.disk.free / 1024 ** 3).toFixed(1)} GB free of ${(h.disk.total / 1024 ** 3).toFixed(1)} GB` : 'unknown'}`, `instance: ${h.instance.running ? 'running' : 'idle'}`);
      const l = await agent.logs();
      out.push('', `--- service log (${l.live ? 'live' : `last run${l.lastRun ? ' ' + l.lastRun.savedAt : ''}`}) ---`, ...l.agent, '', '--- emulator output ---', ...l.output, '', '--- EKA2L1.log ---', ...l.eka2l1Log);
    } catch (e) { out.push(`service: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return out.join('\n') + '\n';
}

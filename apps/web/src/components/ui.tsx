import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Switch({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span>{children}</span>
    </label>
  );
}

export interface SegOption<T extends string> { value: T; label: ReactNode; title?: string }

/** Radio-group style segmented control. */
export function Seg<T extends string>({ value, options, onChange, label, block, className = '' }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; label: string; block?: boolean; className?: string }) {
  return (
    <div className={`seg ${block ? 'block' : ''} ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Panel({ icon, title, children, open = true, right }: { icon: IconName; title: string; children: ReactNode; open?: boolean; right?: ReactNode }) {
  return (
    <details className="panel" open={open}>
      <summary>
        <Icon name={icon} />
        <span>{title}</span>
        {right}
        <Icon name="chevron" className="chev" />
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  );
}

export function Meter({ value, max, hot, label }: { value: number; max: number; hot?: boolean; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return <div className={`meter ${hot ? 'hot' : ''}`} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}><span style={{ width: `${pct}%` }} /></div>;
}

export function Spark({ values, max, label }: { values: number[]; max?: number; label: string }) {
  const top = max ?? Math.max(1, ...values);
  return <div className="spark" role="img" aria-label={label}>{values.map((v, i) => <span key={i} style={{ height: `${Math.max(4, (v / top) * 100)}%` }} />)}</div>;
}

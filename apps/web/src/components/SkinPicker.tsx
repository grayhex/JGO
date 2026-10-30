import type { LoadedSkin } from '../skin/types';

/** Status badge for a skin's `status`: review drafts are shown as such everywhere, never as certified likenesses. */
export function SkinStatus({ status }: { status: string }) {
  return <span className={`badge ${status === 'review-draft' ? 'mock' : 'prod'}`} title={status === 'review-draft' ? 'Geometry validated, historical accuracy not yet confirmed' : status}>{status === 'review-draft' ? 'review draft' : status}</span>;
}

export function SkinPicker({ skins, value, onChange }: { skins: LoadedSkin[] | null; value: string; onChange: (id: string) => void }) {
  return (
    <div className="skin-picker" role="radiogroup" aria-label="Phone model">
      {(skins ?? []).map((s) => (
        <button key={s.config.id} type="button" role="radio" className="skin-opt" aria-checked={s.config.id === value} onClick={() => onChange(s.config.id)} title={`${s.config.manufacturer} ${s.config.model} (${s.config.year}), display ${s.config.screen.width}×${s.config.screen.height}`}>
          <img src={`${s.base}${s.config.assets.preview ?? 'preview.webp'}`} alt="" loading="lazy" draggable={false} />
          <strong>{s.config.model}</strong>
          <span>{s.config.manufacturer} · {s.config.screen.width}×{s.config.screen.height}</span>
        </button>
      ))}
      {skins === null && <span className="muted small" style={{ padding: 8 }}>Loading models…</span>}
    </div>
  );
}

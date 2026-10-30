import { t as translateUI } from '../i18n';
import { useCatalog } from '../skin/registry';
export function PhonesPage() {
  const { skins, error } = useCatalog();
  return (
    <section>
      <h1>{translateUI('Phones')}</h1>
      <p>{translateUI('Choose a phone in the player. Screen mode enlarges its display without changing the game.')}</p>
      {error && <p role="alert">{error}</p>}
      <div className="phones-models">
        {skins?.map(({ config: c, base }) => (
          <article className="card phone-preview" key={c.id}>
            <img src={base + c.assets.preview} alt={c.model} height="280" />
            <h2>{c.manufacturer} {c.model}</h2>
            <p>{c.screen.width} × {c.screen.height}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

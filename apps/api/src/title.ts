/**
 * Game titles as the collections hand them over: with the names of release groups and sites glued on
 * ("Asphalt 3 **MASYAKA**", "Bounce -zub-", "[NP] Tetris dedomil.net"), or as file-name style words
 * ("ExtremeAirSnowboarding3D", "Rayman_3"). `cleanTitle` gives the title a person would write.
 * It only reads the text: the stored value is never changed, so group keys and saves stay where they are.
 */

/** Names of groups and sites that are never part of a title (compared in lower case, without dots, dashes and spaces). */
const STRONG = ['masyaka', 'terjef', 'dedomil', 'dedomilnet', 'sefan', 'sefanru', 'xmobila', 'mobilux', 'mobiloid']; // never part of a title
const WEAK = ['zub', 'np', 'freezone']; // could be a word of a title ("Zub Zero"): removed only when decorated ("-zub-", "[NP]") or after "by"
const STRONG_SET = new Set(STRONG);
const JUNK_SET = new Set([...STRONG, ...WEAK]);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яё]/g, '');
const DOMAIN = /\b[\w-]+\.(?:net|ru|com|org|su|ua|by|info|biz|kz|pl|de|cc|tk|ws|me)\b/gi;
const RESOLUTION = /\b\d{2,4}\s*[x×]\s*\d{2,4}\b/g;

function isJunk(token: string): boolean {
  const q = squash(token);
  return q !== '' && JUNK_SET.has(q);
}

/** Splits "ExtremeAirSnowboarding3D" and "NFSUnderground2" into words; leaves "3D" together and names that already have spaces alone. */
function splitCamel(s: string): string {
  if (/\s/.test(s) || !/[a-z]/.test(s)) return s;
  // a single capital inside a word is usually a brand ("SimCity"); two or more, or an acronym, is a file name
  const humps = (s.match(/[a-z][A-Z]/g) ?? []).length;
  const acronym = /[A-Z]{2,}[A-Z][a-z]/.test(s);
  const words = humps >= 2 || acronym ? s.replace(/([a-z])([A-Z])/g, '$1 $2') : s;
  return words
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z]{2,})/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function cleanTitle(raw: string): string {
  let s = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ');
  // **MASYAKA**, *x-mobila*, ~terjef~ : emphasis markers around a tag
  s = s.replace(/[*~=]{1,}\s*([^*~=]{1,40}?)\s*[*~=]{1,}/g, (m, inner: string) => (isJunk(inner) || DOMAIN.test(inner) ? ' ' : m));
  DOMAIN.lastIndex = 0;
  // [NP], (dedomil.net), {sefan.ru}, (240x320): brackets that hold only a tag
  s = s.replace(/[\[(\{]\s*([^\])}]{1,40}?)\s*[\])}]/g, (m, inner: string) => {
    const parts = inner.split(/[\s,;/|+&]+/).filter(Boolean);
    const junkOnly = parts.length > 0 && parts.every((p) => isJunk(p) || /^[\w-]+\.(?:net|ru|com|org|su|ua|by|info|biz)$/i.test(p) || /^\d{2,4}[x×]\d{2,4}$/i.test(p) || /^by$/i.test(p));
    return junkOnly ? ' ' : m;
  });
  s = s.replace(DOMAIN, ' ').replace(RESOLUTION, ' ');
  DOMAIN.lastIndex = 0;
  s = s.replace(/_+/g, ' ');
  // "-zub-", "- dedomil", "by freezone": junk words between separators, and a dangling "by" before them
  const words = s.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const bare = w.replace(/^[-–—|~:]+|[-–—|~:]+$/g, '');
    if (bare === '' && /^[-–—|~:]+$/.test(w)) { kept.push(w); continue; }
    const afterBy = kept.length > 0 && /^by$/i.test(kept[kept.length - 1]!);
    if (isJunk(bare) && (STRONG_SET.has(squash(bare)) || bare !== w || afterBy)) { if (afterBy) kept.pop(); continue; }
    kept.push(w);
  }
  s = kept.join(' ');
  // separators left over at the ends or doubled
  s = s.replace(/(?:\s[-–—|~:]){2,}/g, ' -').replace(/^[\s\-–—|~:.,]+|[\s\-–—|~:.,]+$/g, '').replace(/\s{2,}/g, ' ');
  s = s.replace(/\s+by$/i, '');
  const oneWord = !/\s/.test(s);
  s = splitCamel(s);
  if (oneWord && !/[A-Z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1); // "tetris" -> "Tetris", "asphalt3" -> "Asphalt 3"
  return s.trim() || raw.trim();
}

/** Vendors carry the same tags ("Gameloft SA by dedomil.net"). */
export function cleanVendor(raw: string): string {
  return cleanTitle(raw).replace(/\s+by$/i, '');
}

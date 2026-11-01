export interface FactoryVariant { index: number; label: string; files: string[] }
const child = (node: Element, name: string) => [...node.children].find(c => c.tagName === name);
const value = (node: Element | undefined) => node?.textContent?.trim() ?? '';
const safe = (name: string) => name && name.length <= 120 && name.normalize('NFKC') === name && !/[\\/\0:*?"<>|]/.test(name) && !name.startsWith('.') && !name.includes('..');

export async function readFactoryVpl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

/** Matches the desktop installer's VPL variant and image selection; never rewrites XML or filenames. */
export function parseFactoryVpl(text: string): FactoryVariant[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('VPL declarations and external entities are not supported.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'VariantPackingList') throw new Error('Invalid VPL: expected VariantPackingList XML.');
  const variants = [...doc.documentElement.children].filter(v => v.tagName === 'Variant').map((v, index) => {
    const info = child(v, 'VariantIdentification');
    const description = info && value(child(info, 'Description'));
    if (!description) throw new Error('A VPL variant has no description.');
    const code = value(info && child(info, 'ProductCode'));
    const list = child(v, 'FileList');
    const files = [...(list?.children ?? [])].filter(f => f.tagName === 'File' && value(child(f, 'FileType')).toLowerCase() === 'binary' && ['mcu', 'ppm', 'content', 'memorycardcontent'].includes(value(child(f, 'FileSubType')).toLowerCase())).map(f => value(child(f, 'Name')));
    if (!files.length || files.some(name => !safe(name) || !/\.fpsx$/i.test(name))) throw new Error('The VPL must reference plain .fpsx filenames. Select the complete original factory kit.');
    return { index, label: `${description}${code ? ` (${code})` : ''}`, files: [...new Set(files)] };
  });
  if (!variants.length) throw new Error('The VPL contains no variants.');
  return variants;
}

export function checkFactoryFiles(files: readonly Pick<File, 'name'>[]): void {
  if (files.length > 128 || files.filter(f => /\.vpl$/i.test(f.name)).length !== 1 || !files.some(f => /\.fpsx$/i.test(f.name))) throw new Error('Select one .vpl manifest and its .fpsx images (up to 128 files).');
  const seen = new Set<string>();
  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (!safe(file.name) || !/\.(vpl|fpsx)$/i.test(file.name) || seen.has(lower)) throw new Error('Factory kit filenames must be original, unique and contain no directory components.');
    seen.add(lower);
  }
}

// Factory kits must retain relative VPL -> FPSX names. Each browser upload gets
// its own directory; two kits with identical filenames must never share images.
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { safeName } from './policy.mjs';

export const BUNDLE_ID = /^[a-f0-9]{32}$/;
const bad = message => Object.assign(new Error(message), { status: 400, code: 'bad_factory_kit' });
export function factoryDirectory(root, bundle) {
  if (!BUNDLE_ID.test(bundle ?? '')) throw bad('a factory kit requires a 32-hex bundle id');
  return path.join(root, 'factory', bundle);
}
export function factoryUploadPath(root, bundle, name, slot) {
  const normalized = safeName(name);
  if (!normalized || normalized !== name || !(slot === 'vpl' ? /\.vpl$/i : /\.fpsx$/i).test(name)) throw bad('preserve the original .vpl or .fpsx filename, without directory components');
  const dir = factoryDirectory(root, bundle);
  if (existsSync(dir)) {
    if (!lstatSync(dir).isDirectory()) throw bad('invalid factory bundle directory');
    const files = readdirSync(dir);
    if (files.length >= 128) throw bad('a factory bundle is limited to 128 files');
    if (files.some(f => f.toLowerCase() === name.toLowerCase())) throw bad('this filename is already in the bundle; start a fresh upload');
  }
  return path.join(dir, name);
}
export function factoryInstallFiles(root, inbox, request) {
  const { vpl, variant, source, bundle } = request;
  if (source !== undefined && source !== 'inbox') throw bad('source must be inbox or absent');
  if (source === 'inbox' && bundle !== undefined) throw bad('inbox kits must not use an upload bundle');
  if (!safeName(vpl) || safeName(vpl) !== vpl || !/\.vpl$/i.test(vpl)) throw bad('select an original .vpl manifest');
  if (variant !== undefined && (!Number.isInteger(variant) || variant < 0 || variant > 65535)) throw bad('variant must be a zero-based integer');
  const dir = source === 'inbox' ? inbox : factoryDirectory(root, bundle);
  const manifest = path.join(dir, vpl);
  if (!existsSync(manifest) || !lstatSync(manifest).isFile() || lstatSync(manifest).size > 4 * 1024 * 1024) throw bad('the VPL manifest is missing, not a regular file, or larger than 4 MB');
  const images = readdirSync(dir).filter(n => /\.fpsx$/i.test(n) && safeName(n) === n && lstatSync(path.join(dir, n)).isFile());
  if (!images.length) throw bad('provide the .fpsx images beside the VPL with their original filenames');
  return { files: { vpl: manifest }, ...(variant !== undefined ? { variant } : {}), ...(source === 'inbox' ? { keep: true } : { bundleDir: dir }) };
}

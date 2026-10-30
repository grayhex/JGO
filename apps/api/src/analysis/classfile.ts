/**
 * Minimal class-file reader: only the constant pool is parsed. That is all the compatibility
 * analysis needs (which classes/strings a MIDlet refers to) and it keeps the code small and safe
 * (no bytecode interpretation, hard bounds on every read).
 */
export interface ConstantPoolInfo {
  major: number;
  /** Names from CONSTANT_Class entries, internal form (a/b/C). */
  classRefs: string[];
  /** All CONSTANT_Utf8 values (names, descriptors, signatures, string literals). */
  utf8: string[];
  /** CONSTANT_String targets (literals used by the code). */
  strings: string[];
}

export class ClassFormatError extends Error {}

function decodeModifiedUtf8(b: Uint8Array, off: number, len: number): string {
  let s = '';
  const end = off + len;
  for (let i = off; i < end; ) {
    const c = b[i++]!;
    if (c < 0x80) s += String.fromCharCode(c);
    else if ((c & 0xe0) === 0xc0 && i < end) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++]! & 0x3f));
    else if ((c & 0xf0) === 0xe0 && i + 1 < end) {
      s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i]! & 0x3f) << 6) | (b[i + 1]! & 0x3f));
      i += 2;
    } else s += '�';
  }
  return s;
}

export function readConstantPool(b: Uint8Array): ConstantPoolInfo {
  if (b.length < 10 || b[0] !== 0xca || b[1] !== 0xfe || b[2] !== 0xba || b[3] !== 0xbe) throw new ClassFormatError('not a class file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const major = dv.getUint16(6);
  const count = dv.getUint16(8);
  const utf8: (string | undefined)[] = new Array(count);
  const classIdx: number[] = [];
  const stringIdx: number[] = [];
  let p = 10;
  const need = (n: number) => {
    if (p + n > b.length) throw new ClassFormatError('truncated constant pool');
  };
  for (let i = 1; i < count; i++) {
    need(1);
    const tag = b[p++]!;
    switch (tag) {
      case 1: {
        need(2);
        const len = dv.getUint16(p);
        p += 2;
        need(len);
        utf8[i] = decodeModifiedUtf8(b, p, len);
        p += len;
        break;
      }
      case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18:
        need(4); p += 4; break;
      case 5: case 6:
        need(8); p += 8; i++; break; // long/double take two slots
      case 7:
        need(2); classIdx.push(dv.getUint16(p)); p += 2; break;
      case 8:
        need(2); stringIdx.push(dv.getUint16(p)); p += 2; break;
      case 15: need(3); p += 3; break;
      case 16: case 19: case 20: need(2); p += 2; break;
      default:
        throw new ClassFormatError(`unknown constant pool tag ${tag}`);
    }
  }
  return {
    major,
    classRefs: classIdx.map((i) => utf8[i]).filter((s): s is string => !!s),
    utf8: utf8.filter((s): s is string => s !== undefined),
    strings: stringIdx.map((i) => utf8[i]).filter((s): s is string => !!s),
  };
}

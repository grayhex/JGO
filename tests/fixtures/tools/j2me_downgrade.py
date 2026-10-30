#!/usr/bin/env python3
"""Make javac-21 output look like a J2ME-era class file.

* major version -> 48 (KEmulator rejects >= 49)
* drop the MethodParameters attribute that javac 21 emits for anonymous/inner classes: KEmulator reads
  classes through ASM at API level 4, whose MethodVisitor.visitParameter throws RuntimeException.
Usage: j2me_downgrade.py <classes-dir>
"""
import struct
import sys
from pathlib import Path


def skip_cp(b, p, count):
    """Returns (offset after the constant pool, list of utf8 strings by index)."""
    utf8 = {}
    i = 1
    while i < count:
        tag = b[p]
        p += 1
        if tag == 1:
            n = struct.unpack_from(">H", b, p)[0]
            utf8[i] = b[p + 2 : p + 2 + n].decode("utf-8", "replace")
            p += 2 + n
        elif tag in (3, 4, 9, 10, 11, 12, 17, 18):
            p += 4
        elif tag in (5, 6):
            p += 8
            i += 1
        elif tag in (7, 8, 16, 19, 20):
            p += 2
        elif tag == 15:
            p += 3
        else:
            raise ValueError(f"bad constant pool tag {tag}")
        i += 1
    return p, utf8


def strip(b: bytearray) -> bytes:
    b[6:8] = (48).to_bytes(2, "big")
    count = struct.unpack_from(">H", b, 8)[0]
    p, utf8 = skip_cp(b, 10, count)
    p += 6  # access, this, super
    n_if = struct.unpack_from(">H", b, p)[0]
    p += 2 + 2 * n_if
    out = bytearray(b[:p])

    def copy_attrs(p, drop):
        n = struct.unpack_from(">H", b, p)[0]
        q = p + 2
        kept = []
        for _ in range(n):
            name_idx, length = struct.unpack_from(">HI", b, q)
            body = b[q : q + 6 + length]
            q += 6 + length
            if not (drop and utf8.get(name_idx) == "MethodParameters"):
                kept.append(body)
        out.extend(struct.pack(">H", len(kept)))
        for k in kept:
            out.extend(k)
        return q

    for is_method in (False, True):
        n = struct.unpack_from(">H", b, p)[0]
        out.extend(b[p : p + 2])
        p += 2
        for _ in range(n):
            out.extend(b[p : p + 6])  # access, name, descriptor
            p += 6
            p = copy_attrs(p, is_method)
    copy_attrs(p, False)  # class attributes
    return bytes(out)


for f in Path(sys.argv[1]).rglob("*.class"):
    f.write_bytes(strip(bytearray(f.read_bytes())))

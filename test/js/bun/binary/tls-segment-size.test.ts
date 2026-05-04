// Guards against regressing the Windows `.tls` section bloat fixed when
// ~50 `threadlocal var x: bun.PathBuffer` were moved behind
// `bun.ThreadlocalBuffers`.
//
// PE/COFF has no TLS-BSS, so on Windows each of those buffers (96 KB
// apiece there) used to be written into bun.exe as raw zeros — ~5 MB of
// them — and copied into every thread's TLS block at creation. On ELF
// the same declarations land in `.tbss` which costs no disk space, but
// the in-memory template (PT_TLS `MemSiz`) still scaled with them:
// ~340 KB per thread before, ~84 KB after.
//
// This test reads the TLS template size out of the running binary's
// headers and asserts it stays under a ceiling well below the old value,
// so a future reintroduction of large static threadlocals is caught on
// every platform rather than only showing up as a Windows size bump.

import { describe, expect, test } from "bun:test";
import { openSync, readSync, closeSync } from "node:fs";
import { isLinux, isWindows, isFreeBSD } from "harness";

/** Read `len` bytes from `fd` at absolute `offset`. */
function preadExact(fd: number, offset: number, len: number): Buffer {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = readSync(fd, buf, got, len - got, offset + got);
    if (n === 0) throw new Error(`short read at ${offset}`);
    got += n;
  }
  return buf;
}

/**
 * ELF: size of the PT_TLS segment's in-memory template (p_memsz). This is
 * the number of bytes the loader reserves and initialises per thread for
 * static TLS — i.e. the sum of all `threadlocal` storage reachable from
 * the main image.
 */
function elfTlsMemSize(path: string): number {
  const fd = openSync(path, "r");
  try {
    const ehdr = preadExact(fd, 0, 64);
    if (ehdr.readUInt32BE(0) !== 0x7f454c46) throw new Error("not ELF");
    if (ehdr[4] !== 2) throw new Error("only ELF64 supported"); // EI_CLASS
    const le = ehdr[5] === 1; // EI_DATA
    const u16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u64 = (b: Buffer, o: number) => (le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));

    const e_phoff = Number(u64(ehdr, 32));
    const e_phentsize = u16(ehdr, 54);
    const e_phnum = u16(ehdr, 56);

    for (let i = 0; i < e_phnum; i++) {
      const ph = preadExact(fd, e_phoff + i * e_phentsize, e_phentsize);
      const p_type = le ? ph.readUInt32LE(0) : ph.readUInt32BE(0);
      if (p_type === 7 /* PT_TLS */) {
        return Number(u64(ph, 40)); // p_memsz
      }
    }
    return 0; // no TLS segment
  } finally {
    closeSync(fd);
  }
}

/**
 * PE: size of the `.tls` section's VirtualSize. Unlike ELF this is also
 * the on-disk size (PE has no TLS-BSS), so it directly measures the
 * bytes shipped in bun.exe.
 */
function peTlsVirtualSize(path: string): number {
  const fd = openSync(path, "r");
  try {
    const dos = preadExact(fd, 0, 64);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not PE (no MZ)");
    const peOff = dos.readUInt32LE(60);
    const sig = preadExact(fd, peOff, 4);
    if (sig.readUInt32LE(0) !== 0x00004550) throw new Error("not PE (no PE\\0\\0)");

    const coff = preadExact(fd, peOff + 4, 20);
    const numberOfSections = coff.readUInt16LE(2);
    const sizeOfOptionalHeader = coff.readUInt16LE(16);
    const sectOff = peOff + 4 + 20 + sizeOfOptionalHeader;

    for (let i = 0; i < numberOfSections; i++) {
      const sh = preadExact(fd, sectOff + i * 40, 40);
      // Section name is 8 bytes, null-padded.
      const name = sh.subarray(0, 8).toString("latin1").replace(/\0+$/, "");
      if (name === ".tls") {
        return sh.readUInt32LE(8); // VirtualSize
      }
    }
    return 0;
  } finally {
    closeSync(fd);
  }
}

describe("static TLS footprint", () => {
  // Ceiling chosen to sit well between the post-fix size (~82 KB on Linux
  // debug+ASAN, a few KB on Windows release) and the pre-fix size (~340 KB
  // on Linux, ~5 MB on Windows). Generous enough that small additions of
  // pointer-sized threadlocals don't trip it, but any PathBuffer-sized
  // static threadlocal will.
  const CEILING = 192 * 1024;

  test.skipIf(!(isLinux || isFreeBSD))("ELF PT_TLS MemSiz stays under the ceiling", () => {
    const size = elfTlsMemSize(process.execPath);
    console.log(`PT_TLS p_memsz = ${size} bytes (${(size / 1024).toFixed(1)} KB)`);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CEILING);
  });

  test.skipIf(!isWindows)("PE .tls VirtualSize stays under the ceiling", () => {
    const size = peTlsVirtualSize(process.execPath);
    console.log(`.tls VirtualSize = ${size} bytes (${(size / 1024).toFixed(1)} KB)`);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CEILING);
  });
});

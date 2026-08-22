// Model-based fuzzer for PEFile::add_linked_addon (src/exe_format/pe.rs), the
// build-time half of merging `.node` addons into a `bun build --compile` exe on
// Windows. The hand-written cases live in pe-linked-addon-adversarial.test.ts;
// this file generates addons with random layouts instead.
//
// Every iteration builds a random PE32+ DLL together with a model of what it
// contains. Without a poison pill the addon is valid and the merge MUST happen,
// and the merged image plus the `.bunL` record it produces are compared byte for
// byte against what the model says they have to be. With a poison pill (one of
// the conditions pe.rs refuses) the merge MUST be skipped and the host left
// untouched. A third mode corrupts valid addons at random and only checks the
// safety contract: no crash, merged images still validate, skips leave the host
// alone, and the merge never fails with an error.
//
// Runs on every platform through the `peLinkAddon` testing hook. The default
// iteration count is sized for CI and the seed is fixed, so a CI failure is
// reproducible. For a long run pass the count and a per-test timeout:
//
//   PE_FUZZ_ITERATIONS=20000 bun bd test pe-linked-addon-fuzz --timeout 0
//
// Every failure message carries the seed that produced it; replay it with
// PE_FUZZ_SEED=<seed> PE_FUZZ_ITERATIONS=1.

import { peLinkAddon } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

const ITERATIONS = Number(process.env.PE_FUZZ_ITERATIONS ?? 40);
const BASE_SEED = Number(process.env.PE_FUZZ_SEED ?? 0x5eed_0001);

const SECT_ALIGN = 0x1000;
const FILE_ALIGN = 0x200;
const OPT_HDR_SIZE = 240;
const PEOFF = 0x80;
const OPTOFF = PEOFF + 24;
const DDOFF = OPTOFF + 112;
const SHOFF = OPTOFF + OPT_HDR_SIZE;
const MACHINE_X64 = 0x8664;
const MACHINE_ARM64 = 0xaa64;
const TRAMPOLINE = 0x1234; // stands in for the host's exported trampoline (the hook's 4th argument)
const HOST_IMAGE_BASE = 0x1_4000_0000n;

const PAGE_READONLY = 0x02;
const PAGE_READWRITE = 0x04;
const PAGE_EXECUTE_READ = 0x20;
const PAGE_EXECUTE_READWRITE = 0x40;

// ---------------------------------------------------------------------------
// PRNG (splitmix32) so every run is reproducible from its seed.
// ---------------------------------------------------------------------------

class Rng {
  constructor(private state: number) {}
  next(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return this.next() % n;
  }
  /** Integer in [lo, hi]. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
  chance(p: number): boolean {
    return this.next() / 0x1_0000_0000 < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

// ---------------------------------------------------------------------------
// Host: a PE32+ exe with one .text section, plenty of section-header slack and,
// half of the time, an exception directory of its own that the merge has to
// keep in front of the addon's entries.
// ---------------------------------------------------------------------------

interface Host {
  bytes: Buffer;
  machine: number;
  sizeOfImage: number;
  pdata: RuntimeFunction[]; // already host RVAs
}

function makeHost(rng: Rng, machine: number): Host {
  const HDR_SIZE = 0x1000;
  const textRaw = FILE_ALIGN * 2;
  const buf = Buffer.alloc(HDR_SIZE + textRaw);
  const entrySize = machine === MACHINE_ARM64 ? 8 : 12;

  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(PEOFF, 0x3c);
  buf.writeUInt32LE(0x4550, PEOFF);
  buf.writeUInt16LE(machine, PEOFF + 4);
  buf.writeUInt16LE(1, PEOFF + 6);
  buf.writeUInt16LE(OPT_HDR_SIZE, PEOFF + 20);
  buf.writeUInt16LE(0x0022, PEOFF + 22);
  buf.writeUInt16LE(0x020b, OPTOFF);
  buf.writeBigUInt64LE(HOST_IMAGE_BASE, OPTOFF + 24);
  buf.writeUInt32LE(SECT_ALIGN, OPTOFF + 32);
  buf.writeUInt32LE(FILE_ALIGN, OPTOFF + 36);
  buf.writeUInt32LE(2 * SECT_ALIGN, OPTOFF + 56);
  buf.writeUInt32LE(HDR_SIZE, OPTOFF + 60);
  buf.writeUInt16LE(3, OPTOFF + 68);
  buf.writeUInt32LE(16, OPTOFF + 108);

  buf.write(".text", SHOFF, "latin1");
  buf.writeUInt32LE(textRaw, SHOFF + 8);
  buf.writeUInt32LE(SECT_ALIGN, SHOFF + 12);
  buf.writeUInt32LE(textRaw, SHOFF + 16);
  buf.writeUInt32LE(HDR_SIZE, SHOFF + 20);
  buf.writeUInt32LE(0x60000020, SHOFF + 36);

  const pdata: RuntimeFunction[] = [];
  if (rng.chance(0.5)) {
    const n = rng.range(1, 6);
    let begin = SECT_ALIGN;
    for (let i = 0; i < n; i++) {
      const len = rng.range(4, 32) & ~3;
      pdata.push({ begin, end: begin + len, unwind: SECT_ALIGN + 0x300 + i * 16 });
      begin += len + (rng.int(4) << 2);
    }
    // The table lives at the start of .text's raw data; the host's unwind
    // infos are never read by the merge, so they need not exist.
    pdata.forEach((f, i) => {
      const at = HDR_SIZE + i * entrySize;
      buf.writeUInt32LE(f.begin, at);
      if (entrySize === 12) {
        buf.writeUInt32LE(f.end, at + 4);
        buf.writeUInt32LE(f.unwind, at + 8);
      } else {
        buf.writeUInt32LE(f.unwind, at + 4);
      }
    });
    buf.writeUInt32LE(SECT_ALIGN, DDOFF + 3 * 8);
    buf.writeUInt32LE(n * entrySize, DDOFF + 3 * 8 + 4);
  }
  return { bytes: buf, machine, sizeOfImage: 2 * SECT_ALIGN, pdata };
}

// ---------------------------------------------------------------------------
// Addon generator. Everything is laid out with a bump allocator inside the
// first section; further sections carry random bytes so the copy-in and
// protection bookkeeping gets exercised too.
// ---------------------------------------------------------------------------

interface RuntimeFunction {
  begin: number;
  end: number; // unused on ARM64
  unwind: number;
}

interface UnwindInfo {
  rva: number;
  /** Handler RVA named by this record itself (x64 E/U handler or ARM64 X bit). */
  handler?: number;
  /** x64 only: RVA of the unwind info this record chains to. */
  chainTo?: number;
  /** x64 only: offset of the embedded chained RUNTIME_FUNCTION. */
  chainFieldAt?: number;
  /** Offset of the handler field inside the record. */
  handlerFieldAt?: number;
  chainBegin?: number;
  chainEnd?: number;
}

interface ImportEntry {
  iatRva: number;
  ordinal: number; // 0 when imported by name
  name: string; // "" when imported by ordinal
}

interface ImportLib {
  name: string;
  isHost: boolean;
  entries: ImportEntry[];
}

interface SectionModel {
  va: number;
  virtualSize: number;
  rawSize: number;
  rawPtr: number;
  characteristics: number;
}

interface Model {
  machine: number;
  imageBase: bigint;
  sizeOfImage: number;
  entryPoint: number;
  sections: SectionModel[];
  /** Addon RVAs of DIR64 slots, with the values stored there. */
  relocSlots: { rva: number; value: bigint }[];
  /** The reloc directory bytes exactly as written (pe.rs copies them, rebasing page RVAs). */
  relocBlocks: { pageRva: number; entries: number[] }[];
  imports: ImportLib[]; // normal libs first, then delay-load libs, in table order
  exportRegister: number;
  exportApiVersion: number;
  pdata: RuntimeFunction[];
  unwindInfos: Map<number, UnwindInfo>;
  /** Set when the generator deliberately produced something pe.rs must refuse. */
  poison: string | null;
}

interface Generated {
  bytes: Buffer;
  model: Model;
}

const HOST_DLLS = ["node.exe", "NODE.EXE", "node.dll", "bun.exe", "bun-profile.exe"];
const OTHER_DLLS = ["KERNEL32.dll", "api-ms-win-crt-runtime-l1-1-0.dll", "VCRUNTIME140.dll", "ADVAPI32.dll"];
const SYMBOLS = ["napi_create_string_utf8", "napi_module_register", "GetLastError", "memcpy", "_initterm", "uv_close"];

function isHostDll(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "node.exe" || lower === "node.dll" || lower === "bun.exe" || lower.startsWith("bun-");
}

function protectionFor(characteristics: number): number {
  const x = (characteristics & 0x2000_0000) !== 0;
  const w = (characteristics & 0x8000_0000) !== 0;
  if (x && w) return PAGE_EXECUTE_READWRITE;
  if (x) return PAGE_EXECUTE_READ;
  if (w) return PAGE_READWRITE;
  return PAGE_READONLY;
}

const SECTION_FLAGS = [
  0x6000_0020, // code, RX
  0x4000_0040, // initialized data, R
  0xc000_0040, // initialized data, RW
  0xe000_0020, // code, RWX
  0xc000_0080, // uninitialized data, RW
];

function generateAddon(rng: Rng, hostMachine: number, poisonous: boolean): Generated {
  const arm64 = hostMachine === MACHINE_ARM64;
  const poisons: string[] = [];
  const poison = (name: string, p: number): boolean => {
    if (poisonous && poisons.length === 0 && rng.chance(p)) {
      poisons.push(name);
      return true;
    }
    return false;
  };

  const extraSections = rng.int(4);
  // The section table has to fit in the headers: 0x200 holds exactly three headers.
  const HDR_SIZE = SHOFF + (1 + extraSections) * 40 > 0x200 ? 0x400 : rng.pick([0x200, 0x400]);
  const mainRawSize = rng.pick([0x1000, 0x2000, 0x3000]);
  const mainVa = SECT_ALIGN;
  const body = Buffer.alloc(mainRawSize);
  for (let i = 0; i < body.length; i += 4) body.writeUInt32LE(rng.next(), i);
  let cursor = 0;
  const alloc = (size: number, align = 4): number => {
    cursor = (cursor + align - 1) & ~(align - 1);
    const at = cursor;
    cursor += size;
    if (cursor > body.length) throw new Error("generator overflowed the section body; lower the counts");
    return at;
  };
  const rva = (off: number) => mainVa + off;
  const writeCString = (s: string): number => {
    const at = alloc(s.length + 1, 1);
    body.write(s + "\0", at, "latin1");
    return at;
  };

  // --- extra sections -------------------------------------------------------
  const sections: SectionModel[] = [];
  let nextVa = mainVa + Math.max(SECT_ALIGN, (mainRawSize + SECT_ALIGN - 1) & ~(SECT_ALIGN - 1));
  let nextRaw = HDR_SIZE + mainRawSize;
  const extraBodies: { rawPtr: number; bytes: Buffer }[] = [];
  for (let i = 0; i < extraSections; i++) {
    const characteristics = rng.pick(SECTION_FLAGS);
    const bss = (characteristics & 0x80) !== 0 && rng.chance(0.7);
    const rawSize = bss ? 0 : rng.pick([0, FILE_ALIGN, FILE_ALIGN * 2, FILE_ALIGN * 3]);
    const virtualSize = rng.pick([rawSize, rawSize + rng.int(0x300), rng.int(FILE_ALIGN), 0]);
    if (rawSize === 0 && virtualSize === 0 && !rng.chance(0.3)) continue;
    const bytes = Buffer.alloc(rawSize);
    for (let k = 0; k < rawSize; k++) bytes[k] = rng.next() & 0xff;
    const rawPtr = rawSize ? nextRaw : 0;
    if (rawSize) {
      extraBodies.push({ rawPtr, bytes });
      nextRaw += rawSize;
    }
    sections.push({ va: nextVa, virtualSize, rawSize, rawPtr, characteristics });
    const span = Math.max(virtualSize, rawSize);
    nextVa += Math.max(SECT_ALIGN, (span + SECT_ALIGN - 1) & ~(SECT_ALIGN - 1));
  }
  // pe.rs appends the chained-record copies at SizeOfImage, so it refuses one that is not 4-byte aligned.
  const sizeOfImage = nextVa + (poison("misaligned SizeOfImage", 0.03) ? 2 : 0);

  // --- code, entry point, exports --------------------------------------------
  const codeOff = alloc(64, 16);
  body[codeOff] = 0xc3;
  const entryPoint = rng.chance(0.8) ? rva(codeOff) : 0;

  let exportRegister = 0;
  let exportApiVersion = 0;
  const exportNames: { name: string; fnRva: number }[] = [];
  if (rng.chance(0.85)) exportNames.push({ name: "napi_register_module_v1", fnRva: rva(codeOff + 16) });
  if (rng.chance(0.5)) exportNames.push({ name: "node_api_module_get_api_version_v1", fnRva: rva(codeOff + 32) });
  if (rng.chance(0.5)) exportNames.push({ name: "some_other_export", fnRva: rva(codeOff + 48) });
  // Shuffle so the name table order varies.
  exportNames.sort(() => (rng.chance(0.5) ? -1 : 1));
  for (const e of exportNames) {
    if (e.name === "napi_register_module_v1") exportRegister = e.fnRva;
    if (e.name === "node_api_module_get_api_version_v1") exportApiVersion = e.fnRva;
  }

  // --- relocations ------------------------------------------------------------
  const relocSlots: Model["relocSlots"] = [];
  const relocBlocks: Model["relocBlocks"] = [];
  const relocSlotCount = rng.int(12);
  const slotArea = alloc(relocSlotCount * 8 + 8, 8);
  for (let i = 0; i < relocSlotCount; i++) {
    const off = slotArea + i * 8;
    const value = (0x1_8000_0000n + BigInt(rng.int(0x10000))) & 0xffff_ffff_ffffn;
    body.writeBigUInt64LE(value, off);
    relocSlots.push({ rva: rva(off), value });
  }
  if (relocSlotCount > 0 || rng.chance(0.3)) {
    // All slots live in one page; split them across one or two blocks for the same page
    // (linkers never do that, but pe.rs must cope) and pad to an even count.
    const pageRva = rva(slotArea) & ~0xfff;
    const blocks = relocSlotCount > 3 && rng.chance(0.3) ? 2 : 1;
    for (let b = 0; b < blocks; b++) {
      const entries: number[] = [];
      for (let i = b; i < relocSlotCount; i += blocks) {
        entries.push((10 << 12) | (rva(slotArea + i * 8) - pageRva));
      }
      if (entries.length % 2 === 1 || rng.chance(0.3)) entries.push(0); // ABSOLUTE padding
      relocBlocks.push({ pageRva, entries });
    }
  }
  let badRelocType = false;
  if (relocBlocks.length > 0 && relocBlocks[0].entries.length > 0 && poison("reloc type", 0.08)) {
    badRelocType = true;
  }
  const relocsStripped = poison("relocs stripped", 0.05);
  let relocDirRva = 0;
  let relocDirSize = 0;
  if (relocBlocks.length > 0) {
    const total = relocBlocks.reduce((n, blk) => n + 8 + blk.entries.length * 2, 0) + (rng.chance(0.3) ? 8 : 0);
    const at = alloc(total, 4);
    let p = at;
    relocBlocks.forEach((blk, index) => {
      body.writeUInt32LE(blk.pageRva, p);
      body.writeUInt32LE(8 + blk.entries.length * 2, p + 4);
      blk.entries.forEach((e, i) => {
        let value = e;
        if (badRelocType && index === 0 && i === 0) value = (3 << 12) | (e & 0xfff); // HIGHLOW on PE32+
        body.writeUInt16LE(value, p + 8 + i * 2);
      });
      p += 8 + blk.entries.length * 2;
    });
    if (p < at + total) body.fill(0, p, at + total); // optional empty terminator block
    relocDirRva = rva(at);
    relocDirSize = total;
  }

  // --- imports ------------------------------------------------------------------
  const imports: ImportLib[] = [];
  const buildLibs = (
    count: number,
  ): { libs: ImportLib[]; iltRvas: number[]; iatRvas: number[]; nameRvas: number[] } => {
    const libs: ImportLib[] = [];
    const iltRvas: number[] = [];
    const iatRvas: number[] = [];
    const nameRvas: number[] = [];
    for (let l = 0; l < count; l++) {
      const dllName = rng.chance(0.5) ? rng.pick(HOST_DLLS) : rng.pick(OTHER_DLLS);
      const n = rng.range(0, 6);
      const thunks: bigint[] = [];
      const entries: ImportEntry[] = [];
      for (let i = 0; i < n; i++) {
        if (rng.chance(0.25)) {
          const ordinal = rng.range(1, 0xffff);
          thunks.push(0x8000_0000_0000_0000n | BigInt(ordinal));
          entries.push({ iatRva: 0, ordinal, name: "" });
        } else {
          const sym = rng.pick(SYMBOLS);
          const hintAt = alloc(2 + sym.length + 1, 2);
          body.writeUInt16LE(rng.int(0x100), hintAt);
          body.write(sym + "\0", hintAt + 2, "latin1");
          thunks.push(BigInt(rva(hintAt)));
          entries.push({ iatRva: 0, ordinal: 0, name: sym });
        }
      }
      const ilt = alloc((n + 1) * 8, 8);
      const iat = alloc((n + 1) * 8, 8);
      thunks.forEach((t, i) => {
        body.writeBigUInt64LE(t, ilt + i * 8);
        body.writeBigUInt64LE(t, iat + i * 8);
        entries[i].iatRva = rva(iat + i * 8);
      });
      body.writeBigUInt64LE(0n, ilt + n * 8);
      body.writeBigUInt64LE(0n, iat + n * 8);
      libs.push({ name: dllName, isHost: isHostDll(dllName), entries });
      iltRvas.push(rva(ilt));
      iatRvas.push(rva(iat));
      nameRvas.push(rva(writeCString(dllName)));
    }
    return { libs, iltRvas, iatRvas, nameRvas };
  };

  const cxxThrow = poison("_CxxThrowException import", 0.08);
  const normalCount = rng.int(4) + (cxxThrow ? 1 : 0);
  const normal = buildLibs(normalCount);
  if (cxxThrow) {
    // Replace one entry of the last lib with the import pe.rs refuses.
    const lib = normal.libs[normal.libs.length - 1];
    const hintAt = alloc(2 + "_CxxThrowException".length + 1, 2);
    body.writeUInt16LE(0, hintAt);
    body.write("_CxxThrowException\0", hintAt + 2, "latin1");
    const ilt = alloc(16, 8);
    const iat = alloc(16, 8);
    body.writeBigUInt64LE(BigInt(rva(hintAt)), ilt);
    body.writeBigUInt64LE(0n, ilt + 8);
    body.writeBigUInt64LE(BigInt(rva(hintAt)), iat);
    body.writeBigUInt64LE(0n, iat + 8);
    normal.iltRvas[normal.iltRvas.length - 1] = rva(ilt);
    normal.iatRvas[normal.iatRvas.length - 1] = rva(iat);
    lib.entries = [{ iatRva: rva(iat), ordinal: 0, name: "_CxxThrowException" }];
  }
  let importDirRva = 0;
  let importDirSize = 0;
  if (normal.libs.length > 0) {
    const at = alloc((normal.libs.length + 1) * 20, 4);
    normal.libs.forEach((_, i) => {
      const d = at + i * 20;
      // Some linkers omit OriginalFirstThunk; pe.rs then walks the IAT itself.
      body.writeUInt32LE(rng.chance(0.2) ? 0 : normal.iltRvas[i], d);
      body.writeUInt32LE(0, d + 4);
      body.writeUInt32LE(0, d + 8);
      body.writeUInt32LE(normal.nameRvas[i], d + 12);
      body.writeUInt32LE(normal.iatRvas[i], d + 16);
    });
    body.fill(0, at + normal.libs.length * 20, at + (normal.libs.length + 1) * 20);
    importDirRva = rva(at);
    importDirSize = (normal.libs.length + (rng.chance(0.5) ? 1 : 0)) * 20;
  }
  imports.push(...normal.libs);

  const v1Delay = poison("v1 delay-load descriptor", 0.05);
  const delayCount = rng.chance(0.3) ? rng.range(1, 2) : v1Delay ? 1 : 0;
  let delayDirRva = 0;
  let delayDirSize = 0;
  if (delayCount > 0) {
    const delay = buildLibs(delayCount);
    const at = alloc((delayCount + 1) * 32, 4);
    delay.libs.forEach((_, i) => {
      const d = at + i * 32;
      body.writeUInt32LE(v1Delay && i === 0 ? 0 : 1, d); // Attributes: bit 0 = RVA form
      body.writeUInt32LE(delay.nameRvas[i], d + 4);
      body.writeUInt32LE(rva(alloc(8, 8)), d + 8); // module handle slot
      body.writeUInt32LE(delay.iatRvas[i], d + 12);
      body.writeUInt32LE(delay.iltRvas[i], d + 16);
      body.fill(0, d + 20, d + 32);
    });
    body.fill(0, at + delayCount * 32, at + (delayCount + 1) * 32);
    delayDirRva = rva(at);
    delayDirSize = (delayCount + (rng.chance(0.5) ? 1 : 0)) * 32;
    imports.push(...delay.libs);
  }

  // --- export directory ---------------------------------------------------------
  let exportDirRva = 0;
  if (exportNames.length > 0 || rng.chance(0.2)) {
    const n = exportNames.length;
    const funcs = alloc(Math.max(n, 1) * 4, 4);
    const names = alloc(Math.max(n, 1) * 4, 4);
    const ords = alloc(Math.max(n, 1) * 2, 2);
    exportNames.forEach((e, i) => {
      body.writeUInt32LE(e.fnRva, funcs + i * 4);
      body.writeUInt32LE(rva(writeCString(e.name)), names + i * 4);
      body.writeUInt16LE(i, ords + i * 2);
    });
    const dir = alloc(40, 4);
    body.fill(0, dir, dir + 40);
    body.writeUInt32LE(rva(writeCString("addon.node")), dir + 12);
    body.writeUInt32LE(1, dir + 16);
    body.writeUInt32LE(n, dir + 20);
    body.writeUInt32LE(n, dir + 24);
    body.writeUInt32LE(rva(funcs), dir + 28);
    body.writeUInt32LE(rva(names), dir + 32);
    body.writeUInt32LE(rva(ords), dir + 36);
    exportDirRva = rva(dir);
  }

  // --- TLS -----------------------------------------------------------------------
  let tlsDirRva = 0;
  let tlsDirSize = 0;
  const tlsKind = poison("real TLS template", 0.08)
    ? "real"
    : poison("truncated TLS directory", 0.03)
      ? "truncated"
      : rng.chance(0.6)
        ? "empty"
        : "none";
  if (tlsKind !== "none") {
    const dir = alloc(40, 8);
    body.fill(0, dir, dir + 40);
    const start = 0x1_8000_2000n;
    body.writeBigUInt64LE(start, dir);
    body.writeBigUInt64LE(tlsKind === "real" && rng.chance(0.7) ? start + 8n : start, dir + 8);
    body.writeBigUInt64LE(0x1_8000_3000n, dir + 16);
    body.writeBigUInt64LE(0x1_8000_3008n, dir + 24);
    if (tlsKind === "real" && body.readBigUInt64LE(dir + 8) === start) body.writeUInt32LE(16, dir + 32);
    tlsDirRva = rva(dir);
    tlsDirSize = tlsKind === "truncated" ? rng.range(1, 39) : 40;
  }

  // --- exception directory -----------------------------------------------------
  const unwindInfos = new Map<number, UnwindInfo>();
  const pdata: RuntimeFunction[] = [];
  const handlerPool = [rva(codeOff), rva(codeOff + 8)];
  const records: UnwindInfo[] = [];
  const unwindCount = rng.chance(0.25) ? 0 : rng.range(1, 8);
  const noTrampoline = unwindCount > 0 && poison("handlers without a trampoline", 0.05);
  const badVersion = unwindCount > 0 && poison("unknown unwind version", 0.05);
  let anyHandler = false;
  for (let i = 0; i < unwindCount; i++) {
    if (arm64) {
      const codeWords = rng.range(1, 3);
      const epilogs = rng.int(3);
      const singleEpilog = rng.chance(0.4);
      const withHandler = rng.chance(0.6);
      const useExtension = rng.chance(0.15);
      const size =
        4 + (useExtension ? 4 : 0) + (singleEpilog ? 0 : epilogs * 4) + codeWords * 4 + (withHandler ? 4 : 0);
      const at = alloc(size, 4);
      let header = rng.int(0x3ffff); // function length bits
      if (badVersion && i === 0) header |= rng.range(1, 3) << 18;
      if (withHandler) header |= 1 << 20;
      if (singleEpilog) header |= 1 << 21;
      let pos = at + 4;
      if (useExtension) {
        body.writeUInt32LE(header, at); // epilog count and code words both 0 => extension word follows
        body.writeUInt32LE((singleEpilog ? 0 : epilogs) | (codeWords << 16), pos);
        pos += 4;
      } else {
        header |= (singleEpilog ? rng.int(0x1f) : epilogs) << 22;
        header = (header | (codeWords << 27)) >>> 0;
        body.writeUInt32LE(header >>> 0, at);
      }
      if (useExtension && singleEpilog) {
        // With E set the (extended) epilog count is an index, not a scope count: nothing follows.
      } else if (!singleEpilog) {
        for (let e = 0; e < epilogs; e++, pos += 4) body.writeUInt32LE(rng.next(), pos);
      }
      for (let c = 0; c < codeWords; c++, pos += 4) body.writeUInt32LE(rng.next(), pos);
      const info: UnwindInfo = { rva: rva(at) };
      if (withHandler) {
        info.handler = rng.pick(handlerPool);
        info.handlerFieldAt = pos - at;
        body.writeUInt32LE(info.handler, pos);
        anyHandler = true;
      }
      records.push(info);
    } else {
      const codeCount = rng.int(5);
      const padded = codeCount + (codeCount & 1);
      const kind = records.length > 0 && rng.chance(0.3) ? "chain" : rng.chance(0.6) ? "handler" : "plain";
      const tail = 4 + padded * 2;
      const size = tail + (kind === "chain" ? 12 : kind === "handler" ? 4 + rng.int(3) * 4 : 0);
      const at = alloc(size, 4);
      const version = badVersion && i === 0 ? rng.pick([0, 3, 4, 7]) : rng.pick([1, 1, 2]);
      const flags = kind === "chain" ? 4 : kind === "handler" ? rng.pick([1, 2, 3]) : 0;
      body[at] = version | (flags << 3);
      body[at + 1] = rng.int(0x100);
      body[at + 2] = codeCount;
      body[at + 3] = rng.int(0x100);
      for (let c = 0; c < padded; c++) body.writeUInt16LE(rng.int(0x10000), at + 4 + c * 2);
      const info: UnwindInfo = { rva: rva(at) };
      if (kind === "chain") {
        const target = rng.pick(records);
        info.chainTo = target.rva;
        info.chainFieldAt = tail;
        info.chainBegin = rva(codeOff);
        info.chainEnd = rva(codeOff + 4 + rng.int(8) * 4);
        body.writeUInt32LE(info.chainBegin, at + tail);
        body.writeUInt32LE(info.chainEnd, at + tail + 4);
        body.writeUInt32LE(target.rva, at + tail + 8);
      } else if (kind === "handler") {
        info.handler = rng.pick(handlerPool);
        info.handlerFieldAt = tail;
        body.writeUInt32LE(info.handler, at + tail);
        for (let p = tail + 4; p < size; p += 4) body.writeUInt32LE(rng.next(), at + p); // language data
        anyHandler = true;
      }
      records.push(info);
    }
  }
  for (const r of records) unwindInfos.set(r.rva, r);
  if (records.length > 0 && !arm64 && poison("circular unwind chain", 0.05)) {
    const chained = records.filter(r => r.chainTo !== undefined);
    const victim = chained.length > 0 ? rng.pick(chained) : null;
    if (victim) {
      victim.chainTo = victim.rva;
      body.writeUInt32LE(victim.rva, victim.rva - mainVa + victim.chainFieldAt! + 8);
    } else {
      poisons.pop();
    }
  }
  if (noTrampoline && !anyHandler && !chainReachesHandler(records, unwindInfos)) poisons.pop();
  let pdataDirRva = 0;
  let pdataDirSize = 0;
  const entrySize = arm64 ? 8 : 12;
  if (records.length > 0) {
    // One table entry per record, plus a few extra entries sharing records, sorted by begin.
    const n = records.length + rng.int(3);
    let begin = rva(codeOff);
    for (let i = 0; i < n; i++) {
      const len = rng.range(1, 8) * 2;
      const record = i < records.length ? records[i] : rng.pick(records);
      pdata.push({ begin, end: begin + len, unwind: record.rva });
      begin += len + rng.int(3) * 2;
    }
    if (arm64 && rng.chance(0.3)) {
      // A packed entry: no unwind record, the second word carries the flag bits.
      const packedWord = (rng.next() & ~3) | rng.range(1, 3);
      pdata.push({ begin, end: begin + 8, unwind: packedWord >>> 0 });
    }
    const unsorted = pdata.length > 1 && poison("unsorted exception entries", 0.05);
    const indirect = !arm64 && poison("indirect exception entry", 0.04);
    const at = alloc(pdata.length * entrySize, 4);
    pdata.forEach((f, i) => {
      const e = at + i * entrySize;
      let b = f.begin;
      if (unsorted && i === 1) b = pdata[0].begin;
      body.writeUInt32LE(b, e);
      if (arm64) {
        body.writeUInt32LE(f.unwind, e + 4);
      } else {
        body.writeUInt32LE(f.end, e + 4);
        body.writeUInt32LE(indirect && i === 0 ? f.unwind | 1 : f.unwind, e + 8);
      }
    });
    pdataDirRva = rva(at);
    pdataDirSize = pdata.length * entrySize;
    if (poison("exception directory size not a multiple of the entry size", 0.03))
      pdataDirSize += rng.range(1, entrySize - 1);
  }

  // --- headers -----------------------------------------------------------------
  const machine = poison("machine mismatch", 0.05) ? (arm64 ? MACHINE_X64 : MACHINE_ARM64) : hostMachine;
  const numberOfSections = 1 + sections.length;
  const file = Buffer.alloc(nextRaw);
  file.writeUInt16LE(0x5a4d, 0);
  file.writeUInt32LE(PEOFF, 0x3c);
  file.writeUInt32LE(0x4550, PEOFF);
  file.writeUInt16LE(machine, PEOFF + 4);
  file.writeUInt16LE(numberOfSections, PEOFF + 6);
  file.writeUInt16LE(OPT_HDR_SIZE, PEOFF + 20);
  file.writeUInt16LE(0x2022 | (relocsStripped ? 1 : 0), PEOFF + 22);
  file.writeUInt16LE(0x020b, OPTOFF);
  file.writeUInt32LE(entryPoint, OPTOFF + 16);
  const imageBase = 0x1_8000_0000n + (BigInt(rng.int(0x100)) << 16n);
  file.writeBigUInt64LE(imageBase, OPTOFF + 24);
  file.writeUInt32LE(SECT_ALIGN, OPTOFF + 32);
  file.writeUInt32LE(FILE_ALIGN, OPTOFF + 36);
  file.writeUInt32LE(sizeOfImage, OPTOFF + 56);
  file.writeUInt32LE(HDR_SIZE, OPTOFF + 60);
  file.writeUInt16LE(2, OPTOFF + 68);
  file.writeUInt32LE(16, OPTOFF + 108);
  const setDir = (i: number, dirRva: number, size: number) => {
    file.writeUInt32LE(dirRva, DDOFF + i * 8);
    file.writeUInt32LE(size, DDOFF + i * 8 + 4);
  };
  if (exportDirRva) setDir(0, exportDirRva, 40);
  if (importDirRva) setDir(1, importDirRva, importDirSize);
  if (pdataDirRva) setDir(3, pdataDirRva, pdataDirSize);
  if (relocDirRva) setDir(5, relocDirRva, relocDirSize);
  if (tlsDirRva) setDir(9, tlsDirRva, tlsDirSize);
  if (delayDirRva) setDir(13, delayDirRva, delayDirSize);

  const mainVirtualSize = rng.chance(0.3) ? cursor : mainRawSize;
  const mainSection: SectionModel = {
    va: mainVa,
    virtualSize: mainVirtualSize,
    rawSize: mainRawSize,
    rawPtr: HDR_SIZE,
    characteristics: rng.pick([0x6000_0020, 0xe000_0020, 0xc000_0040]),
  };
  const all = [mainSection, ...sections];
  all.forEach((s, i) => {
    const h = SHOFF + i * 40;
    file.write(i === 0 ? ".text" : `.s${i}`, h, "latin1");
    file.writeUInt32LE(s.virtualSize, h + 8);
    file.writeUInt32LE(s.va, h + 12);
    file.writeUInt32LE(s.rawSize, h + 16);
    file.writeUInt32LE(s.rawPtr, h + 20);
    file.writeUInt32LE(s.characteristics, h + 36);
  });
  body.copy(file, HDR_SIZE);
  for (const extra of extraBodies) extra.bytes.copy(file, extra.rawPtr);

  return {
    bytes: file,
    model: {
      machine,
      imageBase,
      sizeOfImage,
      entryPoint,
      sections: all,
      relocSlots,
      relocBlocks,
      imports,
      exportRegister,
      exportApiVersion,
      pdata,
      unwindInfos,
      poison: poisons[0] ?? null,
    },
  };
}

/** True if following chains from any record reaches one with a handler. */
function chainReachesHandler(records: UnwindInfo[], infos: Map<number, UnwindInfo>): boolean {
  return records.some(r => chainHandler(r.rva, infos) !== undefined);
}

/** The handler the chain starting at `unwindRva` ends in, mirroring UnwindPatcher. */
function chainHandler(unwindRva: number, infos: Map<number, UnwindInfo>): number | undefined {
  let current = infos.get(unwindRva);
  for (let depth = 0; current && depth <= 40; depth++) {
    if (current.chainTo === undefined) return current.handler;
    current = infos.get(current.chainTo);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Model: what a merge of a valid addon has to produce.
// ---------------------------------------------------------------------------

/** The merged `.bnN` section contents pe.rs must have produced for this addon. */
function expectedImage(gen: Generated, rvaBase: number, trampoline: number): Buffer {
  const { bytes, model } = gen;
  const image = Buffer.alloc(model.sizeOfImage);
  for (const s of model.sections) {
    const copyLen = Math.min(s.rawSize, model.sizeOfImage - s.va);
    if (copyLen > 0) bytes.copy(image, s.va, s.rawPtr, s.rawPtr + copyLen);
  }
  const delta = HOST_IMAGE_BASE + BigInt(rvaBase) - model.imageBase;
  for (const slot of model.relocSlots) {
    image.writeBigUInt64LE(BigInt.asUintN(64, slot.value + delta), slot.rva);
  }
  for (const lib of model.imports) for (const e of lib.entries) image.writeBigUInt64LE(0n, e.iatRva);
  // Unwind infos reachable from the table are rewritten; unreachable ones are left alone.
  for (const unwindRva of reachableUnwindInfos(model)) {
    const info = model.unwindInfos.get(unwindRva)!;
    if (info.chainTo !== undefined) {
      const at = info.rva + info.chainFieldAt!;
      image.writeUInt32LE(info.chainBegin! + rvaBase, at);
      image.writeUInt32LE(info.chainEnd! + rvaBase, at + 4);
      image.writeUInt32LE(info.chainTo + rvaBase, at + 8);
    } else if (info.handler !== undefined) {
      image.writeUInt32LE(trampoline, info.rva + info.handlerFieldAt!);
    }
  }
  return image;
}

/** Addon RVAs of every unwind info the table entries lead to, following chains. */
function reachableUnwindInfos(model: Model): Set<number> {
  const reachable = new Set<number>();
  for (const f of model.pdata) {
    if (model.machine === MACHINE_ARM64 && (f.unwind & 3) !== 0) continue;
    let current = model.unwindInfos.get(f.unwind);
    while (current && !reachable.has(current.rva)) {
      reachable.add(current.rva);
      current = current.chainTo === undefined ? undefined : model.unwindInfos.get(current.chainTo);
    }
  }
  return reachable;
}

type Redirect = [unwindInfo: number, handler: number, view: number];

/**
 * Checks the handler index and the appendix of chained-record copies against the model. Every
 * reachable record whose chain ends in a handler gets an entry; a plain record is presented as
 * itself, a chained record as a copy placed after the image whose embedded entry chains, in addon
 * terms, to whatever its target is presented as; and each copy gets an entry of its own. The copies
 * have to tile the appendix exactly. `merged` is the whole `.bnN` payload, `prefix` the model's
 * image (a copy's header and codes are byte-identical to its original's).
 */
function checkHandlers(
  model: Model,
  rvaBase: number,
  handlers: Redirect[],
  sectionSize: number,
  merged: Buffer,
  prefix: Buffer,
) {
  const byKey = new Map(handlers.map(h => [h[0], h]));
  expect(byKey.size).toBe(handlers.length);
  expect(handlers.map(h => h[0])).toEqual([...handlers.map(h => h[0])].sort((a, b) => a - b));

  const withHandler = [...reachableUnwindInfos(model)].filter(
    rva => chainHandler(rva, model.unwindInfos) !== undefined,
  );
  const copies: { at: number; size: number }[] = [];
  let expectedEntries = 0;
  for (const rva of withHandler) {
    const info = model.unwindInfos.get(rva)!;
    const entry = byKey.get(rva + rvaBase);
    expect(entry, `no entry for unwind info 0x${rva.toString(16)}`).toBeDefined();
    expect(entry![1]).toBe(chainHandler(rva, model.unwindInfos)! + rvaBase);
    expectedEntries++;
    if (info.chainTo === undefined) {
      expect(entry![2]).toBe(rva);
      continue;
    }
    const view = entry![2];
    const size = info.chainFieldAt! + 12;
    expect(view).toBeGreaterThanOrEqual(model.sizeOfImage);
    expect(view + size).toBeLessThanOrEqual(sectionSize);
    copies.push({ at: view, size });
    expectedEntries++;
    expect(byKey.get(view + rvaBase)).toEqual([view + rvaBase, entry![1], view]);
    const copy = merged.subarray(view, view + size);
    expect(copy.subarray(0, info.chainFieldAt!).equals(prefix.subarray(rva, rva + info.chainFieldAt!))).toBe(true);
    const targetView = byKey.get(info.chainTo + rvaBase)![2];
    expect([
      copy.readUInt32LE(info.chainFieldAt!),
      copy.readUInt32LE(info.chainFieldAt! + 4),
      copy.readUInt32LE(info.chainFieldAt! + 8),
    ]).toEqual([info.chainBegin!, info.chainEnd!, targetView]);
  }
  expect(handlers).toHaveLength(expectedEntries);

  copies.sort((a, b) => a.at - b.at);
  let next = model.sizeOfImage;
  for (const c of copies) {
    expect(c.at).toBe(next);
    next += c.size;
  }
  expect(next).toBe(sectionSize);
  expect(merged.length).toBe(sectionSize);
}

interface BlobRecord {
  name: string;
  rvaBase: number;
  imageSize: number;
  entryPoint: number;
  preferredBase: bigint;
  exportRegister: number;
  exportApiVersion: number;
  sections: { rva: number; size: number; protect: number }[];
  relocs: Buffer;
  imports: { name: string; isHost: boolean; entries: { iatRva: number; ordinal: number; name: string }[] }[];
}

function parseBlob(blob: Buffer): { record: BlobRecord; sectionSize: number; handlers: Redirect[] } {
  let pos = 0;
  const u32 = () => {
    const v = blob.readUInt32LE(pos);
    pos += 4;
    return v;
  };
  const str = () => {
    const n = u32();
    const s = blob.subarray(pos, pos + n);
    pos += n;
    return s;
  };
  expect(u32()).toBe(0x4b4e4c42);
  expect(u32()).toBe(3);
  expect(u32()).toBe(1);
  const indexRvaBase = u32();
  const sectionSize = u32();
  const handlersPos = u32();
  const handlerCount = u32();
  const name = str().toString("latin1");
  const rvaBase = u32();
  const imageSize = u32();
  const entryPoint = u32();
  const preferredBase = blob.readBigUInt64LE(pos);
  pos += 8;
  const exportRegister = u32();
  const exportApiVersion = u32();
  const sections = [];
  for (let n = u32(); n > 0; n--) sections.push({ rva: u32(), size: u32(), protect: u32() });
  const relocs = Buffer.from(str());
  const imports = [];
  for (let n = u32(); n > 0; n--) {
    const libName = str().toString("latin1");
    const isHost = blob[pos++] !== 0;
    const entries = [];
    for (let m = u32(); m > 0; m--) {
      const iatRva = u32();
      const ordinal = blob.readUInt16LE(pos);
      pos += 2;
      entries.push({ iatRva, ordinal, name: str().toString("latin1") });
    }
    imports.push({ name: libName, isHost, entries });
  }
  expect([indexRvaBase, handlersPos]).toEqual([rvaBase, pos]);
  expect(sectionSize).toBeGreaterThanOrEqual(imageSize);
  const handlers: Redirect[] = [];
  for (let i = 0; i < handlerCount; i++) {
    handlers.push([blob.readUInt32LE(pos), blob.readUInt32LE(pos + 4), blob.readUInt32LE(pos + 8)]);
    pos += 12;
  }
  expect(pos).toBe(blob.length);
  return {
    record: {
      name,
      rvaBase,
      imageSize,
      entryPoint,
      preferredBase,
      exportRegister,
      exportApiVersion,
      sections,
      relocs,
      imports,
    },
    sectionSize,
    handlers,
  };
}

function expectedRelocs(model: Model, rvaBase: number): Buffer {
  const parts: Buffer[] = [];
  for (const blk of model.relocBlocks) {
    const b = Buffer.alloc(8 + blk.entries.length * 2);
    b.writeUInt32LE(blk.pageRva + rvaBase, 0);
    b.writeUInt32LE(b.length, 4);
    blk.entries.forEach((e, i) => b.writeUInt16LE(e, 8 + i * 2));
    parts.push(b);
  }
  return Buffer.concat(parts);
}

interface SectionHeader {
  name: string;
  va: number;
  virtualSize: number;
  rawPtr: number;
  rawSize: number;
}

function sectionHeaders(pe: Buffer): SectionHeader[] {
  const peOff = pe.readUInt32LE(0x3c);
  const n = pe.readUInt16LE(peOff + 6);
  const sh = peOff + 24 + pe.readUInt16LE(peOff + 20);
  const out: SectionHeader[] = [];
  for (let i = 0; i < n; i++) {
    const h = sh + i * 40;
    const raw = pe.subarray(h, h + 8);
    const z = raw.indexOf(0);
    out.push({
      name: raw.subarray(0, z === -1 ? 8 : z).toString("latin1"),
      virtualSize: pe.readUInt32LE(h + 8),
      va: pe.readUInt32LE(h + 12),
      rawSize: pe.readUInt32LE(h + 16),
      rawPtr: pe.readUInt32LE(h + 20),
    });
  }
  return out;
}

function exceptionDirectory(pe: Buffer, entrySize: number): number[][] | null {
  const dirRva = pe.readUInt32LE(DDOFF + 3 * 8);
  const size = pe.readUInt32LE(DDOFF + 3 * 8 + 4);
  if (dirRva === 0 && size === 0) return null;
  const home = sectionHeaders(pe).find(s => dirRva >= s.va && dirRva + size <= s.va + s.rawSize);
  expect(home).toBeDefined();
  const at = home!.rawPtr + (dirRva - home!.va);
  const out: number[][] = [];
  for (let p = at; p < at + size; p += entrySize) {
    const words: number[] = [];
    for (let w = 0; w < entrySize; w += 4) words.push(pe.readUInt32LE(p + w));
    out.push(words);
  }
  return out;
}

function entryWords(f: RuntimeFunction, arm64: boolean, rebase: number): number[] {
  if (arm64) return [f.begin + rebase, (f.unwind & 3) !== 0 ? f.unwind : f.unwind + rebase];
  return [f.begin + rebase, f.end + rebase, f.unwind + rebase];
}

function checkMergedAgainstModel(host: Host, gen: Generated, result: ReturnType<typeof peLinkAddon>, name: string) {
  const { model } = gen;
  const output = Buffer.from(result.output!);
  const rvaBase = result.rvaBase!;
  expect(rvaBase % SECT_ALIGN).toBe(0);
  expect(rvaBase).toBeGreaterThanOrEqual(host.sizeOfImage);

  const headers = sectionHeaders(output);
  expect(headers.map(h => h.name)).toEqual([".text", ".bn0", ".bunL"]);
  const bn0 = headers[1];
  expect(bn0.va).toBe(rvaBase);
  const { record, sectionSize, handlers } = parseBlob(Buffer.from(result.metadata!));
  expect(bn0.virtualSize).toBe(sectionSize);
  const merged = output.subarray(bn0.rawPtr, bn0.rawPtr + sectionSize);
  const wanted = expectedImage(gen, rvaBase, TRAMPOLINE);
  const imagePart = merged.subarray(0, model.sizeOfImage);
  if (!imagePart.equals(wanted)) {
    const at = imagePart.findIndex((b, i) => b !== wanted[i]);
    throw new Error(`merged image differs from the model at addon RVA 0x${at.toString(16)}`);
  }
  checkHandlers(model, rvaBase, handlers, sectionSize, merged, wanted);

  expect(record).toEqual({
    name,
    rvaBase,
    imageSize: model.sizeOfImage,
    entryPoint: model.entryPoint ? model.entryPoint + rvaBase : 0,
    preferredBase: HOST_IMAGE_BASE,
    exportRegister: model.exportRegister ? model.exportRegister + rvaBase : 0,
    exportApiVersion: model.exportApiVersion ? model.exportApiVersion + rvaBase : 0,
    sections: model.sections
      .filter(s => Math.max(s.virtualSize, s.rawSize) > 0)
      .map(s => ({
        rva: s.va + rvaBase,
        size: Math.min(Math.max(s.virtualSize, s.rawSize), model.sizeOfImage - s.va),
        protect: protectionFor(s.characteristics),
      })),
    relocs: expectedRelocs(model, rvaBase),
    imports: model.imports.map(lib => ({
      name: lib.name,
      isHost: lib.isHost,
      entries: lib.entries.map(e => ({ iatRva: e.iatRva + rvaBase, ordinal: e.ordinal, name: e.name })),
    })),
  });

  const arm64 = host.machine === MACHINE_ARM64;
  const entrySize = arm64 ? 8 : 12;
  const expectedTable = [
    ...host.pdata.map(f => entryWords(f, arm64, 0)),
    ...model.pdata.map(f => entryWords(f, arm64, rvaBase)),
  ];
  expect(exceptionDirectory(output, entrySize)).toEqual(expectedTable.length > 0 ? expectedTable : null);
}

// ---------------------------------------------------------------------------
// The fuzz loops.
// ---------------------------------------------------------------------------

function outcome(result: ReturnType<typeof peLinkAddon>): "merged" | "skipped" | "error" {
  if (result.error !== undefined) return "error";
  return result.skipped ? "skipped" : "merged";
}

function describeFailure(seed: number, mode: string, detail: string): string {
  return `${mode} iteration failed (${detail}); replay with PE_FUZZ_SEED=${seed} PE_FUZZ_ITERATIONS=1`;
}

/** Enough of the model to see which gate a wrong skip or merge must have come from. */
function summarize(model: Model): string {
  const unwind = [...model.unwindInfos.values()].map(u =>
    u.chainTo !== undefined ? `chain->0x${u.chainTo.toString(16)}` : u.handler !== undefined ? "handler" : "plain",
  );
  return JSON.stringify({
    machine: model.machine.toString(16),
    sizeOfImage: model.sizeOfImage,
    sections: model.sections.map(s => [s.va, s.virtualSize, s.rawSize, s.characteristics.toString(16)]),
    relocSlots: model.relocSlots.length,
    relocBlocks: model.relocBlocks.map(b => b.entries.length),
    imports: model.imports.map(l => `${l.name}[${l.entries.map(e => e.name || "#" + e.ordinal).join(",")}]`),
    exports: [model.exportRegister, model.exportApiVersion],
    entryPoint: model.entryPoint,
    pdata: model.pdata.map(f => [f.begin, f.end, f.unwind.toString(16)]),
    unwind,
  });
}

const MODE_SALT = { valid: 0, poisoned: 0x10_0000, mutated: 0x20_0000 } as const;

function runIteration(seed: number, mode: "valid" | "poisoned" | "mutated") {
  const rng = new Rng((seed + MODE_SALT[mode]) >>> 0);
  const machine = rng.chance(0.25) ? MACHINE_ARM64 : MACHINE_X64;
  const host = makeHost(rng, machine);
  const gen = generateAddon(rng, machine, mode === "poisoned");
  const name = `B:/~BUN/root/addon-${seed.toString(16)}.node`;
  const hostBefore = Buffer.from(host.bytes);

  if (mode === "mutated") {
    const addon = gen.bytes;
    const flips = rng.range(1, 8);
    for (let i = 0; i < flips; i++) {
      const at = rng.chance(0.5) ? rng.int(Math.min(addon.length, 0x400)) : rng.int(addon.length);
      addon[at] = rng.chance(0.3) ? 0xff : rng.chance(0.3) ? 0 : rng.int(256);
    }
    // A flipped SizeOfImage byte can legitimately ask for up to the 512 MiB cap (the
    // adversarial suite covers the cap itself); keep this loop's allocations small.
    if (addon.readUInt32LE(OPTOFF + 56) > 0x40_0000)
      addon.writeUInt32LE(addon.readUInt32LE(OPTOFF + 56) & 0x3f_ffff, OPTOFF + 56);
    if (rng.chance(0.1)) gen.bytes = Buffer.from(addon.subarray(0, rng.int(addon.length)));
    const result = peLinkAddon(host.bytes, gen.bytes, name, TRAMPOLINE);
    const what = outcome(result);
    // validate() runs inside the hook after every merge, so "error" here means the merge
    // produced a broken image or failed half way; both are bugs for any input.
    if (what === "error") throw new Error(describeFailure(seed, mode, result.error!));
    if (what === "skipped" && !Buffer.from(result.output!).equals(hostBefore)) {
      throw new Error(describeFailure(seed, mode, "skip modified the host image"));
    }
    return what;
  }

  const trampoline = gen.model.poison === "handlers without a trampoline" ? undefined : TRAMPOLINE;
  const result = peLinkAddon(host.bytes, gen.bytes, name, trampoline);
  const what = outcome(result);
  const expected = gen.model.poison ? "skipped" : "merged";
  if (what !== expected) {
    throw new Error(
      describeFailure(
        seed,
        mode,
        `expected ${expected} (poison: ${gen.model.poison}), got ${what}${result.error ? ": " + result.error : ""}; model: ${summarize(gen.model)}`,
      ),
    );
  }
  if (what === "skipped") {
    if (!Buffer.from(result.output!).equals(hostBefore)) {
      throw new Error(describeFailure(seed, mode, "skip modified the host image"));
    }
    return what;
  }
  try {
    checkMergedAgainstModel(host, gen, result, name);
  } catch (e) {
    throw new Error(describeFailure(seed, mode, String(e instanceof Error ? e.message : e)), { cause: e });
  }
  return what;
}

describe("pe.addLinkedAddon model-based fuzz", () => {
  test(`valid addons always merge and match the model (${ITERATIONS} iterations)`, () => {
    for (let i = 0; i < ITERATIONS; i++) expect(runIteration(BASE_SEED + i, "valid")).toBe("merged");
  });

  test(`poisoned addons are skipped, valid ones merged (${ITERATIONS} iterations)`, () => {
    const seen = { merged: 0, skipped: 0 };
    for (let i = 0; i < ITERATIONS; i++) seen[runIteration(BASE_SEED + i, "poisoned") as "merged" | "skipped"]++;
    // The poison probabilities are tuned so both outcomes occur in any run of reasonable size.
    if (ITERATIONS >= 100) expect(seen.skipped).toBeGreaterThan(0);
  });

  test(`corrupted addons never crash, error, or touch the host on a skip (${ITERATIONS} iterations)`, () => {
    for (let i = 0; i < ITERATIONS; i++) runIteration(BASE_SEED + i, "mutated");
  });
});

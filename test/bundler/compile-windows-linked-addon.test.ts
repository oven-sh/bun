// Coverage for the Windows static `.node` merge done by
// `pe.PEFile.addLinkedAddon` during `bun build --compile`.
//
// Windows-only: the merge uses the running bun as the PE template, so
// cross-compiling from Linux/macOS would try to download a matching
// release build (which doesn't exist for canary/debug). On Windows we
// compile for the default target, inspect the output exe's section table
// and `.bunL` blob by hand, then run the result to prove the in-place
// bind produces a working addon without a temp file.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

type Section = { name: string; virtualSize: number; virtualAddress: number; rawSize: number; characteristics: number };

function parsePESections(exePath: string): Section[] {
  const buf = readFileSync(exePath);
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error("not MZ");
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOff) !== 0x4550) throw new Error("not PE");
  const nSect = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const shOff = peOff + 24 + optSize;
  const out: Section[] = [];
  for (let i = 0; i < nSect; i++) {
    const off = shOff + i * 40;
    const raw = buf.subarray(off, off + 8);
    const z = raw.indexOf(0);
    out.push({
      name: raw.subarray(0, z === -1 ? 8 : z).toString("latin1"),
      virtualSize: buf.readUInt32LE(off + 8),
      virtualAddress: buf.readUInt32LE(off + 12),
      rawSize: buf.readUInt32LE(off + 16),
      characteristics: buf.readUInt32LE(off + 36),
    });
  }
  return out;
}

function findSection(exePath: string, name: string): Section | undefined {
  return parsePESections(exePath).find(s => s.name === name);
}

function readSectionData(exePath: string, name: string): Buffer {
  const buf = readFileSync(exePath);
  const peOff = buf.readUInt32LE(0x3c);
  const nSect = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const shOff = peOff + 24 + optSize;
  for (let i = 0; i < nSect; i++) {
    const off = shOff + i * 40;
    const raw = buf.subarray(off, off + 8);
    const z = raw.indexOf(0);
    const s = raw.subarray(0, z === -1 ? 8 : z).toString("latin1");
    if (s === name) {
      const rawPtr = buf.readUInt32LE(off + 20);
      const rawSize = buf.readUInt32LE(off + 16);
      return buf.subarray(rawPtr, rawPtr + rawSize);
    }
  }
  throw new Error(`section ${name} not found`);
}

// Construct the smallest PE32+ DLL that exercises every code path in
// `pe.PEFile.addLinkedAddon`: headers, a `.text` section with one DIR64
// relocation, an import descriptor (from `node.exe`, so the runtime would
// bind it against the host), and an export of `napi_register_module_v1`.
// The machine code is a single `ret` — it never runs in this test, we
// only care that the merge parses it and lays it out correctly.
function makeTinyPEDll(): Buffer {
  const SECT_ALIGN = 0x1000;
  const FILE_ALIGN = 0x200;
  const HDR_SIZE = FILE_ALIGN;
  const IMAGE_BASE = 0x180000000n;

  // One section holds everything. RVA layout inside it:
  const TEXT_RVA = SECT_ALIGN;
  const code_off = 0x000; // ret at TEXT_RVA + 0
  const abs_slot_off = 0x008; // u64 absolute pointer (target of the reloc)
  const iat_off = 0x020; // 2×u64 IAT slots (napi_create_string_utf8, terminator)
  const ilt_off = 0x030; // 2×u64 ILT thunks
  const hintname_off = 0x040; // IMAGE_IMPORT_BY_NAME for napi_create_string_utf8
  const dllname_off = 0x060; // "node.exe"
  const impdesc_off = 0x070; // 2×IMAGE_IMPORT_DESCRIPTOR (one + terminator)
  const reloc_off = 0x0a0; // IMAGE_BASE_RELOCATION block
  const exp_off = 0x0c0; // IMAGE_EXPORT_DIRECTORY
  const exp_funcs_off = 0x0f0;
  const exp_names_off = 0x0f4;
  const exp_ords_off = 0x0f8;
  const exp_name_off = 0x100; // "addon.dll"
  const reg_name_off = 0x110; // "napi_register_module_v1"
  const sect_vsize = 0x200;
  const sect_rawsize = FILE_ALIGN;

  const buf = Buffer.alloc(HDR_SIZE + sect_rawsize);

  // DOS header
  buf.writeUInt16LE(0x5a4d, 0); // MZ
  const e_lfanew = 0x80;
  buf.writeUInt32LE(e_lfanew, 0x3c);

  // PE header
  let o = e_lfanew;
  buf.writeUInt32LE(0x4550, o); // PE\0\0
  o += 4;
  buf.writeUInt16LE(0x8664, o); // machine x64
  buf.writeUInt16LE(1, o + 2); // number_of_sections
  buf.writeUInt16LE(240, o + 16); // size_of_optional_header (PE32+ with 16 dirs)
  buf.writeUInt16LE(0x2022, o + 18); // characteristics: EXECUTABLE | LARGE_ADDRESS | DLL
  o += 20;

  // OptionalHeader64
  const optOff = o;
  buf.writeUInt16LE(0x020b, optOff); // magic PE32+
  buf.writeUInt32LE(TEXT_RVA + code_off, optOff + 16); // AddressOfEntryPoint
  buf.writeBigUInt64LE(IMAGE_BASE, optOff + 24); // ImageBase
  buf.writeUInt32LE(SECT_ALIGN, optOff + 32);
  buf.writeUInt32LE(FILE_ALIGN, optOff + 36);
  buf.writeUInt32LE(TEXT_RVA + SECT_ALIGN, optOff + 56); // SizeOfImage
  buf.writeUInt32LE(HDR_SIZE, optOff + 60); // SizeOfHeaders
  buf.writeUInt16LE(2, optOff + 68); // Subsystem GUI
  buf.writeUInt32LE(16, optOff + 108); // NumberOfRvaAndSizes
  const ddOff = optOff + 112;
  const setDir = (idx: number, rva: number, size: number) => {
    buf.writeUInt32LE(rva, ddOff + idx * 8);
    buf.writeUInt32LE(size, ddOff + idx * 8 + 4);
  };
  setDir(0, TEXT_RVA + exp_off, 40); // EXPORT
  setDir(1, TEXT_RVA + impdesc_off, 40); // IMPORT (2 descriptors × 20)
  setDir(5, TEXT_RVA + reloc_off, 12); // BASERELOC

  // Section header
  const shOff = optOff + 240;
  buf.write(".text", shOff, "latin1");
  buf.writeUInt32LE(sect_vsize, shOff + 8); // VirtualSize
  buf.writeUInt32LE(TEXT_RVA, shOff + 12); // VirtualAddress
  buf.writeUInt32LE(sect_rawsize, shOff + 16); // SizeOfRawData
  buf.writeUInt32LE(HDR_SIZE, shOff + 20); // PointerToRawData
  buf.writeUInt32LE(0x60000020, shOff + 36); // CODE | EXECUTE | READ

  // Section body
  const body = buf.subarray(HDR_SIZE);
  body[code_off] = 0xc3; // ret

  // Absolute pointer that the reloc will adjust. Points at the ret.
  body.writeBigUInt64LE(IMAGE_BASE + BigInt(TEXT_RVA + code_off), abs_slot_off);

  // ILT thunk: RVA of IMAGE_IMPORT_BY_NAME (high bit clear = by name)
  body.writeBigUInt64LE(BigInt(TEXT_RVA + hintname_off), ilt_off);
  body.writeBigUInt64LE(0n, ilt_off + 8);
  // IAT mirrors ILT before binding
  body.writeBigUInt64LE(BigInt(TEXT_RVA + hintname_off), iat_off);
  body.writeBigUInt64LE(0n, iat_off + 8);
  // IMAGE_IMPORT_BY_NAME
  body.writeUInt16LE(0, hintname_off);
  body.write("napi_create_string_utf8\0", hintname_off + 2, "latin1");
  body.write("node.exe\0", dllname_off, "latin1");
  // IMAGE_IMPORT_DESCRIPTOR
  body.writeUInt32LE(TEXT_RVA + ilt_off, impdesc_off + 0); // OriginalFirstThunk
  body.writeUInt32LE(TEXT_RVA + dllname_off, impdesc_off + 12); // Name
  body.writeUInt32LE(TEXT_RVA + iat_off, impdesc_off + 16); // FirstThunk
  // terminator descriptor is already zero

  // Base relocation block: one DIR64 entry at abs_slot_off, plus a pad
  body.writeUInt32LE(TEXT_RVA, reloc_off + 0); // page RVA
  body.writeUInt32LE(12, reloc_off + 4); // block size (8 hdr + 2 entries × 2)
  body.writeUInt16LE((10 << 12) | abs_slot_off, reloc_off + 8); // DIR64
  body.writeUInt16LE(0, reloc_off + 10); // ABSOLUTE pad

  // Export directory
  body.writeUInt32LE(TEXT_RVA + exp_name_off, exp_off + 12); // Name
  body.writeUInt32LE(1, exp_off + 16); // Base
  body.writeUInt32LE(1, exp_off + 20); // NumberOfFunctions
  body.writeUInt32LE(1, exp_off + 24); // NumberOfNames
  body.writeUInt32LE(TEXT_RVA + exp_funcs_off, exp_off + 28);
  body.writeUInt32LE(TEXT_RVA + exp_names_off, exp_off + 32);
  body.writeUInt32LE(TEXT_RVA + exp_ords_off, exp_off + 36);
  body.writeUInt32LE(TEXT_RVA + code_off, exp_funcs_off); // AddressOfFunctions[0]
  body.writeUInt32LE(TEXT_RVA + reg_name_off, exp_names_off); // AddressOfNames[0]
  body.writeUInt16LE(0, exp_ords_off); // ordinal index
  body.write("addon.dll\0", exp_name_off, "latin1");
  body.write("napi_register_module_v1\0", reg_name_off, "latin1");

  return buf;
}

function projectFiles(addon: Buffer) {
  return {
    // `require` of a .node file inside a bun-target bundle emits a
    // `process.dlopen($bunfs/...)` at runtime; gating on argv keeps the
    // call out of the section-inspection tests (which pass no args) but
    // present in the bundle so the addon is packed.
    "entry.cjs": `
      if (process.argv[2] === "load") {
        require("./addon.node");
      }
      console.log("ok");
    `,
    "addon.node": addon,
    "package.json": JSON.stringify({ name: "t", type: "commonjs" }),
  };
}

async function compileForWindows(dir: string, extraEnv: Record<string, string> = {}): Promise<string> {
  const out = join(dir, "out.exe");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--outfile", out, join(dir, "entry.cjs")],
    env: { ...bunEnv, ...extraEnv },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, stdout, code] = await Promise.all([build.stderr.text(), build.stdout.text(), build.exited]);
  if (code !== 0) throw new Error(`bun build --compile failed (exit ${code}):\n${stderr}\n${stdout}`);
  return out;
}

describe.skipIf(!isWindows)("bun build --compile native addon static link", () => {
  const timeout = 120_000;

  test(
    "merges the addon as a .bnN section and emits .bunL metadata",
    async () => {
      using dir = tempDir("pe-linked-addon", projectFiles(makeTinyPEDll()));
      const exe = await compileForWindows(String(dir));
      const sections = parsePESections(exe);
      const names = sections.map(s => s.name);

      // `.bun` is the module graph (always present); `.bunL` is the
      // linked-addon metadata; `.bn0` is the addon image itself.
      expect(names).toContain(".bun");
      expect(names).toContain(".bunL");
      expect(names).toContain(".bn0");

      // Section order matters: `addBunSection` runs last so its checksum
      // covers the addon sections.
      expect(names.indexOf(".bn0")).toBeLessThan(names.indexOf(".bunL"));
      expect(names.indexOf(".bunL")).toBeLessThan(names.indexOf(".bun"));

      // The addon section is mapped RW so the runtime can apply ASLR
      // relocs and bind the IAT; it is *not* executable on disk.
      const bn0 = findSection(exe, ".bn0")!;
      const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
      const IMAGE_SCN_MEM_READ = 0x40000000;
      const IMAGE_SCN_MEM_WRITE = 0x80000000;
      expect(bn0.characteristics & IMAGE_SCN_MEM_READ).toBeTruthy();
      expect(bn0.characteristics & IMAGE_SCN_MEM_WRITE).toBeTruthy();
      expect(bn0.characteristics & IMAGE_SCN_MEM_EXECUTE).toBeFalsy();
      // The whole addon image (SizeOfImage = 0x2000) is laid out, not
      // just the raw .text bytes.
      expect(bn0.virtualSize).toBe(0x2000);

      // .bunL payload: [u64 len]['BLNK' u32][version u32][count u32]...
      const bunL = readSectionData(exe, ".bunL");
      const blobLen = Number(bunL.readBigUInt64LE(0));
      expect(blobLen).toBeGreaterThan(12);
      expect(bunL.readUInt32LE(8)).toBe(0x4b4e4c42); // 'BLNK'
      expect(bunL.readUInt32LE(12)).toBe(1); // version
      expect(bunL.readUInt32LE(16)).toBe(1); // one addon
      const nameLen = bunL.readUInt32LE(20);
      const name = bunL.subarray(24, 24 + nameLen).toString("utf8");
      // toBytes() prefixes with the public $bunfs path so process.dlopen's
      // argument matches the key. The bundler may append a content hash
      // to the asset basename (default --asset-naming), so match the
      // shape rather than the exact string.
      expect(name).toMatch(/^B:\/~BUN\/root\/addon(-[0-9a-z]+)?\.node$/);

      let p = 24 + nameLen;
      const rvaBase = bunL.readUInt32LE(p);
      p += 4;
      const imageSize = bunL.readUInt32LE(p);
      p += 4;
      const entryPoint = bunL.readUInt32LE(p);
      p += 4;
      const preferredBase = bunL.readBigUInt64LE(p);
      p += 8;
      p += 8; // pdata_rva + pdata_count (none in the fixture)
      const exportRegister = bunL.readUInt32LE(p);
      p += 12; // skip the other two export slots
      const nSections = bunL.readUInt32LE(p);
      p += 4;
      // One SectionInfo: rva / size / final_protect
      expect(nSections).toBe(1);
      const secRva = bunL.readUInt32LE(p);
      const secProtect = bunL.readUInt32LE(p + 8);
      p += 12;
      // The addon's only section was CODE|EXECUTE|READ, which becomes
      // PAGE_EXECUTE_READ after the runtime is done patching it.
      expect(secProtect).toBe(0x20);
      // All addon RVAs are rebased to bun-relative at build time.
      expect(rvaBase).toBe(bn0.virtualAddress);
      expect(imageSize).toBe(0x2000);
      expect(entryPoint).toBe(bn0.virtualAddress + 0x1000);
      expect(exportRegister).toBe(bn0.virtualAddress + 0x1000);
      expect(secRva).toBe(bn0.virtualAddress + 0x1000);
      expect(preferredBase).toBeGreaterThan(0n);

      // Reloc block: page RVA was TEXT_RVA in the addon, should now be
      // bn0.virtualAddress + TEXT_RVA.
      const relocLen = bunL.readUInt32LE(p);
      p += 4;
      expect(relocLen).toBe(12);
      const relocPage = bunL.readUInt32LE(p);
      expect(relocPage).toBe(bn0.virtualAddress + 0x1000);
      p += relocLen;

      // One import lib ("node.exe", is_host) with one by-name entry.
      expect(bunL.readUInt32LE(p)).toBe(1);
      p += 4;
      const dllNameLen = bunL.readUInt32LE(p);
      p += 4;
      expect(bunL.subarray(p, p + dllNameLen).toString("latin1")).toBe("node.exe");
      p += dllNameLen;
      expect(bunL[p]).toBe(1); // is_host
      p += 1;
      expect(bunL.readUInt32LE(p)).toBe(1); // one entry
      p += 4;
      const iatRva = bunL.readUInt32LE(p);
      expect(iatRva).toBe(bn0.virtualAddress + 0x1000 + 0x020);
      p += 6;
      const symLen = bunL.readUInt32LE(p);
      p += 4;
      expect(bunL.subarray(p, p + symLen).toString("latin1")).toBe("napi_create_string_utf8");

      // The build-time relocation delta was applied to the DIR64 slot in
      // the copied image, and the IAT slot was zeroed.
      const bn0Data = readSectionData(exe, ".bn0");
      const absSlot = bn0Data.readBigUInt64LE(0x1000 + 0x008);
      expect(absSlot).toBe(preferredBase + BigInt(bn0.virtualAddress + 0x1000));
      expect(bn0Data.readBigUInt64LE(0x1000 + 0x020)).toBe(0n);
    },
    timeout,
  );

  test(
    "BUN_FEATURE_FLAG_DISABLE_PE_ADDON_LINK leaves the addon as opaque bytes",
    async () => {
      using dir = tempDir("pe-linked-addon-off", projectFiles(makeTinyPEDll()));
      const exe = await compileForWindows(String(dir), { BUN_FEATURE_FLAG_DISABLE_PE_ADDON_LINK: "1" });
      const names = parsePESections(exe).map(s => s.name);
      expect(names).toContain(".bun");
      expect(names).not.toContain(".bunL");
      expect(names).not.toContain(".bn0");
    },
    timeout,
  );

  // The end-to-end "bind a real addon and run it without a temp file"
  // case is covered by test/napi/napi.test.ts, which compiles a
  // node-gyp-built addon, runs it, and asserts BUN_TMPDIR stayed empty.
  // A synthetic DLL whose napi_register_module_v1 is a bare `ret`
  // cannot safely be called (rax is garbage), so that test lives where
  // a real addon is available.

  test(
    "an addon with real __declspec(thread) TLS data is skipped and falls back to opaque bytes",
    async () => {
      // A nonzero TLS template (RawData span or SizeOfZeroFill) means
      // real __declspec(thread) / thread_local! storage, which needs
      // an index reserved in the loader's private LdrpTlsBitmap and a
      // template installed in every existing thread's
      // ThreadLocalStoragePointer — neither has a userspace API.
      // addLinkedAddon() refuses these; the build must still succeed
      // with the raw addon in `.bun` for the runtime tempfile
      // fallback. An empty-template directory (the MSVC CRT's
      // tlssup.obj stub, present in essentially every node-gyp
      // addon) is merged — the adversarial suite covers that case.
      const addon = makeTinyPEDll();
      const e_lfanew = addon.readUInt32LE(0x3c);
      const ddOff = e_lfanew + 24 + 112;
      addon.writeUInt32LE(0x1000 + 0x150, ddOff + 9 * 8); // rva (in-image)
      addon.writeUInt32LE(40, ddOff + 9 * 8 + 4); // size
      // Write the directory body at file offset 0x200+0x150 with a
      // nonzero RawData span → real TLS template.
      addon.writeBigUInt64LE(0x180001000n, 0x200 + 0x150 + 0);
      addon.writeBigUInt64LE(0x180001008n, 0x200 + 0x150 + 8);

      using dir = tempDir("pe-linked-addon-tls", projectFiles(addon));
      const out = await compileForWindows(String(dir));

      const names = parsePESections(out).map(s => s.name);
      expect(names).toContain(".bun");
      expect(names).not.toContain(".bunL");
      expect(names).not.toContain(".bn0");
    },
    timeout,
  );
});

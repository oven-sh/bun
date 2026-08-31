// Adversarial coverage for PEFile::add_linked_addon (src/exe_format/pe.rs),
// the part of `bun build --compile` that parses a user-supplied `.node` PE
// and merges it into the Windows output executable.
//
// The addon bytes are untrusted (they come from npm packages), so the
// parser must never hang, overflow, or corrupt the host image on
// malformed input. Every case here must either produce a host image
// that still passes PE validation, or be cleanly rejected with
// `{ skipped: true }` / `{ error: ... }` so the runtime can fall back to
// the temp-file+LoadLibrary path.
//
// Runs on every platform via the `peLinkAddon` testing hook; no Windows
// host or downloaded bun.exe template required.

import { peLinkAddon } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// ---------------------------------------------------------------------------
// Synthetic PE builders. Kept deliberately small: enough structure for the
// parser to accept the well-formed baseline, and enough addressability for
// each test to poke exactly one field into a bad state.
// ---------------------------------------------------------------------------

const SECT_ALIGN = 0x1000;
const FILE_ALIGN = 0x200;
const OPT_HDR_SIZE = 240; // PE32+ with 16 data directories
const PEOFF = 0x80;
const OPTOFF = PEOFF + 24;
const SHOFF = OPTOFF + OPT_HDR_SIZE;
const DDOFF = OPTOFF + 112;

type Mutator = (buf: Buffer) => void;

// A valid PE32+ "host" with one empty .text section and 16 spare
// section-header slots. This stands in for bun.exe: large enough that the
// merge has somewhere to put the addon, small enough to make structural
// assertions obvious.
function makeHost(mutate?: Mutator): Buffer {
  const HDR_SIZE = 0x1000; // lots of header slack = many section slots
  const textRaw = FILE_ALIGN;
  const buf = Buffer.alloc(HDR_SIZE + textRaw);

  buf.writeUInt16LE(0x5a4d, 0); // MZ
  buf.writeUInt32LE(PEOFF, 0x3c);
  buf.writeUInt32LE(0x4550, PEOFF); // PE\0\0
  buf.writeUInt16LE(0x8664, PEOFF + 4); // machine x64
  buf.writeUInt16LE(1, PEOFF + 6); // number_of_sections
  buf.writeUInt16LE(OPT_HDR_SIZE, PEOFF + 20);
  buf.writeUInt16LE(0x0022, PEOFF + 22); // EXECUTABLE | LARGE_ADDRESS_AWARE

  buf.writeUInt16LE(0x020b, OPTOFF); // PE32+
  buf.writeBigUInt64LE(0x140000000n, OPTOFF + 24); // ImageBase
  buf.writeUInt32LE(SECT_ALIGN, OPTOFF + 32);
  buf.writeUInt32LE(FILE_ALIGN, OPTOFF + 36);
  buf.writeUInt32LE(2 * SECT_ALIGN, OPTOFF + 56); // SizeOfImage = headers+.text
  buf.writeUInt32LE(HDR_SIZE, OPTOFF + 60); // SizeOfHeaders
  buf.writeUInt16LE(3, OPTOFF + 68); // CONSOLE
  buf.writeUInt32LE(16, OPTOFF + 108); // NumberOfRvaAndSizes

  buf.write(".text", SHOFF, "latin1");
  buf.writeUInt32LE(FILE_ALIGN, SHOFF + 8); // VirtualSize
  buf.writeUInt32LE(SECT_ALIGN, SHOFF + 12); // VirtualAddress
  buf.writeUInt32LE(textRaw, SHOFF + 16); // SizeOfRawData
  buf.writeUInt32LE(HDR_SIZE, SHOFF + 20); // PointerToRawData
  buf.writeUInt32LE(0x60000020, SHOFF + 36); // CODE|EXECUTE|READ

  mutate?.(buf);
  return buf;
}

// A valid PE32+ DLL addon with: one RX section, one DIR64 reloc, one
// `node.exe` import, one `napi_register_module_v1` export. Each test
// mutates exactly one field away from valid.
function makeAddon(mutate?: Mutator): Buffer {
  const HDR_SIZE = FILE_ALIGN;
  const TEXT_RVA = SECT_ALIGN;
  const sect_vsize = 0x200;
  const sect_raw = FILE_ALIGN;
  const buf = Buffer.alloc(HDR_SIZE + sect_raw);

  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(PEOFF, 0x3c);
  buf.writeUInt32LE(0x4550, PEOFF);
  buf.writeUInt16LE(0x8664, PEOFF + 4);
  buf.writeUInt16LE(1, PEOFF + 6);
  buf.writeUInt16LE(OPT_HDR_SIZE, PEOFF + 20);
  buf.writeUInt16LE(0x2022, PEOFF + 22); // EXECUTABLE | LARGE_ADDR | DLL

  buf.writeUInt16LE(0x020b, OPTOFF);
  buf.writeUInt32LE(TEXT_RVA, OPTOFF + 16); // AddressOfEntryPoint
  buf.writeBigUInt64LE(0x180000000n, OPTOFF + 24);
  buf.writeUInt32LE(SECT_ALIGN, OPTOFF + 32);
  buf.writeUInt32LE(FILE_ALIGN, OPTOFF + 36);
  buf.writeUInt32LE(TEXT_RVA + SECT_ALIGN, OPTOFF + 56);
  buf.writeUInt32LE(HDR_SIZE, OPTOFF + 60);
  buf.writeUInt16LE(2, OPTOFF + 68);
  buf.writeUInt32LE(16, OPTOFF + 108);

  // Layout inside the single section, at TEXT_RVA + off:
  const off = {
    code: 0x000,
    abs: 0x008, // DIR64 slot
    iat: 0x020,
    ilt: 0x030,
    hint: 0x040,
    dll: 0x060,
    impd: 0x070, // 2 × IMAGE_IMPORT_DESCRIPTOR
    reloc: 0x0a0,
    exp: 0x0c0,
    efuncs: 0x0f0,
    enames: 0x0f4,
    eords: 0x0f8,
    ename: 0x100,
    rname: 0x110,
  };

  // Data directories.
  const setDir = (i: number, rva: number, size: number) => {
    buf.writeUInt32LE(rva, DDOFF + i * 8);
    buf.writeUInt32LE(size, DDOFF + i * 8 + 4);
  };
  setDir(0, TEXT_RVA + off.exp, 40); // EXPORT
  setDir(1, TEXT_RVA + off.impd, 40); // IMPORT
  setDir(5, TEXT_RVA + off.reloc, 12); // BASERELOC

  buf.write(".text", SHOFF, "latin1");
  buf.writeUInt32LE(sect_vsize, SHOFF + 8);
  buf.writeUInt32LE(TEXT_RVA, SHOFF + 12);
  buf.writeUInt32LE(sect_raw, SHOFF + 16);
  buf.writeUInt32LE(HDR_SIZE, SHOFF + 20);
  buf.writeUInt32LE(0x60000020, SHOFF + 36);

  const body = buf.subarray(HDR_SIZE);
  body[off.code] = 0xc3; // ret
  body.writeBigUInt64LE(0x180000000n + BigInt(TEXT_RVA + off.code), off.abs);

  body.writeBigUInt64LE(BigInt(TEXT_RVA + off.hint), off.ilt);
  body.writeBigUInt64LE(0n, off.ilt + 8);
  body.writeBigUInt64LE(BigInt(TEXT_RVA + off.hint), off.iat);
  body.writeBigUInt64LE(0n, off.iat + 8);
  body.writeUInt16LE(0, off.hint);
  body.write("napi_create_string_utf8\0", off.hint + 2, "latin1");
  body.write("node.exe\0", off.dll, "latin1");
  body.writeUInt32LE(TEXT_RVA + off.ilt, off.impd + 0);
  body.writeUInt32LE(TEXT_RVA + off.dll, off.impd + 12);
  body.writeUInt32LE(TEXT_RVA + off.iat, off.impd + 16);

  body.writeUInt32LE(TEXT_RVA, off.reloc + 0);
  body.writeUInt32LE(12, off.reloc + 4);
  body.writeUInt16LE((10 << 12) | off.abs, off.reloc + 8);
  body.writeUInt16LE(0, off.reloc + 10);

  body.writeUInt32LE(TEXT_RVA + off.ename, off.exp + 12);
  body.writeUInt32LE(1, off.exp + 16);
  body.writeUInt32LE(1, off.exp + 20);
  body.writeUInt32LE(1, off.exp + 24);
  body.writeUInt32LE(TEXT_RVA + off.efuncs, off.exp + 28);
  body.writeUInt32LE(TEXT_RVA + off.enames, off.exp + 32);
  body.writeUInt32LE(TEXT_RVA + off.eords, off.exp + 36);
  body.writeUInt32LE(TEXT_RVA + off.code, off.efuncs);
  body.writeUInt32LE(TEXT_RVA + off.rname, off.enames);
  body.writeUInt16LE(0, off.eords);
  body.write("addon.dll\0", off.ename, "latin1");
  body.write("napi_register_module_v1\0", off.rname, "latin1");

  mutate?.(buf);
  return buf;
}

function sectionHeaders(pe: Buffer): { name: string; va: number; rawPtr: number; rawSize: number }[] {
  const peOff = pe.readUInt32LE(0x3c);
  const n = pe.readUInt16LE(peOff + 6);
  const sh = peOff + 24 + pe.readUInt16LE(peOff + 20);
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = sh + i * 40;
    const raw = pe.subarray(h, h + 8);
    const z = raw.indexOf(0);
    out.push({
      name: raw.subarray(0, z === -1 ? 8 : z).toString("latin1"),
      va: pe.readUInt32LE(h + 12),
      rawPtr: pe.readUInt32LE(h + 20),
      rawSize: pe.readUInt32LE(h + 16),
    });
  }
  return out;
}

function sections(pe: Buffer): string[] {
  return sectionHeaders(pe).map(s => s.name);
}

// File offset of an RVA in a host produced by the hook (the host's own section table was
// written by makeHost, so OPTOFF/DDOFF still apply to it).
function fileOffset(pe: Buffer, rva: number): number {
  const s = sectionHeaders(pe).find(s => rva >= s.va && rva < s.va + s.rawSize);
  if (!s) throw new Error(`rva ${rva.toString(16)} is not backed by any section`);
  return s.rawPtr + (rva - s.va);
}

// The output's IMAGE_DIRECTORY_ENTRY_EXCEPTION as x64 RUNTIME_FUNCTION triples, or null if unset.
function exceptionDirectory(pe: Buffer): { begin: number; end: number; unwind: number }[] | null {
  const rva = pe.readUInt32LE(DDOFF + 3 * 8);
  const size = pe.readUInt32LE(DDOFF + 3 * 8 + 4);
  if (rva === 0 && size === 0) return null;
  expect(size % 12).toBe(0);
  // The table must live in a .bunL section (the most recent merge's), after its metadata blob.
  const home = sectionHeaders(pe).find(s => rva >= s.va && rva + size <= s.va + s.rawSize);
  expect(home?.name).toBe(".bunL");
  const at = fileOffset(pe, rva);
  const out = [];
  for (let p = at; p < at + size; p += 12) {
    out.push({ begin: pe.readUInt32LE(p), end: pe.readUInt32LE(p + 4), unwind: pe.readUInt32LE(p + 8) });
  }
  return out;
}

// One handler-index entry: the unwind info's RVA in the exe, the displaced handler's RVA in the
// exe, and the addon-relative RVA of the record the trampoline presents to that handler.
type Redirect = [unwindInfo: number, handler: number, view: number];

// The fixed-size index that follows the metadata header, resolved to the handler lists it points
// at. `sectionSize` is the addon's image plus the appendix of chained-record copies.
function handlerIndex(m: Buffer): { rvaBase: number; sectionSize: number; handlers: Redirect[] }[] {
  const count = m.readUInt32LE(8);
  const out = [];
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    const pos = m.readUInt32LE(rec + 8);
    const n = m.readUInt32LE(rec + 12);
    const handlers: Redirect[] = [];
    for (let j = 0; j < n; j++) {
      const at = pos + j * 12;
      handlers.push([m.readUInt32LE(at), m.readUInt32LE(at + 4), m.readUInt32LE(at + 8)]);
    }
    out.push({ rvaBase: m.readUInt32LE(rec), sectionSize: m.readUInt32LE(rec + 4), handlers });
  }
  return out;
}

// Contract: every adversarial input must either merge into a PE that still
// passes validate(), or be rejected. Never undefined / never a crash. When it
// is skipped the host image must be untouched, since the real build keeps
// merging further addons into the same image. Callers that skip must have
// used an unmodified makeHost(), which is what the output is compared to.
function expectSafe(res: ReturnType<typeof peLinkAddon>) {
  if (res.error !== undefined) {
    expect(typeof res.error).toBe("string");
    return "error" as const;
  }
  if (res.skipped === true) {
    expect(Buffer.from(res.output!).equals(makeHost()), "a skipped merge must leave the host untouched").toBe(true);
    return "skipped" as const;
  }
  expect(res.skipped).toBe(false);
  // Merge succeeded: the output must be a well-formed PE with the new
  // sections actually present (validate() ran in the hook, which
  // rejects overlapping raw ranges and SizeOfImage mismatches).
  expect(res.output).toBeInstanceOf(Uint8Array);
  expect(res.metadata).toBeInstanceOf(Uint8Array);
  const out = Buffer.from(res.output!);
  expect(out.readUInt16LE(0)).toBe(0x5a4d);
  const s = sections(out);
  // The last two sections appended by the hook are the addon image and
  // its metadata; everything before is whatever the host already had.
  expect(s.slice(-2)).toEqual([".bn0", ".bunL"]);
  return "merged" as const;
}

describe("pe.addLinkedAddon adversarial input", () => {
  test("baseline: well-formed addon merges and validates", () => {
    const res = peLinkAddon(makeHost(), makeAddon(), "B:/~BUN/root/addon.node");
    expect(expectSafe(res)).toBe("merged");
    // rvaBase lands after the host's single section, section-aligned.
    expect(res.rvaBase).toBe(2 * SECT_ALIGN);
    // Metadata: 'BLNK' magic, version, count, then the handler index (this addon has no
    // exception directory, so no handlers) and the addon record.
    const m = Buffer.from(res.metadata!);
    expect([m.readUInt32LE(0), m.readUInt32LE(4), m.readUInt32LE(8)]).toEqual([0x4b4e4c42, 3, 1]);
    expect(handlerIndex(m)).toEqual([{ rvaBase: 2 * SECT_ALIGN, sectionSize: 2 * SECT_ALIGN, handlers: [] }]);
    // The host had no exception directory and the addon contributed nothing, so none was created.
    expect(exceptionDirectory(Buffer.from(res.output!))).toBeNull();
  });

  test("non-PE junk is skipped without touching the host", () => {
    const r = peLinkAddon(makeHost(), Buffer.from("not a pe file at all"), "x");
    expect(expectSafe(r)).toBe("skipped");
    expect(r.metadata).toBeUndefined();
  });

  test("addon with AddressOfEntryPoint past SizeOfImage is skipped", () => {
    // Runtime would otherwise jump to exe_base + rva_base + bogus_rva.
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x7fffffff, OPTOFF + 16)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("PE32 (not PE32+) is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt16LE(0x010b, OPTOFF)),
      "x",
    );
    // AddonView.init rejects non-PE32+ magic → addLinkedAddon returns null.
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon with IMAGE_FILE_RELOCS_STRIPPED is skipped (cannot rebase)", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt16LE(b.readUInt16LE(PEOFF + 22) | 0x0001, PEOFF + 22)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon with an empty-template TLS directory is merged (MSVC CRT stub)", () => {
    // MSVC's _DllMainCRTStartup pulls in tlssup.obj, so essentially
    // every MSVC-built DLL has an IMAGE_TLS_DIRECTORY64 even with no
    // __declspec(thread) data. When StartAddressOfRawData ==
    // EndAddressOfRawData and SizeOfZeroFill == 0 there is no per-
    // thread storage to install, so no LdrpTlsBitmap slot is needed
    // and the CRT's __dyn_tls_init/_dtor callbacks are no-ops. Merge
    // and ignore the directory.
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        // 40 zero bytes at 0x1150 → raw_start == raw_end == zero_fill == 0.
        b.writeUInt32LE(SECT_ALIGN + 0x150, DDOFF + 9 * 8);
        b.writeUInt32LE(40, DDOFF + 9 * 8 + 4);
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("merged");
  });

  test("addon with a nonzero TLS template is skipped (real __declspec(thread))", () => {
    // A nonzero RawData span (or SizeOfZeroFill) means the addon has
    // actual __declspec(thread) / thread_local! storage, which needs
    // an index reserved in the loader's private LdrpTlsBitmap and a
    // template installed in every existing thread's
    // ThreadLocalStoragePointer — neither has a userspace API. Let
    // the tempfile LoadLibraryExW path handle it.
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        b.writeUInt32LE(SECT_ALIGN + 0x150, DDOFF + 9 * 8);
        b.writeUInt32LE(40, DDOFF + 9 * 8 + 4);
        // Write the directory body at file offset HDR(0x200)+0x150:
        // StartAddressOfRawData / EndAddressOfRawData differ by 8.
        b.writeBigUInt64LE(0x180001000n, FILE_ALIGN + 0x150 + 0);
        b.writeBigUInt64LE(0x180001008n, FILE_ALIGN + 0x150 + 8);
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon with a nonzero TLS SizeOfZeroFill is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        b.writeUInt32LE(SECT_ALIGN + 0x150, DDOFF + 9 * 8);
        b.writeUInt32LE(40, DDOFF + 9 * 8 + 4);
        // Template span is zero but SizeOfZeroFill (off +32) is not.
        b.writeUInt32LE(16, FILE_ALIGN + 0x150 + 32);
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon with a truncated TLS directory (size < 40) is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        b.writeUInt32LE(SECT_ALIGN + 0x150, DDOFF + 9 * 8);
        b.writeUInt32LE(16, DDOFF + 9 * 8 + 4);
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon whose PE machine type differs from the host is skipped", () => {
    // ARM64 PE32+ uses IMAGE_REL_BASED_DIR64 just like x64, so the
    // reloc walker would not catch a wrong-arch addon. Without this
    // gate a --target=bun-windows-arm64 build that picked up an x64
    // prebuild would merge cleanly and then crash with
    // STATUS_ILLEGAL_INSTRUCTION in DllMain instead of the clean
    // ERROR_BAD_EXE_FORMAT the tempfile path gives.
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt16LE(0xaa64, PEOFF + 4)), // IMAGE_FILE_MACHINE_ARM64
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon importing _CxxThrowException (CRT DLL) is skipped", () => {
    // Importing the throw function means the addon throws through
    // vcruntime140.dll, whose own RtlPcToFileHeader import the binder does
    // not touch, so such a throw would resolve the thrown type's RVAs
    // against bun.exe's base. An addon linked against the static CRT
    // carries its own copy and imports RtlPcToFileHeader itself, which the
    // binder points at its shim; that one merges (napi's cxx_eh_addon test).
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        // Overwrite the fixture's import-by-name string at the
        // IMAGE_IMPORT_BY_NAME hint offset (section body 0x040+2).
        b.fill(0, FILE_ALIGN + 0x042, FILE_ALIGN + 0x060);
        b.write("_CxxThrowException\0", FILE_ALIGN + 0x042, "latin1");
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon with SizeOfImage = 0 is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0, OPTOFF + 56)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon whose SizeOfImage is not a multiple of 4 is skipped", () => {
    // The copies of chained unwind records are appended at SizeOfImage and
    // UNWIND_INFO has to be 4-byte aligned. Every section still fits, so
    // only the alignment rule refuses this one.
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(b.readUInt32LE(OPTOFF + 56) + 2, OPTOFF + 56)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("addon section whose VirtualAddress lies past SizeOfImage is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x80000, SHOFF + 12)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  // Relocation-block attacks — these are the easiest way to get the parser
  // to loop forever or write out of bounds if it is not careful.

  test("reloc block with size_of_block = 0 (non-terminator) is rejected", () => {
    // page_rva is nonzero so this is not the {0,0} terminator block;
    // stopping here would leave any following blocks unapplied.
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0, FILE_ALIGN + 0x0a0 + 4)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("reloc block claiming more bytes than the directory has is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x10000, FILE_ALIGN + 0x0a0 + 4)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("DIR64 reloc pointing past SizeOfImage is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        // Move the reloc page so page_rva + entry_offset + 8 > SizeOfImage.
        b.writeUInt32LE(0x1ff8, FILE_ALIGN + 0x0a0 + 0);
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("unknown reloc type (HIGHLOW on PE32+) is rejected, not applied blindly", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt16LE((3 << 12) | 0x008, FILE_ALIGN + 0x0a0 + 8)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  // Import-directory attacks.

  test("import descriptor at an RVA outside any section is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x7ffff000, DDOFF + 1 * 8)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("import descriptor whose DLL-name RVA points past the file is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x7fffffff, FILE_ALIGN + 0x070 + 12)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("unterminated ILT (no zero thunk before raw-data end) is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      // Put a nonzero by-ordinal thunk in the last slot of the section
      // so the walker has to ask for the *next* one, past raw-data end.
      makeAddon(b => {
        b.writeUInt32LE(SECT_ALIGN + 0x1f8, FILE_ALIGN + 0x070 + 0); // ILT rva
        b.writeBigUInt64LE(0x8000000000000001n, FILE_ALIGN + 0x1f8); // ordinal 1
      }),
      "x",
    );
    // sliceAtRva for the next thunk fails → collectImports returns true
    // → addLinkedAddon returns null.
    expect(expectSafe(r)).not.toBe("merged");
  });

  test("ILT with IAT slot pointing outside the image is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      // first_thunk (IAT) well past SizeOfImage — the runtime bind
      // would otherwise write through an out-of-range pointer.
      makeAddon(b => b.writeUInt32LE(0x100000, FILE_ALIGN + 0x070 + 16)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("IMAGE_IMPORT_BY_NAME RVA pointing past the file is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeBigUInt64LE(0x7fffffffn, FILE_ALIGN + 0x030)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("legacy v1 delay-load descriptor (no RVA bit) is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        // Re-purpose the space at 0x130.. as a v1 delay descriptor.
        b.writeUInt32LE(SECT_ALIGN + 0x130, DDOFF + 13 * 8);
        b.writeUInt32LE(32, DDOFF + 13 * 8 + 4);
        const d = FILE_ALIGN + 0x130;
        b.writeUInt32LE(0, d + 0); // attributes: RVA bit clear → v1
        b.writeUInt32LE(SECT_ALIGN + 0x060, d + 4); // dll name
        b.writeUInt32LE(SECT_ALIGN + 0x020, d + 12); // IAT
        b.writeUInt32LE(SECT_ALIGN + 0x030, d + 16); // INT
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  // Export-directory attacks — these must not OOM / over-read.

  test("export directory with huge number_of_names does not over-read", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        const exp = FILE_ALIGN + 0x0c0;
        b.writeUInt32LE(0x40000000, exp + 20); // number_of_functions
        b.writeUInt32LE(0x40000000, exp + 24); // number_of_names
      }),
      "x",
    );
    // sliceAtRva on the names/ords/funcs arrays will OutOfBounds → the
    // export block is skipped but the merge still completes with
    // export_register == 0. That is fine: runtime falls through to the
    // self-registration path and, failing that, the tempfile fallback.
    expect(expectSafe(r)).toBe("merged");
  });

  test("export name RVA pointing past the file does not crash", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x7fffffff, FILE_ALIGN + 0x0f4)),
      "x",
    );
    expect(expectSafe(r)).toBe("merged");
  });

  test("addon with number_of_rva_and_sizes < EXPORT index still merges", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        // Only 0 data directories: the dir() helper must treat every
        // lookup as absent rather than reading past the header.
        b.writeUInt32LE(0, OPTOFF + 108);
        // Shrink size_of_optional_header accordingly so the section
        // table still lines up for AddonView.
        // (Leave it at 240: the section table offset is computed from
        //  size_of_optional_header, and we did not move the table.)
      }),
      "x",
    );
    expect(["merged", "skipped"]).toContain(expectSafe(r));
  });

  // Fuzz: random single-byte mutations of a known-good addon must never
  // escape the safe-outcome set. This is the broadest check that the
  // parser has no load-bearing trust in any one byte of the input.
  test("random single-byte mutations are always merged / skipped / error", () => {
    const host = makeHost();
    const seed = makeAddon();
    // Deterministic PRNG so CI failures are reproducible.
    let state = 0xdeadbeef >>> 0;
    const rnd = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (let i = 0; i < 256; i++) {
      const a = Buffer.from(seed);
      a[rnd() % a.length] = rnd() & 0xff;
      const outcome = expectSafe(peLinkAddon(host, a, "x"));
      // The only thing we assert here is that expectSafe did not throw:
      // every outcome in its return set is acceptable.
      expect(["merged", "skipped", "error"]).toContain(outcome);
    }
  });

  // Host-side resource limits — not attacker-controlled in practice, but
  // worth pinning down the behaviour.

  // makeHost with its header area cut down to one file-alignment unit: room for two more
  // section headers, one short of what a merge appends (.bn0, .bunL, .bun). bun.exe's own
  // header area is this tight. Optionally carries a debug directory entry and a COFF symbol
  // table pointer, the two other file offsets the merge has to move along with the data.
  function makeTightHost(withFileOffsets: boolean): Buffer {
    const TEXT_RVA = SECT_ALIGN;
    const DEBUG_DIR_RVA = TEXT_RVA + 0x100;
    const host = makeHost(b => {
      b.writeUInt32LE(FILE_ALIGN, OPTOFF + 60); // SizeOfHeaders
      b.writeUInt32LE(FILE_ALIGN, SHOFF + 20); // .text PointerToRawData
      if (withFileOffsets) {
        b.writeUInt32LE(FILE_ALIGN + 0x180, PEOFF + 12); // PointerToSymbolTable, inside .text
        b.writeUInt32LE(DEBUG_DIR_RVA, DDOFF + 6 * 8); // IMAGE_DIRECTORY_ENTRY_DEBUG
        b.writeUInt32LE(28, DDOFF + 6 * 8 + 4);
      }
    });
    // .text's bytes now live at FILE_ALIGN; fill them so the move below is observable.
    const text = Buffer.alloc(FILE_ALIGN);
    for (let i = 0; i < text.length; i++) text[i] = (i * 7 + 3) & 0xff;
    if (withFileOffsets) {
      const entry = 0x100; // the debug directory entry, at DEBUG_DIR_RVA
      text.writeUInt32LE(2, entry + 12); // Type: IMAGE_DEBUG_TYPE_CODEVIEW
      text.writeUInt32LE(16, entry + 16); // SizeOfData
      text.writeUInt32LE(TEXT_RVA + 0x140, entry + 20); // AddressOfRawData (an RVA, stays)
      text.writeUInt32LE(FILE_ALIGN + 0x140, entry + 24); // PointerToRawData (a file offset, moves)
    }
    return Buffer.concat([host.subarray(0, FILE_ALIGN), text]);
  }

  test("a host with too few spare section-header slots gets a larger header area", () => {
    const host = makeTightHost(false);
    const r = peLinkAddon(host, makeAddon(), "x");
    expect(expectSafe(r)).toBe("merged");
    const out = Buffer.from(r.output!);
    // One section header plus the three appended ones end at 0x228, so the header area grows
    // to the next file-alignment boundary and every section's data moves up by the same amount.
    expect(out.readUInt32LE(OPTOFF + 60)).toBe(2 * FILE_ALIGN);
    const text = sectionHeaders(out).find(s => s.name === ".text")!;
    expect(text.rawPtr).toBe(2 * FILE_ALIGN);
    expect(out.subarray(text.rawPtr, text.rawPtr + text.rawSize).equals(host.subarray(FILE_ALIGN))).toBe(true);
    // Addresses do not move: the merge still lands where it would have in the roomy host.
    expect(r.rvaBase).toBe(peLinkAddon(makeHost(), makeAddon(), "x").rvaBase);
  });

  test("growing the header area moves the debug directory and symbol table file offsets too", () => {
    const r = peLinkAddon(makeTightHost(true), makeAddon(), "x");
    expect(expectSafe(r)).toBe("merged");
    const out = Buffer.from(r.output!);
    expect(out.readUInt32LE(PEOFF + 12)).toBe(2 * FILE_ALIGN + 0x180);
    const entry = fileOffset(out, SECT_ALIGN + 0x100);
    expect(entry).toBe(2 * FILE_ALIGN + 0x100);
    expect(out.readUInt32LE(entry + 20)).toBe(SECT_ALIGN + 0x140);
    expect(out.readUInt32LE(entry + 24)).toBe(2 * FILE_ALIGN + 0x140);
  });

  test("the header area cannot grow into the first section", () => {
    // 92 sections fill the header area right up to .text's address, so the three appended
    // headers have nowhere to go: the merge is refused rather than overlapping the section.
    const r = peLinkAddon(
      makeHost(b => {
        const extra = 91;
        b.writeUInt16LE(1 + extra, PEOFF + 6);
        for (let i = 1; i <= extra; i++) {
          const h = SHOFF + i * 40;
          b.write(`.e${i}`, h, "latin1");
          b.writeUInt32LE(SECT_ALIGN, h + 12); // VirtualAddress, empty section
          b.writeUInt32LE(0x40000040, h + 36);
        }
      }),
      makeAddon(),
      "x",
    );
    expect(r.error).toContain("InsufficientHeaderSpace");
  });

  test("a host whose first section's data is not file-aligned cannot grow its header area", () => {
    const r = peLinkAddon(
      makeHost(b => {
        b.writeUInt32LE(SHOFF + 40, SHOFF + 20); // .text PointerToRawData right after its header
      }),
      makeAddon(),
      "x",
    );
    expect(r.error).toContain("InsufficientHeaderSpace");
  });

  test("merging addons back-to-back produces non-overlapping sections", () => {
    // Use the hook twice by feeding the first output back in. validate()
    // inside the hook rejects overlapping raw ranges / mismatched
    // SizeOfImage, so a successful second merge is the structural proof.
    const first = peLinkAddon(makeHost(), makeAddon(), "B:/~BUN/root/a.node");
    expect(expectSafe(first)).toBe("merged");
    const second = peLinkAddon(Buffer.from(first.output!), makeAddon(), "B:/~BUN/root/b.node");
    expect(expectSafe(second)).toBe("merged");
    // The hook always passes addon_index=0 so both addon sections are
    // named ".bn0" — that is a testing-hook artefact, the real
    // linkNativeAddonsForWindows threads a unique index through. What
    // matters here is that each merge landed at a higher RVA than the
    // last and validate() accepted the result.
    expect(second.rvaBase!).toBeGreaterThan(first.rvaBase!);
    expect(sections(Buffer.from(second.output!))).toEqual([".text", ".bn0", ".bunL", ".bn0", ".bunL"]);
  });

  test("huge SizeOfImage (DoS vector) is skipped instead of allocated", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x7fff0000, OPTOFF + 56)),
      "x",
    );
    expect(expectSafe(r)).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// Exception directory merging. Windows only looks at the exception directory of
// the image that contains a pc, so the addon's RUNTIME_FUNCTIONs have to end up
// in the host's directory, rebased, and every handler they name has to be
// replaced with the host's trampoline (whose RVA the hook takes as a 4th arg).
// ---------------------------------------------------------------------------

const TEXT_RVA = SECT_ALIGN;
const BODY = FILE_ALIGN; // file offset of the addon's section body
// Free space in makeAddon's section, after the offsets it uses itself.
const UNWIND_A = 0x140; // UNWIND_INFO with an exception handler
const UNWIND_B = 0x150; // UNWIND_INFO chained to the function described by UNWIND_A
const PDATA = 0x180;
const HANDLER = 0x004; // any RVA inside the image will do as the "real" handler
const TRAMPOLINE = 0x1234; // pretend RVA of the host's exported trampoline
const RVA_BASE = 2 * SECT_ALIGN; // where makeHost places the addon (see the baseline test)
const IMAGE_SIZE = TEXT_RVA + SECT_ALIGN; // makeAddon's SizeOfImage; chained-record copies are appended here
const HANDLER_RVA = RVA_BASE + TEXT_RVA + HANDLER; // the displaced handler, as the index records it

type Entry = [begin: number, end: number, unwind: number];

// Writes UNWIND_A (handler-bearing), UNWIND_B (chained to UNWIND_A) and a .pdata
// table of `entries`, then points the exception directory at the table.
function withPdata(entries: Entry[], size = entries.length * 12): (b: Buffer) => void {
  return b => {
    const body = b.subarray(BODY);
    body[UNWIND_A] = 0x01 | (1 << 3); // version 1, UNW_FLAG_EHANDLER, no codes
    body.writeUInt32LE(TEXT_RVA + HANDLER, UNWIND_A + 4);
    body[UNWIND_B] = 0x01 | (4 << 3); // version 1, UNW_FLAG_CHAININFO
    body.writeUInt32LE(TEXT_RVA + 0, UNWIND_B + 4);
    body.writeUInt32LE(TEXT_RVA + 8, UNWIND_B + 8);
    body.writeUInt32LE(TEXT_RVA + UNWIND_A, UNWIND_B + 12);
    entries.forEach(([begin, end, unwind], i) => {
      body.writeUInt32LE(begin, PDATA + i * 12);
      body.writeUInt32LE(end, PDATA + i * 12 + 4);
      body.writeUInt32LE(unwind, PDATA + i * 12 + 8);
    });
    b.writeUInt32LE(TEXT_RVA + PDATA, DDOFF + 3 * 8);
    b.writeUInt32LE(size, DDOFF + 3 * 8 + 4);
  };
}

const functionA: Entry = [TEXT_RVA + 0, TEXT_RVA + 8, TEXT_RVA + UNWIND_A];
const functionB: Entry = [TEXT_RVA + 8, TEXT_RVA + 16, TEXT_RVA + UNWIND_B];

// The addon image is copied into .bn0 starting at RVA 0, so an addon RVA is also
// an offset into .bn0's raw data.
function bn0Bytes(output: Buffer, addonRva: number, length: number): number[] {
  const bn0 = sectionHeaders(output).find(s => s.name === ".bn0")!;
  const at = bn0.rawPtr + addonRva;
  return [...output.subarray(at, at + length)];
}

function u32s(values: number[]): number[] {
  return [...Buffer.from(new Uint32Array(values).buffer)];
}

describe("pe.addLinkedAddon exception directory", () => {
  test("entries are rebased into the host directory and the handler is redirected", () => {
    const r = peLinkAddon(makeHost(), makeAddon(withPdata([functionA])), "x", TRAMPOLINE);
    expect(expectSafe(r)).toBe("merged");
    const output = Buffer.from(r.output!);
    expect(exceptionDirectory(output)).toEqual([
      { begin: RVA_BASE + TEXT_RVA, end: RVA_BASE + TEXT_RVA + 8, unwind: RVA_BASE + TEXT_RVA + UNWIND_A },
    ]);
    // The unwind info inside the merged image now names the trampoline...
    expect(bn0Bytes(output, TEXT_RVA + UNWIND_A, 8)).toEqual([0x09, 0, 0, 0, ...u32s([TRAMPOLINE])]);
    // ...and the metadata tells the trampoline where the real handler went.
    // A plain record is presented to the handler as itself, so nothing was appended.
    expect(handlerIndex(Buffer.from(r.metadata!))).toEqual([
      {
        rvaBase: RVA_BASE,
        sectionSize: IMAGE_SIZE,
        handlers: [[RVA_BASE + TEXT_RVA + UNWIND_A, HANDLER_RVA, TEXT_RVA + UNWIND_A]],
      },
    ]);
  });

  test("chained unwind info is rebased and resolves to its primary's handler", () => {
    const r = peLinkAddon(makeHost(), makeAddon(withPdata([functionA, functionB])), "x", TRAMPOLINE);
    expect(expectSafe(r)).toBe("merged");
    const output = Buffer.from(r.output!);
    expect(exceptionDirectory(output)!.map(e => e.begin)).toEqual([RVA_BASE + TEXT_RVA, RVA_BASE + TEXT_RVA + 8]);
    // The RUNTIME_FUNCTION embedded in UNWIND_B was rebased in place (exactly once, although
    // UNWIND_A is reachable from both entries).
    expect(bn0Bytes(output, TEXT_RVA + UNWIND_B + 4, 12)).toEqual(
      u32s([RVA_BASE + TEXT_RVA, RVA_BASE + TEXT_RVA + 8, RVA_BASE + TEXT_RVA + UNWIND_A]),
    );
    expect(bn0Bytes(output, TEXT_RVA + UNWIND_A + 4, 4)).toEqual(u32s([TRAMPOLINE]));
    // An exception in function B is dispatched with B's entry, so the trampoline has to be able to
    // find the handler starting from UNWIND_B as well as from UNWIND_A. What it presents for B is a
    // copy of UNWIND_B appended after the image whose embedded entry stayed addon-relative, and the
    // copy resolves too, since a collided unwind re-dispatches with whatever was presented.
    const copy = IMAGE_SIZE;
    expect(handlerIndex(Buffer.from(r.metadata!))[0]).toEqual({
      rvaBase: RVA_BASE,
      sectionSize: IMAGE_SIZE + 16,
      handlers: [
        [RVA_BASE + TEXT_RVA + UNWIND_A, HANDLER_RVA, TEXT_RVA + UNWIND_A],
        [RVA_BASE + TEXT_RVA + UNWIND_B, HANDLER_RVA, copy],
        [RVA_BASE + copy, HANDLER_RVA, copy],
      ],
    });
    expect(bn0Bytes(output, copy, 16)).toEqual([
      0x01 | (4 << 3),
      0,
      0,
      0,
      ...u32s([TEXT_RVA, TEXT_RVA + 8, TEXT_RVA + UNWIND_A]),
    ]);
    expect(sectionHeaders(output).find(s => s.name === ".bn0")!.rawSize).toBeGreaterThanOrEqual(IMAGE_SIZE + 16);
  });

  test("only the chained entry is listed; its primary's handler is still recorded for it", () => {
    const r = peLinkAddon(makeHost(), makeAddon(withPdata([functionB])), "x", TRAMPOLINE);
    expect(expectSafe(r)).toBe("merged");
    expect(handlerIndex(Buffer.from(r.metadata!))[0].handlers).toEqual([
      [RVA_BASE + TEXT_RVA + UNWIND_A, HANDLER_RVA, TEXT_RVA + UNWIND_A],
      [RVA_BASE + TEXT_RVA + UNWIND_B, HANDLER_RVA, IMAGE_SIZE],
      [RVA_BASE + IMAGE_SIZE, HANDLER_RVA, IMAGE_SIZE],
    ]);
  });

  test("a chain ending in handler-free unwind info records nothing and copies nothing", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        withPdata([functionA, functionB])(b);
        b[BODY + UNWIND_A] = 0x01; // version 1, no flags
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("merged");
    expect(handlerIndex(Buffer.from(r.metadata!))[0]).toEqual({
      rvaBase: RVA_BASE,
      sectionSize: IMAGE_SIZE,
      handlers: [],
    });
  });

  // One .pdata entry whose unwind info is the head of `hops` chained records (each 16 bytes, placed
  // in a second page of section data) ending in UNWIND_A. ntdll follows at most 32 links.
  function withChain(hops: number): Buffer {
    const CHAIN = 0x200; // section offset of the first record; makeAddon's own data ends before it
    const extra = Buffer.alloc(FILE_ALIGN * 2);
    for (let i = 0; i < hops; i++) {
      const rec = i * 16;
      extra[rec] = 0x01 | (4 << 3); // version 1, UNW_FLAG_CHAININFO, no codes
      extra.writeUInt32LE(TEXT_RVA + 0, rec + 4);
      extra.writeUInt32LE(TEXT_RVA + 8, rec + 8);
      const next = i + 1 < hops ? CHAIN + (i + 1) * 16 : UNWIND_A;
      extra.writeUInt32LE(TEXT_RVA + next, rec + 12);
    }
    const addon = Buffer.concat([makeAddon(withPdata([[TEXT_RVA + 0, TEXT_RVA + 8, TEXT_RVA + CHAIN]])), extra]);
    addon.writeUInt32LE(CHAIN + extra.length, SHOFF + 8); // VirtualSize
    addon.writeUInt32LE(CHAIN + extra.length, SHOFF + 16); // SizeOfRawData
    return addon;
  }

  test("a chain of 32 links is merged and every link resolves to the handler", () => {
    const r = peLinkAddon(makeHost(), withChain(32), "x", TRAMPOLINE);
    expect(expectSafe(r)).toBe("merged");
    const output = Buffer.from(r.output!);
    const { sectionSize, handlers } = handlerIndex(Buffer.from(r.metadata!))[0];
    // 32 chained records, their primary, and a copy of each chained record.
    expect(handlers).toHaveLength(65);
    expect(sectionSize).toBe(IMAGE_SIZE + 32 * 16);
    expect(handlers.map(h => h[0])).toEqual([...handlers.map(h => h[0])].sort((a, b) => a - b));
    expect(new Set(handlers.map(h => h[1]))).toEqual(new Set([HANDLER_RVA]));
    // The copies chain to each other (addon-relative) and end at the primary, so a walk that starts
    // from what the trampoline presents for the first link sees the same chain Windows saw, in the
    // addon's own terms.
    const viewOf = (unwindRva: number) => handlers.find(h => h[0] === RVA_BASE + unwindRva)![2];
    let record = viewOf(TEXT_RVA + 0x200);
    for (let hop = 0; hop < 32; hop++) {
      expect(record).toBeGreaterThanOrEqual(IMAGE_SIZE);
      const [flags, , , , ...rest] = bn0Bytes(output, record, 16);
      expect(flags).toBe(0x01 | (4 << 3));
      expect(rest.slice(0, 8)).toEqual(u32s([TEXT_RVA + 0, TEXT_RVA + 8]));
      record = Buffer.from(rest.slice(8, 12)).readUInt32LE(0);
    }
    expect(record).toBe(TEXT_RVA + UNWIND_A);
  });

  test("a chain of 33 links is skipped", () => {
    expect(expectSafe(peLinkAddon(makeHost(), withChain(33), "x", TRAMPOLINE))).toBe("skipped");
  });

  test("unwind info chained to itself is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        withPdata([functionB])(b);
        b.writeUInt32LE(TEXT_RVA + UNWIND_B, BODY + UNWIND_B + 12);
      }),
      "x",
      TRAMPOLINE,
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("an addon whose code has handlers is skipped when the host has no trampoline", () => {
    const r = peLinkAddon(makeHost(), makeAddon(withPdata([functionA])), "x");
    expect(expectSafe(r)).toBe("skipped");
  });

  test("handler-free unwind info merges without a trampoline", () => {
    const plain: Entry = [TEXT_RVA + 0, TEXT_RVA + 8, TEXT_RVA + UNWIND_A];
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        withPdata([plain])(b);
        b[BODY + UNWIND_A] = 0x01; // version 1, no flags: the handler field is not part of it
      }),
      "x",
    );
    expect(expectSafe(r)).toBe("merged");
    expect(exceptionDirectory(Buffer.from(r.output!))).toHaveLength(1);
    expect(handlerIndex(Buffer.from(r.metadata!))[0].handlers).toEqual([]);
  });

  test("a host directory is preserved ahead of the addon's entries", () => {
    const host = makeHost(b => {
      // One RUNTIME_FUNCTION for the host's own .text, stored in .text's raw data.
      const textRaw = 0x1000; // PointerToRawData of makeHost's .text
      b.writeUInt32LE(SECT_ALIGN, textRaw);
      b.writeUInt32LE(SECT_ALIGN + 0x10, textRaw + 4);
      b.writeUInt32LE(SECT_ALIGN + 0x20, textRaw + 8);
      b.writeUInt32LE(SECT_ALIGN, DDOFF + 3 * 8);
      b.writeUInt32LE(12, DDOFF + 3 * 8 + 4);
    });
    const r = peLinkAddon(host, makeAddon(withPdata([functionA])), "x", TRAMPOLINE);
    expect(expectSafe(r)).toBe("merged");
    expect(exceptionDirectory(Buffer.from(r.output!))).toEqual([
      { begin: SECT_ALIGN, end: SECT_ALIGN + 0x10, unwind: SECT_ALIGN + 0x20 },
      { begin: RVA_BASE + TEXT_RVA, end: RVA_BASE + TEXT_RVA + 8, unwind: RVA_BASE + TEXT_RVA + UNWIND_A },
    ]);
  });

  test("a second addon appends after the first one's entries", () => {
    const first = peLinkAddon(makeHost(), makeAddon(withPdata([functionA])), "a", TRAMPOLINE);
    expect(expectSafe(first)).toBe("merged");
    const second = peLinkAddon(Buffer.from(first.output!), makeAddon(withPdata([functionA])), "b", TRAMPOLINE);
    expect(expectSafe(second)).toBe("merged");
    const begins = exceptionDirectory(Buffer.from(second.output!))!.map(e => e.begin);
    expect(begins).toEqual([first.rvaBase! + TEXT_RVA, second.rvaBase! + TEXT_RVA]);
  });

  test.each<[string, Entry[], number | undefined]>([
    ["unsorted entries", [functionB, functionA], undefined],
    ["function end before its start", [[TEXT_RVA + 8, TEXT_RVA + 8, TEXT_RVA + UNWIND_A]], undefined],
    ["function end past the image", [[TEXT_RVA, 0x7000_0000, TEXT_RVA + UNWIND_A]], undefined],
    ["unwind info past the image", [[TEXT_RVA, TEXT_RVA + 8, 0x7000_0000]], undefined],
    ["indirect entry (low bit set)", [[TEXT_RVA, TEXT_RVA + 8, TEXT_RVA + UNWIND_A + 1]], undefined],
    ["directory size not a multiple of the entry size", [functionA], 13],
    ["directory running past the image", [functionA], 0x1000],
  ])("%s is skipped, leaving the host untouched", (_name, entries, size) => {
    const r = peLinkAddon(makeHost(), makeAddon(withPdata(entries, size)), "x", TRAMPOLINE);
    expect(expectSafe(r)).toBe("skipped");
  });

  test("a chained entry whose target is malformed is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        withPdata([functionB])(b);
        b.writeUInt32LE(0x7000_0000, BODY + UNWIND_B + 12); // chained unwind info past the image
      }),
      "x",
      TRAMPOLINE,
    );
    expect(expectSafe(r)).toBe("skipped");
  });

  test("random single-byte mutations of the unwind data are always merged / skipped / error", () => {
    const host = makeHost();
    const seed = makeAddon(withPdata([functionA, functionB]));
    let state = 0xc0ffee >>> 0;
    const rnd = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (let i = 0; i < 256; i++) {
      const a = Buffer.from(seed);
      // Aim at the unwind infos and the table rather than the whole file.
      a[BODY + UNWIND_A + (rnd() % (PDATA + 24 - UNWIND_A))] = rnd() & 0xff;
      // A merge must still yield a sorted, in-bounds directory: validate() inside the hook
      // turns anything else into an error, and expectSafe accepts all three outcomes.
      expect(["merged", "skipped", "error"]).toContain(expectSafe(peLinkAddon(host, a, "x", TRAMPOLINE)));
    }
  });

  test("unwind info with an unknown version is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => {
        withPdata([functionA])(b);
        b[BODY + UNWIND_A] = 0x03 | (1 << 3);
      }),
      "x",
      TRAMPOLINE,
    );
    expect(expectSafe(r)).toBe("skipped");
  });
});

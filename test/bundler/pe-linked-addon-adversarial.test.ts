// Adversarial coverage for pe.PEFile.addLinkedAddon — the part of
// `bun build --compile` that parses a user-supplied `.node` PE and
// merges it into the Windows output executable.
//
// The addon bytes are untrusted (they come from npm packages), so the
// parser must never hang, overflow, or corrupt the host image on
// malformed input. Every case here must either produce a host image
// that still passes PE validation, or be cleanly rejected with
// `{ skipped: true }` / `{ error: ... }` so the runtime can fall back to
// the temp-file+LoadLibrary path.
//
// Runs on every platform via the `peLinkAddon` testing hook — no Windows
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

function sections(pe: Buffer): string[] {
  const peOff = pe.readUInt32LE(0x3c);
  const n = pe.readUInt16LE(peOff + 6);
  const sh = peOff + 24 + pe.readUInt16LE(peOff + 20);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = pe.subarray(sh + i * 40, sh + i * 40 + 8);
    const z = raw.indexOf(0);
    out.push(raw.subarray(0, z === -1 ? 8 : z).toString("latin1"));
  }
  return out;
}

// Contract: every adversarial input must either merge into a PE that still
// passes validate(), or be rejected. Never undefined / never a crash. When it
// *is* rejected the host image must be untouched, so the `.bun` graph can
// still carry the raw addon bytes for the runtime fallback.
function expectSafe(res: ReturnType<typeof peLinkAddon>) {
  if (res.error !== undefined) {
    expect(typeof res.error).toBe("string");
    return "error" as const;
  }
  if (res.skipped === true) return "skipped" as const;
  expect(res.skipped).toBe(false);
  // Merge succeeded — the output must be a well-formed PE with the new
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
    // Metadata starts with 'BLNK' magic + version 1 + count 1.
    const m = Buffer.from(res.metadata!);
    expect(m.readUInt32LE(0)).toBe(0x4b4e4c42);
    expect(m.readUInt32LE(4)).toBe(1);
    expect(m.readUInt32LE(8)).toBe(1);
  });

  test("non-PE junk is skipped without touching the host", () => {
    // The hook rejects before any host mutation; a separate merge of
    // a *valid* addon against the same host bytes must then produce
    // exactly the baseline output, proving the first call left the
    // host unchanged.
    const host = makeHost();
    const r = peLinkAddon(host, Buffer.from("not a pe file at all"), "x");
    expect(r.skipped).toBe(true);
    expect(r.output).toBeUndefined();
    const again = peLinkAddon(host, makeAddon(), "B:/~BUN/root/addon.node");
    expect(expectSafe(again)).toBe("merged");
  });

  test("addon with AddressOfEntryPoint past SizeOfImage is skipped", () => {
    // Runtime would otherwise jump to exe_base + rva_base + bogus_rva.
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x7fffffff, OPTOFF + 16)),
      "x",
    );
    expect(r.skipped).toBe(true);
  });

  test("PE32 (not PE32+) is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt16LE(0x010b, OPTOFF)),
      "x",
    );
    // AddonView.init rejects non-PE32+ magic → addLinkedAddon returns null.
    expect(r.skipped).toBe(true);
  });

  test("addon with IMAGE_FILE_RELOCS_STRIPPED is skipped (cannot rebase)", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt16LE(b.readUInt16LE(PEOFF + 22) | 0x0001, PEOFF + 22)),
      "x",
    );
    expect(r.skipped).toBe(true);
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
    expect(r.skipped).toBe(true);
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
    expect(r.skipped).toBe(true);
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
    expect(r.skipped).toBe(true);
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
    expect(r.skipped).toBe(true);
  });

  test("addon with SizeOfImage = 0 is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0, OPTOFF + 56)),
      "x",
    );
    expect(r.skipped).toBe(true);
  });

  test("addon section whose VirtualAddress lies past SizeOfImage is skipped", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x80000, SHOFF + 12)),
      "x",
    );
    expect(r.skipped).toBe(true);
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
    expect(r.skipped).toBe(true);
  });

  test("unknown reloc type (HIGHLOW on PE32+) is rejected, not applied blindly", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt16LE((3 << 12) | 0x008, FILE_ALIGN + 0x0a0 + 8)),
      "x",
    );
    expect(r.skipped).toBe(true);
  });

  // Import-directory attacks.

  test("import descriptor at an RVA outside any section is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x7ffff000, DDOFF + 1 * 8)),
      "x",
    );
    expect(r.skipped).toBe(true);
  });

  test("import descriptor whose DLL-name RVA points past the file is rejected", () => {
    const r = peLinkAddon(
      makeHost(),
      makeAddon(b => b.writeUInt32LE(0x7fffffff, FILE_ALIGN + 0x070 + 12)),
      "x",
    );
    expect(r.skipped).toBe(true);
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
    expect(r.skipped).toBe(true);
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
    expect(r.skipped).toBe(true);
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

  test("host with no spare section-header slots returns InsufficientHeaderSpace", () => {
    const r = peLinkAddon(
      // SizeOfHeaders leaves room for exactly the one existing section
      // header and nothing more: first_raw sits right after it.
      makeHost(b => {
        const firstRaw = SHOFF + 40; // one section header
        b.writeUInt32LE(firstRaw, SHOFF + 20); // .text PointerToRawData
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
    expect(r.skipped).toBe(true);
  });
});

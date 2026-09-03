/**
 * Reads the module graph that `bun build --compile` embeds in an executable.
 * Only the section that holds it is read (ELF `.bun`, Mach-O `__BUN,__bun`,
 * PE `.bun`), not the whole executable (hundreds of MB in a debug build).
 *
 * The layout is `to_bytes` in src/standalone_graph/StandaloneModuleGraph.rs.
 * The section starts with a u64 payload length. The payload ends with
 * `Offsets { byte_count: usize, modules_ptr: StringPointer, entry_point_id:
 * u32, compile_exec_argv_ptr: StringPointer, flags: u32 }` (32 bytes) and the
 * `---- Bun! ----` trailer. A `StringPointer` is `{ offset: u32, length: u32 }`
 * relative to the payload.
 */
import { expect } from "bun:test";
import { isWindows } from "harness";
import { closeSync, openSync, readSync } from "node:fs";

export interface Span {
  offset: number;
  length: number;
}

export interface EmbeddedModule {
  /** `/$bunfs/root/<name>` (`B:/~BUN/root/<name>` on Windows) */
  name: string;
  /** The printed chunk. */
  source: string;
  contents: Span;
  bytecode: Span;
  moduleInfo: Span;
  /** Header of the ES module record a `--bytecode` chunk carries (`serialize_body` in src/js_printer/lib.rs). */
  moduleRecord: { requestedModules: number; records: number } | null;
}

export interface ModuleGraph {
  /** Table order is load order. */
  modules: EmbeddedModule[];
  entryPointId: number;
  flags: number;
  /** Leading modules that make up the entry point's static import closure. */
  startupCount: number;
  /** Ahead-of-time bytecode of the internal modules the bundle imports, by InternalModuleRegistry id. */
  builtinBytecode: (Span & { id: number })[];
  bytecodeStringTable: Span | null;
  /** Slots of the bytecode string table that the module records' names resolve through. */
  moduleInfoStringTable: Span | null;
}

/** `Flags` in src/standalone_graph/StandaloneModuleGraph.rs */
export const Flags = {
  HAS_SOURCE_HASHES: 1 << 5,
  HAS_BUILTIN_BYTECODE: 1 << 6,
  HAS_BYTECODE_STRING_TABLE: 1 << 7,
  HAS_STARTUP_MODULE_COUNT: 1 << 8,
  HAS_MODULE_INFO_STRING_TABLE: 1 << 9,
};

const TRAILER = Buffer.from("\n---- Bun! ----\n", "latin1");

function readAt(fd: number, offset: number, size: number): Buffer {
  const buf = Buffer.alloc(size);
  const read = readSync(fd, buf, 0, size, offset);
  if (read !== size) throw new Error(`read ${read} of ${size} bytes at offset ${offset}`);
  return buf;
}

/** The ELF `.bun` section, through the section header table. Null for another format. */
export function readBunSectionELF(fd: number): Buffer | null {
  const ehdr = Buffer.alloc(64);
  readSync(fd, ehdr, 0, 64, 0);
  // "\x7fELF", ELFCLASS64, little-endian
  if (ehdr.toString("latin1", 0, 4) !== "\x7fELF" || ehdr[4] !== 2 || ehdr[5] !== 1) return null;
  const shoff = Number(ehdr.readBigUInt64LE(0x28));
  const shentsize = ehdr.readUInt16LE(0x3a);
  const shnum = ehdr.readUInt16LE(0x3c);
  const shstrndx = ehdr.readUInt16LE(0x3e);
  const shdrs = readAt(fd, shoff, shentsize * shnum);
  // Elf64_Shdr: sh_name u32, sh_type u32, sh_flags u64, sh_addr u64, sh_offset u64, sh_size u64, ...
  const header = (i: number) => {
    const sh = shdrs.subarray(i * shentsize, (i + 1) * shentsize);
    return {
      name: sh.readUInt32LE(0),
      offset: Number(sh.readBigUInt64LE(0x18)),
      size: Number(sh.readBigUInt64LE(0x20)),
    };
  };
  const strtab = header(shstrndx);
  const names = readAt(fd, strtab.offset, strtab.size);
  for (let i = 0; i < shnum; i++) {
    const sh = header(i);
    if (names.toString("latin1", sh.name, names.indexOf(0, sh.name)) === ".bun") return readAt(fd, sh.offset, sh.size);
  }
  return null;
}

/** The Mach-O `__bun` section of the `__BUN` segment, through the load commands. Null for another format. */
export function readBunSectionMachO(fd: number): Buffer | null {
  // mach_header_64: magic, cputype, cpusubtype, filetype, ncmds, sizeofcmds, flags, reserved (32 bytes)
  const header = readAt(fd, 0, 32);
  if (header.readUInt32LE(0) !== 0xfeedfacf) return null;
  const ncmds = header.readUInt32LE(16);
  const commands = readAt(fd, 32, header.readUInt32LE(20));
  for (let at = 0, i = 0; i < ncmds; i++, at += commands.readUInt32LE(at + 4)) {
    // segment_command_64 (72 bytes): cmd, cmdsize, segname[16], vmaddr, vmsize, fileoff, filesize,
    // maxprot, initprot, nsects, flags. LC_SEGMENT_64 is 0x19.
    if (commands.readUInt32LE(at) !== 0x19 || commands.toString("latin1", at + 8, at + 14) !== "__BUN\0") continue;
    const nsects = commands.readUInt32LE(at + 64);
    for (let section = at + 72, j = 0; j < nsects; j++, section += 80) {
      // section_64 (80 bytes): sectname[16], segname[16], addr u64, size u64, offset u32, ...
      if (commands.toString("latin1", section, section + 6) !== "__bun\0") continue;
      return readAt(fd, commands.readUInt32LE(section + 48), Number(commands.readBigUInt64LE(section + 40)));
    }
  }
  return null;
}

/** The PE `.bun` section, through the section table. Null for another format. */
export function readBunSectionPE(fd: number): Buffer | null {
  const dos = readAt(fd, 0, 64);
  if (dos.toString("latin1", 0, 2) !== "MZ") return null;
  const pe = dos.readUInt32LE(0x3c);
  // "PE\0\0", then the COFF header: Machine u16, NumberOfSections u16, TimeDateStamp u32,
  // PointerToSymbolTable u32, NumberOfSymbols u32, SizeOfOptionalHeader u16, Characteristics u16.
  const coff = readAt(fd, pe, 24);
  if (coff.toString("latin1", 0, 4) !== "PE\0\0") return null;
  const sectionCount = coff.readUInt16LE(6);
  const sections = readAt(fd, pe + 24 + coff.readUInt16LE(20), sectionCount * 40);
  for (let at = 0, i = 0; i < sectionCount; i++, at += 40) {
    // IMAGE_SECTION_HEADER (40 bytes): Name[8], VirtualSize u32, VirtualAddress u32, SizeOfRawData u32, PointerToRawData u32, ...
    if (sections.toString("latin1", at, at + 5) !== ".bun\0") continue;
    return readAt(fd, sections.readUInt32LE(at + 20), sections.readUInt32LE(at + 16));
  }
  return null;
}

/**
 * Parses the module graph embedded in the executable at `outfile`. Only the
 * section that holds it is read.
 */
export function readModuleGraph(outfile: string): ModuleGraph {
  // A Windows target gets `.exe` appended to the outfile it was asked for.
  const path = isWindows ? `${outfile}.exe` : outfile;
  const fd = openSync(path, "r");
  let data: Buffer | null;
  try {
    data = readBunSectionELF(fd) ?? readBunSectionMachO(fd) ?? readBunSectionPE(fd);
  } finally {
    closeSync(fd);
  }
  if (!data) throw new Error(`${path} has no module graph section: not an ELF, Mach-O or PE executable`);
  const trailer = data.lastIndexOf(TRAILER);
  expect(trailer).toBeGreaterThan(0);
  const offsets = trailer - 32;
  const base = offsets - Number(data.readBigUInt64LE(offsets));
  const payload = data.subarray(base, trailer);

  const span = (at: number): Span => ({ offset: payload.readUInt32LE(at), length: payload.readUInt32LE(at + 4) });
  const text = ({ offset, length }: Span) => payload.toString("latin1", offset, offset + length);
  const table = span(payload.length - 32 + 8);
  const entryPointId = payload.readUInt32LE(payload.length - 32 + 16);
  const flags = payload.readUInt32LE(payload.length - 32 + 28);

  // `CompiledModuleGraphFile`: name, contents, sourcemap, bytecode, module_info,
  // bytecode_origin_path (StringPointer each), then 4 bytes.
  const RECORD = 52;
  expect(table.length % RECORD).toBe(0);
  const modules: EmbeddedModule[] = [];
  for (let record = table.offset; record < table.offset + table.length; record += RECORD) {
    const contents = span(record + 8);
    const moduleInfo = span(record + 32);
    modules.push({
      name: text(span(record)),
      source: text(contents),
      contents,
      bytecode: span(record + 24),
      moduleInfo,
      // u8 flags, u8 id width, u8 0, u8 0, u32 requested-module count, u32 record count, ...
      moduleRecord:
        moduleInfo.length >= 12
          ? {
              requestedModules: payload.readUInt32LE(moduleInfo.offset + 4),
              records: payload.readUInt32LE(moduleInfo.offset + 8),
            }
          : null,
    });
  }

  // Records chained after the module table, in `Flags` bit order.
  let at = table.offset + table.length;
  if (flags & Flags.HAS_SOURCE_HASHES) at += modules.length * 4;
  const builtinBytecode: ModuleGraph["builtinBytecode"] = [];
  if (flags & Flags.HAS_BUILTIN_BYTECODE) {
    // `u32 count`, then `count` × `{ u32 id, StringPointer bytes }`
    const count = payload.readUInt32LE(at);
    at += 4;
    for (let i = 0; i < count; i++, at += 12) {
      builtinBytecode.push({ id: payload.readUInt32LE(at), ...span(at + 4) });
    }
  }
  let bytecodeStringTable: Span | null = null;
  if (flags & Flags.HAS_BYTECODE_STRING_TABLE) {
    bytecodeStringTable = span(at);
    at += 8;
  }
  let startupCount = modules.length;
  if (flags & Flags.HAS_STARTUP_MODULE_COUNT) {
    startupCount = payload.readUInt32LE(at);
    at += 4;
  }
  let moduleInfoStringTable: Span | null = null;
  if (flags & Flags.HAS_MODULE_INFO_STRING_TABLE) {
    moduleInfoStringTable = span(at);
  }

  // JSC reads the bytecode in place and expects it 128-byte aligned once
  // mapped. The section is page aligned and starts with the 8-byte length, so
  // every bytecode region sits at 120 mod 128 (`append_bytecode_aligned`).
  // Module records and their string table are not aligned.
  const aligned: Span[] = [...modules.map(m => m.bytecode), ...builtinBytecode];
  if (bytecodeStringTable) aligned.push(bytecodeStringTable);
  for (const region of aligned) {
    if (region.length > 0)
      expect(region.offset % 128, `bytecode at payload offset ${region.offset} is aligned`).toBe(120);
  }

  return { modules, entryPointId, flags, startupCount, builtinBytecode, bytecodeStringTable, moduleInfoStringTable };
}

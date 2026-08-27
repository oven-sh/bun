/**
 * Reads the module graph that `bun build --compile` embeds in an executable,
 * without reading the whole executable (hundreds of MB in a debug build).
 *
 * The layout is `to_bytes` in src/standalone_graph/StandaloneModuleGraph.rs.
 * The payload ends with `Offsets { byte_count: usize, modules_ptr:
 * StringPointer, entry_point_id: u32, compile_exec_argv_ptr: StringPointer,
 * flags: u32 }` (32 bytes) and the `---- Bun! ----` trailer. A `StringPointer`
 * is `{ offset: u32, length: u32 }` relative to the payload.
 */
import { expect } from "bun:test";
import { isWindows } from "harness";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";

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
  moduleInfoStringTable: (Span & { text: string }) | null;
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

/**
 * On Linux the graph is the ELF `.bun` section, far from the end of the file.
 * Returns null for any other executable format.
 */
export function readBunSectionELF(fd: number): Buffer | null {
  const ehdr = Buffer.alloc(64);
  readSync(fd, ehdr, 0, 64, 0);
  // "\x7fELF", ELFCLASS64, little-endian
  if (ehdr.toString("latin1", 0, 4) !== "\x7fELF" || ehdr[4] !== 2 || ehdr[5] !== 1) return null;
  const shoff = Number(ehdr.readBigUInt64LE(0x28));
  const shentsize = ehdr.readUInt16LE(0x3a);
  const shnum = ehdr.readUInt16LE(0x3c);
  const shstrndx = ehdr.readUInt16LE(0x3e);
  const shdrs = Buffer.alloc(shentsize * shnum);
  readSync(fd, shdrs, 0, shdrs.length, shoff);
  const header = (i: number) => {
    const sh = shdrs.subarray(i * shentsize, (i + 1) * shentsize);
    return {
      name: sh.readUInt32LE(0),
      offset: Number(sh.readBigUInt64LE(0x18)),
      size: Number(sh.readBigUInt64LE(0x20)),
    };
  };
  const read = ({ offset, size }: { offset: number; size: number }) => {
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, offset);
    return buf;
  };
  const names = read(header(shstrndx));
  for (let i = 0; i < shnum; i++) {
    const sh = header(i);
    if (names.toString("latin1", sh.name, names.indexOf(0, sh.name)) === ".bun") return read(sh);
  }
  return null;
}

/**
 * Parses the module graph embedded in the executable at `outfile`. On Linux
 * only the `.bun` section is read. Other formats read the whole file.
 */
export function readModuleGraph(outfile: string): ModuleGraph {
  // A Windows target gets `.exe` appended to the outfile it was asked for.
  const fd = openSync(isWindows ? `${outfile}.exe` : outfile, "r");
  let data: Buffer;
  try {
    data = readBunSectionELF(fd) ?? readFileSync(fd);
  } finally {
    closeSync(fd);
  }
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
    modules.push({
      name: text(span(record)),
      source: text(contents),
      contents,
      bytecode: span(record + 24),
      moduleInfo: span(record + 32),
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
  let moduleInfoStringTable: ModuleGraph["moduleInfoStringTable"] = null;
  if (flags & Flags.HAS_MODULE_INFO_STRING_TABLE) {
    const strings = span(at);
    moduleInfoStringTable = { ...strings, text: text(strings) };
  }

  return { modules, entryPointId, flags, startupCount, builtinBytecode, bytecodeStringTable, moduleInfoStringTable };
}

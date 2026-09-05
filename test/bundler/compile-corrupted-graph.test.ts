// A compiled executable carries its module graph in the `.bun` section. The graph ends
// with `Offsets`, then the trailer. `Offsets` holds the size of the graph and the index of
// the entry point, and it points at the module table and at the compile exec argv string.
// Each 52-byte module record starts with six { u32 offset, u32 length } pointers: name,
// contents, source map, bytecode, module info and bytecode origin path. After the module
// table, `to_bytes` chains records in `Flags` bit order: a u32 source hash per module, the
// builtin bytecode table (u32 count, then count x { u32 id, u32 offset, u32 length }) and,
// with --bytecode, a pointer to the bytecode string table.
//
// These fields come from the file. Each case damages one of them, and the executable
// must report it at startup. `StandaloneModuleGraph::from_bytes` used to read past the
// end of the section instead, and a release build crashed.

import { expect, test } from "bun:test";
import { bunEnv, isMacOS, tempDir } from "harness";
import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

const TRAILER = "\n---- Bun! ----\n";
// repr(C): byte_count u64, modules_ptr { offset u32, length u32 }, entry_point_id u32,
// compile_exec_argv_ptr { offset u32, length u32 }, flags u32.
const OFFSETS_SIZE = 32;
const MODULE_RECORD_SIZE = 52;
const HAS_SOURCE_HASHES = 1 << 5;
const HAS_BUILTIN_BYTECODE = 1 << 6;
const HAS_BYTECODE_STRING_TABLE = 1 << 7;

/** File positions of the fields that the cases damage. */
function locateRecords(executable: Buffer) {
  const offsetsAt = executable.lastIndexOf(TRAILER) - OFFSETS_SIZE;
  const graphAt = offsetsAt - Number(executable.readBigUInt64LE(offsetsAt));
  const modulesAt = graphAt + executable.readUInt32LE(offsetsAt + 8);
  const modulesLength = executable.readUInt32LE(offsetsAt + 12);
  const builtinTableAt = modulesAt + modulesLength + (modulesLength / MODULE_RECORD_SIZE) * 4;
  const builtinCount = executable.readUInt32LE(builtinTableAt);
  // A serialized source map starts with { u32 file count, u32 map length }, then a pointer to each file name.
  const sourceMapAt = graphAt + executable.readUInt32LE(modulesAt + 16);
  return {
    flags: executable.readUInt32LE(offsetsAt + 28),
    moduleCount: modulesLength / MODULE_RECORD_SIZE,
    sourceMapLength: executable.readUInt32LE(modulesAt + 20),
    builtinCount,
    byteCountLowAt: offsetsAt,
    modulesLengthAt: offsetsAt + 12,
    entryPointIdAt: offsetsAt + 16,
    execArgvOffsetAt: offsetsAt + 20,
    firstModuleNameOffsetAt: modulesAt,
    firstModuleContentsLengthAt: modulesAt + 12,
    firstSourceFileNameOffsetAt: sourceMapAt + 8,
    builtinCountAt: builtinTableAt,
    firstBuiltinOffsetAt: builtinTableAt + 4 + 4,
    bytecodeStringTableOffsetAt: builtinTableAt + 4 + 12 * builtinCount,
  };
}
type Records = ReturnType<typeof locateRecords>;

/** Writes only the damaged field. The rest of the file stays as the build wrote it. */
function writeUInt32At(path: string, position: number, value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  const fd = openSync(path, "r+");
  try {
    expect(writeSync(fd, bytes, 0, bytes.length, position)).toBe(bytes.length);
  } finally {
    closeSync(fd);
  }
}

const cases = [
  {
    // `byte_count` is a u64. The graph is far smaller than 4 GiB, so its high half stays 0.
    label: "a byte count larger than the section",
    bytecode: false,
    field: (records: Records) => records.byteCountLowAt,
    value: 0x7ffffff0,
    error: "byte count is out of range",
  },
  {
    label: "a module list that runs past the end of the graph",
    bytecode: false,
    field: (records: Records) => records.modulesLengthAt,
    value: 0x7ffffff0,
    error: "module list is out of range",
  },
  {
    // The app is one module (the layout check below asserts it), so 1 is one past the end.
    label: "an entry point ID equal to the module count",
    bytecode: false,
    field: (records: Records) => records.entryPointIdAt,
    value: 1,
    error: "entry point ID is out of range for the module list",
  },
  {
    label: "a compile exec argv that starts past the end of the graph",
    bytecode: false,
    execArgv: ["--smol"],
    field: (records: Records) => records.execArgvOffsetAt,
    value: 0x7ffffff0,
    error: "compile exec argv is out of range",
  },
  {
    label: "a module name that starts past the end of the graph",
    bytecode: false,
    field: (records: Records) => records.firstModuleNameOffsetAt,
    value: 0xfffffff0,
    error: "module name is out of range",
  },
  {
    label: "module contents that run past the end of the graph",
    bytecode: false,
    field: (records: Records) => records.firstModuleContentsLengthAt,
    value: 0x7fffffff,
    error: "module contents are out of range",
  },
  {
    label: "a builtin bytecode count larger than the graph",
    bytecode: false,
    field: (records: Records) => records.builtinCountAt,
    value: 0xfffffff0,
    error: "builtin bytecode table is out of range",
  },
  {
    label: "a builtin bytecode entry that starts past the end of the graph",
    bytecode: true,
    field: (records: Records) => records.firstBuiltinOffsetAt,
    value: 0x7ffffff0,
    error: "builtin bytecode table is out of range",
  },
  {
    label: "a bytecode string table that starts past the end of the graph",
    bytecode: true,
    field: (records: Records) => records.bytecodeStringTableOffsetAt,
    value: 0x7ffffff0,
    error: "bytecode string table is out of range",
  },
];

// macOS is skipped: a patched Mach-O needs a new signature, and `from_bytes` is the same
// code on every platform. Each case compiles its own executable, a copy of the whole bun
// binary (about 800 MB under debug and ASAN), and reads it into memory. So the cases run
// one at a time, each with a higher timeout.
test.skipIf(isMacOS).each(cases)(
  "$label is reported as a corrupted module graph",
  async ({ bytecode, execArgv, field, value, error }) => {
    // node:path gives the --bytecode build some builtin bytecode entries.
    using dir = tempDir("compile-corrupted-graph", {
      "app.js": `import { join } from "node:path";\nconsole.log(join("should", "not", "run"));`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: { outfile: join(String(dir), "app"), execArgv },
      bytecode,
      format: "esm",
      target: "bun",
    });
    expect(result.success).toBe(true);
    const outfile = result.outputs[0].path;

    const records = locateRecords(Buffer.from(await Bun.file(outfile).arrayBuffer()));
    const expectedFlags = HAS_SOURCE_HASHES | HAS_BUILTIN_BYTECODE | (bytecode ? HAS_BYTECODE_STRING_TABLE : 0);
    expect({
      flags: records.flags & (HAS_SOURCE_HASHES | HAS_BUILTIN_BYTECODE | HAS_BYTECODE_STRING_TABLE),
      moduleCount: records.moduleCount,
      hasBuiltinBytecode: records.builtinCount > 0,
    }).toEqual({ flags: expectedFlags, moduleCount: 1, hasBuiltinBytecode: bytecode });

    writeUInt32At(outfile, field(records), value);

    await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: expect.stringContaining(`Corrupted module graph: ${error}`),
      exitCode: 1,
    });
  },
  60_000,
);

// The source map is read only when a stack trace prints. A file name that is out of range
// makes the map absent, so the trace shows the bundled path and not `app.js`.
test.skipIf(isMacOS)(
  "a source map file name that starts past the end of the source map makes the map absent",
  async () => {
    using dir = tempDir("compile-corrupted-source-map", {
      "app.js": `throw new Error("thrown by the app");`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: { outfile: join(String(dir), "app") },
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);
    const outfile = result.outputs.find(output => output.kind === "entry-point")!.path;

    const records = locateRecords(Buffer.from(await Bun.file(outfile).arrayBuffer()));
    expect({ moduleCount: records.moduleCount, hasSourceMap: records.sourceMapLength > 0 }).toEqual({
      moduleCount: 1,
      hasSourceMap: true,
    });
    writeUInt32At(outfile, records.firstSourceFileNameOffsetAt, 0x7ffffff0);

    await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: expect.stringMatching(/thrown by the app[\s\S]*(\$bunfs|~BUN)\/root\/app/),
      exitCode: 1,
    });
  },
  60_000,
);

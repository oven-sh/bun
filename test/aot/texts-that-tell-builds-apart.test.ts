import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, readElf64ProgramHeaders, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Programs outside this repository search a build of Bun for these texts and symbols. If one must ever say something else, a new one goes beside it.
const marks = [
  {
    symbol: "Bun__startsOnlyWhereWriteExecuteMemoryIsDenied",
    text: "hardened start: the kernel must deny write-execute memory",
    build: "all(bun_hardened, not(bun_starts_without_mdwe))",
  },
  {
    symbol: "Bun__startsWhereWriteExecuteMemoryCannotBeDenied",
    text: "hardened start: a kernel without PR_SET_MDWE is accepted ",
    build: "all(bun_hardened, bun_starts_without_mdwe)",
  },
  {
    symbol: "Bun__readsFewEnvironmentVariables",
    text: "hardened environment: what only tests set is never read   ",
    build: "bun_locked_environment",
  },
  {
    symbol: "Bun__readsEveryEnvironmentVariable",
    text: "hardened environment: every variable is read, as for tests",
    build: "all(bun_hardened, not(bun_locked_environment))",
  },
  {
    symbol: "Bun__startsWhereItsFileCannotBeRead",
    text: "execute-only start: where its file cannot be read, the loaded code is moved",
    build: "not(bun_refuses_execute_only_start)",
  },
  {
    symbol: "Bun__startsOnlyWhereItsFileCanBeRead",
    text: "execute-only start: where its file cannot be read, it does not start       ",
    build: "bun_refuses_execute_only_start",
  },
];
const [mustDeny, neednotDeny, readsFew, readsEvery] = marks;

test("each text, its symbol and the builds that hold it stand in the source letter for letter", () => {
  const source = readFileSync(join(import.meta.dir, "..", "..", "src", "jsc", "compiled_program.rs"), "utf8");
  for (const { symbol, text, build } of marks) {
    const declaration = new RegExp(
      `\\n    #\\[cfg\\((.*)\\)\\]\\n    #\\[used\\]\\n    #\\[unsafe\\(no_mangle\\)\\]\\n    (?:pub\\(super\\) )?static ${symbol}: \\[u8; (\\d+)\\] =\\n        \\*b"(.*)\\\\0";\\n`,
    ).exec(source);
    expect({ symbol, build: declaration?.[1], size: Number(declaration?.[2]), text: declaration?.[3] }).toEqual({
      symbol,
      build,
      size: text.length + 1,
      text,
    });
  }
});

function placesOf(file: Buffer, text: string) {
  const places: number[] = [];
  for (let at = file.indexOf(text + "\0"); at >= 0; at = file.indexOf(text + "\0", at + 1)) places.push(at);
  return places;
}

/** Where in the file each of the names begins, by the symbol table. Nothing: the file has no symbol table. */
function symbolsOf(path: string, file: Buffer, names: string[]) {
  const [symbolTable, entrySize] = [2, 24];
  const [headers, headerSize, count] = [Number(file.readBigUInt64LE(40)), file.readUInt16LE(58), file.readUInt16LE(60)];
  const sections = Array.from({ length: count }, (_, index) => {
    const at = headers + index * headerSize;
    return {
      type: file.readUInt32LE(at + 4),
      start: Number(file.readBigUInt64LE(at + 24)),
      size: Number(file.readBigUInt64LE(at + 32)),
      link: file.readUInt32LE(at + 40),
    };
  });
  const table = sections.find(section => section.type === symbolTable);
  if (!table) return undefined;
  const strings = file.subarray(sections[table.link].start, sections[table.link].start + sections[table.link].size);
  const wanted = new Map(names.map(name => [strings.indexOf(`\0${name}\0`) + 1, name]));
  wanted.delete(0);
  const segments = readElf64ProgramHeaders(path).filter(header => header.type === 1);
  const found: Record<string, number> = {};
  for (let at = table.start; at < table.start + table.size; at += entrySize) {
    const name = wanted.get(file.readUInt32LE(at));
    if (name === undefined) continue;
    const address = file.readBigUInt64LE(at + 8);
    const segment = segments.find(each => address >= each.vaddr && address < each.vaddr + each.filesz)!;
    found[name] = Number(segment.offset + address - segment.vaddr);
  }
  return found;
}

describe.skipIf(!isLinux)("the file of the Bun under test", () => {
  const file = isLinux ? readFileSync(process.execPath) : Buffer.alloc(0);
  const places = new Map(marks.map(mark => [mark, placesOf(file, mark.text)]));
  const holds = (mark: (typeof marks)[number]) => places.get(mark)!.length > 0;

  test("holds one text of each pair, once, and those about hardening only if it is hardened", () => {
    const counts = marks.map(mark => places.get(mark)!.length);
    expect([counts[0] + counts[1], counts[2] + counts[3], counts[4] + counts[5]]).toEqual(
      isHardened ? [1, 1, 1] : [0, 0, 1],
    );
  });

  test("names each text that it holds, and no other, in its symbol table if it has one", () => {
    const symbols = symbolsOf(
      process.execPath,
      file,
      marks.map(mark => mark.symbol),
    );
    if (!symbols) return;
    expect(symbols).toEqual(Object.fromEntries(marks.filter(holds).map(mark => [mark.symbol, places.get(mark)![0]])));
  });

  const launcher = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen(${JSON.stringify(isLinux ? libcPathForDlopen() : "")}, {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const load = 0x20, jumpIfEqual = 0x15, answer = 0x06, allow = 0x7fff0000, invalidArgument = 0x00050000 | 22;
const systemCall = 0, firstArgument = 16, prctl = process.arch === "arm64" ? 167 : 157, setMDWE = 65;
const instructions = [
  [load, 0, 0, systemCall], [jumpIfEqual, 0, 3, prctl],
  [load, 0, 0, firstArgument], [jumpIfEqual, 0, 1, setMDWE], [answer, 0, 0, invalidArgument],
  [answer, 0, 0, allow],
];
const filter = new Uint8Array(instructions.length * 8);
const view = new DataView(filter.buffer);
instructions.forEach(([code, ifTrue, ifFalse, operand], i) => {
  view.setUint16(i * 8, code, true);
  view.setUint8(i * 8 + 2, ifTrue);
  view.setUint8(i * 8 + 3, ifFalse);
  view.setUint32(i * 8 + 4, operand, true);
});
const filterProgram = new BigUint64Array([BigInt(instructions.length), BigInt(ptr(filter))]);
const path = Buffer.from(process.argv[2] + "\\0");
const argv = new BigUint64Array([BigInt(ptr(path)), 0n]);
if (libc.symbols.prctl(38, 1, 0, 0, 0)) throw new Error("PR_SET_NO_NEW_PRIVS was refused");
if (libc.symbols.prctl(22, 2, ptr(filterProgram), 0, 0)) throw new Error("the filter was refused");
libc.symbols.execv(ptr(path), ptr(argv));
throw new Error("execv failed");
`;

  test.skipIf(!isHardened)(
    "does what its texts about hardening say",
    async () => {
      using dir = tempDir("aot-texts-of-builds", {
        "program.ts": `console.log("started");\n`,
        "launcher.ts": launcher,
      });
      const executable = join(String(dir), "program");
      const built = await run([bunExe(), "build", "--compile", "--aot", executable + ".ts", "--outfile", executable]);
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });

      const onAnOldKernel = await run([bunExe(), join(String(dir), "launcher.ts"), executable]);
      expect({ [mustDeny.symbol]: holds(mustDeny), [neednotDeny.symbol]: holds(neednotDeny) }).toEqual({
        [mustDeny.symbol]: onAnOldKernel.exitCode === 1,
        [neednotDeny.symbol]: onAnOldKernel.exitCode === 0,
      });
      if (holds(mustDeny)) expect(onAnOldKernel.stderr).toContain("prctl(PR_SET_MDWE)");

      if ((await run([executable])).exitCode !== 0) return;
      const steered = await run([executable], undefined, { ...bunEnv, BUN_JSC_logGC: "1" });
      expect({ [readsFew.symbol]: holds(readsFew), [readsEvery.symbol]: holds(readsEvery) }).toEqual({
        [readsFew.symbol]: steered.exitCode === 1,
        [readsEvery.symbol]: steered.exitCode === 0,
      });
      if (holds(readsFew)) expect(steered.stderr).toContain("the environment sets BUN_JSC_logGC");
    },
    120_000,
  );
});

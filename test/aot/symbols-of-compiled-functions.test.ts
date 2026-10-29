// `bun build --compile --aot --aot-symbols` puts the functions of the program into the symbol table of a Linux executable, beside the symbols
// that Bun has there itself, so that gdb and perf show them by name. The file is read here, with no tool.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

setDefaultTimeout(120_000);

const SYMBOL_TABLE = 2;
const FUNCTION = 2;

function textAt(file: Buffer, offset: number) {
  return file.toString("latin1", offset, file.indexOf(0, offset));
}

function sectionsOf(file: Buffer) {
  const [start, size, count, names] = [
    Number(file.readBigUInt64LE(40)),
    file.readUInt16LE(58),
    file.readUInt16LE(60),
    file.readUInt16LE(62),
  ];
  const sections = Array.from({ length: count }, (_, index) => {
    const at = start + index * size;
    return {
      name: file.readUInt32LE(at),
      type: file.readUInt32LE(at + 4),
      address: Number(file.readBigUInt64LE(at + 16)),
      offset: Number(file.readBigUInt64LE(at + 24)),
      size: Number(file.readBigUInt64LE(at + 32)),
      link: file.readUInt32LE(at + 40),
      info: file.readUInt32LE(at + 44),
    };
  });
  return sections.map(section => ({ ...section, name: textAt(file, sections[names].offset + section.name) }));
}

function symbolsOf(path: string) {
  const file = readFileSync(path);
  const sections = sectionsOf(file);
  const tables = sections.filter(section => section.type === SYMBOL_TABLE);
  expect(tables.length).toBeLessThanOrEqual(1);
  const table = tables[0] ?? { offset: 0, size: 0, link: 0, info: 0 };
  const symbols = Array.from({ length: table.size / 24 }, (_, index) => {
    const at = table.offset + index * 24;
    return {
      name: textAt(file, sections[table.link].offset + file.readUInt32LE(at)),
      isLocal: file[at + 4] >> 4 === 0,
      isFunction: (file[at + 4] & 15) === FUNCTION,
      section: sections[file.readUInt16LE(at + 6)]?.name,
      address: Number(file.readBigUInt64LE(at + 8)),
      size: Number(file.readBigUInt64LE(at + 16)),
    };
  });
  return { symbols, firstGlobal: table.info, payload: sections.find(section => section.name === ".bun")!, sections };
}

const main = `function fibonacciOfTheTest(n: number): number {
  return n < 2 ? n : fibonacciOfTheTest(n - 1) + fibonacciOfTheTest(n - 2);
}
class RepositoryOfTheTest {
  findInTheTest(id: number) {
    return "row " + id;
  }
}
console.log(fibonacciOfTheTest(process.argv.length + 8), new RepositoryOfTheTest().findInTheTest(1));
`;

async function build(cwd: string, outfile: string, ...flags: string[]) {
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "main.ts", "--outfile", outfile],
    cwd,
  );
  expect({ complaints: stderr.split("\n").filter(line => /^(warn|error)\b/.test(line)), exitCode }).toEqual({
    complaints: [],
    exitCode: 0,
  });
  return join(cwd, outfile);
}

describe.skipIf(!isLinux)("--aot-symbols", () => {
  test("the functions of the program join the symbols that Bun has", async () => {
    using dir = tempDir("aot-symbols", { "main.ts": main });
    const [without, withThem] = [
      symbolsOf(await build(String(dir), "without")),
      symbolsOf(await build(String(dir), "with", "--aot-symbols")),
    ];
    const isOfTheTest = (symbol: { name: string }) =>
      symbol.name.includes("OfTheTest") || symbol.name.includes("InTheTest");
    expect(without.symbols.filter(isOfTheTest)).toEqual([]);

    const own = withThem.symbols.filter(isOfTheTest);
    expect(own.map(symbol => symbol.name)).toContain("fibonacciOfTheTest");
    const { address, size } = withThem.payload;
    for (const symbol of own) {
      expect(symbol).toMatchObject({ isLocal: true, isFunction: true, section: ".bun" });
      expect(symbol.size).toBeGreaterThan(0);
      expect(symbol.address).toBeGreaterThanOrEqual(address);
      expect(symbol.address + symbol.size).toBeLessThanOrEqual(address + size);
    }

    // Every symbol of Bun is still there, and local symbols come first, as the format wants.
    const added = new Set(
      withThem.symbols.filter(symbol => symbol.section === ".bun" && symbol.isLocal && symbol.isFunction),
    );
    expect(withThem.symbols.filter(symbol => !added.has(symbol))).toEqual(without.symbols);
    expect(withThem.symbols.slice(0, withThem.firstGlobal).filter(symbol => !symbol.isLocal)).toEqual([]);
    expect(withThem.symbols.slice(withThem.firstGlobal).filter(symbol => symbol.isLocal)).toEqual([]);
    expect(withThem.sections.map(section => section.name)).toContain(".debug_frame");

    await using proc = Bun.spawn({
      cmd: [join(String(dir), "with")],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stdout: await proc.stdout.text(), stderr: await proc.stderr.text(), exitCode: await proc.exited }).toEqual(
      { stdout: "55 row 1\n", stderr: "", exitCode: 0 },
    );
  });

  // The name of the output file goes into the executable, so both are built under one name.
  test("nothing that is loaded into memory changes", async () => {
    using dir = tempDir("aot-symbols-are-not-loaded", { "without/main.ts": main, "with/main.ts": main });
    const [without, withThem] = [
      readFileSync(await build(join(String(dir), "without"), "app")),
      readFileSync(await build(join(String(dir), "with"), "app", "--aot-symbols")),
    ];
    expect(withThem.length).toBeGreaterThan(without.length);

    const [sectionHeadersOffset, numberOfSections] = [
      { at: 40, size: 8 },
      { at: 60, size: 2 },
    ];
    const start = Buffer.from(withThem.subarray(0, without.length));
    for (const { at, size } of [sectionHeadersOffset, numberOfSections]) without.copy(start, at, at, at + size);
    expect(start.equals(without)).toBe(true);

    const [segments, segmentSize, count] = [
      Number(withThem.readBigUInt64LE(32)),
      withThem.readUInt16LE(54),
      withThem.readUInt16LE(56),
    ];
    const endOfSegments = Math.max(
      ...Array.from({ length: count }, (_, index) => {
        const at = segments + index * segmentSize;
        return Number(withThem.readBigUInt64LE(at + 8)) + Number(withThem.readBigUInt64LE(at + 32));
      }),
    );
    expect(endOfSegments).toBeLessThanOrEqual(without.length);
  });
});

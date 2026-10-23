import { describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError } from "../../../scripts/build/error.ts";
import { serializeBuiltinUses } from "../../../scripts/build/trim/builtin-uses.ts";
import type { FeatureModel } from "../../../scripts/build/trim/features.ts";
import {
  createSectionGraph,
  type GraphReading,
  type ObjectFormat,
  type SectionGraphParts,
} from "../../../scripts/build/trim/graph.ts";
import {
  builtinModulesHeaderBytes,
  createLinker,
  layOut,
  maxSecondLinks,
  parseArguments,
  printSummary,
  Stopwatch,
  withoutBuiltinModulesHeader,
  type Arguments,
  type Layout,
  type LinkSession,
} from "../../../scripts/build/trim/link.ts";
import { machO } from "../../../scripts/build/trim/linker-macho.ts";
import type { LinkerFormat, LinkName, LinkRequest } from "../../../scripts/build/trim/linker.ts";
import type { RemovableRange } from "../../../scripts/build/trim/ranges.ts";
import { removedRangeListBytes, roomFor } from "../../../scripts/build/trim/table.ts";
import type { BuiltinEntry, BuiltinUses } from "../../../scripts/build/trim/types.ts";
import { run } from "../../aot/harness/run";
import { packageOf } from "../icu-data-package.ts";
import { feature, modelOf } from "./toy-graph.ts";

setDefaultTimeout(60_000);

const [Extra, Unguarded] = [128, 129];
const model: FeatureModel = modelOf(feature("Extra", Extra), feature("Unguarded", Unguarded));
const builtinUsing = (...features: string[]): BuiltinEntry => ({
  id: 7,
  path: "Bun.extra",
  kind: "Function",
  uses: features.map(name => ({ feature: name, isConditional: false })),
  nativeSymbols: [],
  hasHiddenRoot: false,
});
const uses: BuiltinUses = { entries: [builtinUsing("Extra")] };

interface Section {
  address: number;
  size: number;
  output: string;
  to?: number[];
}

function graphOf(sections: Section[], more: Partial<SectionGraphParts> = {}) {
  return createSectionGraph({
    format: "elf",
    isArm64: false,
    placedCount: sections.length,
    address: sections.map(section => section.address),
    size: sections.map(section => section.size),
    alignment: sections.map(() => 16),
    output: sections.map(section => section.output),
    object: sections.map(() => "toy.o"),
    section: sections.map((section, node) => `${section.output}.section${node}`),
    successors: sections.map(section => new Set(section.to ?? [])),
    roots: new Set(),
    exported: new Set(),
    liveWithoutReference: new Set(),
    names: sections.map((_, node) => [`symbol${node}`]),
    aliases: new Map(),
    externalNames: new Set(),
    stringHash: new Map(),
    ...more,
  });
}

describe("parseArguments", () => {
  const paths = ["work", "features.json", "builtin-uses.json"];
  const parse = (...words: string[]) => parseArguments(["bun", "link.ts", ...words]);
  const parsed: Arguments = {
    work: "work",
    featuresPath: "features.json",
    builtinUsesPath: "builtin-uses.json",
    demangler: undefined,
    command: ["clang", "-o", "program"],
  };

  test("takes three paths and a command", () => {
    expect(parse(...paths, "--", "clang", "-o", "program")).toEqual(parsed);
  });

  test("takes its option behind the paths and between them", () => {
    const command = ["--", "clang", "-o", "program"];
    expect(parse(...paths, "--demangler=/usr/bin/llvm-cxxfilt", ...command)).toEqual({
      ...parsed,
      demangler: "/usr/bin/llvm-cxxfilt",
    });
    expect(parse("work", "--demangler=filt", ...paths.slice(1), ...command)).toEqual({ ...parsed, demangler: "filt" });
  });

  test("leaves every word after the first separator to the command", () => {
    const command = ["clang", "--demangler=filt", "--", "--unknown"];
    expect(parse(...paths, "--", ...command)).toEqual({ ...parsed, command });
  });

  const rejected: [name: string, words: string[]][] = [
    ["no separator", [...paths, "clang"]],
    ["two paths", [...paths.slice(0, 2), "--", "clang"]],
    ["four paths", [...paths, "more", "--", "clang"]],
    ["an unknown option", [...paths, "--plan=old", "--", "clang"]],
    ["a demangler option without a path", [...paths, "--demangler=", "--", "clang"]],
    ["an empty command", [...paths, "--"]],
  ];
  test.each(rejected)("rejects %s with the usage line", (_, words) => {
    expect(() => parse(...words)).toThrow(BuildError);
    expect(() => parse(...words)).toThrow("usage: link.ts <work directory> <features.json> <builtin-uses.json> [");
  });
});

describe("createLinker", () => {
  const files = {
    "in.rsp": 'a.o\n"with space/b.o"\n-lc\nlibc.a\n',
    "lazy.rsp": '--start-lib\n"lazy1.o"\nlazy2.o\n--end-lib\n',
    "lazy-coff.rsp": '/start-lib\r\n"lazy1.obj"\r\n/end-lib\r\n',
    "print-arguments.js": 'console.log("ARGUMENTS " + JSON.stringify(process.argv.slice(2)));',
    "fail.js": 'console.error("ld.lld: error: undefined symbol: missing"); process.exit(1);',
    "work/stale.txt": "",
  };
  const argumentsFor = (folder: string, command: string[]): Arguments => ({
    work: join(folder, "work"),
    featuresPath: "",
    builtinUsesPath: "",
    demangler: undefined,
    command,
  });
  const elfCommand = (folder: string, compiler = "clang++") => [
    compiler,
    `@${join(folder, "in.rsp")}`,
    `-Wl,@${join(folder, "lazy.rsp")}`,
    "-Wl,--gdb-index",
    "-Wl,--symbol-ordering-file=old.txt",
    `-Wl,-Map=${join(folder, "program.map")}`,
    "-o",
    join(folder, "program"),
  ];
  const request = (more: Partial<LinkRequest>): LinkRequest => ({
    name: "first",
    rewrite: path => path,
    first: [],
    last: [],
    replaced: new Map(),
    ...more,
  });
  const printedArguments = (log: string): string[] => JSON.parse(/^ARGUMENTS (.*)$/m.exec(log)![1]!);

  test("lists the inputs of plain and -Wl,@ response files in order, without flags", () => {
    using dir = tempDir("trim-linker-inputs", files);
    const { linker, format } = createLinker(argumentsFor(String(dir), elfCommand(String(dir))));
    expect(format).toBe("elf");
    expect(linker.inputs).toEqual(["a.o", "with space/b.o", "libc.a", "lazy1.o", "lazy2.o"]);
    expect(linker.output).toBe(join(String(dir), "program"));
    expect(linker.firstLinkName).toMatch(/^first-[0-9a-f]{8}$/);
    expect(readdirSync(linker.work)).toEqual([]);
  });

  test("recognizes a Mach-O command by its map flag", () => {
    using dir = tempDir("trim-linker-macho", files);
    const command = ["clang++", `@${join(String(dir), "in.rsp")}`, "-Wl,-map,program.map", "-o", "program"];
    const { linker, format } = createLinker(argumentsFor(String(dir), command));
    expect(format).toBe("macho");
    expect(linker.inputs).toEqual(["a.o", "with space/b.o", "libc.a"]);
    expect(linker.output).toBe("program");
  });

  test("on Mach-O every output section that can move can be filled, except the one with pointers", () => {
    using dir = tempDir("trim-linker-macho-policy", files);
    const command = ["clang++", "-exported_symbols_list", "symbols.txt", "-Wl,-map,program.map", "-o", "program"];
    const format = machO(createLinker(argumentsFor(String(dir), command)).linker);
    const policyOf = (output: string) => [format.isMovable(output), format.canBeFilled(output), format.isCode(output)];
    expect(policyOf("__DATA_CONST,__const")).toEqual([true, false, false]);
    for (const output of ["__TEXT,__text", "__TEXT,__jsc_bytecode", "__TEXT,__jsc_wasm"]) {
      expect(policyOf(output)).toEqual([true, true, true]);
    }
    for (const output of ["__TEXT,__const", "__TEXT,__bun_builtins", "__TEXT,__cstring"]) {
      expect(policyOf(output)).toEqual([true, true, false]);
    }
    expect(policyOf("__TEXT,__literals")).toEqual([false, true, false]);
    expect(policyOf("__DATA,__data")).toEqual([false, false, false]);
  });

  test("recognizes a COFF command by /link", () => {
    using dir = tempDir("trim-linker-coff", files);
    const command = [
      "clang-cl",
      "/nologo",
      `@${join(String(dir), "in.rsp")}`,
      `/clang:-Wl,@${join(String(dir), "lazy-coff.rsp")}`,
      "/Feprogram.exe",
      "/link",
      "/lldmap:program.chunks.map",
      "/machine:x64",
    ];
    const { linker, format } = createLinker(argumentsFor(String(dir), command));
    expect(format).toBe("coff");
    expect(linker.inputs).toEqual(["a.o", "with space/b.o", "libc.a", "lazy1.obj"]);
    expect(linker.output).toBe("program.exe");
  });

  const rejected: [name: string, command: string[]][] = [
    ["no output", ["clang++", "-Wl,-Map=program.map"]],
    ["-o as the last word", ["clang++", "-Wl,-Map=program.map", "-o"]],
    ["no map", ["clang++", "-o", "program"]],
    ["another format's map flag", ["clang-cl", "/Feprogram.exe", "/link", "-Wl,-Map=program.map"]],
    ["no /Fe", ["clang-cl", "/link", "/lldmap:program.map"]],
  ];
  test.each(rejected)("rejects a command with %s", (_, command) => {
    using dir = tempDir("trim-linker-rejected", files);
    expect(() => createLinker(argumentsFor(String(dir), command))).toThrow(BuildError);
    expect(existsSync(join(String(dir), "work", "stale.txt"))).toBe(true);
  });

  test("rejects a response file that does not exist", () => {
    using dir = tempDir("trim-linker-missing", files);
    const missing = join(String(dir), "missing.rsp");
    const command = ["clang++", `@${missing}`, "-Wl,-Map=program.map", "-o", "program"];
    let error: unknown;
    try {
      createLinker(argumentsFor(String(dir), command));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(BuildError);
    const { file, cause } = error as BuildError;
    expect(file).toBe(missing);
    expect(cause).toMatchObject({ code: "ENOENT" });
  });

  test("gives each link its own output, map, response files and arguments", () => {
    using dir = tempDir("trim-linker-link", files);
    const folder = String(dir);
    const command = elfCommand(folder, bunExe());
    const { linker } = createLinker(argumentsFor(folder, command));
    const first = linker.link(
      request({
        rewrite: path => (path === "a.o" ? undefined : path === "lazy1.o" ? "split/lazy1.o" : path),
        first: [join(folder, "print-arguments.js"), "room.s.o"],
        last: ["-Wl,--strip-debug"],
        replaced: new Map([[4, "-Wl,--symbol-ordering-file=new.txt"]]),
        without: /^-Wl,--gdb-index$/,
      }),
    );
    expect(first).toMatchObject({
      name: "first",
      executable: join(linker.work, linker.firstLinkName),
      map: join(linker.work, "first.map"),
    });
    expect(printedArguments(first.log)).toEqual([
      "room.s.o",
      `@${join(linker.work, "first.1.rsp")}`,
      `-Wl,@${join(linker.work, "first.2.rsp")}`,
      "-Wl,--symbol-ordering-file=new.txt",
      `-Wl,-Map=${first.map}`,
      "-o",
      first.executable,
      "-Wl,--strip-debug",
    ]);
    expect(readFileSync(join(linker.work, "first.1.rsp"), "utf8")).toBe('"with space/b.o"\n-lc\n"libc.a"\n');
    expect(readFileSync(join(linker.work, "first.2.rsp"), "utf8")).toBe(
      '--start-lib\n"split/lazy1.o"\n"lazy2.o"\n--end-lib\n',
    );
    expect(readFileSync(join(linker.work, "first.log"), "latin1")).toBe(first.log);

    const second = linker.link(request({ name: "second", first: [join(folder, "print-arguments.js")] }));
    expect(second).toMatchObject({ name: "second", executable: command.at(-1)!, map: join(folder, "program.map") });
    expect(printedArguments(second.log).slice(2)).toEqual(command.slice(3));
    expect(linker.command).toEqual(elfCommand(folder, bunExe()));

    expect(readFileSync(join(linker.work, "second.log"), "latin1")).toBe(second.log);
  });

  test("throws the end of the log when the linker fails", () => {
    using dir = tempDir("trim-linker-fails", files);
    const { linker } = createLinker(argumentsFor(String(dir), elfCommand(String(dir), bunExe())));
    const link = () => linker.link(request({ first: [join(String(dir), "fail.js")] }));
    expect(link).toThrow(BuildError);
    expect(link).toThrow(/^the first link failed:\n[^]*undefined symbol: missing/);
    expect(readFileSync(join(linker.work, "first.log"), "latin1")).toContain(
      "ld.lld: error: undefined symbol: missing",
    );
  });

  test("throws when the compiler driver cannot run", () => {
    using dir = tempDir("trim-linker-no-driver", files);
    const command = elfCommand(String(dir), join(String(dir), "no-such-driver"));
    const { linker } = createLinker(argumentsFor(String(dir), command));
    expect(() => linker.link(request({}))).toThrow(BuildError);
  });
});

describe("a failed link", () => {
  async function runLink(...words: string[]) {
    const script = join(import.meta.dir, "..", "..", "..", "scripts", "build", "trim", "link.ts");
    const { stdout, stderr, exitCode } = await run([bunExe(), script, ...words]);
    return { stdout, stderr, exitCode };
  }

  test("prints the message after trim:", async () => {
    const { stdout, stderr, exitCode } = await runLink("work", "features.json", "builtin-uses.json");
    expect(stderr).toMatch(/^trim: usage: link\.ts <work directory> .* -- <link command>\n$/);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  test("reads the uses of the built-ins before it links, and checks them against the model", async () => {
    using dir = tempDir("trim-link-uses", {
      "features.json": JSON.stringify({ hash: "0", features: [{ name: "Extra", index: Extra }] }),
      "undeclared.json": serializeBuiltinUses({ entries: [builtinUsing("Missing")] }),
    });
    const at = (name: string) => join(String(dir), name);
    const undeclared = await runLink(at("work"), at("features.json"), at("undeclared.json"), "--", "cc");
    expect(undeclared.stderr.split("\n").slice(0, 2)).toEqual([
      "trim: Bun.extra uses Missing, which src/trim/features does not declare",
      `  at: ${at("undeclared.json")}`,
    ]);
    expect(undeclared.exitCode).toBe(1);
    expect(existsSync(at("work"))).toBe(false);
  });
});

describe("withoutBuiltinModulesHeader", () => {
  const builtins = 0x4000;
  const graph = graphOf([
    { address: 0x1000, size: 0x100, output: ".text" },
    { address: builtins, size: 0x1000, output: ".bun_builtins" },
    { address: 0x8000, size: 0x100, output: ".rodata" },
  ]);
  const range = (start: number, end: number): RemovableRange => ({
    start,
    end,
    set: 3,
    isCode: false,
    canBeCut: true,
    canBeFilled: true,
  });
  const without = (...ranges: RemovableRange[]) => withoutBuiltinModulesHeader(ranges, graph, ".bun_builtins");
  const headerEnd = builtins + builtinModulesHeaderBytes;

  test("the header size is the one the generator writes and the Rust reader expects", () => {
    const source = (path: string) => readFileSync(join(import.meta.dir, "..", "..", "..", path), "utf8");
    expect(source("src/codegen/bundle-modules.ts")).toContain(
      `const BUILTINS_HEADER_SIZE = ${builtinModulesHeaderBytes};`,
    );
    expect(source("src/exe_format/builtins.rs")).toContain(`const HEADER_SIZE: usize = ${builtinModulesHeaderBytes};`);
  });

  test("a range that starts with the section loses the header", () => {
    expect(without(range(builtins, 0x5000))).toEqual([range(headerEnd, 0x5000)]);
  });

  test("a range that spans the header splits in two", () => {
    expect(without(range(0x3000, 0x5000))).toEqual([range(0x3000, builtins), range(headerEnd, 0x5000)]);
  });

  test("a range that ends inside the header stops at the section's start", () => {
    expect(without(range(0x3000, builtins + 8))).toEqual([range(0x3000, builtins)]);
  });

  test("a range inside the header is dropped", () => {
    expect(without(range(builtins, headerEnd), range(0x8000, 0x8100))).toEqual([range(0x8000, 0x8100)]);
    expect(without(range(builtins + 8, builtins + 16))).toEqual([]);
  });

  test("ranges elsewhere do not change", () => {
    const ranges = [range(0x3000, builtins), range(headerEnd, 0x5000), range(0x8000, 0x8100)];
    expect(without(...ranges)).toEqual(ranges);
  });

  test("without a placed section of that output the list is returned as it is", () => {
    const ranges = [range(builtins, 0x5000)];
    expect(withoutBuiltinModulesHeader(ranges, graph, ".bunblt")).toBe(ranges);
    const unplaced = graphOf(
      [
        { address: builtins, size: 0x1000, output: ".text" },
        { address: -1, size: 0, output: ".bun_builtins" },
      ],
      { placedCount: 1 },
    );
    expect(withoutBuiltinModulesHeader(ranges, unplaced, ".bun_builtins")).toBe(ranges);
  });
});

describe("layOut", () => {
  const [main, entered] = [0, 1];

  function readingOf(
    removableDataSections: number,
    format: ObjectFormat = "elf",
    retainedSections: Section[] = [],
  ): GraphReading {
    const sections: (Section & { to: number[] })[] = [
      { address: 0x1000, size: 0x100, output: ".text", to: [entered] },
      { address: 0x2000, size: 0x2000, output: ".text", to: [] },
    ];
    for (let index = 0; index < removableDataSections; index++) {
      sections[entered]!.to.push(sections.length);
      sections[main]!.to.push(sections.length + 1);
      sections.push({ address: 0x10000 + index * 32, size: 16, output: ".data", to: [] });
      sections.push({ address: 0x10010 + index * 32, size: 16, output: ".data", to: [] });
    }
    for (const section of retainedSections) {
      sections[main]!.to.push(sections.length);
      sections.push({ ...section, to: [] });
    }
    const record = Buffer.alloc(24);
    record.writeUInt16LE(Extra, 16);
    return {
      graph: graphOf(sections, { format, roots: new Set([main]) }),
      recordSections: [
        {
          object: "toy.o",
          bytes: record,
          references: new Map([
            [0, "main"],
            [8, "entered"],
          ]),
        },
      ],
      resolve: (_, reference) => ({ node: reference === "main" ? main : entered, section: reference }),
      failures: [],
      statistics: {},
    };
  }

  function fakeSession(folder: string, format: Partial<LinkerFormat>, inputs: string[] = []) {
    const work = join(folder, "work");
    const reviewDirectory = join(folder, "program.trim");
    for (const created of [work, join(work, "split"), join(work, "named"), reviewDirectory]) mkdirSync(created);
    const requests: LinkRequest[] = [];
    const rooms: number[] = [];
    const tables: Buffer[] = [];
    const noArguments = () => ({ last: [], replaced: new Map<number, string>() });
    const session: LinkSession = {
      linker: {
        work,
        firstLinkName: "first-00000000",
        output: join(folder, "program"),
        command: ["clang"],
        inputs,
        assemble: name => join(work, name + ".o"),
        link(request) {
          requests.push(request);
          const executable = join(work, request.name);
          writeFileSync(executable, "");
          return { name: request.name, executable, map: executable + ".map", log: "" };
        },
      },
      format: {
        isMovable: output => output === ".text",
        canBeFilled: () => true,
        isCode: output => output === ".text",
        relinksSameInputs: false,
        firstInputs: [],
        builtinModulesOutput: ".bun_builtins",
        supportObjects: room => (rooms.push(room), ["room.s.o"]),
        prepareInput: path => path,
        prepareCompiledObjects: () => false,
        compiledObjects: () => [],
        firstLinkArguments: noArguments,
        secondLinkArguments: noArguments,
        read: () => readingOf(1),
        namedBytes: () => undefined,
        orderOf: (_, partition) => ({
          retainedFirst: [],
          groups: partition.groups.map(({ set }) => ({ set, names: [], afterRetained: [] })),
          nodes: [],
          unnamed: new Map(),
        }),
        nameUnnamedSections: () => new Map(),
        writeTable: table => void tables.push(table),
        tidyUp() {},
        ...format,
      },
      model,
      uses,
      demangler: undefined,
      reviewDirectory,
      stopwatch: new Stopwatch(),
    };
    return { session, requests, rooms, tables };
  }
  const namesOf = (requests: LinkRequest[]) => requests.map(request => request.name);

  function summaryOf(layout: Layout, session: LinkSession): string[] {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      printSummary(layout, session);
      return log.mock.calls.map(([line]) => String(line));
    } finally {
      log.mockRestore();
    }
  }

  test("links twice, writes the table and the review files, and removes what is as large as the program", () => {
    using dir = tempDir("trim-layout", {});
    const { session, requests, rooms, tables } = fakeSession(String(dir), {});
    const layout = layOut(session);
    expect(namesOf(requests)).toEqual(["first", "second"]);
    expect(rooms).toEqual([0, 1024]);
    expect(layout).toMatchObject({ room: 1024, secondLinks: 1, droppedRanges: 0 });
    expect(tables).toEqual([layout.table]);
    expect(layout.ranges).toMatchObject([
      { start: 0x2000, end: 0x4000, isCode: true, canBeCut: true, canBeFilled: true },
      { start: 0x10000, end: 0x10010, isCode: false, canBeCut: false, canBeFilled: true },
    ]);
    expect(readdirSync(session.reviewDirectory).sort()).toEqual([
      "entry-points.txt",
      "groups.txt",
      "requires.txt",
      "retained-by.txt",
    ]);
    expect(readdirSync(session.linker.work).sort()).toEqual(["second", "sections.txt"]);
  });

  test("the summary reports the entry points, the ranges, the table and the timings", () => {
    using dir = tempDir("trim-layout-summary", {});
    const { session } = fakeSession(String(dir), { read: () => ({ ...readingOf(1), statistics: { objects: 1 } }) });
    const layout = layOut(session);
    const printed = summaryOf(layout, session);
    expect(printed.slice(0, -1)).toEqual([
      "1 entry points in 1 records: 0 dead guards, 0 guards inside their entry point, 0 of entry points that do nothing, 0 written by the entry point itself, 0 entry points folded with other code",
      "0 edges between features: 0 references, 0 aborting guards, 0 recoverable guards; 0 are answered by the built-ins table or a start-up option",
      "1 groups, 1 ranges that can be cut, 1 that can only be filled: 0.01 MB in all groups",
      "0.00 MB of the groups are outside every cuttable range",
      `the trim table takes ${layout.table.length} of 1024 bytes`,
      "0.00 MB are in the image without a known reference and are retained",
      "graph: objects 1",
      "needed only by features, in output sections that cannot be reordered: .data 0.00 MB",
    ]);
    expect(printed.at(-1)).toMatch(
      /^the trimmable link took \d+\.\d s: first link \d+\.\d s, .*review files \d+\.\d s$/,
    );
  });

  test("the summary lists the features that built-ins use and no guard enters", () => {
    using dir = tempDir("trim-layout-unguarded", {});
    const session: LinkSession = {
      ...fakeSession(String(dir), {}).session,
      uses: { entries: [builtinUsing("Extra", "Unguarded")] },
    };
    expect(summaryOf(layOut(session), session)).toContain(
      "1 features that built-ins use have no guard, so nothing is removed with them: Unguarded",
    );
  });

  describe("ICU's data package", () => {
    const dataPackage = packageOf([
      ["icudt99l/coll/de.res", 16],
      ["icudt99l/zoneinfo64.res", 16],
      ["icudt99l/coll/fr.res", 16],
    ]);
    const start = 0x20000;
    const end = start + dataPackage.length;
    const formatWithPackage = (readLinks: LinkName[], moreSymbols: [string, number][] = []): Partial<LinkerFormat> => ({
      read: () => readingOf(1, "elf", [{ address: start, size: dataPackage.length + 64, output: ".rodata" }]),
      namedBytes(link) {
        readLinks.push(link.name);
        return {
          symbols: [["icudt99_dat", start], ["symbol_after_package", end], ...moreSymbols],
          image: {
            isArm64: false,
            bytes: (address, length) => dataPackage.subarray(address - start, address - start + length),
          },
        };
      },
    });

    test("is read once per link, stays in the layout, and the summary has one line for it", () => {
      using dir = tempDir("trim-layout-icu", {});
      const readLinks: LinkName[] = [];
      const session: LinkSession = {
        ...fakeSession(String(dir), formatWithPackage(readLinks)).session,
        model: {
          ...model,
          icuData: [{ itemClass: "collation", exceptWindows: false, byLocale: false, features: ["Extra"] }],
        },
      };
      const layout = layOut(session);
      expect(readLinks).toEqual(["first", "second"]);
      expect(layout.icuLanguages).toEqual([]);
      expect(layout.icuPackages).toEqual([
        {
          start,
          end,
          items: 3,
          runs: [
            { firstItem: 0, itemCount: 1, features: [Extra], localeGroup: undefined, bytes: 16 },
            { firstItem: 2, itemCount: 1, features: [Extra], localeGroup: undefined, bytes: 16 },
          ],
        },
      ]);
      const printed = summaryOf(layout, session);
      expect(printed[printed.indexOf(`the trim table takes ${layout.table.length} of 1024 bytes`) + 1]).toBe(
        "ICU data: 3 items, 0.00 MB, removable in 2 runs, 0 languages in 0 groups: Extra 0.00 MB",
      );
    });

    test("with Bun's hook in ICU, the languages of a class that is removed by locale reach the layout, the table and the summary", () => {
      using dir = tempDir("trim-layout-icu-languages", {});
      const session: LinkSession = {
        ...fakeSession(String(dir), formatWithPackage([], [["bun_icu_zstd_dict", 0x1000]])).session,
        model: {
          ...model,
          icuData: [{ itemClass: "collation", exceptWindows: false, byLocale: true, features: ["Extra"] }],
          icuLanguageGroups: [["fr", "oc"]],
        },
      };
      const layout = layOut(session);
      const languages = [
        { name: "de", group: 0 },
        { name: "fr", group: 1 },
        { name: "oc", group: 1 },
      ];
      expect(layout.icuLanguages).toEqual(languages);
      expect(summaryOf(layout, session)).toContain(
        "ICU data: 3 items, 0.00 MB, removable in 2 runs, 3 languages in 2 groups: Extra 0.00 MB",
      );
    });

    test("has no line when no feature owns a class of ICU data", () => {
      using dir = tempDir("trim-layout-icu-unowned", {});
      const { session } = fakeSession(String(dir), formatWithPackage([]));
      const layout = layOut(session);
      expect(layout.icuPackages).toEqual([]);
      expect(summaryOf(layout, session).filter(line => line.startsWith("ICU data:"))).toEqual([]);
    });
  });

  test("a table that outgrows its room costs one more link", () => {
    using dir = tempDir("trim-layout-room", {});
    const { session, requests, rooms, tables } = fakeSession(String(dir), {
      read: link => readingOf(link.name === "first" ? 1 : 200),
    });
    const layout = layOut(session);
    expect(layout.table.length).toBeGreaterThan(1024);
    expect(namesOf(requests)).toEqual(["first", "second", "second"]);
    const room = roomFor(Math.max(layout.table.length, removedRangeListBytes(layout.ranges.length)));
    expect(rooms).toEqual([0, 1024, room]);
    expect(layout).toMatchObject({ room, secondLinks: 2 });
    expect(tables).toEqual([layout.table]);
    expect(layout.ranges).toHaveLength(201);
  });

  test("a table whose size never settles fails the link", () => {
    using dir = tempDir("trim-layout-unsettled", {});
    let sections = 50;
    const { session, requests, tables } = fakeSession(String(dir), {
      read: link => readingOf(link.name === "first" ? 1 : (sections *= 4)),
    });
    expect(() => layOut(session)).toThrow(BuildError);
    expect(namesOf(requests)).toEqual(["first", ...Array(maxSecondLinks).fill("second")]);
    expect(tables).toEqual([]);
    expect(readdirSync(session.reviewDirectory)).toEqual([]);
  });

  test("failures of a step end the sequence, headed by their kind", () => {
    using dir = tempDir("trim-layout-failure", {});
    const { session, requests } = fakeSession(String(dir), {
      read: () => ({ ...readingOf(1), failures: [{ kind: "UnreadInput", object: "toy.o", reason: "NotFound" }] }),
    });
    expect(() => layOut(session)).toThrow(BuildError);
    expect(() => layOut(session)).toThrow(/^UnreadInput: /);
    expect(namesOf(requests)).toEqual(["first", "first"]);
    expect(readdirSync(session.reviewDirectory)).toEqual([]);
    expect(existsSync(join(session.linker.work, "first"))).toBe(true);
  });

  test("a guard that no table entry and no feature's code can ever enter ends the sequence after the first link", () => {
    using dir = tempDir("trim-layout-declared-uses", {});
    const { session, requests } = fakeSession(String(dir), {});
    const withoutUses: LinkSession = { ...session, uses: { entries: [] } };
    expect(() => layOut(withoutUses)).toThrow(BuildError);
    expect(() => layOut(withoutUses)).toThrow(
      /^GuardWithoutUser: symbol0 \(toy\.o, 256 bytes\) enters symbol1 \(toy\.o, 8192 bytes\), an entry point of Extra, /,
    );
    expect(namesOf(requests)).toEqual(["first", "first"]);
    expect(readdirSync(session.reviewDirectory)).toEqual([]);
  });

  describe("inputs", () => {
    const files = { "module.bc": Buffer.from([0x42, 0x43, 0xc0, 0xde]), "plain.o": "", "builtins.o": "" };
    const rewritten = (request: LinkRequest, inputs: string[]) => inputs.map(path => request.rewrite(path));

    test("objects compiled from bitcode replace it once they changed, and in the second link", () => {
      using dir = tempDir("trim-layout-bitcode", files);
      const at = (name: string) => join(String(dir), name);
      const [bitcode, plain, builtins] = [at("module.bc"), at("plain.o"), at("builtins.o")];
      const inputs = [bitcode, plain, builtins];
      const { session, requests } = fakeSession(
        String(dir),
        {
          firstInputs: [builtins],
          prepareInput: path => path + ".split",
          compiledObjects: () => ["program.lto.o"],
          prepareCompiledObjects: objects => objects.length > 0,
          nameUnnamedSections: () => new Map([[plain + ".split", plain + ".named"]]),
        },
        inputs,
      );
      layOut(session);
      expect(namesOf(requests)).toEqual(["first", "first", "second"]);
      expect(requests.map(request => request.first)).toEqual([
        ["room.s.o", builtins],
        ["room.s.o", builtins, "program.lto.o"],
        ["room.s.o", builtins, "program.lto.o"],
      ]);
      expect(requests.map(request => rewritten(request, inputs))).toEqual([
        [bitcode + ".split", plain + ".split", undefined],
        [undefined, plain + ".split", undefined],
        [undefined, plain + ".named", undefined],
      ]);
    });

    test("a format that links the same inputs again gets the bitcode twice", () => {
      using dir = tempDir("trim-layout-same-inputs", files);
      const inputs = Object.keys(files).map(name => join(String(dir), name));
      const { session, requests } = fakeSession(
        String(dir),
        { relinksSameInputs: true, compiledObjects: () => ["program.exe.lto.obj"] },
        inputs,
      );
      layOut(session);
      expect(requests.map(request => request.first)).toEqual([["room.s.o"], ["room.s.o"]]);
      expect(requests.map(request => rewritten(request, inputs))).toEqual([inputs, inputs]);
    });
  });
});

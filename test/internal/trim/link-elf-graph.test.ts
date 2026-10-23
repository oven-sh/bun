import { expect, setDefaultTimeout, test } from "bun:test";
import { isMusl, tempDir } from "harness";
import { closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openElf } from "../../../scripts/build/trim/elf-file.ts";
import { readElfGraph } from "../../../scripts/build/trim/elf-graph.ts";
import { readEntryPoints } from "../../../scripts/build/trim/entry-points.ts";
import { findEdge, type SectionGraph } from "../../../scripts/build/trim/graph.ts";
import { relocationLinkArguments } from "../../../scripts/build/trim/link.ts";
import type { Link } from "../../../scripts/build/trim/linker.ts";
import { partition } from "../../../scripts/build/trim/partition.ts";
import { removableRanges } from "../../../scripts/build/trim/ranges.ts";
import { checkElfRelocations } from "../../../scripts/build/trim/validate-elf-relocations.ts";
import {
  canLink,
  compileFeatureCodeOnce,
  compileObjects,
  createElfFormat,
  defaultObjects,
  describeLink,
  guardsBoth,
  isX64,
  linkByHand,
  linked,
  linkSkipReason,
  mainCallingFeatureCode5,
  mainReturning,
  objectPath,
  objectsWithMore,
  sectionOf,
  sources,
  tools,
  wrapped,
} from "./link-elf-support.ts";
import {
  entryCalling,
  expectCleanRuns,
  Extra,
  indexOf,
  mixingFunction,
  Other,
  otherSource,
  run,
  skipNotice,
  start,
} from "./toy-program.ts";

setDefaultTimeout(60_000);

const testFile = "link-elf-graph.test.ts";
if (!canLink) skipNotice(testFile, linkSkipReason);
else {
  if (isMusl) skipNotice(testFile, "musl has no symbol versions: the case with a versioned symbol does not run");
  if (!isX64) {
    skipNotice(testFile, "only x86-64 has R_X86_64_GOTOFF64: the case with an unknown relocation type does not run");
  }
}

compileFeatureCodeOnce();

const symbolBytes = 24;

function removeMapLines(map: string, section: string) {
  const lines = readFileSync(map, "latin1").split("\n");
  writeFileSync(map, lines.filter(line => !line.includes(`:(${section})`)).join("\n"));
}

function withoutSymbol(executable: string, name: string): string {
  const { fd, sections } = openElf(executable, "r")!;
  closeSync(fd);
  const symbolTable = sections.find(section => section.name === ".symtab")!;
  const strings = sections[symbolTable.link]!;
  const file = readFileSync(executable);
  const nameOf = (symbol: number) => {
    const at = strings.offset + file.readUInt32LE(symbol);
    return file.toString("latin1", at, file.indexOf(0, at));
  };
  let removedSymbols = 0;
  for (let symbol = symbolTable.offset; symbol < symbolTable.offset + symbolTable.size; symbol += symbolBytes) {
    if (nameOf(symbol) !== name) continue;
    file.fill(0, symbol, symbol + symbolBytes);
    removedSymbols++;
  }
  expect(removedSymbols).toBe(1);
  const stripped = `${executable}.stripped`;
  writeFileSync(stripped, file);
  return stripped;
}

describeLink("the graph reader", () => {
  const objects = [...objectsWithMore, "table"];
  const files = {
    ...sources,
    "entry.c": entryCalling("more"),
    "more.c": `static ${mixingFunction("feature_local", 3)} int more(int x) { return feature_local(x); }`,
  };

  test("reads a good link, and reports an object deleted after it", async () => {
    using dir = tempDir("trim-elf-reader", files);
    const folder = String(dir);
    await compileObjects(folder, objects);
    const { executable, map, log } = await linkByHand(folder, { name: "second", output: "hand", objects });
    expect(readElfGraph(executable, map, log).failures).toEqual([]);
    const object = join(folder, "more.o");
    rmSync(object);
    expect(readElfGraph(executable, map, log).failures).toEqual([{ kind: "UnreadInput", object, reason: "NotFound" }]);
  });

  test("makes no node of a section that the map lists and the image does not load", async () => {
    using dir = tempDir("trim-elf-reader", {
      ...files,
      "notes.c": String.raw`__asm__(".section .toy_notes,\"\",@progbits\n.ascii \"only in the file\"\n.section .toy_loaded,\"aR\",@progbits\n.ascii \"in the image\"\n.text\n");`,
    });
    const folder = String(dir);
    const linkedObjects = [...objects, "notes"];
    await compileObjects(folder, linkedObjects);
    const { executable, map, log } = await linkByHand(folder, {
      name: "second",
      output: "hand",
      objects: linkedObjects,
    });
    expect(readFileSync(map, "latin1")).toMatch(/^ +0 +0 +[0-9a-f]+ +\d+ \.toy_notes$/m);
    const { graph, failures } = readElfGraph(executable, map, log);
    expect(failures).toEqual([]);
    expect(graph.output).toContain(".toy_loaded");
    expect(graph.output).not.toContain(".toy_notes");
  });

  test("reports a reference to a section the map does not list", async () => {
    using dir = tempDir("trim-elf-reader", files);
    const folder = String(dir);
    await compileObjects(folder, objects);
    const { executable, map, log } = await linkByHand(folder, { name: "second", output: "hand", objects });
    removeMapLines(map, ".text.feature_local");
    const failure = { kind: "UnresolvedReference", target: ".text.feature_local" };
    expect(readElfGraph(executable, map, log).failures).toContainEqual(expect.objectContaining(failure));
  });

  test("reports a global that neither the map nor the executable's symbol table lists", async () => {
    using dir = tempDir("trim-elf-reader", files);
    const folder = String(dir);
    await compileObjects(folder, objects);
    const { executable, map, log } = await linkByHand(folder, { name: "second", output: "hand", objects });
    removeMapLines(map, ".text.more");
    expect(readElfGraph(executable, map, log).failures).toEqual([]);
    expect(readElfGraph(withoutSymbol(executable, "more"), map, log).failures).toEqual([
      { kind: "UnresolvedReference", object: objectPath(folder, "entry"), section: ".text.entered", target: "more" },
    ]);
  });

  test.skipIf(isMusl)("reads a reference to a versioned symbol of a shared library", async () => {
    const versionedName = `exp@${isX64 ? "GLIBC_2.2.5" : "GLIBC_2.17"}`;
    using dir = tempDir("trim-elf-reader", {
      ...files,
      "versioned.c": `
        __asm__(".symver exp,${versionedName}");
        double exp(double);
        __attribute__((noinline)) double calls_versioned(double x) { return exp(x); }
      `,
      "main.c": `
        ${start}
        double calls_versioned(double);
        ${mainReturning("calls_versioned(argc) > 2 ? 0 : 1")}
      `,
    });
    const folder = String(dir);
    const linkedObjects = [...objectsWithMore, "versioned"];
    await compileObjects(folder, linkedObjects);
    const listing = [tools["llvm-nm"]!, "--undefined-only", "--format=just-symbols", "versioned.o"];
    expect((await run(listing, folder)).stdout.split("\n")).toContain(versionedName);
    const { executable, map, log } = await linkByHand(folder, {
      name: "second",
      output: "hand",
      objects: linkedObjects,
      linkFlags: ["-lm"],
    });
    expect(readElfGraph(executable, map, log).failures).toEqual([]);
  });
});

function withoutEdge(graph: SectionGraph, from: number, to: number): SectionGraph {
  const edge = findEdge(graph, from, to);
  expect(edge).toBeGreaterThanOrEqual(0);
  const successors = new Uint32Array(graph.successors.length - 1);
  successors.set(graph.successors.subarray(0, edge));
  successors.set(graph.successors.subarray(edge + 1), edge);
  const successorStart = graph.successorStart.map((first, node) => (node > from ? first - 1 : first));
  return { ...graph, successors, successorStart };
}

function withOneByteChanged(link: Link, section: string): Link {
  const file = readFileSync(link.executable);
  file[sectionOf(link.executable, section).offset]! ^= 1;
  const executable = `${link.executable}.changed`;
  writeFileSync(executable, file);
  return { ...link, executable };
}

describeLink("the linker's own relocations", () => {
  const objects = ["feature_code", "entry", "embedder", "room", "main"];
  const files = {
    ...sources,
    "room.c": String.raw`__asm__(".section .bun_trim,\"aR\",@progbits\n.p2align 3\n.zero 64\n.text\n");`,
    "main.c": mainCallingFeatureCode5,
  };
  const validatorSummary = /^[1-9]\d* relocations from the linker: [1-9]\d* into removable ranges/m;

  async function linkTwice(folder: string, linkedObjects: string[] = objects) {
    await compileObjects(folder, linkedObjects);
    const shipped = await linkByHand(folder, { name: "second", output: "hand", objects: linkedObjects });
    const withRelocations = await linkByHand(folder, {
      name: "relocations",
      output: "relocated",
      objects: linkedObjects,
      linkFlags: relocationLinkArguments(folder, shipped.executable),
    });
    const reading = readElfGraph(shipped.executable, shipped.map, shipped.log);
    return { shipped, withRelocations, reading, ...createElfFormat(folder, "hand") };
  }

  type Links = Awaited<ReturnType<typeof linkTwice>>;

  function check(links: Links, graph: SectionGraph = links.reading.graph, shipped: Link = links.shipped) {
    const { withRelocations, reading, features, format } = links;
    const { entryPoints } = readEntryPoints(reading, features);
    const partitioned = partition({
      graph,
      entryPoints,
      model: features,
      isMovable: format.isMovable,
      isCode: format.isCode,
    });
    expect(partitioned.failures).toEqual([]);
    const { ranges } = removableRanges(graph, partitioned, format);
    return checkElfRelocations({ shipped, withRelocations, graph, partition: partitioned, ranges }).failures;
  }

  test("agree with a plain link", async () => {
    using dir = tempDir("trim-elf-relocations", sources);
    const result = await linked(String(dir), { validatesRelocations: true });
    expect(result.linkOutput).toMatch(validatorSummary);
    expectCleanRuns(result);
  });

  test("agree with a link without the header of the unwind tables", async () => {
    using dir = tempDir("trim-elf-relocations", sources);
    const result = await linked(String(dir), { validatesRelocations: true, linkFlags: ["-Wl,--no-eh-frame-hdr"] });
    expect(result.linkOutput).toMatch(validatorSummary);
    expectCleanRuns(result);
  });

  test("agree with a link that defines a symbol version, which names the output file", async () => {
    using dir = tempDir("trim-elf-relocations", { ...sources, "version.lds": "TOY_1 { global: main; local: *; };\n" });
    const result = await linked(String(dir), {
      validatesRelocations: true,
      linkFlags: ["-Wl,--version-script=version.lds", "-Wl,--export-dynamic"],
    });
    expect(result.linkOutput).toMatch(validatorSummary);
    expectCleanRuns(result);
  });

  test("agree where one feature calls another's entry point", async () => {
    using dir = tempDir("trim-elf-relocations", {
      ...sources,
      "entry.c": entryCalling("entry_of_other"),
      "other.c": otherSource,
      "main.c": guardsBoth,
    });
    const { table, linkOutput } = await linked(String(dir), {
      objects: ["feature_code", "entry", "other", "embedder", "main"],
      validatesRelocations: true,
    });
    expect(linkOutput).toMatch(validatorSummary);
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "Reference", isFollowed: true },
    ]);
  });

  test("find a reference the graph reader missed", async () => {
    using dir = tempDir("trim-elf-relocations", files);
    const links = await linkTwice(String(dir));
    const { graph } = links.reading;
    const nodeNamed = (name: string) => graph.names.findIndex(names => names.includes(name));
    const [from, to] = [nodeNamed("main"), nodeNamed("feature_code_5")];
    expect(check(links)).toEqual([]);
    const failure = { kind: "ReferenceIntoRemovableRange", from, to };
    expect(check(links, withoutEdge(graph, from, to))).toEqual([expect.objectContaining(failure)]);
  });

  test("compare every section of the image but the table", async () => {
    using dir = tempDir("trim-elf-relocations", files);
    const links = await linkTwice(String(dir));
    const checkChanged = (section: string) =>
      check(links, links.reading.graph, withOneByteChanged(links.shipped, section));
    expect(checkChanged(".text")).toEqual([{ kind: "RelinkedImageDiffers", section: ".text" }]);
    expect(checkChanged(".bun_trim")).toEqual([]);
  });

  test.skipIf(!isX64)("do not stop a link that asks for a report alone", async () => {
    using dir = tempDir("trim-elf-relocations", {
      ...sources,
      "offset.c": String.raw`__asm__(".data\n.globl table_offset\ntable_offset: .quad feature_code_5@GOTOFF\n.text\n");`,
      "main.c": `
        ${start}
        extern long table_offset;
        ${mainReturning("table_offset != 0 ? 0 : 1")}
      `,
    });
    const program = { objects: [...defaultObjects, "offset"] };
    const stopped = await wrapped(String(dir), { ...program, validatesRelocations: true });
    expect(stopped.exitCode).toBe(1);
    expect(stopped.stderr).toContain("UnknownRelocationType");
    const result = await linked(String(dir), { ...program, validatesRelocations: "report" });
    expect(result.linkOutput).toContain("UnknownRelocationType");
    expectCleanRuns(result);
  });

  test.skipIf(!isX64)("report a relocation type they do not know", async () => {
    using dir = tempDir("trim-elf-relocations", {
      ...files,
      "offset.c": String.raw`__asm__(".data\n.globl table_offset\ntable_offset: .quad feature_code_5@GOTOFF\n.text\n");`,
      "main.c": `
        ${start}
        extern long table_offset;
        ${mainReturning("table_offset != 0 ? 0 : 1")}
      `,
    });
    const links = await linkTwice(String(dir), [...objects, "offset"]);
    expect(check(links)).toEqual([{ kind: "UnknownRelocationType", section: ".rela.data", type: 25 }]);
  });
});

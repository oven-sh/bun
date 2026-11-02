import { expect, setDefaultTimeout, test } from "bun:test";
import { isMusl, tempDir } from "harness";
import { closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveCache } from "../../../scripts/build/trim/archive.ts";
import { openElf } from "../../../scripts/build/trim/elf-file.ts";
import { readElfGraph } from "../../../scripts/build/trim/elf-graph.ts";
import { readElfObject } from "../../../scripts/build/trim/elf-objects.ts";
import {
  canLink,
  compileFeatureCodeOnce,
  compileObjects,
  describeLink,
  isX64,
  linkByHand,
  linkSkipReason,
  mainReturning,
  objectPath,
  objectsWithMore,
  sources,
  tools,
} from "./link-elf-support.ts";
import { entryCalling, mixingFunction, run, skipNotice, start } from "./toy-program.ts";

setDefaultTimeout(60_000);

const testFile = "link-elf-graph.test.ts";
if (!canLink) skipNotice(testFile, linkSkipReason);
else if (isMusl) skipNotice(testFile, "musl has no symbol versions: the case with a versioned symbol does not run");

compileFeatureCodeOnce();

test.skipIf(!canLink)("the symbols with which AArch64 marks code and data name no section", async () => {
  using dir = tempDir("trim-elf-mapping-symbols", {
    "marked.c": `static const int table[] = { 1, 2, 3, 5 }; int marked(int at) { return table[at & 3]; }`,
  });
  const folder = String(dir);
  const flags = [
    "--target=aarch64-unknown-linux-gnu",
    "-O1",
    "-ffunction-sections",
    "-fdata-sections",
    "-ffreestanding",
  ];
  const compiled = await run([tools.clang!, ...flags, "-c", "marked.c", "-o", "marked.o"], folder);
  if (compiled.exitCode !== 0)
    return skipNotice(testFile, "clang has no AArch64 target: the case with mapping symbols does not run");
  expect((await run([tools["llvm-nm"]!, "--special-syms", "marked.o"], folder)).stdout).toContain(" $x");
  const read = readElfObject(join(folder, "marked.o"), new Set([".text.marked", ".rodata.table"]), new ArchiveCache());
  if (typeof read === "string") throw new Error(`marked.o was not read: ${read}`);
  expect(read.named).toContainEqual(["marked", ".text.marked"]);
  expect(read.named.filter(([name]) => name.startsWith("$"))).toEqual([]);
});

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

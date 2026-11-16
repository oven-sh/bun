// A Windows executable lists its sections in a table in front of the first of them. `bun build --compile` adds one section for the program, with `--aot` and
// without, and `--trim` adds sections around what it cuts out. The table can grow up to the address of the first section.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

const headerSize = 40;
// One for the program, and two for each of thirty cuts.
const leastFreeSlots = 61;

function sectionTableOf(path: string) {
  const bytes = Buffer.alloc(4096);
  const file = openSync(path, "r");
  try {
    readSync(file, bytes, 0, bytes.length, 0);
  } finally {
    closeSync(file);
  }
  const fileHeader = bytes.readUInt32LE(0x3c) + 4;
  const count = bytes.readUInt16LE(fileHeader + 2);
  const table = fileHeader + 20 + bytes.readUInt16LE(fileHeader + 16);
  const sections = Array.from({ length: count }, (_, index) => {
    const header = bytes.subarray(table + index * headerSize, table + (index + 1) * headerSize);
    return {
      name: header.toString("latin1", 0, 8).replace(/\0+$/, ""),
      address: header.readUInt32LE(12),
      sizeInFile: header.readUInt32LE(16),
      offsetInFile: header.readUInt32LE(20),
    };
  });
  const slotsUpTo = (end: number) => Math.floor((end - table) / headerSize) - count;
  return {
    names: sections.map(section => section.name).join(" "),
    count,
    freeSlotsInFile: slotsUpTo(
      Math.min(...sections.filter(section => section.sizeInFile).map(section => section.offsetInFile)),
    ),
    freeSlots: slotsUpTo(Math.min(...sections.map(section => section.address))),
  };
}

const describeTable = (name: string, table: ReturnType<typeof sectionTableOf>) =>
  `${name}: ${table.count} sections, ${table.freeSlotsInFile} free slots in front of the data in the file, ${table.freeSlots} in front of the first section: ${table.names}`;

test.skipIf(!isWindows)("Bun leaves room for the sections that a build adds", () => {
  const table = sectionTableOf(bunExe());
  console.error(describeTable("bun", table));
  expect(table.freeSlots).toBeGreaterThanOrEqual(leastFreeSlots);
});

test.skipIf(!isWindows).each([[[]], [["--aot"]], [["--trim"]], [["--aot", "--trim"]]])(
  "an executable built with %j runs",
  async flags => {
    using dir = tempDir("section-headers", { "program.js": `console.log("ran");` });
    const folder = String(dir);
    const build = await spawned(
      [bunExe(), "build", "--compile", ...flags, "program.js", "--outfile", "program.exe"],
      folder,
      bunEnv,
    );
    if (flags.includes("--trim") && build.stderr.includes("this build of Bun doesn't support --trim")) return;
    built(build);
    console.error(describeTable(`bun build --compile ${flags.join(" ")}`, sectionTableOf(join(folder, "program.exe"))));
    const run = await spawned([join(folder, "program.exe")], folder, bunEnv);
    expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  },
  300_000,
);

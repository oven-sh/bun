import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  misplaced,
  pageSize,
  rangesThatCanGo,
  readPlan,
  wholePages,
  writePlan,
  type Layout,
  type Needs,
} from "../../scripts/build/islands-layout.ts";

type Section = [
  size: number,
  neededBy: string | "stays",
  options?: { output?: string; gap?: number; alignment?: number },
];

function laidOut(sections: Section[], start = 0x200000): Layout & Needs {
  const result = { address: [], size: [], alignment: [], output: [], core: new Set(), neededBy: new Map() } as Layout &
    Needs;
  let address = start;
  sections.forEach(([size, neededBy, options = {}], node) => {
    address += options.gap ?? 0;
    result.address.push(address);
    result.size.push(size);
    result.alignment.push(options.alignment ?? 16);
    result.output.push(options.output ?? ".text");
    if (neededBy === "stays") result.core.add(node);
    else result.neededBy.set(node, neededBy);
    address += size;
  });
  return result;
}

const isMovable = (output: string) => output === ".text" || output === ".rodata";
const stretches = (layout: Layout & Needs) =>
  rangesThatCanGo(layout, layout, isMovable).map(({ start, end, features }) => [
    start - 0x200000,
    end - 0x200000,
    features,
  ]);

describe("the stretches of an executable that can go", () => {
  test("sections that lie together are one stretch for each set of features, and the stretches abut", () => {
    const layout = laidOut([
      [0x100, "stays"],
      [0x6000, "tools"],
      [0x2000, "tools"],
      [0x3000, "tools,jit"],
      [0x5000, "jit"],
      [0x100, "stays"],
    ]);
    expect(stretches(layout)).toEqual([
      [0x100, 0x8100, "tools"],
      [0x8100, 0xb100, "tools,jit"],
      [0xb100, 0x10100, "jit"],
    ]);
    expect(misplaced(layout, layout, rangesThatCanGo(layout, layout, isMovable))).toBe(0);
  });

  test("a section that stays is in no stretch, wherever a plan has put it", () => {
    const layout = laidOut([
      [0x8000, "tools"],
      [0x40, "stays"],
      [0x8000, "tools"],
    ]);
    expect(stretches(layout)).toEqual([
      [0, 0x8000, "tools"],
      [0x8040, 0x10040, "tools"],
    ]);
  });

  test("padding between two sets of features belongs to the first", () => {
    const layout = laidOut([
      [0x7ff8, "tools"],
      [0x8000, "jit", { gap: 8 }],
    ]);
    expect(stretches(layout)).toEqual([
      [0, 0x8000, "tools"],
      [0x8000, 0x10000, "jit"],
    ]);
  });

  test("a run shorter than a page is not listed", () => {
    expect(
      stretches(
        laidOut([
          [pageSize - 16, "tools"],
          [0x40, "stays"],
          [pageSize, "tools"],
        ]),
      ),
    ).toEqual([[pageSize + 0x30, 2 * pageSize + 0x30, "tools"]]);
  });

  test("bytes that no section accounts for end a run", () => {
    const layout = laidOut([
      [0x8000, "tools"],
      [0x8000, "tools", { gap: 64, alignment: 16 }],
    ]);
    expect(stretches(layout)).toEqual([
      [0, 0x8000, "tools"],
      [0x8040, 0x10040, "tools"],
    ]);
  });

  test("another output section ends a run, and one that cannot be cut is never listed", () => {
    const layout = laidOut([
      [0x8000, "tools"],
      [0x8000, "tools", { output: ".rodata" }],
      [0x8000, "tools", { output: ".data" }],
    ]);
    expect(stretches(layout)).toEqual([
      [0, 0x8000, "tools"],
      [0x8000, 0x10000, "tools"],
    ]);
    expect(wholePages(rangesThatCanGo(layout, layout, isMovable))).toBe(0x10000);
  });

  test("the largest runs are kept when there are too many", () => {
    const sections: Section[] = [];
    for (let index = 0; index < 300; index++) sections.push([pageSize + index * 16, "tools"], [16, "stays"]);
    const kept = rangesThatCanGo(laidOut(sections), laidOut(sections), isMovable);
    expect(kept.length).toBe(256);
    expect(Math.min(...kept.map(range => range.end - range.start))).toBe(pageSize + 44 * 16);
  });
});

describe("the check over the stretches", () => {
  const layout = laidOut([
    [0x8000, "tools"],
    [0x40, "stays"],
    [0x8000, "jit"],
  ]);

  test("finds a section that stays within a stretch", () => {
    expect(misplaced(layout, layout, [{ start: 0x200000, end: 0x208040, features: "tools" }])).toBe(1);
  });

  test("finds a section that other features need", () => {
    expect(misplaced(layout, layout, [{ start: 0x208040, end: 0x210040, features: "tools" }])).toBe(1);
  });

  test("finds a section of which only the end lies in a stretch", () => {
    expect(misplaced(layout, layout, [{ start: 0x208020, end: 0x208040, features: "tools" }])).toBe(1);
  });
});

describe("whole pages", () => {
  test("stretches that abut count as one; the broken pages at both ends do not count", () => {
    expect(
      wholePages([
        { start: 0x200100, end: 0x208100, features: "tools" },
        { start: 0x208100, end: 0x210100, features: "jit" },
      ]),
    ).toBe(0x10000 - pageSize);
    expect(
      wholePages([
        { start: 0x200100, end: 0x208100, features: "tools" },
        { start: 0x208140, end: 0x210100, features: "jit" },
      ]),
    ).toBe(0x10000 - 2 * pageSize);
  });
});

describe("a plan", () => {
  const plan = {
    doors: ["_ZN3JSC21installImageCompilerEv"],
    islands: [
      { features: "tools", names: ["a", "b.llvm.123"] },
      { features: "tools,jit", names: ["c"] },
    ],
  };

  test("is read as it was written", () => {
    using dir = tempDir("islands-plan", {});
    const path = join(String(dir), "islands.plan");
    writePlan(path, plan);
    expect(readFileSync(path, "utf8")).toBe(
      "bun-islands-plan 1\ndoor _ZN3JSC21installImageCompilerEv\nisland tools\na\nb.llvm.123\nisland tools,jit\nc\n",
    );
    expect(readPlan(path, ["tools", "jit"])).toEqual(plan);
  });

  test("loses the islands of features that are no longer declared", () => {
    using dir = tempDir("islands-plan", {});
    const path = join(String(dir), "islands.plan");
    writePlan(path, plan);
    expect(readPlan(path, ["tools"])?.islands).toEqual([plan.islands[0]!]);
    expect(readPlan(path, ["bundler"])).toBeUndefined();
  });

  test("is not there when the file is the placeholder, is missing or was not named", () => {
    using dir = tempDir("islands-plan", {});
    const path = join(String(dir), "islands.plan");
    writeFileSync(path, "no plan yet\n");
    expect(readPlan(path, ["tools"])).toBeUndefined();
    expect(readPlan(join(String(dir), "none"), ["tools"])).toBeUndefined();
    expect(readPlan(undefined, ["tools"])).toBeUndefined();
  });
});

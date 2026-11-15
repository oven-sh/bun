import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { BuildError } from "../../../scripts/build/error.ts";
import { readArchive } from "../../../scripts/build/trim/archive.ts";
import type { Feature, FeatureModel, IcuDataLine } from "../../../scripts/build/trim/features.ts";
import {
  createSectionGraph,
  type ObjectFormat,
  type SectionGraph,
  type SectionGraphParts,
} from "../../../scripts/build/trim/graph.ts";
import {
  classOfIcuItem,
  icuItemClasses,
  icuPackagesOf,
  itemsOf,
  runsOf,
  type IcuItemClass,
  type NamedBytes,
} from "../../../scripts/build/trim/icu-data.ts";
import { groupLanguages, languageOfIcuItem } from "../../../scripts/build/trim/icu-locales.ts";
import { imageOfParts, type LinkedImage } from "../../../scripts/build/trim/linked-image.ts";
import type { Partition } from "../../../scripts/build/trim/partition.ts";
import {
  checkRanges,
  cuttableRanges,
  featuresNotKeepingModuleTexts,
  fillOnlyRanges,
  maxCuttableRanges,
  maxFillOnlyRanges,
  moduleTextRanges,
  readBuiltinModuleTexts,
  removableRanges,
  type OutputPolicy,
  type RemovableRange,
} from "../../../scripts/build/trim/ranges.ts";
import { xxh3 } from "../../../scripts/build/trim/xxh3.ts";
import { packageOf } from "../icu-data-package.ts";
import { A, feature, modelOf, partitioned, tableOutput } from "./toy-graph.ts";

type Section = [
  size: number,
  features: number[] | "retained" | "flagged",
  options?: { output?: string; gap?: number; alignment?: number },
];
type Layout = { graph: SectionGraph; partition: Partition };

function partsOf(sections: Section[], start: number, format: ObjectFormat): SectionGraphParts {
  const parts: SectionGraphParts = {
    format,
    isArm64: false,
    placedCount: sections.length,
    address: [],
    size: [],
    alignment: [],
    output: [],
    object: [],
    section: [],
    successors: [],
    roots: new Set(),
    exported: new Set(),
    liveWithoutReference: new Set(),
    names: [],
    aliases: new Map(),
    externalNames: new Set(),
    stringHash: new Map(),
  };
  let address = start;
  sections.forEach(([size, , options = {}], node) => {
    address += options.gap ?? 0;
    parts.address.push(address);
    parts.size.push(size);
    parts.alignment.push(options.alignment ?? 16);
    parts.output.push(options.output ?? ".text");
    parts.object.push("toy.o");
    parts.section.push(`section${node}`);
    parts.successors.push(new Set());
    parts.names.push([`symbol${node}`]);
    address += size;
  });
  return parts;
}

function createLayout(sections: Section[], start = 0x200000, format: ObjectFormat = "elf"): Layout {
  const isRetained = new Uint8Array(sections.length);
  const setOf = new Uint32Array(sections.length);
  const sets: number[][] = [[]];
  const setNumbers = new Map<string, number>();
  sections.forEach(([, features], node) => {
    if (features === "retained") isRetained[node] = 1;
    if (features === "retained" || features === "flagged") return;
    const key = features.join();
    const set = setNumbers.get(key) ?? sets.push(features) - 1;
    setNumbers.set(key, set);
    setOf[node] = set;
  });
  return {
    graph: createSectionGraph(partsOf(sections, start, format)),
    partition: { isRetained, setOf, exactSetOf: setOf, sets } as Partition,
  };
}

const policy: OutputPolicy = {
  isMovable: output => output === ".text" || output === ".rodata",
  canBeFilled: output => output !== ".bss",
  isCode: output => output === ".text",
};
const [Tools, Jit] = [128, 0];

const summarize = ({ partition }: Layout, ranges: RemovableRange[]) =>
  ranges.map(range => [range.start - 0x200000, range.end - 0x200000, partition.sets[range.set]]);
const cuttable = ({ graph, partition }: Layout) => cuttableRanges(graph, partition, policy);
const fillOnly = (layout: Layout) => fillOnlyRanges(layout.graph, layout.partition, cuttable(layout).ranges, policy);
const sizeOf = (range: RemovableRange) => range.end - range.start;
const isAscendingAndDisjoint = (ranges: RemovableRange[]) =>
  ranges.every((range, index) => index === 0 || ranges[index - 1]!.end <= range.start);

describe("ranges that can be cut", () => {
  const abuttingSections: Section[] = [
    [0x100, "retained"],
    [0x6000, [Tools]],
    [0x2000, [Tools]],
    [0x3000, [Jit, Tools]],
    [0x5000, [Jit]],
    [0x100, "retained"],
  ];
  const abuttingRanges = [
    [0x100, 0x8100, [Tools]],
    [0x8100, 0xb100, [Jit, Tools]],
    [0xb100, 0x10100, [Jit]],
  ];
  const smallestRunBytes = 0x100;
  const runsOverLimitIn = (output: string): Section[] =>
    Array.from({ length: 2100 }, (_, index): Section[] => [
      [smallestRunBytes + index * 16, [Tools], { output }],
      [16, "retained", { output }],
    ]).flat();
  const runsOverLimit = runsOverLimitIn(".text");
  const droppedSizes = Array.from({ length: 52 }, (_, index) => smallestRunBytes + index * 16);
  const policyWithPointers: OutputPolicy = {
    isMovable: output => output === ".pointers" || policy.isMovable(output),
    canBeFilled: output => output !== ".pointers" && policy.canBeFilled(output),
    isCode: policy.isCode,
  };

  test("adjacent sections form one range per feature set, and the ranges abut", () => {
    const layout = createLayout(abuttingSections);
    const { ranges } = cuttable(layout);
    expect(summarize(layout, ranges)).toEqual(abuttingRanges);
    for (const range of ranges) expect(range).toMatchObject({ canBeCut: true, canBeFilled: true, isCode: true });
    expect(checkRanges(layout.graph, layout.partition, ranges)).toEqual([]);
  });

  test("a retained section is not in any range", () => {
    const layout = createLayout([
      [0x8000, [Tools]],
      [0x40, "retained"],
      [0x8000, [Tools]],
    ]);
    expect(summarize(layout, cuttable(layout).ranges)).toEqual([
      [0, 0x8000, [Tools]],
      [0x8040, 0x10040, [Tools]],
    ]);
  });

  test("a section with no feature set ends a run and is not in any range", () => {
    const layout = createLayout([
      [0x8000, [Tools]],
      [0x40, "flagged"],
      [0x8000, [Tools]],
    ]);
    expect(summarize(layout, cuttable(layout).ranges)).toEqual([
      [0, 0x8000, [Tools]],
      [0x8040, 0x10040, [Tools]],
    ]);
  });

  test("padding between two sets belongs to the first", () => {
    const layout = createLayout([
      [0x7ff8, [Tools]],
      [0x8000, [Jit], { gap: 8 }],
    ]);
    expect(summarize(layout, cuttable(layout).ranges)).toEqual([
      [0, 0x8000, [Tools]],
      [0x8000, 0x10000, [Jit]],
    ]);
  });

  test("a short run is listed: how long a cut has to be is not the link's to decide", () => {
    const layout = createLayout([
      [1, [Tools]],
      [0x3f, "retained"],
      [0x8000, [Tools]],
      [0x40, "retained"],
      [0x10, [Jit]],
    ]);
    const { ranges, droppedRanges, droppedBytes } = cuttable(layout);
    expect(summarize(layout, ranges)).toEqual([
      [0, 1, [Tools]],
      [0x40, 0x8040, [Tools]],
      [0x8080, 0x8090, [Jit]],
    ]);
    expect(ranges.map(range => range.canBeCut)).toEqual([true, true, true]);
    expect({ droppedRanges, droppedBytes }).toEqual({ droppedRanges: 0, droppedBytes: 0 });
    expect(fillOnly(layout).ranges).toEqual([]);
  });

  test("a gap wider than alignment padding ends a run", () => {
    const layout = createLayout([
      [0x8000, [Tools]],
      [0x8000, [Tools], { gap: 64, alignment: 16 }],
    ]);
    expect(summarize(layout, cuttable(layout).ranges)).toEqual([
      [0, 0x8000, [Tools]],
      [0x8040, 0x10040, [Tools]],
    ]);
  });

  test("another output section ends a run, and one that cannot move is never listed", () => {
    const layout = createLayout([
      [0x8000, [Tools]],
      [0x8000, [Tools], { output: ".rodata" }],
      [0x8000, [Tools], { output: ".data" }],
    ]);
    const { ranges } = cuttable(layout);
    expect(summarize(layout, ranges)).toEqual([
      [0, 0x8000, [Tools]],
      [0x8000, 0x10000, [Tools]],
    ]);
    expect(ranges.map(range => range.isCode)).toEqual([true, false]);
  });

  test("a run in an output section that can move but cannot be filled can only be cut", () => {
    const layout = createLayout([
      [0x8000, [Tools]],
      [0x8000, [Tools], { output: ".pointers" }],
      [0x40, "retained", { output: ".pointers" }],
      [0x20, [Tools], { output: ".pointers" }],
    ]);
    const { ranges } = removableRanges(layout.graph, layout.partition, policyWithPointers);
    expect(summarize(layout, ranges)).toEqual([
      [0, 0x8000, [Tools]],
      [0x8000, 0x10000, [Tools]],
      [0x10040, 0x10060, [Tools]],
    ]);
    expect(ranges[0]).toMatchObject({ canBeCut: true, canBeFilled: true, isCode: true });
    expect(ranges[1]).toMatchObject({ canBeCut: true, canBeFilled: false, isCode: false });
    expect(ranges[2]).toMatchObject({ canBeCut: true, canBeFilled: false, isCode: false });
  });

  test("the largest runs win when there are too many", () => {
    const { ranges, droppedRanges, droppedBytes } = cuttable(createLayout(runsOverLimit));
    expect(ranges.length).toBe(maxCuttableRanges);
    expect(Math.min(...ranges.map(sizeOf))).toBe(smallestRunBytes + 52 * 16);
    expect(isAscendingAndDisjoint(ranges)).toBe(true);
    expect(droppedRanges).toBe(52);
    expect(droppedBytes).toBe(droppedSizes.reduce((sum, size) => sum + size, 0));
  });

  test("a run over the limit can still be filled", () => {
    const { graph, partition } = createLayout(runsOverLimit);
    const { ranges, droppedRanges, droppedBytes } = removableRanges(graph, partition, policy);
    expect(ranges.filter(range => range.canBeCut).length).toBe(maxCuttableRanges);
    expect(ranges.filter(range => !range.canBeCut).map(sizeOf)).toEqual(droppedSizes);
    expect({ droppedRanges, droppedBytes }).toEqual({ droppedRanges: 0, droppedBytes: 0 });
  });

  test("a run over the limit that cannot be filled either is never removed, and is counted", () => {
    const { graph, partition } = createLayout(runsOverLimitIn(".pointers"));
    const { ranges, droppedRanges, droppedBytes } = removableRanges(graph, partition, policyWithPointers);
    expect(ranges.length).toBe(maxCuttableRanges);
    expect(ranges.every(range => range.canBeCut && !range.canBeFilled)).toBe(true);
    expect(droppedRanges).toBe(52);
    expect(droppedBytes).toBe(droppedSizes.reduce((sum, size) => sum + size, 0));
  });

  test("an empty section neither splits a range nor starts one", () => {
    const layout = createLayout([
      [0x8000, [Tools]],
      [0, [Jit]],
      [0x8000, [Tools]],
    ]);
    expect(summarize(layout, cuttable(layout).ranges)).toEqual([[0, 0x10000, [Tools]]]);
    expect(fillOnly(layout).ranges).toEqual([]);
  });
});

describe("ranges that can only be filled", () => {
  const inData = { output: ".data" };
  const mixedSections: Section[] = [
    [0x8000, [Tools]],
    [0x40, "retained"],
    [0x20, [Tools]],
    [0x40, "retained", inData],
    [0x20, [Tools], inData],
    [0x10, [Tools], inData],
    [0x10, [Jit], inData],
    [0x40, "retained", inData],
    [0x30, [Tools], { output: ".bss" }],
  ];

  test("removable sections in an output section that cannot move are listed, however small, wherever the file has bytes", () => {
    const layout = createLayout(mixedSections);
    const { ranges } = fillOnly(layout);
    expect(summarize(layout, ranges)).toEqual([
      [0x80a0, 0x80d0, [Tools]],
      [0x80d0, 0x80e0, [Jit]],
    ]);
    expect(ranges.map(range => range.canBeCut)).toEqual([false, false]);
    expect(ranges.map(range => range.canBeFilled)).toEqual([true, true]);
    expect(ranges.map(range => range.isCode)).toEqual([false, false]);
    expect(checkRanges(layout.graph, layout.partition, [...cuttable(layout).ranges, ...ranges])).toEqual([]);
  });

  test("code that cannot move is marked as code", () => {
    const unmovable: OutputPolicy = { ...policy, isMovable: () => false };
    const layout = createLayout([[0x20, [Tools]]]);
    expect(fillOnlyRanges(layout.graph, layout.partition, [], unmovable).ranges).toEqual([
      {
        start: 0x200000,
        end: 0x200020,
        set: layout.partition.setOf[0]!,
        isCode: true,
        canBeCut: false,
        canBeFilled: true,
      },
    ]);
  });

  test("padding is not included", () => {
    const layout = createLayout([
      [0x20, [Tools], inData],
      [0x20, [Tools], { ...inData, gap: 8 }],
    ]);
    expect(summarize(layout, fillOnly(layout).ranges)).toEqual([
      [0, 0x20, [Tools]],
      [0x28, 0x48, [Tools]],
    ]);
  });

  test("a section that starts inside the previous range is skipped", () => {
    const layout = createLayout([
      [0x20, [Tools], inData],
      [0x20, [Tools], { ...inData, gap: -8 }],
    ]);
    expect(summarize(layout, fillOnly(layout).ranges)).toEqual([[0, 0x20, [Tools]]]);
  });

  test("one set in two output sections does not merge", () => {
    const layout = createLayout([
      [0x20, [Tools], inData],
      [0x20, [Tools], { output: ".data.rel.ro" }],
    ]);
    expect(summarize(layout, fillOnly(layout).ranges)).toEqual([
      [0, 0x20, [Tools]],
      [0x20, 0x40, [Tools]],
    ]);
  });

  test("removableRanges merges both lists in address order", () => {
    const layout = createLayout(mixedSections);
    const { ranges, droppedRanges, droppedBytes } = removableRanges(layout.graph, layout.partition, policy);
    expect(ranges).toEqual([...cuttable(layout).ranges, ...fillOnly(layout).ranges].sort((a, b) => a.start - b.start));
    expect(ranges.map(range => range.canBeCut)).toEqual([true, true, false, false]);
    expect(isAscendingAndDisjoint(ranges)).toBe(true);
    expect({ droppedRanges, droppedBytes }).toEqual({ droppedRanges: 0, droppedBytes: 0 });
    expect(checkRanges(layout.graph, layout.partition, ranges)).toEqual([]);
  });

  test("ranges dropped at the limit are counted", () => {
    const sections: Section[] = [];
    for (let index = 0; index < maxFillOnlyRanges + 100; index++) {
      sections.push([16 + (index % 7) * 16, [Tools], inData], [16, "retained", inData]);
    }
    const layout = createLayout(sections);
    const { ranges, droppedRanges, droppedBytes } = fillOnly(layout);
    expect(ranges.length).toBe(maxFillOnlyRanges);
    expect(isAscendingAndDisjoint(ranges)).toBe(true);
    expect(summarize(layout, ranges.slice(0, 1))).toEqual([[0, 16, [Tools]]]);
    expect(droppedRanges).toBe(100);
    expect(droppedBytes).toBe(1600);
  });
});

describe("checkRanges", () => {
  const layout = createLayout([
    [0x8000, [Tools]],
    [0x40, "retained"],
    [0x8000, [Jit]],
    [0x40, "flagged"],
  ]);
  const toolsRange = (start: number, end: number): RemovableRange => ({
    start,
    end,
    set: layout.partition.setOf[0]!,
    isCode: true,
    canBeCut: true,
    canBeFilled: true,
  });
  const failuresOf = (range: RemovableRange) => checkRanges(layout.graph, layout.partition, [range]);

  test("finds a retained section in a range", () => {
    const range = toolsRange(0x200000, 0x208040);
    expect(failuresOf(range)).toEqual([{ kind: "RetainedSectionInRemovableRange", node: 1, range }]);
  });

  test("finds a section of another feature set", () => {
    const range = toolsRange(0x208040, 0x210040);
    expect(failuresOf(range)).toEqual([{ kind: "RetainedSectionInRemovableRange", node: 2, range }]);
  });

  test("finds a section with only its end in a range", () => {
    const range = toolsRange(0x208020, 0x208040);
    expect(failuresOf(range)).toEqual([{ kind: "RetainedSectionInRemovableRange", node: 1, range }]);
  });

  test("finds a section with no feature set", () => {
    const range = toolsRange(0x210040, 0x210080);
    expect(failuresOf(range)).toEqual([{ kind: "RetainedSectionInRemovableRange", node: 3, range }]);
  });

  test("finds an entry of a table in data that no range lists", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["table"] },
        table: { output: tableOutput, to: ["entryA"] },
        entryA: { to: ["onlyA"] },
        onlyA: {},
      },
      [["table", "entryA", A, { builtin: 7 }]],
    );
    const { ranges } = removableRanges(result.graph, result, policy);
    expect(ranges.length).toBe(1);
    expect(checkRanges(result.graph, result, ranges)).toEqual([]);
    const afterEntry = [{ ...ranges[0]!, start: result.graph.address[result.node("onlyA")]! }];
    expect(checkRanges(result.graph, result, afterEntry)).toEqual([
      { kind: "TableEntryOutsideRemovableRanges", node: result.node("entryA") },
    ]);
    expect(checkRanges(result.graph, result, [])).toEqual([
      { kind: "TableEntryOutsideRemovableRanges", node: result.node("entryA") },
    ]);
  });
});

describe("the texts of the built-in modules", () => {
  const output = ".bun_builtins";
  const sectionStart = 0x300000;
  const [Interpreter, BuiltinSourceText, InternalForTesting, RuntimeTranspiler, Bundler] = [1, 2, 128, 129, 130];
  const model = modelOf(
    feature("Interpreter", Interpreter),
    feature("BuiltinSourceText", BuiltinSourceText),
    feature("InternalForTesting", InternalForTesting),
    feature("RuntimeTranspiler", RuntimeTranspiler),
    feature("Bundler", Bundler),
  );

  // `texts` in the order of the section, each with the number of its module.
  function sectionOf(texts: [module: number, text: string][]): { bytes: Buffer; spans: [number, number][] } {
    const recordsEnd = 48 + 24 * texts.length;
    const dependenciesEnd = recordsEnd + 2 * (texts.length + 1);
    const dataOffset = Math.ceil(dependenciesEnd / 16) * 16;
    let data = "functions\0";
    const records = Buffer.alloc(24 * texts.length);
    const spans = texts.map(([module, text]): [number, number] => {
      records.writeUInt32LE(data.length, 24 * module + 16);
      records.writeUInt32LE(text.length, 24 * module + 20);
      const start = sectionStart + dataOffset + data.length;
      data += text + "\0";
      return [start, sectionStart + dataOffset + data.length];
    });
    const header = Buffer.alloc(48);
    header.write("BUNBLTNS", 0, "latin1");
    [2, 0, texts.length, 48, recordsEnd, dependenciesEnd, dataOffset, data.length].forEach((word, index) =>
      header.writeUInt32LE(word, 8 + 4 * index),
    );
    const padding = Buffer.alloc(dataOffset - recordsEnd);
    return { bytes: Buffer.concat([header, records, padding, Buffer.from(data, "latin1")]), spans };
  }
  const imageOf = (bytes: Buffer): LinkedImage => ({
    isArm64: false,
    bytes: (address, length) =>
      address >= sectionStart && address + length <= sectionStart + bytes.length
        ? bytes.subarray(address - sectionStart, address - sectionStart + length)
        : undefined,
  });
  const layoutOf = (bytes: Buffer, features: number[] | "retained") =>
    createLayout([[bytes.length, features, { output }]], sectionStart);
  const afterHeader = (layout: Layout, bytes: Buffer): RemovableRange => ({
    start: sectionStart + 48,
    end: sectionStart + bytes.length,
    set: layout.partition.setOf[0]!,
    isCode: false,
    canBeCut: true,
    canBeFilled: true,
  });
  const three = sectionOf([
    [2, "(function (){third})"],
    [0, "(function (){first})"],
    [1, "(function (){second})"],
  ]);
  const listed = (layout: Layout, ranges: RemovableRange[], bytes = three.bytes, features = model) =>
    moduleTextRanges({ ...layout, model: features, ranges, output, openImage: () => imageOf(bytes) });

  test("are read in the order of their addresses, each with its NUL", () => {
    const { graph } = layoutOf(three.bytes, "retained");
    expect(readBuiltinModuleTexts(graph, output, () => imageOf(three.bytes))).toEqual(
      [2, 0, 1].map((module, index) => ({ module, start: three.spans[index]![0], end: three.spans[index]![1] })),
    );
    expect(three.spans[0]![1]).toBe(three.spans[1]![0]);
    expect(three.spans[0]![1] - three.spans[0]![0]).toBe("(function (){third})".length + 1);
  });

  test("have the set of their range, and as readers the features that keep a text nothing runs", () => {
    const everyFeature = [Interpreter, BuiltinSourceText, InternalForTesting, RuntimeTranspiler, Bundler];
    const layout = layoutOf(three.bytes, everyFeature);
    const range = afterHeader(layout, three.bytes);
    expect(listed(layout, [range])).toEqual(
      [2, 0, 1].map((module, index) => ({
        module,
        start: three.spans[index]![0],
        end: three.spans[index]![1],
        set: range.set,
        readers: [InternalForTesting],
        canBeCut: true,
        canBeFilled: true,
      })),
    );
    expect(featuresNotKeepingModuleTexts).toEqual(["RuntimeTranspiler", "Interpreter", "BuiltinSourceText", "Bundler"]);
  });

  test("have no readers where no feature of the set keeps a text nothing runs", () => {
    const layout = layoutOf(three.bytes, [Interpreter, RuntimeTranspiler]);
    const range = { ...afterHeader(layout, three.bytes), canBeCut: false };
    expect(listed(layout, [range]).map(({ readers, canBeCut }) => [readers, canBeCut])).toEqual([
      [[], false],
      [[], false],
      [[], false],
    ]);
  });

  test("are not listed where every feature of the set keeps them", () => {
    const layout = layoutOf(three.bytes, [InternalForTesting]);
    expect(listed(layout, [afterHeader(layout, three.bytes)])).toEqual([]);
  });

  test("are listed only where one range holds the whole text", () => {
    const layout = layoutOf(three.bytes, [Interpreter]);
    const whole = afterHeader(layout, three.bytes);
    const [, [secondStart, secondEnd]] = three.spans as [[number, number], [number, number], [number, number]];
    const split = [
      { ...whole, end: secondStart + 4 },
      { ...whole, start: secondStart + 4 },
    ];
    expect(listed(layout, split).map(text => text.module)).toEqual([2, 1]);
    expect(listed(layout, [{ ...whole, start: secondEnd }]).map(text => text.module)).toEqual([1]);
    expect(listed(layout, [])).toEqual([]);
  });

  test("a section without the index has none, whatever the features are called", () => {
    const bytes = Buffer.alloc(256, 0x61);
    const layout = layoutOf(bytes, [Interpreter]);
    expect(listed(layout, [afterHeader(layout, bytes)], bytes, modelOf())).toEqual([]);
    const short = Buffer.from("BUNBLTNS", "latin1");
    expect(readBuiltinModuleTexts(layoutOf(short, "retained").graph, output, () => imageOf(short))).toEqual([]);
  });

  test("the executable is not opened for a program without the section", () => {
    const { graph } = createLayout([[64, "retained"]]);
    const openImage = () => {
      throw new Error("opened");
    };
    expect(readBuiltinModuleTexts(graph, output, openImage)).toEqual([]);
  });

  test.each<[string, (bytes: Buffer) => void]>([
    ["another version", bytes => bytes.writeUInt32LE(1, 8)],
    ["records past the section", bytes => bytes.writeUInt32LE(1000, 16)],
    ["a module without text", bytes => bytes.writeUInt32LE(0, 48 + 20)],
    ["a text without its NUL in the data", bytes => bytes.writeUInt32LE(bytes.readUInt32LE(36) - 1, 36)],
    ["two texts that overlap", bytes => bytes.writeUInt32LE(bytes.readUInt32LE(48 + 16) + 1, 48 + 24 + 16)],
  ])("an index with %s is an error", (_name, damage) => {
    const bytes = Buffer.from(three.bytes);
    damage(bytes);
    const { graph } = layoutOf(bytes, "retained");
    expect(() => readBuiltinModuleTexts(graph, output, () => imageOf(bytes))).toThrow(BuildError);
  });
});

describe("the items of ICU's data package", () => {
  const createItems = (...names: string[]) => names.map(name => ({ name, size: 16 }));

  test("an item's name follows the first slash, and its size reaches the next item or the end of the package", () => {
    const items: [string, number][] = [
      ["icudt75l/af.res", 48],
      ["icudt75l/coll/de.res", 40],
      ["icudt75l/zoneinfo64.res", 33],
    ];
    expect(itemsOf(packageOf(items))).toEqual([
      { name: "af.res", size: 48 },
      { name: "coll/de.res", size: 48 },
      { name: "zoneinfo64.res", size: 33 },
    ]);
    expect(itemsOf(packageOf(items, 144)).map(item => item.name)).toEqual(["af.res", "coll/de.res", "zoneinfo64.res"]);
    expect(itemsOf(packageOf([]))).toEqual([]);
  });

  test("other data and truncated packages throw", () => {
    const whole = packageOf([
      ["icudt75l/af.res", 48],
      ["icudt75l/zu.res", 16],
    ]);
    const withByte = (at: number, byte: number) => {
      const copy = Buffer.from(whole);
      copy[at] = byte;
      return copy;
    };
    for (const other of [
      Buffer.alloc(0),
      Buffer.alloc(64),
      withByte(2, 0),
      withByte(8, 1),
      withByte(12, 0x52),
      withByte(16, 2),
      whole.subarray(0, 40),
      withByte(32, 0xff),
      withByte(32 + 4 + 3, 0xff),
      withByte(32 + 8 + 3, 0xff),
    ]) {
      expect(() => itemsOf(other)).toThrow("ICU's data package is malformed");
    }
  });

  const classified: [name: string, itemClass: IcuItemClass][] = [
    ["brkitr/root.res", "sentence-break"],
    ["brkitr/sent_el.brk", "sentence-break"],
    ["brkitr/word.brk", "break-iteration"],
    ["brkitr/thaidict.dict", "break-iteration"],
    ["coll/ucadata.icu", "collation-root"],
    ["coll/root.res", "collation-root"],
    ["coll/en_US.res", "collation-root"],
    ["coll/de.res", "collation"],
    ["curr/de.res", "currency"],
    ["lang/de.res", "language-names"],
    ["region/de.res", "region-names"],
    ["rbnf/de.res", "number-spellout"],
    ["translit/el.res", "transliteration"],
    ["unit/de.res", "unit"],
    ["units.res", "unit"],
    ["grammaticalFeatures.res", "unit"],
    ["zone/de.res", "zone"],
    ["ibm-37_P100-1995.cnv", "converter"],
    ["cnvalias.icu", "converter"],
    ["rfc3491.spp", "string-prep"],
    ["confusables.cfu", "confusables"],
    ["unames.icu", "character-names"],
    ["nfkc_scf.nrm", "nfkc-simple-case-fold"],
    ["windowsZones.res", "windows-zones"],
    ["currencyNumericCodes.res", "currency-codes"],
    ["genderList.res", "gender-list"],
    ["dayPeriods.res", "day-periods"],
    ["plurals.res", "plural-rules"],
    ["pluralRanges.res", "plural-rules"],
    ["de.res", "locale"],
    ["zh_Hant_TW.res", "locale"],
    ["fil.res", "locale"],
  ];

  test.each(classified)("%s has class %s", (name, itemClass) => {
    expect(classOfIcuItem(name)).toBe(itemClass);
  });

  test.each([
    "en.res",
    "en_US.res",
    "root.res",
    "res_index.res",
    "zone/en.res",
    "zone/root.res",
    "zone/pool.res",
    "supplementalData.res",
    "icuver.res",
    "zoneinfo64.res",
    "nfc.nrm",
    "other/de.res",
  ])("%s has no class", name => {
    expect(classOfIcuItem(name)).toBeUndefined();
  });

  test("the names above cover exactly the item classes", () => {
    expect(new Set(classified.map(([, itemClass]) => itemClass))).toEqual(new Set(icuItemClasses));
  });

  const classes = new Map<IcuItemClass, { features: number[]; byLocale: boolean }>([
    ["converter", { features: [Tools], byLocale: false }],
    ["collation", { features: [5], byLocale: false }],
    ["collation-root", { features: [1, 5], byLocale: false }],
    ["locale", { features: [7], byLocale: false }],
    ["zone", { features: [7], byLocale: true }],
    ["unit", { features: [7], byLocale: true }],
  ]);
  const withoutGroup = (firstItem: number, itemCount: number, features: number[]) => ({
    firstItem,
    itemCount,
    features,
    localeGroup: undefined,
    bytes: 16 * itemCount,
  });

  test("adjacent items with the same features are one run", () => {
    expect(
      runsOf(createItems("af.res", "ar.res", "coll/de.res", "coll/fr.res", "de.res"), classes, undefined),
    ).toStrictEqual([withoutGroup(0, 2, [7]), withoutGroup(2, 2, [5]), withoutGroup(4, 1, [7])]);
  });

  test("an item without a class ends a run and is not in any run", () => {
    expect(runsOf(createItems("de.res", "en.res", "es.res", "zoneinfo64.res"), classes, undefined)).toEqual([
      withoutGroup(0, 1, [7]),
      withoutGroup(2, 1, [7]),
    ]);
    expect(runsOf(createItems("en.res", "zoneinfo64.res"), classes, undefined)).toEqual([]);
  });

  test("adjacent items with different features are separate runs", () => {
    expect(runsOf(createItems("coll/de.res", "coll/root.res", "coll/sv.res"), classes, undefined)).toEqual([
      withoutGroup(0, 1, [5]),
      withoutGroup(1, 1, [1, 5]),
      withoutGroup(2, 1, [5]),
    ]);
  });

  test("an item whose class has no features ends a run and is not in any run", () => {
    expect(runsOf(createItems("curr/de.res"), classes, undefined)).toEqual([]);
    expect(runsOf(createItems("af.res", "curr/de.res", "de.res"), classes, undefined)).toEqual([
      withoutGroup(0, 1, [7]),
      withoutGroup(2, 1, [7]),
    ]);
  });

  describe("by locale", () => {
    const groupOfLanguage = new Map([
      ["de", 0],
      ["nb", 1],
      ["no", 1],
      ["sv", 2],
    ]);
    const inGroup = (firstItem: number, itemCount: number, localeGroup: number | undefined) => ({
      ...withoutGroup(firstItem, itemCount, [7]),
      localeGroup,
    });

    test("adjacent items with the same features and another group are separate runs", () => {
      expect(
        runsOf(
          createItems("zone/de.res", "zone/de_AT.res", "zone/nb.res", "zone/no.res", "zone/sv.res"),
          classes,
          groupOfLanguage,
        ),
      ).toStrictEqual([inGroup(0, 2, 0), inGroup(2, 2, 1), inGroup(4, 1, 2)]);
    });

    test("an item of a class that is not removed by locale has no group", () => {
      expect(runsOf(createItems("de.res", "sv.res", "zone/sv.res"), classes, groupOfLanguage)).toStrictEqual([
        inGroup(0, 2, undefined),
        inGroup(2, 1, 2),
      ]);
    });

    test("an item that belongs to no language, or to one without a group, has no group", () => {
      expect(
        runsOf(createItems("unit/de.res", "unit/root.res", "units.res", "unit/fi.res"), classes, groupOfLanguage),
      ).toStrictEqual([inGroup(0, 1, 0), inGroup(1, 3, undefined)]);
    });

    test("without groups data leaves by feature only", () => {
      expect(runsOf(createItems("zone/de.res", "zone/nb.res", "zone/sv.res"), classes, undefined)).toStrictEqual([
        inGroup(0, 3, undefined),
      ]);
    });
  });

  describe("icuPackagesOf", () => {
    const packageStart = 0x400000;
    const data = packageOf([
      ["icudt99l/coll/de.res", 16],
      ["icudt99l/zone/de.res", 16],
      ["icudt99l/zoneinfo64.res", 16],
    ]);
    const collationRun = { firstItem: 0, itemCount: 1, features: [5], localeGroup: undefined, bytes: 16 };
    const zoneRun = { firstItem: 1, itemCount: 1, features: [6], localeGroup: undefined, bytes: 16 };
    const entrySymbol: [string, number] = ["icudt99_dat", packageStart];
    const hookSymbol: [string, number] = ["bun_icu_zstd_dict", 0x300000];
    const icuLines: IcuDataLine[] = [
      { itemClass: "collation", exceptWindows: false, byLocale: false, features: ["Collation"] },
      { itemClass: "zone", exceptWindows: true, byLocale: false, features: ["Zones"] },
    ];
    const icuLinesByLocale = icuLines.map(line => ({ ...line, byLocale: true }));

    const featureOf = (name: string, index: number): Feature => ({
      name,
      rustName: name,
      index,
      text: name,
      enteredFrom: "program",
      isEngine: true,
      minimumBytes: {},
      exports: false,
    });
    const modelOf = (icuData: IcuDataLine[], icuLanguageGroups: string[][] = []): FeatureModel => ({
      features: [featureOf("Collation", 5), featureOf("Zones", 6)],
      trimFeatures: [],
      icuData,
      icuLanguageGroups,
      hash: 0n,
    });
    const graphOf = (format: ObjectFormat, size = data.length) =>
      createLayout([[size, "retained", { output: ".rodata" }]], packageStart, format).graph;
    const linkedOf = (symbols: [string, number][], bytes = data): NamedBytes => ({
      symbols,
      image: {
        isArm64: false,
        bytes: (address, length) => bytes.subarray(address - packageStart, address - packageStart + length),
      },
    });

    test("a package has the runs of the classes the model names", () => {
      expect(icuPackagesOf(linkedOf([entrySymbol]), graphOf("elf"), modelOf(icuLines))).toEqual({
        packages: [{ start: packageStart, end: packageStart + data.length, items: 3, runs: [collationRun, zoneRun] }],
        languages: [],
      });
    });

    test("an except-windows line does not apply to COFF", () => {
      expect(icuPackagesOf(linkedOf([entrySymbol]), graphOf("coff"), modelOf(icuLines)).packages).toEqual([
        { start: packageStart, end: packageStart + data.length, items: 3, runs: [collationRun] },
      ]);
    });

    test("the next symbol in the node ends the package", () => {
      const end = packageStart + 16 * Math.ceil(data.length / 16);
      const bytes = Buffer.concat([data, Buffer.alloc(64, 0xcc)]);
      const linked = linkedOf([entrySymbol, ["after", end]], bytes);
      expect(icuPackagesOf(linked, graphOf("elf", bytes.length), modelOf(icuLines)).packages).toEqual([
        { start: packageStart, end, items: 3, runs: [collationRun, zoneRun] },
      ]);
    });

    test("no linked bytes or no ICU lines give no packages", () => {
      const nothing = { packages: [], languages: [] };
      expect(icuPackagesOf(undefined, graphOf("elf"), modelOf(icuLines))).toEqual(nothing);
      expect(icuPackagesOf(linkedOf([entrySymbol]), graphOf("elf"), modelOf([]))).toEqual(nothing);
    });

    test("with Bun's hook in ICU, the items of a class that is removed by locale get the group of their language", () => {
      const { packages, languages } = icuPackagesOf(
        linkedOf([entrySymbol, hookSymbol]),
        graphOf("elf"),
        modelOf(icuLinesByLocale, [["de", "nds"]]),
      );
      expect(languages).toEqual([
        { name: "de", group: 0 },
        { name: "nds", group: 0 },
      ]);
      expect(packages.map(({ runs }) => runs)).toEqual([
        [
          { ...collationRun, localeGroup: 0 },
          { ...zoneRun, localeGroup: 0 },
        ],
      ]);
    });

    test("only the languages of classes that are removed by locale are listed", () => {
      const lines = [icuLines[0]!, icuLinesByLocale[1]!];
      const elf = icuPackagesOf(linkedOf([entrySymbol, hookSymbol]), graphOf("elf"), modelOf(lines));
      expect(elf.languages).toEqual([{ name: "de", group: 0 }]);
      expect(elf.packages.map(({ runs }) => runs)).toEqual([[collationRun, { ...zoneRun, localeGroup: 0 }]]);
      expect(icuPackagesOf(linkedOf([entrySymbol, hookSymbol]), graphOf("coff"), modelOf(lines)).languages).toEqual([]);
      expect(icuPackagesOf(linkedOf([entrySymbol, hookSymbol]), graphOf("elf"), modelOf(icuLines)).languages).toEqual(
        [],
      );
    });

    test("without the hook a removed language would be a silent fallback, so there are no languages and no groups", () => {
      expect(
        icuPackagesOf(linkedOf([entrySymbol]), graphOf("elf"), modelOf(icuLinesByLocale, [["de", "nds"]])),
      ).toEqual({
        packages: [{ start: packageStart, end: packageStart + data.length, items: 3, runs: [collationRun, zoneRun] }],
        languages: [],
      });
    });

    test("an unknown class throws", () => {
      const lines = [{ itemClass: "no-such-class", exceptWindows: false, byLocale: false, features: ["Collation"] }];
      expect(() => icuPackagesOf(linkedOf([entrySymbol]), graphOf("elf"), modelOf(lines))).toThrow(BuildError);
    });

    test("a class on two lines throws", () => {
      const lines = [...icuLines, icuLines[0]!];
      expect(() => icuPackagesOf(linkedOf([entrySymbol]), graphOf("elf"), modelOf(lines))).toThrow(BuildError);
    });

    test("an entry symbol outside every node throws", () => {
      const linked = linkedOf([["icudt99_dat", 0x500000]]);
      expect(() => icuPackagesOf(linked, graphOf("elf"), modelOf(icuLines))).toThrow(BuildError);
    });
  });
});

describe("icu-locales", () => {
  test.each([
    ["de.res", "de"],
    ["fil.res", "fil"],
    ["zh_Hant_TW.res", "zh"],
    ["en_US_POSIX.res", "en"],
    ["es_419.res", "es"],
    ["coll/de.res", "de"],
    ["zone/sr_Latn.res", "sr"],
  ])("the language of %s is %s", (name, language) => {
    expect(languageOfIcuItem(name)).toBe(language);
  });

  test.each([
    "root.res",
    "pool.res",
    "res_index.res",
    "coll/res_index.res",
    "zone/tzdbNames.res",
    "units.res",
    "zoneinfo64.res",
    "de.brk",
    "brkitr/de.dict",
    "de",
    "DE.res",
    "d.res",
    "de-AT.res",
    "de_.res",
    "",
  ])("%j belongs to no language", name => {
    expect(languageOfIcuItem(name)).toBeUndefined();
  });

  test("each language gets a group of its own, numbered in the order of the names", () => {
    expect(groupLanguages(["sv", "de", "fi", "de"], [])).toEqual([
      { name: "de", group: 0 },
      { name: "fi", group: 1 },
      { name: "sv", group: 2 },
    ]);
    expect(groupLanguages([], [])).toEqual([]);
  });

  test("the languages of a line share the group of the first of them by name", () => {
    expect(
      groupLanguages(
        ["de", "nb", "no", "sv", "hr"],
        [
          ["sr", "hr"],
          ["no", "nb", "nn"],
        ],
      ),
    ).toEqual([
      { name: "de", group: 0 },
      { name: "hr", group: 1 },
      { name: "nb", group: 2 },
      { name: "nn", group: 2 },
      { name: "no", group: 2 },
      { name: "sr", group: 1 },
      { name: "sv", group: 3 },
    ]);
  });

  test("a language that only a line names is listed", () => {
    expect(groupLanguages([], [["no", "nb"]])).toEqual([
      { name: "nb", group: 0 },
      { name: "no", group: 0 },
    ]);
  });
});

describe("xxh3", () => {
  test("matches Bun.hash.xxHash3 at every length with a separate code path", () => {
    let seed = 12345;
    for (const length of [...Array(300).keys(), 511, 512, 513, 1023, 1024, 1025, 2047, 2048, 2049, 5000, 100000]) {
      const bytes = Buffer.alloc(length);
      for (let index = 0; index < length; index++)
        bytes[index] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
      expect({ length, hash: xxh3(bytes) }).toEqual({ length, hash: BigInt(Bun.hash.xxHash3(bytes)) });
    }
  });
});

describe("archives", () => {
  const latin1 = (text: string) => Buffer.from(text, "latin1");

  function archiveOf(members: [name: string, body: Buffer][]) {
    const chunks: Buffer[] = [latin1("!<arch>\n")];
    const headers: number[] = [];
    let at = 8;
    for (const [name, body] of members) {
      headers.push(at);
      chunks.push(latin1(name.padEnd(16) + " 0".repeat(16) + String(body.length).padEnd(10) + "`\n"), body);
      at += 60 + body.length;
      if (body.length % 2 === 1) {
        chunks.push(latin1("\n"));
        at++;
      }
    }
    return { bytes: Buffer.concat(chunks), headers };
  }

  function readMembers(bytes: Buffer) {
    using dir = tempDir("trim-archive", { "input.a": bytes });
    const path = join(String(dir), "input.a");
    return {
      members: readArchive(path),
      memberAt: (offset: number, size: number) => ({ archive: path, offset, size }),
    };
  }

  test("GNU: long names, and two members of one name in file order", () => {
    const { bytes, headers } = archiveOf([
      ["//", latin1("a_member_with_a_long_name.o/\n")],
      ["/0", Buffer.alloc(4)],
      ["short.o/", Buffer.alloc(5)],
      ["short.o/", Buffer.alloc(6)],
    ]);
    const { members, memberAt } = readMembers(bytes);
    expect(members).toEqual(
      new Map([
        ["a_member_with_a_long_name.o", [memberAt(headers[1]! + 60, 4)]],
        ["short.o", [memberAt(headers[2]! + 60, 5), memberAt(headers[3]! + 60, 6)]],
      ]),
    );
  });

  test("BSD: the name comes first in the member's bytes", () => {
    const name = latin1("bsd_member_name.o".padEnd(20, "\0"));
    const { bytes, headers } = archiveOf([
      ["#1/20", Buffer.concat([name, Buffer.alloc(7)])],
      ["plain.o", Buffer.alloc(2)],
    ]);
    const { members, memberAt } = readMembers(bytes);
    expect(members).toEqual(
      new Map([
        ["bsd_member_name.o", [memberAt(headers[0]! + 80, 7)]],
        ["plain.o", [memberAt(headers[1]! + 60, 2)]],
      ]),
    );
  });

  test("COFF: linker members have no entry, and a long name ends at NUL", () => {
    const { bytes, headers } = archiveOf([
      ["/", Buffer.alloc(8)],
      ["/", Buffer.alloc(8)],
      ["//", latin1("dir\\long_member_name.obj\0")],
      ["/0", Buffer.alloc(3)],
    ]);
    const { members, memberAt } = readMembers(bytes);
    expect(members).toEqual(new Map([["dir\\long_member_name.obj", [memberAt(headers[3]! + 60, 3)]]]));
  });

  test.each([
    ["other text", "not an archive\n"],
    ["a thin archive", "!<thin>\n"],
    ["a file shorter than the magic", "!<arch"],
  ])("%s has no members", (_label, text) => {
    expect(readMembers(latin1(text)).members).toEqual(new Map());
  });

  function expectArchiveError(bytes: Buffer) {
    using dir = tempDir("trim-archive", { "input.a": bytes });
    const path = join(String(dir), "input.a");
    let error: unknown;
    try {
      readArchive(path);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(BuildError);
    expect(error).toHaveProperty("file", path);
  }

  test.each(["plain.o/", "//"])("a %s member that runs past the end of the file throws", name => {
    const { bytes } = archiveOf([[name, Buffer.alloc(32)]]);
    expectArchiveError(bytes.subarray(0, bytes.length - 1));
  });

  test("a BSD name longer than its member throws", () => {
    expectArchiveError(archiveOf([["#1/40", Buffer.alloc(8)]]).bytes);
  });
});

describe("linked images", () => {
  const parts = [
    { start: 0x1000, end: 0x1010, offset: 0 },
    { start: 0x1010, end: 0x1020, offset: 16 },
  ];
  const fileBytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index));

  test("bytes are read by address, within one part", () => {
    using dir = tempDir("trim-image", { image: fileBytes });
    const image = imageOfParts(join(String(dir), "image"), parts, false);
    expect(image.isArm64).toBe(false);
    expect(image.bytes(0x1008, 8)).toEqual(fileBytes.subarray(8, 16));
    expect(image.bytes(0x1018, 8)).toEqual(fileBytes.subarray(24, 32));
  });

  test("a range outside one part has no bytes", () => {
    using dir = tempDir("trim-image", { image: fileBytes });
    const image = imageOfParts(join(String(dir), "image"), parts, false);
    expect(image.bytes(0x1008, 16)).toBeUndefined();
    expect(image.bytes(0xfff, 1)).toBeUndefined();
    expect(image.bytes(0x1020, 1)).toBeUndefined();
    expect(image.bytes(0x1010, 16)).toEqual(fileBytes.subarray(16, 32));
  });
});

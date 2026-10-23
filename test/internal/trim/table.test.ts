import { readTrimTable } from "bun:internal-for-testing";
import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { BuildError } from "../../../scripts/build/error.ts";
import { loadFeatures } from "../../../scripts/build/trim/features.ts";
import type { Partition } from "../../../scripts/build/trim/partition.ts";
import {
  assembleTable,
  encodeTable,
  roomFor,
  trimTableHeaderBytes,
  trimTableMagic,
  trimTableVersion,
  type TableParts,
  type TrimTable,
} from "../../../scripts/build/trim/table.ts";
import { edgeStrengths, type FeatureEdge } from "../../../scripts/build/trim/types.ts";

const root = join(import.meta.dir, "..", "..", "..");
const model = loadFeatures(root);

const small: TrimTable = {
  featuresHash: model.hash,
  baseAddress: 0x200000,
  edges: [
    { from: 0, to: 1, strength: "Reference", isFollowed: true },
    { from: 1, to: 128, strength: "AbortingGuard", isFollowed: true },
    { from: 128, to: 0, strength: "RecoverableGuard", isFollowed: false },
  ],
  sets: [[0], [0, 128], [1]],
  ranges: [
    { start: 0x204000, end: 0x208000, set: 0, isCode: true, canBeCut: true, canBeFilled: true },
    { start: 0x208000, end: 0x20c010, set: 1, isCode: true, canBeCut: true, canBeFilled: false },
    { start: 0x300000, end: 0x300020, set: 2, isCode: false, canBeCut: false, canBeFilled: true },
  ],
  icuPackages: [
    {
      start: 0x400000,
      end: 0x480010,
      runs: [
        { firstItem: 2, itemCount: 3, set: 0, localeGroup: undefined },
        { firstItem: 5, itemCount: 1, set: 1, localeGroup: 1 },
      ],
    },
  ],
  icuLanguages: [
    { name: "de", group: 0 },
    { name: "fil", group: 1 },
  ],
  moduleTexts: [],
};

const withModuleTexts: TrimTable = {
  ...small,
  moduleTexts: [
    { start: 0x500000, end: 0x500040, module: 7, set: 1, readers: 0, canBeCut: true, canBeFilled: true },
    { start: 0x500040, end: 0x500050, module: 3, set: 2, readers: undefined, canBeCut: false, canBeFilled: true },
  ],
};

const empty: TrimTable = {
  featuresHash: model.hash,
  baseAddress: 0,
  edges: [],
  sets: [],
  ranges: [],
  icuPackages: [],
  icuLanguages: [],
  moduleTexts: [],
};

function large(): TrimTable {
  let seed = 1;
  const below = (limit: number) => (seed = (seed * 48271) % 2147483647) % limit;
  const distinctAscending = (count: number, next: () => number) =>
    [...new Set(Array.from({ length: count }, next))].sort((a, b) => a - b);
  const featureIndexes = model.features.map(feature => feature.index);
  const anyFeature = () => featureIndexes[below(featureIndexes.length)]!;
  const setCount = 200;
  const anySet = () => below(setCount);

  const sets = new Map<string, number[]>();
  while (sets.size < setCount) {
    const members = distinctAscending(1 + below(4), anyFeature);
    sets.set(members.join(), members);
  }

  const edges = new Map<string, FeatureEdge>();
  while (edges.size < 40) {
    const [from, to] = [anyFeature(), anyFeature()];
    const strength = edgeStrengths[below(edgeStrengths.length)]!;
    if (from !== to)
      edges.set(`${from},${to}`, { from, to, strength, isFollowed: strength === "Reference" || below(2) === 0 });
  }

  const letter = () => String.fromCharCode(97 + below(26));
  const languageNames = new Set(
    Array.from({ length: 60 }, () => letter() + letter() + (below(3) === 0 ? letter() : "")),
  );
  const groupCount = 25;
  const icuLanguages = [...languageNames]
    .sort()
    .map((name, index) => ({ name, group: index < groupCount ? index : below(groupCount) }));

  let end = 0x200000;
  const ranges = Array.from({ length: 3000 }, () => {
    const start = end + (below(4) === 0 ? 16 * (1 + below(1024)) : 0);
    end = start + 8 * (1 + below(16384));
    const canBeCut = below(2) === 0;
    return { start, end, set: anySet(), isCode: below(2) === 0, canBeCut, canBeFilled: !canBeCut || below(2) === 0 };
  });

  const icuPackages = Array.from({ length: 2 }, () => {
    const start = end + 0x10000;
    end = start + 0x100000;
    let nextItem = 0;
    const runs = Array.from({ length: 50 }, () => {
      const firstItem = nextItem + below(3);
      const itemCount = 1 + below(20);
      nextItem = firstItem + itemCount;
      return { firstItem, itemCount, set: anySet(), localeGroup: below(3) === 0 ? undefined : below(groupCount) };
    });
    return { start, end, runs };
  });

  const setList = [...sets.values()];
  const properSubsetOf = (set: number) =>
    setList.findIndex((members, other) => other !== set && members.every(member => setList[set]!.includes(member)));
  end += 0x10000;
  const moduleTexts = Array.from({ length: 200 }, (_, index) => {
    const start = end + (below(8) === 0 ? 1 + below(64) : 0);
    end = start + 1 + below(100000);
    const set = anySet();
    const readers = properSubsetOf(set);
    const canBeCut = below(2) === 0;
    return {
      start,
      end,
      module: (index * 7) % 200,
      set,
      readers: readers < 0 ? undefined : readers,
      canBeCut,
      canBeFilled: !canBeCut || below(2) === 0,
    };
  });

  return {
    featuresHash: model.hash,
    baseAddress: 0x200000,
    edges: [...edges.values()].sort((a, b) => a.from - b.from || a.to - b.to),
    sets: setList,
    ranges,
    icuPackages,
    icuLanguages,
    moduleTexts,
  };
}

const tables: [name: string, table: TrimTable][] = [
  ["small", small],
  ["small with module texts", withModuleTexts],
  ["empty", empty],
  ["large", large()],
];

const inRoom = (bytes: Buffer) => Buffer.concat([bytes, Buffer.alloc(roomFor(bytes.length) - bytes.length)]);
const directoryOf = (bytes: Buffer) =>
  Array.from({ length: 8 }, (_, index) => [bytes.readUInt32LE(32 + index * 8), bytes.readUInt32LE(36 + index * 8)]);

function elfWith(section: Buffer | undefined): Buffer {
  const contents = section ?? Buffer.alloc(0);
  const names = section ? "\0.bun_trim\0.shstrtab\0" : "\0.other\0\0\0\0.shstrtab\0";
  const sectionHeaders = Math.ceil((128 + contents.length) / 8) * 8;
  const file = Buffer.alloc(sectionHeaders + 3 * 64);
  file.write("\x7fELF", 0, "latin1");
  file.set([2, 1, 1], 4);
  file.writeUInt16LE(2, 16);
  file.writeUInt16LE(62, 18);
  file.writeUInt32LE(1, 20);
  file.writeBigUInt64LE(BigInt(sectionHeaders), 40);
  file.writeUInt16LE(64, 52);
  file.writeUInt16LE(64, 58);
  file.writeUInt16LE(3, 60);
  file.writeUInt16LE(2, 62);
  file.write(names, 64, "latin1");
  contents.copy(file, 128);

  const tableHeader = sectionHeaders + 64;
  file.writeUInt32LE(1, tableHeader);
  file.writeUInt32LE(1, tableHeader + 4);
  file.writeBigUInt64LE(2n, tableHeader + 8);
  file.writeBigUInt64LE(0x10000n, tableHeader + 16);
  file.writeBigUInt64LE(128n, tableHeader + 24);
  file.writeBigUInt64LE(BigInt(contents.length), tableHeader + 32);
  file.writeBigUInt64LE(8n, tableHeader + 48);

  const namesHeader = sectionHeaders + 128;
  file.writeUInt32LE(11, namesHeader);
  file.writeUInt32LE(3, namesHeader + 4);
  file.writeBigUInt64LE(64n, namesHeader + 24);
  file.writeBigUInt64LE(21n, namesHeader + 32);
  return file;
}

const dir = tempDir("trim-table", {});
afterAll(() => dir[Symbol.dispose]());
const path = join(String(dir), "executable");
const read = (bytes: Buffer) => {
  writeFileSync(path, bytes);
  return readTrimTable(path);
};

describe("encodeTable", () => {
  test("byte layout of the small table", () => {
    expect([trimTableMagic, trimTableVersion, trimTableHeaderBytes]).toEqual(["BUNTRIM\0", 4, 96]);
    const bytes = encodeTable(small);
    expect(bytes.length).toBe(240);
    expect(bytes.readUInt32LE(12)).toBe(240);
    expect(bytes.toString("latin1", 0, 8)).toBe("BUNTRIM\0");
    expect(bytes.readUInt32LE(8)).toBe(4);
    expect(bytes.readBigUInt64LE(16)).toBe(model.hash);
    expect(bytes.readBigUInt64LE(24)).toBe(0x200000n);
    expect(directoryOf(bytes)).toEqual([
      [96, 3],
      [116, 3],
      [140, 4],
      [148, 3],
      [184, 1],
      [200, 2],
      [224, 2],
      [240, 0],
    ]);
    expect(bytes.toString("hex", 96, 116)).toBe("000001000001" + "010080000101" + "800000000200" + "0000");
    expect(bytes.toString("hex", 148, 160)).toBe("004000000040000000000101");
    expect([bytes[159], bytes[171], bytes[183]]).toEqual([1, 2, 0]);
    expect(bytes.toString("hex", 200, 224)).toBe("020000000300000000000000" + "050000000100000001000200");
    expect(bytes.toString("hex", 224, 240)).toBe("6465000000000000" + "66696c0001000000");
  });

  test("byte layout of the module texts", () => {
    const bytes = encodeTable(withModuleTexts);
    expect(bytes.length).toBe(272);
    expect(directoryOf(bytes).at(-1)).toEqual([240, 2]);
    expect(bytes.subarray(96, 240).equals(encodeTable(small).subarray(96, 240))).toBe(true);
    expect(bytes.toString("hex", 240, 256)).toBe("00003000" + "40000000" + "0700" + "0100" + "0100" + "01" + "00");
    expect(bytes.toString("hex", 256, 272)).toBe("40003000" + "10000000" + "0300" + "0200" + "0000" + "00" + "00");
  });

  test("the empty table is a header with eight empty sections", () => {
    const bytes = encodeTable(empty);
    expect(bytes.length).toBe(96);
    expect(directoryOf(bytes)).toEqual(Array.from({ length: 8 }, () => [96, 0]));
  });

  test("roomFor adds one sixteenth and rounds up to whole kilobytes", () => {
    expect([0, 1, 960, 964, 33378].map(roomFor)).toEqual([0, 1024, 1024, 2048, 35840]);
    for (const bytes of [1, 1000, 20390, 33378, 100000]) {
      expect(roomFor(bytes)).toBeGreaterThanOrEqual((bytes * 17) / 16);
      expect(roomFor(bytes) - (bytes * 17) / 16).toBeLessThan(1024);
    }
  });

  const withRange = (start: number, end: number): TrimTable => ({
    ...empty,
    baseAddress: 0x200000,
    sets: [[0]],
    ranges: [{ start, end, set: 0, isCode: true, canBeCut: true, canBeFilled: true }],
  });
  const indexPairs = Array.from({ length: 363 }, (_, first) =>
    Array.from({ length: 362 - first }, (_, offset) => [first, first + 1 + offset]),
  ).flat();

  test.each<[string, TrimTable]>([
    ["a range that ends 2^32 past the base address", withRange(0x200000, 0x200000 + 2 ** 32)],
    ["65,536 feature sets", { ...small, sets: indexPairs.slice(0, 65536) }],
  ])("encodeTable throws on %s", (_name, table) => {
    expect(() => encodeTable(table)).toThrow(BuildError);
  });

  test.each<[string, TrimTable]>([
    ["a range that ends 2^32 - 1 past the base address", withRange(0x200000, 0x200000 + 2 ** 32 - 1)],
    ["65,535 feature sets", { ...small, sets: indexPairs.slice(0, 65535) }],
    ["feature index 511", { ...small, sets: [[0], [0, 511], [1]] }],
    ["an edge to feature index 511", { ...small, edges: [{ ...small.edges[0]!, to: 511 }] }],
    ["locale group 65,534", { ...small, icuLanguages: [...small.icuLanguages, { name: "sv", group: 65534 }] }],
    [
      "a language whose group no run has",
      { ...small, icuLanguages: [...small.icuLanguages, { name: "sv", group: 2 }] },
    ],
    ["two languages in one group", { ...small, icuLanguages: [...small.icuLanguages, { name: "sv", group: 1 }] }],
  ])("encodeTable accepts %s", (_name, table) => {
    expect(() => encodeTable(table)).not.toThrow();
  });
});

describe("assembleTable", () => {
  const edges: FeatureEdge[] = [{ from: 0, to: 1, strength: "AbortingGuard", isFollowed: false }];
  const partition = { sets: [[], [2], [0], [0, 128]], edges } as Partition;
  const parts: TableParts = {
    featuresHash: model.hash,
    partition,
    ranges: [
      { start: 0x210040, end: 0x210080, set: 3, isCode: true, canBeCut: true, canBeFilled: true },
      { start: 0x230000, end: 0x230040, set: 2, isCode: false, canBeCut: false, canBeFilled: true },
    ],
    icuPackages: [
      {
        start: 0x240000,
        end: 0x250000,
        items: 2,
        runs: [
          { firstItem: 0, itemCount: 1, features: [0], localeGroup: undefined, bytes: 16 },
          { firstItem: 1, itemCount: 1, features: [1], localeGroup: 0, bytes: 16 },
        ],
      },
    ],
    icuLanguages: [{ name: "de", group: 0 }],
    moduleTexts: [],
  };

  test("numbers feature sets by first use: ranges, ICU runs", () => {
    const table = assembleTable(parts);
    expect(table.featuresHash).toBe(model.hash);
    expect(table.sets).toEqual([[0, 128], [0], [1]]);
    expect(table.ranges.map(range => range.set)).toEqual([0, 1]);
    expect(table.icuPackages).toEqual([
      {
        start: 0x240000,
        end: 0x250000,
        runs: [
          { firstItem: 0, itemCount: 1, set: 1, localeGroup: undefined },
          { firstItem: 1, itemCount: 1, set: 2, localeGroup: 0 },
        ],
      },
    ]);
    expect(table.icuLanguages).toEqual([{ name: "de", group: 0 }]);
    expect(table.edges).toEqual(edges);
    expect(table.baseAddress).toBe(0x210000);
  });

  test("a range never overlaps an ICU package", () => {
    const across = { start: 0x230000, end: 0x260000, set: 2, isCode: false, canBeCut: true, canBeFilled: false };
    expect(assembleTable({ ...parts, ranges: [across] }).ranges).toEqual([
      { ...across, end: 0x240000, set: 0 },
      { ...across, start: 0x250000, set: 0 },
    ]);
    const inside = { ...across, start: 0x241000, end: 0x242000 };
    const table = assembleTable({ ...parts, ranges: [inside] });
    expect(table.ranges).toEqual([]);
    expect(table.baseAddress).toBe(0x240000);
  });

  test("a range never overlaps a module text, and the readers are a set of their own", () => {
    const across = { start: 0x230000, end: 0x230100, set: 3, isCode: false, canBeCut: true, canBeFilled: true };
    const text = { set: 3, readers: [128], canBeCut: true, canBeFilled: true };
    const moduleTexts = [
      { ...text, start: 0x230060, end: 0x230080, module: 1, readers: [] },
      { ...text, start: 0x230040, end: 0x230060, module: 0 },
    ];
    const table = assembleTable({ ...parts, ranges: [across], icuPackages: [], moduleTexts });
    expect(table.sets).toEqual([[0, 128], [128]]);
    expect(table.ranges).toEqual([
      { ...across, end: 0x230040, set: 0 },
      { ...across, start: 0x230080, set: 0 },
    ]);
    expect(table.moduleTexts).toEqual([
      { start: 0x230040, end: 0x230060, module: 0, set: 0, readers: 1, canBeCut: true, canBeFilled: true },
      { start: 0x230060, end: 0x230080, module: 1, set: 0, readers: undefined, canBeCut: true, canBeFilled: true },
    ]);
  });

  test("a module text alone sets the base address", () => {
    const moduleTexts = [
      { start: 0x345678, end: 0x345688, module: 0, set: 3, readers: [0], canBeCut: false, canBeFilled: true },
    ];
    expect(assembleTable({ ...parts, ranges: [], icuPackages: [], moduleTexts }).baseAddress).toBe(0x340000);
  });

  test("the base address is 0 without ranges and ICU packages", () => {
    expect(assembleTable({ ...parts, ranges: [], icuPackages: [] }).baseAddress).toBe(0);
  });

  test("throws on a range with the empty feature set", () => {
    const ranges = [{ start: 0x210040, end: 0x210080, set: 0, isCode: true, canBeCut: true, canBeFilled: true }];
    expect(() => assembleTable({ ...parts, ranges })).toThrow(BuildError);
  });
});

describe("readTrimTable", () => {
  test.each(tables)("reads the %s table that encodeTable wrote", (_name, table) => {
    expect(read(elfWith(inRoom(encodeTable(table))))).toEqual(table);
  });

  test("an executable without the section, or with a section no link filled, has no table", () => {
    expect(() => read(elfWith(undefined))).toThrow("(NoTrimTable)");
    expect(() => read(elfWith(Buffer.alloc(4096)))).toThrow("(NoTrimTable)");
  });

  test("a file that is not an executable is unrecognized", () => {
    expect(() => read(Buffer.from("not an executable"))).toThrow("(UnrecognizedExecutable)");
  });

  test("the section of a trimmed executable is reported as AlreadyTrimmed", () => {
    const bytes = Buffer.concat([Buffer.from("BUNTRMD\0", "latin1"), Buffer.alloc(8)]);
    expect(() => read(elfWith(bytes))).toThrow("(AlreadyTrimmed)");
  });

  test("a table of another feature list is unusable by this Bun", () => {
    const bytes = encodeTable({ ...small, featuresHash: model.hash ^ 1n });
    expect(() => read(elfWith(bytes))).toThrow("(FeatureListMismatch)");
  });

  test.each([3, 5])("a table of version %d is unusable by this Bun", version => {
    const bytes = encodeTable(small);
    bytes.writeUInt32LE(version, 8);
    expect(() => read(elfWith(bytes))).toThrow("(FeatureListMismatch)");
  });

  test("the reader rejects an undeclared feature index in a set", () => {
    const bytes = encodeTable(small);
    bytes.writeUInt16LE(127, 144);
    expect(() => read(elfWith(bytes))).toThrow("(MalformedTable)");
  });

  test("the reader rejects an undeclared feature index in an edge", () => {
    const bytes = encodeTable(small);
    bytes.writeUInt16LE(127, 104);
    expect(() => read(elfWith(bytes))).toThrow("(MalformedTable)");
  });
});

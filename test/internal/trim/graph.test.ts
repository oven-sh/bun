import { describe, expect, test } from "bun:test";

import { BuildError } from "../../../scripts/build/error.ts";
import {
  findCFunctionEntryPoints,
  findCxxFunctionEntryPoints,
  findStaticTableEntryPoints,
  mergeEntryPoints,
  onlyReturns,
  readEntryPoints,
  recordBytes,
  stubKinds,
  unqualifiedFunctionName,
} from "../../../scripts/build/trim/entry-points.ts";
import type { Feature, FeatureModel } from "../../../scripts/build/trim/features.ts";
import {
  chainTo,
  createSectionGraph,
  featureIndexLimit,
  findEdge,
  nodeAt,
  propagateFeatureSets,
  reach,
  reverseEdges,
  shortestChains,
  type Edges,
  type GraphReading,
  type ObjectFormat,
  type RecordSection,
  type SectionGraph,
  type SectionGraphParts,
} from "../../../scripts/build/trim/graph.ts";
import { partition } from "../../../scripts/build/trim/partition.ts";
import { Demangler } from "../../../scripts/build/trim/report.ts";
import {
  EdgeKind,
  guardOrigins,
  type BuiltinEntry,
  type BuiltinKind,
  type EntryPoint,
} from "../../../scripts/build/trim/types.ts";

type Edge = [from: number, to: number];

function partsOf(successors: number[][]): SectionGraphParts {
  return {
    format: "elf",
    isArm64: false,
    placedCount: successors.length,
    address: successors.map((_, node) => 0x1000 + 0x10 * node),
    size: successors.map(() => 0x10),
    alignment: successors.map(() => 16),
    output: successors.map(() => ".text"),
    object: successors.map(() => "toy.o"),
    section: successors.map((_, node) => `.text.f${node}`),
    successors: successors.map(targets => new Set(targets)),
    roots: new Set(),
    exported: new Set(),
    liveWithoutReference: new Set(),
    names: successors.map((_, node) => [`f${node}`]),
    aliases: new Map(),
    externalNames: new Set(),
    stringHash: new Map(),
  };
}

const graphOf = (successors: number[][]): SectionGraph => createSectionGraph(partsOf(successors));

function skipping(graph: SectionGraph, ...edges: Edge[]): Uint8Array {
  const skippedEdges = new Uint8Array(graph.successors.length);
  for (const [from, to] of edges) {
    const edge = findEdge(graph, from, to);
    expect(edge).toBeGreaterThanOrEqual(0);
    skippedEdges[edge] = 1;
  }
  return skippedEdges;
}

function flagging(graph: SectionGraph, ...nodes: number[]): Uint8Array {
  const flags = new Uint8Array(graph.count);
  for (const node of nodes) flags[node] = 1;
  return flags;
}

function cycleOf(length: number): SectionGraph {
  const text = new Array<string>(length).fill("");
  const ones = new Array<number>(length).fill(1);
  return createSectionGraph({
    ...partsOf([]),
    placedCount: length,
    address: Array.from({ length }, (_, node) => node),
    size: ones,
    alignment: ones,
    output: text,
    object: text,
    section: text,
    successors: Array.from({ length }, (_, node) => new Set([(node + 1) % length])),
    names: new Array<string[]>(length).fill([]),
  });
}

describe("createSectionGraph", () => {
  test("packs successor lists in ascending order, without self edges or repeats", () => {
    const graph = graphOf([[2, 0, 1, 2], [], [1, 0]]);
    expect(graph.count).toBe(3);
    expect([...graph.successorStart]).toEqual([0, 2, 2, 4]);
    expect([...graph.successors]).toEqual([1, 2, 0, 1]);
  });

  test("sorts successors as numbers", () => {
    const graph = graphOf([[10, 9, 2, 11], ...Array.from({ length: 11 }, () => [])]);
    expect([...graph.successors]).toEqual([2, 9, 10, 11]);
  });

  test("turns the three node sets into bytes and shares everything it does not pack", () => {
    const parts: SectionGraphParts = {
      ...partsOf([[], [], []]),
      format: "macho",
      isArm64: true,
      roots: new Set([0]),
      exported: new Set([1, 2]),
      liveWithoutReference: new Set([2]),
      aliases: new Map([[1, [["other.o", "g"]]]]),
      externalNames: new Set(["f1"]),
      stringHash: new Map([[2, 7]]),
    };
    const graph = createSectionGraph(parts);
    expect(graph.format).toBe("macho");
    expect(graph.isArm64).toBe(true);
    expect([...graph.isRoot]).toEqual([1, 0, 0]);
    expect([...graph.isExported]).toEqual([0, 1, 1]);
    expect([...graph.isLiveWithoutReference]).toEqual([0, 0, 1]);
    expect([...graph.address]).toEqual(parts.address);
    expect([...graph.size]).toEqual(parts.size);
    expect([...graph.alignment]).toEqual(parts.alignment);
    for (const shared of ["output", "object", "section", "names", "aliases", "externalNames", "stringHash"] as const) {
      expect(graph[shared]).toBe(parts[shared]);
    }
  });

  test("an address above 32 bits survives", () => {
    const parts = partsOf([[]]);
    parts.address[0] = 0x1_4000_1000;
    expect(createSectionGraph(parts).address[0]).toBe(0x1_4000_1000);
  });

  test("an empty section may share its address with the section after it", () => {
    const parts = partsOf([[], []]);
    parts.size[0] = 0;
    parts.address[1] = parts.address[0]!;
    expect(nodeAt(createSectionGraph(parts), parts.address[0]!)).toBe(1);
  });

  test("the error for sections out of order names both", () => {
    const parts = partsOf([[], []]);
    parts.address.reverse();
    expect(() => createSectionGraph(parts)).toThrow(
      "nodes are not sorted by address: toy.o:(.text.f0) at 0x1010, 16 bytes, then toy.o:(.text.f1) at 0x1000, 16 bytes",
    );
  });

  test("a graph without nodes", () => {
    const graph = graphOf([]);
    expect(graph.count).toBe(0);
    expect([...graph.successorStart]).toEqual([0]);
    expect(reach(graph, []).length).toBe(0);
    expect(propagateFeatureSets(graph, new Map(), new Uint8Array(0), new Uint8Array(0)).sets).toEqual([[]]);
  });

  test.each<[string, (parts: SectionGraphParts) => unknown]>([
    ["a successor out of range", parts => parts.successors[0]!.add(3)],
    ["a negative successor", parts => parts.successors[0]!.add(-1)],
    ["a fractional successor", parts => parts.successors[0]!.add(1.5)],
    ["a root out of range", parts => parts.roots.add(3)],
    ["an exported node out of range", parts => parts.exported.add(3)],
    ["a node live without reference out of range", parts => parts.liveWithoutReference.add(3)],
    ["descending addresses", parts => parts.address.reverse()],
    ["two sections with bytes at one address", parts => (parts.address[1] = parts.address[0]!)],
    [
      "an empty section at the address of the section before it",
      parts => {
        parts.address[1] = parts.address[0]!;
        parts.size[1] = 0;
      },
    ],
    ["a placed node without an address", parts => (parts.address[0] = -1)],
    ["a per-node array that is too short", parts => parts.names.pop()],
    ["a per-node array that is too long", parts => parts.size.push(0)],
    ["more placed nodes than nodes", parts => (parts.placedCount = 4)],
    ["an unplaced node with an address", parts => (parts.placedCount = 2)],
  ])("%s throws", (_, damage) => {
    const parts = partsOf([[1], [2], []]);
    expect(() => createSectionGraph(parts)).not.toThrow();
    damage(parts);
    expect(() => createSectionGraph(parts)).toThrow(BuildError);
  });
});

describe("reach", () => {
  const graph = graphOf([[1, 3], [2], [], [], [2]]);

  test("marks the start nodes and everything their edges lead to", () => {
    expect([...reach(graph, [0])]).toEqual([1, 1, 1, 1, 0]);
    expect([...reach(graph, new Set([4, 3]))]).toEqual([0, 0, 1, 1, 1]);
    expect([...reach(graph, [])]).toEqual([0, 0, 0, 0, 0]);
  });

  test("does not follow a skipped edge", () => {
    expect([...reach(graph, [0], skipping(graph, [1, 2]))]).toEqual([1, 1, 0, 1, 0]);
    expect([...reach(graph, [0], skipping(graph, [0, 1], [0, 3]))]).toEqual([1, 0, 0, 0, 0]);
  });

  test("any byte other than 0 skips the edge", () => {
    const skippedEdges = skipping(graph, [1, 2]).map(byte => byte * 2);
    expect([...reach(graph, [0], skippedEdges)]).toEqual([1, 1, 0, 1, 0]);
  });

  test("a skipped edge does not hide a node another edge leads to", () => {
    const diamond = graphOf([[1, 2], [3], [3], []]);
    expect([...reach(diamond, [0], skipping(diamond, [1, 3]))]).toEqual([1, 1, 1, 1]);
  });

  test("terminates on a cycle", () => {
    expect([...reach(graphOf([[1], [0], [0]]), [1])]).toEqual([1, 1, 0]);
  });

  test("a start node out of range and a byte array of the wrong length throw", () => {
    expect(() => reach(graph, [5])).toThrow(BuildError);
    expect(() => reach(graph, [0], new Uint8Array(graph.successors.length + 1))).toThrow(BuildError);
  });
});

describe("propagateFeatureSets", () => {
  interface Limits {
    skipped?: Edge[];
    excluded?: number[];
  }

  const propagate = (graph: SectionGraph, seeds: [node: number, features: number[]][], limits: Limits = {}) =>
    propagateFeatureSets(
      graph,
      new Map(seeds),
      skipping(graph, ...(limits.skipped ?? [])),
      flagging(graph, ...(limits.excluded ?? [])),
    );

  function featuresOf(graph: SectionGraph, seeds: [node: number, features: number[]][], limits?: Limits): number[][] {
    const { setOf, sets } = propagate(graph, seeds, limits);
    return Array.from(setOf, set => sets[set]!);
  }

  const cycle = [[1], [2], [0]];

  test("a diamond gives its last node the union", () => {
    const diamond = graphOf([[1, 2], [3], [3], []]);
    expect(
      featuresOf(diamond, [
        [1, [1]],
        [2, [2]],
      ]),
    ).toEqual([[], [1], [2], [1, 2]]);
  });

  test("a feature does not flow against an edge", () => {
    expect(featuresOf(graphOf([[1], [2], []]), [[1, [4]]])).toEqual([[], [4], [4]]);
  });

  test("a cycle of three nodes gets one set", () => {
    const { setOf, sets } = propagate(graphOf([...cycle, [0]]), [[1, [7]]]);
    expect([...setOf]).toEqual([1, 1, 1, 0]);
    expect(sets).toEqual([[], [7]]);
  });

  test("two seeds in one cycle reach every node of it", () => {
    expect(
      featuresOf(graphOf(cycle), [
        [0, [1]],
        [2, [2]],
      ]),
    ).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
  });

  test("a cycle passes on what enters it", () => {
    expect(featuresOf(graphOf([[1], [2], [3], [1, 4], []]), [[0, [9]]])).toEqual([[9], [9], [9], [9], [9]]);
  });

  test("a skipped edge stops a feature", () => {
    expect(featuresOf(graphOf([[1], [2], []]), [[0, [3]]], { skipped: [[1, 2]] })).toEqual([[3], [3], []]);
  });

  test("a skipped edge does not close a cycle", () => {
    expect(featuresOf(graphOf(cycle), [[1, [3]]], { skipped: [[2, 0]] })).toEqual([[], [3], [3]]);
  });

  test("an excluded node has set 0 and nothing passes through it", () => {
    const { setOf, sets } = propagate(graphOf([[1], [2], []]), [[0, [3]]], { excluded: [1] });
    expect([...setOf]).toEqual([1, 0, 0]);
    expect(sets).toEqual([[], [3]]);
  });

  test("a feature passes around an excluded node", () => {
    expect(featuresOf(graphOf([[1, 3], [2], [], [2]]), [[0, [3]]], { excluded: [1] })).toEqual([[3], [], [3], [3]]);
  });

  test("an excluded node does not close a cycle", () => {
    expect(featuresOf(graphOf(cycle), [[0, [3]]], { excluded: [2] })).toEqual([[3], [3], []]);
  });

  test("an excluded seed spreads nothing", () => {
    const { setOf, sets } = propagate(graphOf([[1], []]), [[0, [1]]], { excluded: [0] });
    expect([...setOf]).toEqual([0, 0]);
    expect(sets).toEqual([[]]);
  });

  test("features 0, 31, 32 and 511 come back in ascending order", () => {
    expect(featuresOf(graphOf([[1], []]), [[0, [511, 32, 0, 31]]])).toEqual([
      [0, 31, 32, 511],
      [0, 31, 32, 511],
    ]);
  });

  test("every feature index comes back as itself", () => {
    const all = Array.from({ length: featureIndexLimit }, (_, feature) => feature);
    expect(featuresOf(graphOf([[]]), [[0, all]])).toEqual([all]);
  });

  test("sets are numbered by the first node that has them, regardless of seed order", () => {
    const { setOf, sets } = propagate(graphOf([[], [], [], [], [0]]), [
      [3, [9]],
      [2, [4]],
      [0, [9]],
    ]);
    expect([...setOf]).toEqual([1, 0, 2, 1, 0]);
    expect(sets).toEqual([[], [9], [4]]);
  });

  test("a feature index out of range throws, even on an excluded seed", () => {
    const graph = graphOf([[]]);
    expect(featureIndexLimit).toBe(512);
    expect(() => propagate(graph, [[0, [featureIndexLimit]]])).toThrow(BuildError);
    expect(() => propagate(graph, [[0, [-1]]])).toThrow(BuildError);
    expect(() => propagate(graph, [[0, [1.5]]])).toThrow(BuildError);
    expect(() => propagate(graph, [[0, [featureIndexLimit]]], { excluded: [0] })).toThrow(BuildError);
  });

  test("a seed out of range and byte arrays of the wrong length throw", () => {
    const graph = graphOf([[1], []]);
    expect(() => propagate(graph, [[2, [0]]])).toThrow(BuildError);
    expect(() => propagateFeatureSets(graph, new Map(), new Uint8Array(2), new Uint8Array(2))).toThrow(BuildError);
    expect(() => propagateFeatureSets(graph, new Map(), new Uint8Array(1), new Uint8Array(1))).toThrow(BuildError);
  });

  test("agrees with one search per feature on a pseudorandom graph", () => {
    let state = 12345;
    const below = (limit: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state >>> 8) % limit;
    };
    const count = 400;
    const graph = graphOf(Array.from({ length: count }, () => Array.from({ length: below(5) }, () => below(count))));
    const skippedEdges = Uint8Array.from(graph.successors, () => (below(10) === 0 ? 1 : 0));
    const isExcluded = Uint8Array.from({ length: count }, (_, node) => (node > 0 && below(10) === 0 ? 1 : 0));
    const features = [0, 1, 31, 32, 63, 64, 200, 511];
    const seeds = new Map([[0, [511]]]);
    for (let seed = 0; seed < 30; seed++) seeds.set(1 + below(count - 1), [features[below(8)]!, features[below(8)]!]);

    const blockedEdges = skippedEdges.map((byte, edge) => byte | isExcluded[graph.successors[edge]!]!);
    const expected: number[][] = Array.from({ length: count }, () => []);
    for (const feature of features) {
      const starts = [...seeds].flatMap(([node, list]) => (list.includes(feature) && !isExcluded[node] ? [node] : []));
      reach(graph, starts, blockedEdges).forEach((isReached, node) => {
        if (isReached) expected[node]!.push(feature);
      });
    }

    const { setOf, sets } = propagateFeatureSets(graph, seeds, skippedEdges, isExcluded);
    expect(Array.from(setOf, set => sets[set]!)).toEqual(expected);
    expect(new Set(sets.map(String)).size).toBe(sets.length);
    expect(sets[setOf[0]!]).toContain(511);
  });
});

describe("reverseEdges", () => {
  const listsOf = ({ count, successorStart, successors }: Edges) =>
    Array.from({ length: count }, (_, node) => [
      ...successors.subarray(successorStart[node]!, successorStart[node + 1]!),
    ]);
  const nothingSkipped = (graph: Edges) => new Uint8Array(graph.successors.length);

  test("turns every edge around", () => {
    const graph = graphOf([[1, 2], [2], [0], []]);
    expect(listsOf(reverseEdges(graph, nothingSkipped(graph)))).toEqual([[2], [0], [0, 1], []]);
  });

  test("each list ascends", () => {
    const graph = graphOf([[3], [3], [3], [], [3]]);
    expect(listsOf(reverseEdges(graph, nothingSkipped(graph)))).toEqual([[], [], [], [0, 1, 2, 4], []]);
  });

  test("leaves out a skipped edge, whatever byte other than 0 marks it", () => {
    const graph = graphOf([[1, 2], [2], []]);
    const skippedEdges = skipping(graph, [0, 2]);
    expect(listsOf(reverseEdges(graph, skippedEdges))).toEqual([[], [0], [1]]);
    expect(
      listsOf(
        reverseEdges(
          graph,
          skippedEdges.map(byte => byte * 3),
        ),
      ),
    ).toEqual([[], [0], [1]]);
  });

  test("reversed twice is the graph again", () => {
    const graph = graphOf([[1, 3], [2], [0, 3], []]);
    const reversed = reverseEdges(graph, nothingSkipped(graph));
    expect(listsOf(reverseEdges(reversed, nothingSkipped(reversed)))).toEqual(listsOf(graph));
  });

  test("a graph without nodes, and one without edges", () => {
    expect(listsOf(reverseEdges(graphOf([]), new Uint8Array(0)))).toEqual([]);
    expect(listsOf(reverseEdges(graphOf([[], []]), new Uint8Array(0)))).toEqual([[], []]);
  });

  test("a byte array of the wrong length throws", () => {
    expect(() => reverseEdges(graphOf([[1], []]), new Uint8Array(2))).toThrow(BuildError);
  });

  test("backward propagation agrees with one forward search per node on a pseudorandom graph", () => {
    let state = 54321;
    const below = (limit: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state >>> 8) % limit;
    };
    const count = 300;
    const graph = graphOf(Array.from({ length: count }, () => Array.from({ length: below(4) }, () => below(count))));
    const skippedEdges = Uint8Array.from(graph.successors, () => (below(8) === 0 ? 1 : 0));
    const features = [0, 31, 32, 200, 511];
    const seeds = new Map<number, number[]>();
    for (let seed = 0; seed < 25; seed++) seeds.set(below(count), [features[below(5)]!]);

    const expected = Array.from({ length: count }, (_, node) => {
      const isReached = reach(graph, [node], skippedEdges);
      const reachedFeatures = [...seeds].flatMap(([seed, list]) => (isReached[seed] ? list : []));
      return [...new Set(reachedFeatures)].sort((a, b) => a - b);
    });

    const reversed = reverseEdges(graph, skippedEdges);
    const { setOf, sets } = propagateFeatureSets(reversed, seeds, nothingSkipped(reversed), new Uint8Array(count));
    expect(Array.from(setOf, set => sets[set]!)).toEqual(expected);
    expect(expected.some(list => list.length > 1)).toBe(true);
  });
});

describe("shortestChains", () => {
  const graph = graphOf([[1, 4], [2], [3], [], [3], []]);

  test("picks the shorter of two chains and marks an unreachable node", () => {
    const previous = shortestChains(graph, [0]);
    expect([...previous]).toEqual([-1, 0, 1, 4, 0, -2]);
    expect(chainTo(previous, 3)).toEqual([3, 4, 0]);
    expect(chainTo(previous, 0)).toEqual([0]);
    expect(chainTo(previous, 5)).toEqual([]);
  });

  test("does not follow a skipped edge", () => {
    const previous = shortestChains(graph, [0], skipping(graph, [4, 3]));
    expect(chainTo(previous, 3)).toEqual([3, 2, 1, 0]);
  });

  test("of two chains of equal length, picks the one through the node queued first", () => {
    expect(shortestChains(graphOf([[1, 2], [3], [3], []]), [0])[3]).toBe(1);
    const joined = graphOf([[2], [2], []]);
    expect([...shortestChains(joined, [1, 0])]).toEqual([-1, -1, 1]);
    expect([...shortestChains(joined, [0, 1])]).toEqual([-1, -1, 0]);
  });

  test("a start node reachable from another start node stays a start", () => {
    expect([...shortestChains(graphOf([[1], []]), [0, 1, 0])]).toEqual([-1, -1]);
  });

  test("nodes out of range throw", () => {
    expect(() => shortestChains(graph, [6])).toThrow(BuildError);
    expect(() => shortestChains(graph, [0], new Uint8Array(0))).toThrow(BuildError);
    expect(() => chainTo(shortestChains(graph, [0]), 6)).toThrow(BuildError);
    expect(() => chainTo(shortestChains(graph, [0]), -1)).toThrow(BuildError);
  });
});

test("a cycle and a chain of 200,000 nodes do not overflow the stack", () => {
  const length = 200_000;
  const graph = cycleOf(length);
  const noEdges = new Uint8Array(graph.successors.length);
  const noNodes = new Uint8Array(graph.count);
  expect(reach(graph, [0]).indexOf(0)).toBe(-1);
  expect(chainTo(shortestChains(graph, [0]), length - 1).length).toBe(length);

  const cycle = propagateFeatureSets(graph, new Map([[length - 1, [5]]]), noEdges, noNodes);
  expect(cycle.sets).toEqual([[], [5]]);
  expect(cycle.setOf.indexOf(0)).toBe(-1);

  const chain = propagateFeatureSets(graph, new Map([[1, [5]]]), skipping(graph, [length - 1, 0]), noNodes);
  expect(chain.sets).toEqual([[], [5]]);
  expect(chain.setOf.lastIndexOf(0)).toBe(0);
});

describe("findEdge", () => {
  const graph = graphOf([[1, 3, 4], [], [], [0], []]);

  test("finds the first, a middle and the last edge of a node", () => {
    expect([1, 3, 4].map(to => findEdge(graph, 0, to))).toEqual([0, 1, 2]);
    expect(findEdge(graph, 3, 0)).toBe(3);
  });

  test("is -1 where there is no edge", () => {
    expect(findEdge(graph, 0, 0)).toBe(-1);
    expect(findEdge(graph, 0, 2)).toBe(-1);
    expect(findEdge(graph, 0, 5)).toBe(-1);
    expect(findEdge(graph, 0, -1)).toBe(-1);
    expect(findEdge(graph, 1, 0)).toBe(-1);
    expect(findEdge(graph, 2, 0)).toBe(-1);
    expect(findEdge(graph, 4, 0)).toBe(-1);
  });

  test("a source out of range throws", () => {
    expect(() => findEdge(graph, 5, 0)).toThrow(BuildError);
    expect(() => findEdge(graph, -1, 0)).toThrow(BuildError);
  });
});

describe("nodeAt", () => {
  const graph = createSectionGraph({
    ...partsOf([[], [], []]),
    placedCount: 2,
    address: [0x1000, 0x1020, -1],
    size: [0x10, 8, 0],
  });

  test("finds a section by its first and its last byte", () => {
    expect(nodeAt(graph, 0x1000)).toBe(0);
    expect(nodeAt(graph, 0x100f)).toBe(0);
    expect(nodeAt(graph, 0x1020)).toBe(1);
    expect(nodeAt(graph, 0x1027)).toBe(1);
  });

  test("is -1 before, between and after the sections", () => {
    expect(nodeAt(graph, 0xfff)).toBe(-1);
    expect(nodeAt(graph, 0x1010)).toBe(-1);
    expect(nodeAt(graph, 0x101f)).toBe(-1);
    expect(nodeAt(graph, 0x1028)).toBe(-1);
  });

  test("is -1 for the address of an unplaced node", () => {
    expect(graph.address[2]).toBe(-1);
    expect(nodeAt(graph, graph.address[2]!)).toBe(-1);
  });
});

const feature = (name: string, index: number): Feature => ({
  name,
  rustName: name,
  index,
  text: name,
  enteredFrom: "program",
  isEngine: index < 128,
  minimumBytes: {},
  exports: false,
});
const [Jit, Sqlite, Undeclared] = [0, 300, 301];
const model: FeatureModel = {
  features: [feature("JIT", Jit), feature("Sqlite", Sqlite)],
  trimFeatures: [],
  icuData: [],
  icuLanguageGroups: [],
  hash: 0n,
};

describe("readEntryPoints", () => {
  interface ToyRecord {
    guard?: string;
    entry?: string;
    feature?: number;
    stub?: number;
    origin?: number;
    builtin?: number;
  }

  function recordSection(object: string, records: ToyRecord[]): RecordSection {
    const bytes = Buffer.alloc(records.length * recordBytes);
    const references = new Map<number, string>();
    records.forEach((record, index) => {
      const at = index * recordBytes;
      bytes.fill(0xaa, at, at + 16);
      if (record.guard !== undefined) references.set(at, record.guard);
      if (record.entry !== undefined) references.set(at + 8, record.entry);
      bytes.writeUInt16LE(record.feature ?? Jit, at + 16);
      bytes[at + 18] = record.stub ?? 0;
      bytes[at + 19] = record.origin ?? 0;
      bytes.writeUInt32LE(record.builtin ?? 0, at + 20);
    });
    return { object, bytes, references };
  }

  const nodes = new Map([
    ["a.o Lguard", 0],
    ["a.o Lother_guard", 1],
    ["a.o Gentry", 2],
    ["a.o Gother_entry", 3],
    ["a.o Gfolded_entry", 2],
    ["b.o Lguard", 4],
    ["b.o Gentry", 2],
    ["a.o Lguard_that_only_returns", 5],
  ]);

  const toyGraph = graphOf([[2], [2, 3], [], [], [2], []]);
  const read = (...recordSections: RecordSection[]) => {
    const reading: GraphReading = {
      graph: toyGraph,
      recordSections,
      resolve(object, reference) {
        const node = nodes.get(`${object} ${reference}`);
        return node === undefined ? undefined : { node, section: `${object}\0${reference}` };
      },
      failures: [{ kind: "UnreadInput", object: "unrelated.o", reason: "NotFound" }],
      statistics: {},
    };
    return readEntryPoints(reading, model, [70, 80, 90]);
  };

  const guarded: ToyRecord = { guard: "Lguard", entry: "Gentry" };
  const guardedInA: EntryPoint = {
    guard: 0,
    entry: 2,
    feature: Jit,
    stub: "Abort",
    origin: "NativeCode",
    builtin: undefined,
    entrySection: "a.o\0Gentry",
  };

  test("one record", () => {
    expect(read(recordSection("a.o", [{ ...guarded, feature: Sqlite, stub: 3 }]))).toStrictEqual({
      entryPoints: [{ ...guardedInA, feature: Sqlite, stub: "ReturnDefault" }],
      failures: [],
      statistics: { records: 1, deadGuards: 0, guardsInsideEntryPoint: 0, definitions: 0, guardsOfEmptyEntryPoints: 0 },
    });
  });

  test("a record of a built-in has its id", () => {
    const { entryPoints, failures } = read(
      recordSection("a.o", [
        { ...guarded, stub: 1, origin: 1, builtin: 0xfffffffe },
        { ...guarded, guard: "Lother_guard", stub: 1, origin: 1, builtin: 0 },
      ]),
    );
    expect(failures).toEqual([]);
    expect(entryPoints).toStrictEqual([
      { ...guardedInA, stub: "Throw", origin: "Builtin", builtin: 0xfffffffe },
      { ...guardedInA, guard: 1, stub: "Throw", origin: "Builtin", builtin: 0 },
    ]);
  });

  test("no record sections, and a section without records", () => {
    const statistics = {
      records: 0,
      deadGuards: 0,
      guardsInsideEntryPoint: 0,
      definitions: 0,
      guardsOfEmptyEntryPoints: 0,
    };
    const nothing = { entryPoints: [], failures: [], statistics };
    expect(read()).toEqual(nothing);
    expect(read(recordSection("a.o", []))).toEqual(nothing);
  });

  test("the stub byte is an index into stubKinds", () => {
    expect(recordBytes).toBe(24);
    expect(stubKinds).toEqual(["Abort", "Throw", "ReturnUndefined", "ReturnDefault"]);
    const { entryPoints } = read(
      recordSection(
        "a.o",
        [3, 2, 1, 0].map(stub => ({ ...guarded, stub })),
      ),
    );
    expect(entryPoints.map(entryPoint => entryPoint.stub)).toEqual([...stubKinds]);
  });

  test("the origin byte is an index into guardOrigins", () => {
    expect(guardOrigins).toEqual(["NativeCode", "Builtin", "Definition", "BuiltinNamedByEngine"]);
    const { entryPoints } = read(
      recordSection(
        "a.o",
        [1, 0].map(origin => ({ ...guarded, origin })),
      ),
    );
    expect(entryPoints.map(entryPoint => entryPoint.origin)).toEqual(guardOrigins.slice(0, 2));
  });

  test("a position that code of the engine records becomes the number of the built-in in the table", () => {
    const { entryPoints, failures } = read(recordSection("a.o", [{ ...guarded, origin: 3, builtin: 2 }]));
    expect(entryPoints).toEqual([{ ...guardedInA, origin: "Builtin", builtin: 90 }]);
    expect(failures).toEqual([]);
  });

  test("a position behind the end of the engine's list is malformed", () => {
    const { entryPoints, failures } = read(recordSection("a.o", [{ ...guarded, origin: 3, builtin: 3 }]));
    expect(entryPoints).toEqual([]);
    expect(failures).toEqual([{ kind: "UnreadInput", object: "a.o", reason: "MalformedRecords" }]);
  });

  test("a reference is resolved in the object of its section", () => {
    const { entryPoints } = read(recordSection("b.o", [guarded]), recordSection("a.o", [guarded]));
    expect(entryPoints).toEqual([guardedInA, { ...guardedInA, guard: 4, entrySection: "b.o\0Gentry" }]);
  });

  test("a dead guard is counted and is not a failure", () => {
    const { entryPoints, failures, statistics } = read(
      recordSection("a.o", [
        { entry: "Gentry" },
        { guard: "Ldiscarded", entry: "Gentry" },
        { guard: "Ldiscarded", entry: "Gdiscarded" },
        {},
      ]),
    );
    expect(entryPoints).toEqual([]);
    expect(failures).toEqual([]);
    expect(statistics).toEqual({
      records: 4,
      deadGuards: 4,
      guardsInsideEntryPoint: 0,
      definitions: 0,
      guardsOfEmptyEntryPoints: 0,
    });
  });

  test("the same guard twice is one entry point", () => {
    const { entryPoints, statistics } = read(recordSection("a.o", [guarded, guarded]));
    expect(entryPoints).toEqual([guardedInA]);
    expect(statistics.records).toBe(2);
  });

  test("records that differ in one member are all retained, sorted by entry, guard, feature, stub, origin, id, section", () => {
    const { entryPoints } = read(
      recordSection("a.o", [
        { guard: "Lguard", entry: "Gother_entry" },
        { guard: "Lother_guard", entry: "Gentry" },
        { guard: "Lguard", entry: "Gfolded_entry" },
        { guard: "Lguard", entry: "Gentry", feature: Sqlite },
        { guard: "Lguard", entry: "Gentry", stub: 1 },
        { guard: "Lguard", entry: "Gentry", origin: 1, builtin: 7 },
        { guard: "Lguard", entry: "Gentry", origin: 1, builtin: 0 },
        { guard: "Lguard", entry: "Gentry" },
      ]),
    );
    expect(entryPoints).toStrictEqual([
      guardedInA,
      { ...guardedInA, entrySection: "a.o\0Gfolded_entry" },
      { ...guardedInA, origin: "Builtin", builtin: 0 },
      { ...guardedInA, origin: "Builtin", builtin: 7 },
      { ...guardedInA, stub: "Throw" },
      { ...guardedInA, feature: Sqlite },
      { ...guardedInA, guard: 1 },
      { ...guardedInA, entry: 3, entrySection: "a.o\0Gother_entry" },
    ]);
  });

  test("a guard inside its own entry point is counted and dropped", () => {
    const recursive = { guard: "Gentry", entry: "Gfolded_entry" };
    const { entryPoints, failures, statistics } = read(recordSection("a.o", [recursive]));
    expect(entryPoints).toEqual([]);
    expect(failures).toEqual([]);
    expect(statistics).toEqual({
      records: 1,
      deadGuards: 0,
      guardsInsideEntryPoint: 1,
      definitions: 0,
      guardsOfEmptyEntryPoints: 0,
    });
  });

  test("a section of 23 bytes is malformed, and the other sections are still read", () => {
    const short = recordSection("b.o", [guarded]);
    short.bytes = short.bytes.subarray(0, recordBytes - 1);
    const { entryPoints, failures, statistics } = read(short, recordSection("a.o", [guarded]));
    expect(failures).toEqual([{ kind: "UnreadInput", object: "b.o", reason: "MalformedRecords" }]);
    expect(entryPoints).toEqual([guardedInA]);
    expect(statistics.records).toBe(1);
  });

  test.each<[string, ToyRecord]>([
    ["stub 4", { stub: 4 }],
    ["stub 255", { stub: 255 }],
    ["origin 4", { origin: 4 }],
    ["origin 255", { origin: 255 }],
    ["a guard in native code with the id of a built-in", { origin: 0, builtin: 7 }],
    ["a guard in native code with an id in the last byte only", { origin: 0, builtin: 0x80000000 }],
  ])("%s is reported once and ends its section", (_, damage) => {
    const damaged = { ...guarded, guard: "Lother_guard", ...damage };
    const { entryPoints, failures, statistics } = read(recordSection("a.o", [guarded, damaged, damaged, guarded]));
    expect(failures).toEqual([{ kind: "UnreadInput", object: "a.o", reason: "MalformedRecords" }]);
    expect(entryPoints).toEqual([guardedInA]);
    expect(statistics.records).toBe(1);
  });

  describe("a record that the entry point's own definition writes", () => {
    const definition: ToyRecord = { guard: "Gentry", entry: "Gentry", origin: 2 };

    test("guards every reference to the entry point", () => {
      const { entryPoints, failures, statistics } = read(recordSection("a.o", [{ ...definition, feature: Sqlite }]));
      expect(failures).toEqual([]);
      expect(entryPoints).toStrictEqual(
        [0, 1, 4].map(guard => ({ ...guardedInA, guard, feature: Sqlite, origin: "Definition" })),
      );
      expect(statistics).toEqual({
        records: 1,
        deadGuards: 0,
        guardsInsideEntryPoint: 0,
        definitions: 1,
        guardsOfEmptyEntryPoints: 0,
      });
    });

    test("of a function the linker folded with other code gives one entry point, however many places refer to the shared code", () => {
      const graph = createSectionGraph({
        ...partsOf([[2], [2, 3], [], [], [2]]),
        aliases: new Map([[2, [["other.o", "unrelated"]]]]),
      });
      const reading: GraphReading = {
        graph,
        recordSections: [recordSection("a.o", [definition])],
        resolve: (object, reference) => ({
          node: nodes.get(`${object} ${reference}`)!,
          section: `${object}\0${reference}`,
        }),
        failures: [],
        statistics: {},
      };
      const { entryPoints, failures } = readEntryPoints(reading, model);
      expect(failures).toEqual([]);
      expect(entryPoints).toStrictEqual([{ ...guardedInA, origin: "Definition" }]);
      const result = partition({ graph, entryPoints, model, isMovable: () => true, isCode: () => true });
      expect(result.foldedEntryPoints).toStrictEqual(entryPoints);
    });

    test("with the stub Throw and an id says that JavaScript enters it as that built-in", () => {
      const { entryPoints, failures, statistics } = read(
        recordSection("a.o", [{ ...definition, stub: 1, builtin: 7 }]),
      );
      expect(failures).toEqual([]);
      expect(entryPoints).toStrictEqual(
        [0, 1, 4].map(guard => ({ ...guardedInA, guard, stub: "Throw", origin: "Builtin", builtin: 7 })),
      );
      expect(statistics.definitions).toBe(1);
    });

    test("with the stub Throw and no id is entered from native code", () => {
      const { entryPoints, failures } = read(recordSection("a.o", [{ ...definition, stub: 1 }]));
      expect(failures).toEqual([]);
      expect(entryPoints).toStrictEqual(
        [0, 1, 4].map(guard => ({ ...guardedInA, guard, stub: "Throw", origin: "Definition" })),
      );
    });

    test("makes a reference from code a guarded edge and one from data a soft edge", () => {
      const { entryPoints } = read(recordSection("a.o", [definition]));
      const graph = createSectionGraph({
        ...partsOf([[2], [2, 3], [], [], [2]]),
        output: [".text", ".text", ".text", ".text", ".data.rel.ro"],
        roots: new Set([0, 1, 4]),
      });
      const result = partition({
        graph,
        entryPoints,
        model,
        isMovable: () => true,
        isCode: output => output === ".text",
      });
      expect(result.failures).toEqual([]);
      expect([0, 1, 4].map(guard => result.edgeKind[findEdge(graph, guard, 2)])).toEqual([
        EdgeKind.Guarded,
        EdgeKind.Guarded,
        EdgeKind.Soft,
      ]);
      expect(result.edgeKind[findEdge(graph, 1, 3)]).toBe(EdgeKind.Ordinary);
      expect(Array.from(result.isRetained)).toEqual([1, 1, 0, 1, 1]);
      expect(result.sets[result.setOf[2]!]).toEqual([Jit]);
    });

    test("of an entry point that nothing refers to gives no entry point and no failure", () => {
      const { entryPoints, failures, statistics } = read(
        recordSection("a.o", [{ guard: "Lguard", entry: "Lguard", origin: 2 }]),
      );
      expect(entryPoints).toEqual([]);
      expect(failures).toEqual([]);
      expect(statistics).toEqual({
        records: 1,
        deadGuards: 0,
        guardsInsideEntryPoint: 0,
        definitions: 1,
        guardsOfEmptyEntryPoints: 0,
      });
    });

    test("beside a guard's own record leaves that record as it is", () => {
      const { entryPoints, statistics } = read(recordSection("a.o", [guarded, definition]));
      expect(entryPoints).toStrictEqual([
        guardedInA,
        ...[0, 1, 4].map(guard => ({ ...guardedInA, guard, origin: "Definition" })),
      ]);
      expect(statistics).toEqual({
        records: 2,
        deadGuards: 0,
        guardsInsideEntryPoint: 0,
        definitions: 1,
        guardsOfEmptyEntryPoints: 0,
      });
    });

    test("of a definition that is not in the image is a dead guard", () => {
      const { entryPoints, failures, statistics } = read(
        recordSection("a.o", [{ guard: "Gdiscarded", entry: "Gdiscarded", origin: 2 }]),
      );
      expect(entryPoints).toEqual([]);
      expect(failures).toEqual([]);
      expect(statistics).toEqual({
        records: 1,
        deadGuards: 1,
        guardsInsideEntryPoint: 0,
        definitions: 0,
        guardsOfEmptyEntryPoints: 0,
      });
    });

    test.each<[string, ToyRecord]>([
      ["the stub ReturnUndefined", { ...definition, stub: 2 }],
      ["the stub ReturnDefault", { ...definition, stub: 3 }],
      ["the stub Abort and the id of a built-in", { ...definition, builtin: 7 }],
      ["its two addresses in different sections", { ...definition, guard: "Lguard" }],
      ["an entry point that is not in the image", { ...definition, entry: "Gdiscarded" }],
    ])("with %s is malformed and ends its section", (_, damaged) => {
      const { entryPoints, failures, statistics } = read(recordSection("a.o", [guarded, damaged, definition]));
      expect(failures).toEqual([{ kind: "UnreadInput", object: "a.o", reason: "MalformedRecords" }]);
      expect(entryPoints).toEqual([guardedInA]);
      expect(statistics.definitions).toBe(0);
    });

    test("is told from a guard in native code that lies inside its entry point, which is only counted", () => {
      const { entryPoints, failures, statistics } = read(recordSection("a.o", [{ ...definition, origin: 0 }]));
      expect(entryPoints).toEqual([]);
      expect(failures).toEqual([]);
      expect(statistics).toEqual({
        records: 1,
        deadGuards: 0,
        guardsInsideEntryPoint: 1,
        definitions: 0,
        guardsOfEmptyEntryPoints: 0,
      });
    });
  });

  test("an unknown feature is reported once per section, and only its records are skipped", () => {
    const unknown = { ...guarded, feature: Undeclared };
    const { entryPoints, failures } = read(
      recordSection("a.o", [unknown, { ...unknown, feature: 0xffff }, guarded]),
      recordSection("b.o", [unknown]),
    );
    expect(failures).toEqual([
      { kind: "UnreadInput", object: "a.o", reason: "UnknownFeature" },
      { kind: "UnreadInput", object: "b.o", reason: "UnknownFeature" },
    ]);
    expect(entryPoints).toEqual([guardedInA]);
  });

  test("a live guard whose entry point is not in the image fails", () => {
    const { entryPoints, failures, statistics } = read(
      recordSection("a.o", [
        { guard: "Lother_guard", feature: Sqlite },
        { guard: "Lguard", entry: "Ginlined" },
      ]),
    );
    expect(entryPoints).toEqual([]);
    expect(failures).toStrictEqual([
      { kind: "GuardWithoutReference", guard: 0, entry: undefined, feature: Jit, target: "Ginlined" },
      { kind: "GuardWithoutReference", guard: 1, entry: undefined, feature: Sqlite, target: "" },
    ]);
    expect(statistics).toEqual({
      records: 2,
      deadGuards: 0,
      guardsInsideEntryPoint: 0,
      definitions: 0,
      guardsOfEmptyEntryPoints: 0,
    });
  });

  test("a guard in a function that only returns, whose entry point is not in the image, is only counted", () => {
    const { entryPoints, failures, statistics } = read(
      recordSection("a.o", [{ guard: "Lguard_that_only_returns", entry: "Gempty" }]),
    );
    expect(entryPoints).toEqual([]);
    expect(failures).toEqual([]);
    expect(statistics).toEqual({
      records: 1,
      deadGuards: 0,
      guardsInsideEntryPoint: 0,
      definitions: 0,
      guardsOfEmptyEntryPoints: 1,
    });
  });

  test("a guard inlined twice into one function fails once", () => {
    const inlined = { guard: "Lguard", entry: "Ginlined" };
    expect(read(recordSection("a.o", [inlined, inlined])).failures.length).toBe(1);
  });
});

describe("onlyReturns", () => {
  const [returns, procedureRecord, unwindRecord, handler] = [0, 1, 2, 3];
  const sections = [".text", ".pdata", ".xdata", ".text"];
  const graphWith = (successors: number[][], more: Partial<SectionGraphParts> = {}) =>
    createSectionGraph({ ...partsOf(successors), format: "coff", section: sections, ...more });
  const withRecords = [[procedureRecord, unwindRecord], [returns, unwindRecord], [], []];

  test("a small function that refers to nothing", () => {
    expect(onlyReturns(graphWith([[], [], [], []]), returns)).toBe(true);
    expect(onlyReturns(graphWith([[], [], [], []], { size: [33, 12, 8, 16] }), returns)).toBe(false);
    expect(onlyReturns(graphWith([[handler], [], [], []]), returns)).toBe(false);
  });

  test("a COFF function's own unwind records do not count as references", () => {
    expect(onlyReturns(graphWith(withRecords), returns)).toBe(true);
    expect(
      onlyReturns(graphWith(withRecords, { section: [".text$mn", ".pdata$x", ".xdata$x", ".text"] }), returns),
    ).toBe(true);
  });

  test("unwind records that name a handler, or another function, do", () => {
    expect(
      onlyReturns(graphWith([[procedureRecord, unwindRecord], [returns, unwindRecord], [handler], []]), returns),
    ).toBe(false);
    expect(onlyReturns(graphWith([[procedureRecord], [returns, handler], [], []]), returns)).toBe(false);
  });

  test("sections of those names mean nothing in another format", () => {
    expect(onlyReturns(graphWith(withRecords, { format: "elf" }), returns)).toBe(false);
  });
});

describe("findCFunctionEntryPoints", () => {
  const [loop, table, attach, read, shared] = [0, 1, 2, 3, 4];

  function find(
    cFunctions: Record<string, string[]>,
    format: "elf" | "macho" = "elf",
    names = [["loop"], ["table"], ["tls_attach"], ["tls_read"], ["tls_a", "tls_b"]],
  ) {
    const reading: GraphReading = {
      graph: createSectionGraph({ ...partsOf([[attach, read, shared], [attach], [read], [], []]), format, names }),
      recordSections: [],
      resolve: () => undefined,
      failures: [],
      statistics: {},
    };
    const features = model.features.map(each =>
      cFunctions[each.name] === undefined ? each : { ...each, cFunctions: cFunctions[each.name] },
    );
    return findCFunctionEntryPoints(reading, { ...model, features });
  }

  const record = (guard: number, entry: number, index = Sqlite): EntryPoint => ({
    guard,
    entry,
    feature: index,
    stub: "Abort",
    origin: "Definition",
    builtin: undefined,
    entrySection: `toy.o\0.text.f${entry}`,
  });

  test("every reference to a named function is cut, from code and from data", () => {
    expect(find({ Sqlite: ["tls_attach"] })).toStrictEqual({
      entryPoints: [record(loop, attach), record(table, attach)],
      missing: [],
    });
  });

  test("a function that two features name stays while either feature does", () => {
    expect(find({ Sqlite: ["tls_read"], JIT: ["tls_read"] }).entryPoints).toStrictEqual([
      record(loop, read, Jit),
      record(loop, read),
      record(attach, read, Jit),
      record(attach, read),
    ]);
  });

  test("a name that is not in the link is reported and cuts nothing", () => {
    expect(find({ Sqlite: ["tls_gone"] })).toStrictEqual({ entryPoints: [], missing: ["tls_gone"] });
  });

  test("a function that shares its section with a function nobody names is not cut", () => {
    expect(find({ Sqlite: ["tls_a"] })).toStrictEqual({ entryPoints: [], missing: ["tls_a"] });
    expect(find({ Sqlite: ["tls_a", "tls_b"] }).entryPoints).toStrictEqual([record(loop, shared)]);
  });

  test("a Mach-O symbol has an underscore ahead of the C name", () => {
    const names = [["_loop"], ["_table"], ["_tls_attach"], ["_tls_read"], ["_tls_a", "_tls_b"]];
    expect(find({ Sqlite: ["tls_attach"] }, "macho", names).entryPoints).toStrictEqual([
      record(loop, attach),
      record(table, attach),
    ]);
  });

  test("no feature names a function", () => {
    expect(find({})).toStrictEqual({ entryPoints: [], missing: [] });
  });
});

describe("findCxxFunctionEntryPoints", () => {
  const [wrapper, table, secure, plain, data, folded] = [0, 1, 2, 3, 4, 5];
  const demangled = new Map([
    ["_ZN3uWS3AppILb1EE3runEv", "uWS::App<true>::run()"],
    ["_ZN3uWS3AppILb0EE3runEv", "uWS::App<false>::run()"],
    ["_ZN3uWS3AppILb1EE5stateE", "uWS::App<true>::state"],
    ["_ZN3uWS3AppILb1EE4stopEv", "uWS::App<true>::stop()"],
    ["_ZN3uWS3AppILb0EE4stopEv", "uWS::App<false>::stop()"],
  ]);
  const names = [
    ["uws_run"],
    ["table"],
    ["_ZN3uWS3AppILb1EE3runEv"],
    ["_ZN3uWS3AppILb0EE3runEv"],
    ["_ZN3uWS3AppILb1EE5stateE"],
    ["_ZN3uWS3AppILb1EE4stopEv", "_ZN3uWS3AppILb0EE4stopEv"],
  ];
  const asked: string[][] = [];

  function find(
    cxxFunctions: Record<string, { hint: string; pattern: string }[]>,
    format: ObjectFormat = "elf",
    namesInFormat = names,
  ) {
    const reading: GraphReading = {
      graph: createSectionGraph({
        ...partsOf([[secure, plain, data, folded], [secure], [data], [], [], []]),
        format,
        output: [".text", ".data.rel.ro", ".text", ".text", ".data", ".text"],
        names: namesInFormat,
      }),
      recordSections: [],
      resolve: () => undefined,
      failures: [],
      statistics: {},
    };
    const features = model.features.map(each =>
      cxxFunctions[each.name] === undefined ? each : { ...each, cxxFunctions: cxxFunctions[each.name] },
    );
    return findCxxFunctionEntryPoints({
      reading,
      model: { ...model, features },
      isCode: output => output === ".text",
      demangle: symbols => (asked.push(symbols), symbols.map(symbol => demangled.get(symbol) ?? symbol)),
    });
  }

  const record = (guard: number, entry: number): EntryPoint => ({
    guard,
    entry,
    feature: Sqlite,
    stub: "Abort",
    origin: "Definition",
    builtin: undefined,
    entrySection: `toy.o\0.text.f${entry}`,
  });
  const secureApp = { hint: "uWS", pattern: "uWS::\\w+<true[,>]" };

  test("every reference to a function whose demangled name matches is cut; data and the other instantiation stay", () => {
    expect(find({ Sqlite: [secureApp] })).toStrictEqual({
      entryPoints: [record(wrapper, secure), record(table, secure)],
      unmatched: [],
    });
  });

  test("a section that the linker folded with a function that doesn't match is not cut", () => {
    expect(find({ Sqlite: [secureApp] }).entryPoints.some(each => each.entry === folded)).toBe(false);
  });

  test("only symbols that contain the hint are demangled", () => {
    asked.length = 0;
    find({ Sqlite: [secureApp] });
    expect(asked.flat()).not.toContain("uws_run");
    expect(asked.flat()).toContain("_ZN3uWS3AppILb0EE3runEv");
  });

  test("the demangler gets a Mach-O name without the underscore that the format puts in front", () => {
    asked.length = 0;
    const withUnderscore = names.map(list => list.map(name => "_" + name));
    expect(find({ Sqlite: [secureApp] }, "macho", withUnderscore)).toStrictEqual(find({ Sqlite: [secureApp] }));
    expect(asked[0]).toStrictEqual(asked[1]);
  });

  test("a pattern that matches nothing is reported", () => {
    expect(find({ Sqlite: [{ hint: "uWS", pattern: "uWS::Gone<" }] })).toStrictEqual({
      entryPoints: [],
      unmatched: ["uWS::Gone<"],
    });
  });

  test("no feature has a pattern", () => {
    expect(find({})).toStrictEqual({ entryPoints: [], unmatched: [] });
  });
});

describe("findStaticTableEntryPoints", () => {
  const cxxfilt = Bun.which("llvm-undname") === null ? undefined : (Bun.which("llvm-cxxfilt") ?? undefined);
  const [main, table, otherTable, open, close, text] = [0, 1, 2, 3, 4, 5];
  const outputs = [".text", ".data.rel.ro", ".data.rel.ro", ".text", ".text", ".rodata"];
  const mangled = new Map([
    ["_open", "Bun::jsSqliteOpen(JSC::JSGlobalObject*, JSC::CallFrame*)"],
    ["_open_alias", "jsSqliteOpen"],
    ["_close", "Bun::jsSqliteClose(JSC::JSGlobalObject*, JSC::CallFrame*)"],
  ]);

  const builtin = (
    id: number,
    kind: BuiltinKind,
    nativeSymbols: string[],
    uses: BuiltinEntry["uses"],
  ): BuiltinEntry => ({
    id,
    path: `Bun.builtin${id}`,
    kind,
    uses,
    nativeSymbols,
    hasHiddenRoot: false,
  });
  const always = (name: string) => ({ feature: name, isConditional: false });
  const sometimes = (name: string) => ({ feature: name, isConditional: true });

  function find(
    entries: BuiltinEntry[],
    names: string[][] = [["main"], ["table"], ["other"], ["_open"], ["_close"], ["text"]],
    format: ObjectFormat = "elf",
  ) {
    const successors = [[open], [open, close, text], [open], [], [], []];
    const reading: GraphReading = {
      graph: createSectionGraph({ ...partsOf(successors), format, output: outputs, names }),
      recordSections: [],
      resolve: () => undefined,
      failures: [],
      statistics: {},
    };
    return findStaticTableEntryPoints({
      reading,
      model,
      uses: { entries },
      isCode: output => output === ".text",
      demangle: list =>
        new Demangler(format === "coff" ? cxxfilt : undefined).demangle(list.map(name => mangled.get(name) ?? name)),
    });
  }

  const record = (guard: number, entry: number, id: number, index = Sqlite): EntryPoint => ({
    guard,
    entry,
    feature: index,
    stub: "Throw",
    origin: "Builtin",
    builtin: id,
    entrySection: `toy.o\0.text.f${entry}`,
  });

  test("each table that holds the address of a built-in's function guards it, and code that takes the address does not", () => {
    expect(find([builtin(7, "Function", ["jsSqliteOpen"], [always("Sqlite")])])).toStrictEqual([
      record(table, open, 7),
      record(otherTable, open, 7),
    ]);
    expect(main).toBe(0);
  });

  test("an entry may name its function with some or all of its namespaces, and another namespace's function of that name is not it", () => {
    expect(find([builtin(7, "Function", ["Bun::jsSqliteOpen"], [always("Sqlite")])])).toStrictEqual([
      record(table, open, 7),
      record(otherTable, open, 7),
    ]);
    expect(find([builtin(7, "Function", ["Node::jsSqliteOpen"], [always("Sqlite")])])).toEqual([]);
    expect(find([builtin(7, "Function", ["un::jsSqliteOpen"], [always("Sqlite")])])).toEqual([]);
  });

  test("the underscore that Mach-O puts in front of a name is not part of it, for a C function and for a mangled one", () => {
    const names = [["_main"], ["_table"], ["_other"], ["_jsSqliteOpen"], ["__close"], ["_text"]];
    const entries = [
      builtin(7, "Function", ["jsSqliteOpen"], [always("Sqlite")]),
      builtin(8, "Function", ["Bun::jsSqliteClose"], [always("Sqlite")]),
    ];
    expect(find(entries, names, "macho")).toStrictEqual([
      record(table, open, 7),
      record(otherTable, open, 7),
      record(table, close, 8),
    ]);
    expect(find(entries, names, "elf")).toEqual([]);
  });

  test.skipIf(cxxfilt === undefined)(
    "a function is found by the name that the Microsoft ABI gives it, in a namespace and outside",
    () => {
      const names = [
        ["main"],
        ["?table@Bun@@3QBUHashTableValue@JSC@@B"],
        ["?other@Bun@@3QBUHashTableValue@JSC@@B"],
        ["?jsSqliteOpen@Bun@@YA_JPEAVJSGlobalObject@JSC@@PEAVCallFrame@3@@Z"],
        ["?jsSqliteClose@@YA_JPEAVJSGlobalObject@JSC@@PEAVCallFrame@2@@Z"],
        ["??_C@_04PLJBKNIO@text@"],
      ];
      const entries = (open: string, close: string) => [
        builtin(7, "Function", [open], [always("Sqlite")]),
        builtin(8, "Function", [close], [always("Sqlite")]),
      ];
      const found = [record(table, open, 7), record(otherTable, open, 7), record(table, close, 8)];
      expect(find(entries("jsSqliteOpen", "jsSqliteClose"), names, "coff")).toStrictEqual(found);
      expect(find(entries("Bun::jsSqliteOpen", "jsSqliteClose"), names, "coff")).toStrictEqual(found);
      expect(find(entries("Node::jsSqliteOpen", "Bun::jsSqliteClose"), names, "coff")).toEqual([]);
    },
  );

  test("a function that no entry names, and data that a table refers to, are no entry points", () => {
    expect(find([builtin(7, "Function", ["jsSqliteMissing", "text"], [always("Sqlite")])])).toEqual([]);
  });

  test("the feature is the entry's first unconditional use", () => {
    expect(
      find([builtin(7, "Method", ["jsSqliteClose"], [sometimes("Sqlite"), always("JIT"), always("Sqlite")])]),
    ).toStrictEqual([record(table, close, 7, Jit)]);
  });

  test("an entry with conditional uses only has no guard", () => {
    expect(find([builtin(7, "Function", ["jsSqliteOpen"], [sometimes("Sqlite")])])).toEqual([]);
  });

  test.each<BuiltinKind>(["Function", "Method", "Constructor", "Accessor"])(
    "a %s is asked about where it becomes callable",
    kind => {
      expect(find([builtin(7, kind, ["jsSqliteClose"], [always("Sqlite")])])).toStrictEqual([record(table, close, 7)]);
    },
  );

  test.each<BuiltinKind>([
    "Namespace",
    "DataProperty",
    "Constant",
    "Prototype",
    "NativeBinding",
    "Module",
    "InternalModule",
  ])("the creation of a %s stays", kind => {
    expect(find([builtin(7, kind, ["jsSqliteClose"], [always("Sqlite")])])).toEqual([]);
  });

  test("two built-ins that share a function give a record each, sorted by feature and id", () => {
    const entries = [
      builtin(9, "Function", ["jsSqliteClose"], [always("Sqlite")]),
      builtin(8, "Function", ["jsSqliteClose"], [always("Sqlite")]),
      builtin(10, "Function", ["jsSqliteClose"], [always("JIT")]),
    ];
    expect(find(entries)).toStrictEqual([
      record(table, close, 10, Jit),
      record(table, close, 8),
      record(table, close, 9),
    ]);
  });

  test("a function with two names that mean the same gives one record for each table", () => {
    const names = [["main"], ["table"], ["other"], ["_open", "_open_alias"], ["_close"], ["text"]];
    expect(find([builtin(7, "Function", ["jsSqliteOpen"], [always("Sqlite")])], names)).toStrictEqual([
      record(table, open, 7),
      record(otherTable, open, 7),
    ]);
  });
});

test.each([
  ["Bun::jsSqliteOpen(JSC::JSGlobalObject*, JSC::CallFrame*)", "jsSqliteOpen"],
  ["JSC::Wasm::create(int)", "create"],
  ["plain(std::pair<a::b, c::d>)", "plain"],
  ["Bun::name", "name"],
  ["plain", "plain"],
  ["", ""],
])("unqualifiedFunctionName(%j) is %j", (demangled, name) => {
  expect(unqualifiedFunctionName(demangled)).toBe(name);
});

test("mergeEntryPoints sorts both lists into one and drops what is in both", () => {
  const record = (guard: number, entry: number): EntryPoint => ({
    guard,
    entry,
    feature: Jit,
    stub: "Throw",
    origin: "Builtin",
    builtin: 7,
    entrySection: "toy.o\0.text",
  });
  expect(mergeEntryPoints([record(0, 2), record(1, 3)], [record(4, 2), record(1, 3), record(0, 1)])).toStrictEqual([
    record(0, 1),
    record(0, 2),
    record(4, 2),
    record(1, 3),
  ]);
  expect(mergeEntryPoints([], [])).toEqual([]);
});

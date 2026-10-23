import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BuildError } from "../../../scripts/build/error.ts";
import type { Feature, FeatureModel } from "../../../scripts/build/trim/features.ts";
import { EdgeKind, type PartitionFailure } from "../../../scripts/build/trim/partition.ts";
import {
  describeFailures,
  foldedEntryPointsHeading,
  maxChainLength,
  maxPrintedFailures,
  writeReviewFiles,
  type LinkFailure,
  type ReportContext,
} from "../../../scripts/build/trim/report.ts";
import type { BuiltinUses, FeatureEdge } from "../../../scripts/build/trim/types.ts";
import {
  A,
  abc,
  abcWith,
  B,
  C,
  edgeKindOf,
  modelOf,
  partitioned,
  tableOutput,
  Tools,
  type Guard,
  type Partitioned,
  type Section,
} from "./toy-graph.ts";

const reference = (from: number, to: number): FeatureEdge => ({ from, to, strength: "Reference", isFollowed: true });

const oneFeature: Record<string, Section> = {
  main: { root: true, to: ["guardA"] },
  guardA: { to: ["entryA", "shared"] },
  entryA: { to: ["onlyA", "shared"] },
  onlyA: {},
  shared: {},
};
const oneFeatureGuards: Guard[] = [["guardA", "entryA", A]];

const twoFeatures: Record<string, Section> = {
  main: { root: true, to: ["guardA", "guardB"] },
  guardA: { to: ["entryA"] },
  guardB: { to: ["entryB"] },
  entryA: { to: ["entryB"] },
  entryB: { to: ["onlyB"] },
  onlyB: {},
};
const twoFeaturesGuards: Guard[] = [
  ["guardA", "entryA", A],
  ["guardB", "entryB", B],
];

const threeFeatures: Record<string, Section> = {
  ...twoFeatures,
  main: { root: true, to: ["guardA", "guardB", "guardT"] },
  guardT: { to: ["entryT"] },
  entryT: {},
};
const threeFeaturesGuards: Guard[] = [...twoFeaturesGuards, ["guardT", "entryT", Tools]];

const sharedEntryPoint: Record<string, Section> = {
  main: { root: true, to: ["guardA", "guardB", "guardC"] },
  guardA: { to: ["both"] },
  guardB: { to: ["both"] },
  guardC: { to: ["entryC"] },
  entryC: { to: ["both"] },
  both: { foldedWith: ["alias"] },
};
const sharedEntryPointGuards: Guard[] = [
  ["guardA", "both", A, { entrySection: "toy.o\0one" }],
  ["guardB", "both", B, { entrySection: "toy.o\0alias" }],
  ["guardC", "entryC", C],
];

describe("the partition", () => {
  test("only the guarded edge is cut", () => {
    const result = partitioned(oneFeature, oneFeatureGuards);
    expect(result.failures).toEqual([]);
    expect(result.retained()).toEqual(["main", "guardA", "shared"]);
    expect(result.features("entryA")).toEqual([A]);
    expect(result.features("onlyA")).toEqual([A]);
    expect(result.edges).toEqual([]);
    expect(edgeKindOf(result, "guardA", "entryA")).toBe(EdgeKind.Guarded);
    expect(edgeKindOf(result, "guardA", "shared")).toBe(EdgeKind.Ordinary);
    expect(result.retained().map(name => result.setOf[result.node(name)])).toEqual([0, 0, 0]);
  });

  test("a guard inlined into a large function cuts only its own edge", () => {
    const result = partitioned(
      { main: { root: true, to: ["entryA", "helper"] }, entryA: { to: ["onlyA"] }, onlyA: {}, helper: {} },
      [["main", "entryA", A]],
    );
    expect(result.failures).toEqual([]);
    expect(result.retained()).toEqual(["main", "helper"]);
  });

  test("a reference from retained code to a section that is not an entry point retains the section", () => {
    const result = partitioned({ ...oneFeature, main: { root: true, to: ["guardA", "onlyA"] } }, oneFeatureGuards);
    expect(result.failures).toEqual([]);
    expect(result.retained()).toEqual(["main", "guardA", "onlyA", "shared"]);
    expect(result.features("entryA")).toEqual([A]);
  });

  test("an unguarded reference to an entry point of another feature is a reference edge and ends the search", () => {
    const result = partitioned(twoFeatures, twoFeaturesGuards);
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([reference(A, B)]);
    expect(result.features("entryB")).toEqual([B]);
    expect(result.features("onlyB")).toEqual([B]);
    expect(edgeKindOf(result, "entryA", "entryB")).toBe(EdgeKind.Unguarded);
  });

  test("a cycle between two features produces both edges", () => {
    const result = partitioned({ ...twoFeatures, entryB: { to: ["entryA", "onlyB"] } }, twoFeaturesGuards);
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([reference(A, B), reference(B, A)]);
  });

  test("a guard inside the code of a feature adds a guard edge in place of a reference", () => {
    const result = partitioned(twoFeatures, [...twoFeaturesGuards, ["entryA", "entryB", B]]);
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([{ from: A, to: B, strength: "AbortingGuard", isFollowed: true }]);
    expect(edgeKindOf(result, "entryA", "entryB")).toBe(EdgeKind.Guarded);
    expect(result.features("entryB")).toEqual([B]);
  });

  test("an entry point of two features takes the feature of an unguarded referrer", () => {
    const result = partitioned(sharedEntryPoint, sharedEntryPointGuards);
    expect(result.failures).toEqual([]);
    expect(result.features("both")).toEqual([A, B, C]);
    expect(result.edges).toEqual([]);
    expect(result.foldedEntryPoints).toEqual([]);
  });

  test("an entry point folded with a function no record names is not removable and is not a failure", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA", "entryA"] },
        guardA: { to: ["entryA"] },
        entryA: { foldedWith: ["alias"], to: ["onlyA"] },
        onlyA: {},
      },
      oneFeatureGuards,
    );
    expect(result.failures).toEqual([]);
    expect(result.foldedEntryPoints).toHaveLength(1);
    expect(result.foldedEntryPoints).toEqual(result.entryPoints);
    expect(result.retained()).toEqual(["main", "guardA", "entryA", "onlyA"]);
  });

  test("an entry point that only returns, which the compiler has made another empty function jump to, is not removable and is not a failure", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA", "alsoEmpty"] },
        guardA: { to: ["entryA"] },
        alsoEmpty: { size: 10, to: ["entryA"] },
        entryA: { size: 6 },
      },
      oneFeatureGuards,
    );
    expect(result.failures).toEqual([]);
    expect(result.foldedEntryPoints).toEqual(result.entryPoints);
    expect(result.retained()).toEqual(["main", "guardA", "alsoEmpty", "entryA"]);
  });

  test("an entry point that only returns and that only its guards refer to leaves with its feature", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA"] },
        guardA: { to: ["entryA"] },
        entryA: { size: 6 },
      },
      oneFeatureGuards,
    );
    expect(result.failures).toEqual([]);
    expect(result.foldedEntryPoints).toEqual([]);
    expect(result.features("entryA")).toEqual([A]);
  });

  describe("exports", () => {
    const library: Record<string, Section> = {
      main: { root: true },
      api: { exported: true, to: ["onlyApi"] },
      onlyApi: {},
    };
    const modelWithExports = abcWith(C, { exports: true });

    test("are retained when no feature owns them", () => {
      const result = partitioned(library, []);
      expect(result.failures).toEqual([]);
      expect(result.retained()).toEqual(["main", "api", "onlyApi"]);
    });

    test("belong to the feature that owns them", () => {
      const result = partitioned(library, [], modelWithExports);
      expect(result.failures).toEqual([]);
      expect(result.features("api")).toEqual([C]);
      expect(result.features("onlyApi")).toEqual([C]);
      expect(result.retained()).toEqual(["main"]);
    });

    test("add their feature to an exported entry point of another feature", () => {
      const result = partitioned(
        { main: { root: true, to: ["guardB"] }, guardB: { to: ["entryB"] }, entryB: { exported: true } },
        [["guardB", "entryB", B]],
        modelWithExports,
      );
      expect(result.failures).toEqual([]);
      expect(result.features("entryB")).toEqual([B, C]);
    });
  });

  test("an unexplained section becomes a root", () => {
    const result = partitioned({ main: { root: true }, orphan: { to: ["orphanTarget"] }, orphanTarget: {} }, []);
    expect(result.failures).toEqual([]);
    expect(Array.from(result.isRoot)).toEqual([1, 1, 1]);
    expect(result.retained()).toEqual(["main", "orphan", "orphanTarget"]);
    expect(result.unexplainedBytes).toBe(0x4000);
  });

  test("a section that is live only by a flag is neither a root nor retained", () => {
    const result = partitioned({ main: { root: true }, flagged: { live: true } }, []);
    expect(result.failures).toEqual([]);
    expect(Array.from(result.isRoot)).toEqual([1, 0]);
    expect(result.retained()).toEqual(["main"]);
    expect(result.setOf[result.node("flagged")]).toBe(0);
    expect(result.unexplainedBytes).toBe(0);
  });

  test("a small set joins a superset, and without a superset it stays and gets no group", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA", "guardB", "guardC"] },
        guardA: { to: ["entryA"] },
        guardB: { to: ["entryB"] },
        guardC: { to: ["entryC"] },
        entryA: { size: 16, to: ["sharedAB"] },
        entryB: { to: ["sharedAB"] },
        entryC: { size: 16 },
        sharedAB: { size: 0x4000 },
      },
      [...twoFeaturesGuards, ["guardC", "entryC", C]],
    );
    expect(result.failures).toEqual([]);
    expect(result.exactFeatures("entryA")).toEqual([A]);
    expect(result.features("entryA")).toEqual([A, B]);
    expect(result.features("entryC")).toEqual([C]);
    expect(result.groupOfSet.has(result.setOf[result.node("entryC")]!)).toBe(false);
  });

  test("groups of features that only the command line enters come first, and features with dependents come last", () => {
    const result = partitioned(threeFeatures, threeFeaturesGuards);
    expect(result.failures).toEqual([]);
    expect(result.groups.map(group => result.sets[group.set])).toEqual([[Tools], [A], [B]]);
    expect(result.layoutRank[Tools]).toBe(0);
    expect(result.groups.map(group => result.groupOfSet.get(group.set))).toEqual([0, 1, 2]);
  });

  test("what every compiled program leaves out lies together: the JIT's groups stand with the command line's, in front of a program's", () => {
    const named = (index: number, name: string) =>
      modelOf(...abc.features.map(each => (each.index === index ? { ...each, name } : each)));
    const sections = { ...threeFeatures, entryT: { to: ["sharedBT"] }, entryB: { to: ["sharedBT"] }, sharedBT: {} };
    const groupsOf = (model: FeatureModel) => {
      const result = partitioned(sections, threeFeaturesGuards, model);
      expect(result.failures).toEqual([]);
      return result.groups.map(group => result.sets[group.set]);
    };
    expect(groupsOf(abc)).toEqual([[Tools], [A], [B], [B, Tools]]);
    expect(groupsOf(named(B, "JIT"))).toEqual([[Tools], [B], [B, Tools], [A]]);
  });

  test("a set without movable bytes gets no group and stays a set", () => {
    const result = partitioned({ ...threeFeatures, entryT: { output: ".data" } }, threeFeaturesGuards);
    expect(result.failures).toEqual([]);
    expect(result.groups.map(group => result.sets[group.set])).toEqual([[A], [B]]);
    expect(result.features("entryT")).toEqual([Tools]);
  });

  type MinimumCase = [
    label: string,
    minimumBytes: Feature["minimumBytes"],
    failures: PartitionFailure[],
    featuresNearMinimum: number[],
  ];
  const minimumCases: MinimumCase[] = [
    [
      "above the removable bytes fails",
      { elf: 0x100000 },
      [{ kind: "FeatureBelowMinimum", feature: A, bytes: 0x4000, minimum: 0x100000 }],
      [],
    ],
    ["above half of the removable bytes is near", { elf: 0x3000 }, [], [A]],
    ["of at most half of the removable bytes passes", { elf: 0x1000 }, [], []],
    ["for another object format is ignored", { macho: 0x100000 }, [], []],
  ];

  test.each(minimumCases)("a minimum size %s", (_label, minimumBytes, failures, featuresNearMinimum) => {
    const result = partitioned(oneFeature, oneFeatureGuards, abcWith(A, { minimumBytes }));
    expect(result.failures).toEqual(failures);
    expect(result.featuresNearMinimum).toEqual(featuresNearMinimum);
    expect(result.removableBytes.get(A)).toBe(0x4000);
  });

  test("the same input produces the same result", () => {
    const first = partitioned(threeFeatures, threeFeaturesGuards);
    const second = partitioned(threeFeatures, threeFeaturesGuards);
    expect(second.sets).toEqual(first.sets);
    expect(second.groups).toEqual(first.groups);
    expect(second.edges).toEqual(first.edges);
    expect(Array.from(second.setOf)).toEqual(Array.from(first.setOf));
    expect(Array.from(second.edgeKind)).toEqual(Array.from(first.edgeKind));
    expect(Array.from(second.layoutRank)).toEqual(Array.from(first.layoutRank));
  });
});

describe("an address in a static table", () => {
  const builtinOfA = { builtin: 7 };
  const table: Record<string, Section> = {
    main: { root: true, to: ["table"] },
    table: { output: tableOutput, to: ["entryA", "text"] },
    text: { output: ".rodata" },
    entryA: { to: ["onlyA"] },
    onlyA: {},
  };
  const tableGuards: Guard[] = [["table", "entryA", A, builtinOfA]];

  test("is a soft edge: the table stays and the function leaves with its feature", () => {
    const result = partitioned(table, tableGuards);
    expect(result.failures).toEqual([]);
    expect(edgeKindOf(result, "table", "entryA")).toBe(EdgeKind.Soft);
    expect(edgeKindOf(result, "table", "text")).toBe(EdgeKind.Ordinary);
    expect(result.retained()).toEqual(["main", "table", "text"]);
    expect(result.features("entryA")).toEqual([A]);
    expect(result.features("onlyA")).toEqual([A]);
    expect(result.edges).toEqual([]);
  });

  test("does not forbid retained code to refer to the function, which is then retained", () => {
    const result = partitioned({ ...table, main: { root: true, to: ["table", "entryA"] } }, tableGuards);
    expect(result.failures).toEqual([]);
    expect(edgeKindOf(result, "table", "entryA")).toBe(EdgeKind.Soft);
    expect(edgeKindOf(result, "main", "entryA")).toBe(EdgeKind.Ordinary);
    expect(result.retained()).toEqual(["main", "table", "text", "entryA", "onlyA"]);
    expect(result.features("entryA")).toEqual([]);
  });

  test("gives the function the feature of other code that refers to it", () => {
    const result = partitioned(
      {
        ...table,
        main: { root: true, to: ["table", "guardB"] },
        guardB: { to: ["entryB"] },
        entryB: { to: ["entryA"] },
      },
      [...tableGuards, ["guardB", "entryB", B]],
    );
    expect(result.failures).toEqual([]);
    expect(edgeKindOf(result, "entryB", "entryA")).toBe(EdgeKind.Ordinary);
    expect(result.features("entryA")).toEqual([A, B]);
    expect(result.edges).toEqual([]);
  });

  test("beside a guard in code, a third referrer that is retained still fails", () => {
    const result = partitioned(
      { ...table, main: { root: true, to: ["table", "guardA", "entryA"] }, guardA: { to: ["entryA"] } },
      [...tableGuards, ["guardA", "entryA", A]],
    );
    expect(edgeKindOf(result, "table", "entryA")).toBe(EdgeKind.Soft);
    expect(edgeKindOf(result, "guardA", "entryA")).toBe(EdgeKind.Guarded);
    expect(edgeKindOf(result, "main", "entryA")).toBe(EdgeKind.Unguarded);
    expect(result.failures).toEqual([
      {
        kind: "EntryPointReferencedByRetainedCode",
        entry: result.node("entryA"),
        referrer: result.node("main"),
        features: [A],
      },
    ]);
  });

  test("without a reference from the table to the function fails", () => {
    const result = partitioned({ ...table, table: { output: tableOutput, to: ["text"] } }, tableGuards);
    expect(result.failures).toContainEqual({
      kind: "GuardWithoutReference",
      guard: result.node("table"),
      entry: result.node("entryA"),
      feature: A,
    });
  });

  test("keeps a small function in its own set, while its small neighbors join a superset", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["table", "guardA", "guardB"] },
        table: { output: tableOutput, to: ["listedA"] },
        guardA: { to: ["entryA"] },
        guardB: { to: ["entryB"] },
        listedA: { size: 16, to: ["sharedAB"] },
        entryA: { size: 16, to: ["sharedAB"] },
        entryB: { to: ["sharedAB"] },
        sharedAB: { size: 0x4000 },
      },
      [["table", "listedA", A, builtinOfA], ...twoFeaturesGuards],
    );
    expect(result.failures).toEqual([]);
    expect(result.exactFeatures("entryA")).toEqual([A]);
    expect(result.features("entryA")).toEqual([A, B]);
    expect(result.exactFeatures("listedA")).toEqual([A]);
    expect(result.features("listedA")).toEqual([A]);
  });
});

describe("a violation", () => {
  test("retained code refers to an entry point", () => {
    const result = partitioned({ ...oneFeature, main: { root: true, to: ["guardA", "entryA"] } }, oneFeatureGuards);
    expect(result.failures).toEqual([
      {
        kind: "EntryPointReferencedByRetainedCode",
        entry: result.node("entryA"),
        referrer: result.node("main"),
        features: [A],
      },
    ]);
    expect(result.features("onlyA")).toEqual([A]);
  });

  test("an entry point is a root", () => {
    const result = partitioned({ ...oneFeature, entryA: { root: true, to: ["onlyA", "shared"] } }, oneFeatureGuards);
    expect(result.failures).toEqual([
      { kind: "EntryPointReferencedByRetainedCode", entry: result.node("entryA"), referrer: undefined, features: [A] },
    ]);
    expect(result.features("onlyA")).toEqual([]);
  });

  test("retained code refers to an entry point of two features", () => {
    const result = partitioned(
      { ...sharedEntryPoint, main: { root: true, to: ["guardA", "guardB", "guardC", "both"] } },
      sharedEntryPointGuards,
    );
    expect(result.failures).toEqual([
      {
        kind: "EntryPointReferencedByRetainedCode",
        entry: result.node("both"),
        referrer: result.node("main"),
        features: [A, B],
      },
    ]);
    expect(result.features("entryC")).toEqual([C]);
  });

  test("a guard has no reference to its entry point", () => {
    const result = partitioned({ ...oneFeature, guardA: { to: ["shared"] } }, oneFeatureGuards);
    expect(result.failures).toContainEqual({
      kind: "GuardWithoutReference",
      guard: result.node("guardA"),
      entry: result.node("entryA"),
      feature: A,
    });
    expect(result.features("onlyA")).toEqual([]);
  });
});

describe("failure reports and review files", () => {
  const uses: BuiltinUses = {
    entries: [
      {
        id: 7,
        path: "Bun.alpha",
        kind: "Function",
        uses: [{ feature: "A", isConditional: false }],
        nativeSymbols: [],
        hasHiddenRoot: false,
      },
    ],
  };
  const contextOf = (result: Partitioned): ReportContext => ({
    graph: result.graph,
    model: abc,
    uses,
    demangler: undefined,
    partition: result,
  });

  const guarded = partitioned(oneFeature, oneFeatureGuards);
  const rangeOfA = {
    start: guarded.graph.address[guarded.node("entryA")]!,
    end: guarded.graph.address[guarded.node("shared")]!,
    set: guarded.setOf[guarded.node("entryA")]!,
    isCode: true,
    canBeCut: true,
    canBeFilled: true,
  };
  const guardWithoutReference: LinkFailure = {
    kind: "GuardWithoutReference",
    guard: guarded.node("guardA"),
    entry: guarded.node("entryA"),
    feature: A,
  };
  const guardOfUnknownBuiltin: LinkFailure = {
    kind: "GuardOfUnknownBuiltin",
    builtin: 9,
    guard: guarded.node("guardA"),
    entry: guarded.node("entryA"),
    feature: A,
  };
  const undeclaredUse: LinkFailure = { kind: "UndeclaredUse", builtin: 7, entry: guarded.node("entryA"), feature: B };
  const useWithoutGuard: LinkFailure = { kind: "UseWithoutGuard", builtin: 7, feature: A };
  const guardWithoutUser: LinkFailure = {
    kind: "GuardWithoutUser",
    guard: guarded.node("guardA"),
    entry: guarded.node("entryA"),
    feature: A,
  };
  const kindCases: [label: string, failure: LinkFailure][] = [
    ["UnreadInput", { kind: "UnreadInput", object: "toy.o", reason: "NotFound" }],
    ["UnresolvedReference", { kind: "UnresolvedReference", object: "toy.o", section: ".text.main", target: "gone" }],
    ["GuardWithoutReference", guardWithoutReference],
    [
      "GuardWithoutReference for an entry point outside the image",
      { kind: "GuardWithoutReference", guard: guarded.node("guardA"), entry: undefined, feature: A, target: "gone" },
    ],
    [
      "EntryPointReferencedByRetainedCode",
      {
        kind: "EntryPointReferencedByRetainedCode",
        entry: guarded.node("entryA"),
        referrer: guarded.node("main"),
        features: [A],
      },
    ],
    [
      "EntryPointReferencedByRetainedCode for a root",
      {
        kind: "EntryPointReferencedByRetainedCode",
        entry: guarded.node("entryA"),
        referrer: undefined,
        features: [A],
      },
    ],
    ["FeatureBelowMinimum", { kind: "FeatureBelowMinimum", feature: A, bytes: 0x4000, minimum: 0x100000 }],
    ["GuardOfUnknownBuiltin", guardOfUnknownBuiltin],
    ["UndeclaredUse", undeclaredUse],
    ["UseWithoutGuard", useWithoutGuard],
    ["GuardWithoutUser", guardWithoutUser],
    [
      "RetainedSectionInRemovableRange",
      { kind: "RetainedSectionInRemovableRange", node: guarded.node("shared"), range: rangeOfA },
    ],
  ];

  test.each(kindCases)("the text of %s starts with its kind", (_label, failure) => {
    const text = describeFailures([failure], contextOf(guarded));
    expect(text).toStartWith(failure.kind + ": ");
    expect(text).not.toEndWith("\n");
  });

  test("a guard whose entry point is not in the image says what its function does refer to", () => {
    const busy = partitioned(
      {
        main: { root: true, to: ["guardA", "quiet"] },
        guardA: { to: ["entryA", "one", "two", "three"] },
        quiet: {},
        entryA: {},
        one: {},
        two: {},
        three: {},
      },
      oneFeatureGuards,
    );
    const gone = (guard: string): LinkFailure => ({
      kind: "GuardWithoutReference",
      guard: busy.node(guard),
      entry: undefined,
      feature: A,
      target: "gone",
    });
    expect(describeFailures([gone("guardA")], contextOf(busy)).split("\n")[1]).toBe(
      "  it refers to entryA (toy.o, 8192 bytes), one (toy.o, 8192 bytes), two (toy.o, 8192 bytes) and 1 more",
    );
    expect(describeFailures([gone("quiet")], contextOf(busy)).split("\n")).toHaveLength(1);
  });

  test("a failure of the declared uses names the built-in by its path, the sections and the feature", () => {
    const describe = (failure: LinkFailure) => describeFailures([failure], contextOf(guarded));
    expect(describe(guardOfUnknownBuiltin)).toBe(
      "GuardOfUnknownBuiltin: the guard in guardA (toy.o, 8192 bytes) enters entryA (toy.o, 8192 bytes) as built-in 9, which builtin-uses.json does not list",
    );
    expect(describe(undeclaredUse)).toBe(
      'UndeclaredUse: Bun.alpha (entryA (toy.o, 8192 bytes)) reaches a guard of B, and its table entry has no "uses B": a program that calls it would lose B under --trim',
    );
    expect(describe(useWithoutGuard)).toBe(
      'UseWithoutGuard: Bun.alpha declares "uses A", and no guard of A is reachable from it: the line retains A for nothing',
    );
    expect(describe(guardWithoutUser)).toBe(
      "GuardWithoutUser: guardA (toy.o, 8192 bytes) enters entryA (toy.o, 8192 bytes), an entry point of A, and no table entry uses A and no feature's code enters it: --trim would always remove it",
    );
  });

  test("a built-in that the uses do not list, or a context without uses, is named by its id", () => {
    expect(describeFailures([{ ...useWithoutGuard, builtin: 9 }], contextOf(guarded))).toStartWith(
      'UseWithoutGuard: built-in 9 declares "uses A"',
    );
    expect(describeFailures([useWithoutGuard], { ...contextOf(guarded), uses: undefined })).toStartWith(
      'UseWithoutGuard: built-in 7 declares "uses A"',
    );
  });

  test("failures are printed by kind, in the order of the steps that find them", () => {
    const failures = [guardWithoutUser, useWithoutGuard, guardWithoutReference, undeclaredUse, guardOfUnknownBuiltin];
    expect(
      describeFailures(failures, contextOf(guarded))
        .split("\n")
        .map(line => line.slice(0, line.indexOf(":"))),
    ).toEqual([
      "GuardWithoutReference",
      "GuardOfUnknownBuiltin",
      "UndeclaredUse",
      "UseWithoutGuard",
      "GuardWithoutUser",
    ]);
  });

  function retainedChain(length: number): Partitioned {
    const sections: Record<string, Section> = {
      main: { root: true, to: ["guardA", "s1"] },
      guardA: { to: ["entryA"] },
      entryA: {},
    };
    for (let link = 1; link <= length; link++) {
      sections[`s${link}`] = { to: [link === length ? "entryA" : `s${link + 1}`] };
    }
    return partitioned(sections, oneFeatureGuards);
  }

  test("a long chain is truncated", () => {
    const result = retainedChain(8);
    expect(result.failures).toEqual([
      {
        kind: "EntryPointReferencedByRetainedCode",
        entry: result.node("entryA"),
        referrer: result.node("s8"),
        features: [A],
      },
    ]);
    const text = describeFailures(result.failures, contextOf(result));
    const links = text.split("\n").filter(line => line.includes("<- "));
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(maxChainLength);
    expect(text).not.toContain("main (");
  });

  test("a short chain ends at the root", () => {
    const result = retainedChain(3);
    const [, ...chain] = describeFailures(result.failures, contextOf(result)).split("\n");
    expect(chain).toEqual([
      "  s3 (toy.o, 8192 bytes)",
      "      <- s2 (toy.o, 8192 bytes)",
      "      <- s1 (toy.o, 8192 bytes)",
      "      <- main (toy.o, 8192 bytes)",
    ]);
  });

  test("failures past the limit are counted", () => {
    const failures = Array.from({ length: maxPrintedFailures + 5 }, (_, index): LinkFailure => ({
      kind: "UnreadInput",
      object: `toy${index}.o`,
      reason: "NotFound",
    }));
    const lines = describeFailures(failures, contextOf(guarded)).split("\n");
    expect(lines).toHaveLength(maxPrintedFailures + 1);
    expect(lines.filter(line => line.startsWith("UnreadInput: "))).toHaveLength(maxPrintedFailures);
    expect(lines.at(-1)).toBe("  and 5 more");
  });

  function reviewFilesOf(result: Partitioned): Record<string, string> {
    using dir = tempDir("trim-review", {});
    writeReviewFiles(String(dir), contextOf(result), result.entryPoints);
    return Object.fromEntries(
      readdirSync(String(dir))
        .sort()
        .map(file => [file, readFileSync(join(String(dir), file), "utf8")]),
    );
  }

  test("writeReviewFiles writes four files, each ending in a newline", () => {
    const result = partitioned(
      { ...twoFeatures, entryA: { to: ["entryB", "onlyA2"] }, onlyA2: { to: ["entryB"] } },
      twoFeaturesGuards,
    );
    const files = reviewFilesOf(result);
    expect(Object.keys(files)).toEqual(["entry-points.txt", "groups.txt", "requires.txt", "retained-by.txt"]);
    for (const text of Object.values(files)) expect(text).toEndWith("\n");
    expect(files["requires.txt"]).toBe(
      [
        "A requires B: 2 references",
        "    entryB (toy.o, 8192 bytes) <- entryA (toy.o, 8192 bytes)",
        "    entryB (toy.o, 8192 bytes) <- onlyA2 (toy.o, 8192 bytes)",
        "",
      ].join("\n"),
    );
    expect(files["entry-points.txt"]).toMatch(/^A Abort 8192 entryA \(toy\.o, 8192 bytes\) <- guardA/m);
  });

  test("requires.txt lists the references first, then the guards with what they do and who answers for them", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA", "guardB", "guardC"] },
        guardA: { to: ["entryA"] },
        guardB: { to: ["entryB"] },
        guardC: { to: ["entryC"] },
        entryA: { to: ["entryB", "entryC"] },
        entryB: { to: ["entryA", "entryC"] },
        entryC: { to: ["entryA"] },
      },
      [
        ["guardA", "entryA", A, { builtin: 7 }],
        ["guardB", "entryB", B],
        ["guardC", "entryC", C],
        ["entryA", "entryB", B, { stub: "Abort" }],
        ["entryA", "entryC", C, { stub: "Throw" }],
        ["entryB", "entryC", C, { stub: "ReturnDefault" }],
      ],
    );
    expect(result.failures).toEqual([]);
    expect(reviewFilesOf(result)["requires.txt"]).toBe(
      [
        "B requires A: 1 references",
        "    entryA (toy.o, 8192 bytes) <- entryB (toy.o, 8192 bytes)",
        "C requires A: 1 references",
        "    entryA (toy.o, 8192 bytes) <- entryC (toy.o, 8192 bytes)",
        "A enters B: aborting guard",
        "A enters C: recoverable guard, answered elsewhere",
        "B enters C: recoverable guard",
        "",
      ].join("\n"),
    );
  });

  test("requires.txt says that a guard only a built-in reaches is answered elsewhere", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA", "guardC"] },
        guardA: { to: ["entryA"] },
        guardC: { to: ["entryC"] },
        entryA: { to: ["entryC"] },
        entryC: {},
      },
      [
        ["guardA", "entryA", A, { builtin: 7 }],
        ["guardC", "entryC", C],
        ["entryA", "entryC", C, { stub: "Throw" }],
      ],
    );
    expect(result.failures).toEqual([]);
    expect(reviewFilesOf(result)["requires.txt"]).toBe("A enters C: recoverable guard, answered elsewhere\n");
  });

  test("entry-points.txt lists the aliases of a folded entry point", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA", "entryA"] },
        guardA: { to: ["entryA"] },
        entryA: { foldedWith: ["_ZN5other3runEv", "helper"] },
      },
      oneFeatureGuards,
    );
    expect(reviewFilesOf(result)["entry-points.txt"]).toEndWith(
      `${foldedEntryPointsHeading}\n  A entryA (toy.o, 8192 bytes): _ZN5other3runEv, helper\n`,
    );
  });

  function retainedByText(size: number): string {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA", "s1"] },
        guardA: { to: ["entryA"] },
        entryA: { to: ["s1"] },
        s1: { size, to: ["s2"] },
        s2: { size, to: ["s3"] },
        s3: { size },
      },
      oneFeatureGuards,
    );
    return reviewFilesOf(result)["retained-by.txt"]!;
  }

  test("retained-by.txt credits a chain to the section retained code reaches first", () => {
    const text = retainedByText(8192);
    expect(text).toMatch(/^A:$/m);
    expect(text.match(/^  0\.02 MB s1 \(/gm)).toHaveLength(1);
    expect(text).not.toMatch(/^  \S+ MB s[23] \(/m);
  });

  test("retained-by.txt omits a feature that shares less than the smallest group", () => {
    expect(retainedByText(1024)).not.toContain("A:");
  });

  test("writeReviewFiles throws without a partition", () => {
    using dir = tempDir("trim-review", {});
    const context = { ...contextOf(guarded), partition: undefined };
    expect(() => writeReviewFiles(String(dir), context, guarded.entryPoints)).toThrow(BuildError);
  });

  const failingTool = Bun.which("false");

  test.skipIf(failingTool === null)("a failed run of the demangler throws", () => {
    const context = { ...contextOf(guarded), demangler: failingTool! };
    expect(() => describeFailures([guardWithoutReference], context)).toThrow(BuildError);
  });
});

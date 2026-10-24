import { describe, expect, test } from "bun:test";

import {
  checkDeclaredUses,
  findUsedFeaturesWithoutGuard,
  findWayToGuard,
  guardedFeaturesReachedFrom,
} from "../../../scripts/build/trim/declared-uses.ts";
import type { BuiltinEntry, BuiltinUses, FeatureModel } from "../../../scripts/build/trim/types.ts";
import {
  A,
  B,
  C,
  Startup,
  Tools,
  abc,
  partitioned,
  tableOutput,
  type Guard,
  type Partitioned,
  type Section,
} from "./toy-graph.ts";

type Use = string | { conditional: string };

const builtin = (id: number, ...uses: Use[]): BuiltinEntry => ({
  id,
  path: `Bun.builtin${id}`,
  kind: "Function",
  uses: uses.map(use =>
    typeof use === "string"
      ? { feature: use, isConditional: false }
      : { feature: use.conditional, isConditional: true },
  ),
  nativeSymbols: [],
  hasHiddenRoot: false,
});

const inputOf = (result: Partitioned, entries: BuiltinEntry[]) => ({
  graph: result.graph,
  model: result.model,
  uses: { entries } satisfies BuiltinUses,
  entryPoints: result.entryPoints,
  partition: result,
});

function check(sections: Record<string, Section>, guards: Guard[], entries: BuiltinEntry[], model: FeatureModel = abc) {
  const result = partitioned(sections, guards, model);
  expect(result.failures).toEqual([]);
  return { result, failures: checkDeclaredUses(inputOf(result, entries)) };
}

const callsC: Record<string, Section> = {
  main: { root: true, to: ["guardA"] },
  guardA: { to: ["entryA"] },
  entryA: { to: ["entryC"] },
  entryC: {},
};
const callsCGuards: Guard[] = [
  ["guardA", "entryA", A, { builtin: 7 }],
  ["entryA", "entryC", C, { stub: "Throw" }],
];

describe("guardedFeaturesReachedFrom", () => {
  const reachedFrom = (result: Partitioned, name: string) => {
    const { setOf, sets } = guardedFeaturesReachedFrom(inputOf(result, []));
    return sets[setOf[result.node(name)]!]!;
  };

  test("is what removable code can enter from a section without passing a guard", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA"] },
        guardA: { to: ["entryA"] },
        entryA: { to: ["helper", "entryB"] },
        helper: { to: ["entryC"] },
        entryB: { to: ["entryT"] },
        entryC: {},
        entryT: {},
      },
      [
        ["guardA", "entryA", A],
        ["entryA", "entryB", B],
        ["helper", "entryC", C],
        ["entryB", "entryT", Tools],
      ],
    );
    expect(result.failures).toEqual([]);
    expect(reachedFrom(result, "entryA")).toEqual([B, C]);
    expect(reachedFrom(result, "helper")).toEqual([C]);
    expect(reachedFrom(result, "entryB")).toEqual([Tools]);
    expect(reachedFrom(result, "entryC")).toEqual([]);
    expect(reachedFrom(result, "guardA")).toEqual([]);
  });

  test("leaves out a folded entry point and the functions that a table lists", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA"] },
        guardA: { to: ["entryA"] },
        entryA: { to: ["entryB", "tableOfA"] },
        tableOfA: { output: tableOutput, to: ["entryC"] },
        entryB: { foldedWith: ["alias"] },
        entryC: {},
      },
      [
        ["guardA", "entryA", A],
        ["entryA", "entryB", B],
        ["tableOfA", "entryC", C, { builtin: 9 }],
      ],
    );
    expect(result.failures).toEqual([]);
    expect(reachedFrom(result, "entryA")).toEqual([]);
  });
});

describe("GuardOfUnknownBuiltin", () => {
  test("a guard with an id that the uses do not list fails", () => {
    const { result, failures } = check(callsC, callsCGuards, [builtin(8, "A")]);
    expect(failures).toEqual([
      {
        kind: "GuardOfUnknownBuiltin",
        builtin: 7,
        guard: result.node("guardA"),
        entry: result.node("entryA"),
        feature: A,
      },
    ]);
  });

  test("a guard with a listed id, and a guard in native code, do not", () => {
    expect(check(callsC, callsCGuards, [builtin(7, "A", "C")]).failures).toEqual([]);
  });
});

describe("UndeclaredUse: an edge no line declares", () => {
  test("the feature of the built-in's own guard has to be declared", () => {
    const { result, failures } = check(callsC, callsCGuards, [builtin(7, "C"), builtin(8, "A")]);
    expect(failures).toEqual([{ kind: "UndeclaredUse", builtin: 7, entry: result.node("entryA"), feature: A }]);
  });

  test("a feature whose guard the entry point reaches has to be declared", () => {
    const { result, failures } = check(callsC, callsCGuards, [builtin(7, "A")]);
    expect(failures).toEqual([{ kind: "UndeclaredUse", builtin: 7, entry: result.node("entryA"), feature: C }]);
  });

  test("the way from the entry point to the guard is the shortest, and ends at what the guard enters", () => {
    const { result } = check(
      {
        ...callsC,
        entryA: { to: ["detour", "helper"] },
        detour: { to: ["longer"] },
        longer: { to: ["deeper"] },
        helper: { to: ["deeper"] },
        deeper: { to: ["entryC"] },
      },
      [callsCGuards[0]!, ["deeper", "entryC", C, { stub: "Throw" }]],
      [builtin(7, "A")],
    );
    const way = (from: string, feature: number) => findWayToGuard(inputOf(result, []), result.node(from), feature);
    expect(way("entryA", C)).toEqual(["entryA", "helper", "deeper", "entryC"].map(name => result.node(name)));
    expect(way("entryA", B)).toEqual([]);
    expect(way("entryC", C)).toEqual([]);
  });

  test("a conditional use declares it", () => {
    expect(check(callsC, callsCGuards, [builtin(7, "A", { conditional: "C" })]).failures).toEqual([]);
  });

  test("a guard two calls deep is found", () => {
    const { result, failures } = check(
      { ...callsC, entryA: { to: ["helper"] }, helper: { to: ["deeper"] }, deeper: { to: ["entryC"] } },
      [callsCGuards[0]!, ["deeper", "entryC", C, { stub: "Throw" }]],
      [builtin(7, "A")],
    );
    expect(failures).toEqual([{ kind: "UndeclaredUse", builtin: 7, entry: result.node("entryA"), feature: C }]);
  });

  test("a guard that only the entry point of another guard reaches is not the built-in's", () => {
    const { failures } = check(
      { ...callsC, entryC: { to: ["entryB"] }, entryB: {} },
      [...callsCGuards, ["entryC", "entryB", B, { stub: "Throw" }]],
      [builtin(7, "A", "C")],
    );
    expect(failures).toEqual([]);
  });

  test.each([
    ["a setting enters at start-up", Startup],
    ["only the command line enters", Tools],
  ])("a guard of a feature that %s needs no line: no use by the program retains it", (_, feature) => {
    expect(
      check(callsC, [callsCGuards[0]!, ["entryA", "entryC", feature, { stub: "Throw" }]], [builtin(7, "A")]).failures,
    ).toEqual([]);
  });

  test("a function that a table in the built-in's code lists needs no line", () => {
    const { failures } = check(
      { ...callsC, entryA: { to: ["tableOfA"] }, tableOfA: { output: tableOutput, to: ["entryC"] } },
      [callsCGuards[0]!, ["tableOfA", "entryC", C, { builtin: 8 }]],
      [builtin(7, "A"), builtin(8, "C")],
    );
    expect(failures).toEqual([]);
  });

  test("fails once for a built-in and a feature, at the lowest entry point", () => {
    const { result, failures } = check(
      {
        main: { root: true, to: ["guardA"] },
        guardA: { to: ["getterA", "setterA"] },
        setterA: { to: ["entryC"] },
        getterA: { to: ["entryC"] },
        entryC: {},
      },
      [
        ["guardA", "getterA", A, { builtin: 7 }],
        ["guardA", "setterA", A, { builtin: 7 }],
        ["getterA", "entryC", C, { stub: "Throw" }],
        ["setterA", "entryC", C, { stub: "Throw" }],
      ],
      [builtin(7, "A")],
    );
    expect(result.node("setterA")).toBeLessThan(result.node("getterA"));
    expect(failures).toEqual([{ kind: "UndeclaredUse", builtin: 7, entry: result.node("setterA"), feature: C }]);
  });
});

describe("UseWithoutGuard: a line no guard matches", () => {
  const apart: Record<string, Section> = {
    main: { root: true, to: ["guardA", "guardB"] },
    guardA: { to: ["entryA"] },
    guardB: { to: ["entryB"] },
    entryA: {},
    entryB: { to: ["entryC"] },
    entryC: {},
  };
  const apartGuards: Guard[] = [
    ["guardA", "entryA", A, { builtin: 7 }],
    ["guardB", "entryB", B, { builtin: 8 }],
    ["entryB", "entryC", C, { stub: "Throw" }],
  ];

  test("a use of a feature whose guards are all in removable code that the built-in does not reach fails", () => {
    expect(check(apart, apartGuards, [builtin(7, "A", "C"), builtin(8, "B", "C")]).failures).toEqual([
      { kind: "UseWithoutGuard", builtin: 7, feature: C },
    ]);
  });

  test("a feature that is guarded at definitions alone passes: every reference to such a function is cut, whoever makes it", () => {
    const atDefinition: Guard[] = [...apartGuards.slice(0, 2), ["entryB", "entryC", C, { origin: "Definition" }]];
    expect(check(apart, atDefinition, [builtin(7, "A", "C"), builtin(8, "B", "C")]).failures).toEqual([]);
  });

  test("a conditional use fails the same way", () => {
    expect(check(apart, apartGuards, [builtin(7, "A", { conditional: "C" }), builtin(8, "B", "C")]).failures).toEqual([
      { kind: "UseWithoutGuard", builtin: 7, feature: C },
    ]);
  });

  test("a built-in without a record fails the same way", () => {
    expect(check(apart, apartGuards, [builtin(7, "A"), builtin(8, "B", "C"), builtin(9, "C")]).failures).toEqual([
      { kind: "UseWithoutGuard", builtin: 9, feature: C },
    ]);
  });

  test("the built-in's own guard and a guard it reaches match", () => {
    expect(check(apart, apartGuards, [builtin(7, "A"), builtin(8, "B", "C")]).failures).toEqual([]);
  });

  test("a guard of the feature in retained code matches every line: the graph cannot say for whom retained code runs", () => {
    const { failures } = check(
      { ...apart, main: { root: true, to: ["guardA", "guardB", "guardC"] }, guardC: { to: ["entryC"] } },
      [...apartGuards, ["guardC", "entryC", C]],
      [builtin(7, "A", "C"), builtin(8, "B", "C"), builtin(9, "C")],
    );
    expect(failures).toEqual([]);
  });

  test("what another built-in behind the same guard feature reaches matches: the root that hands out a class's instances declares what its methods enter", () => {
    const { failures } = check(
      {
        main: { root: true, to: ["guardA"] },
        guardA: { to: ["createA", "methodOfA"] },
        createA: {},
        methodOfA: { to: ["entryC"] },
        entryC: {},
      },
      [
        ["guardA", "createA", A, { builtin: 7 }],
        ["guardA", "methodOfA", A, { builtin: 8 }],
        ["methodOfA", "entryC", C, { stub: "Throw" }],
      ],
      [builtin(7, "A", "C"), builtin(8, "A", "C")],
    );
    expect(failures).toEqual([]);
  });

  test("a feature without any guard owns no bytes, so a line that names it retains nothing and passes", () => {
    const { result, failures } = check(apart, apartGuards.slice(0, 1), [builtin(7, "A", "C", "B")]);
    expect(failures).toEqual([]);
    expect(findUsedFeaturesWithoutGuard(inputOf(result, [builtin(7, "A", "C", "B")]))).toEqual([B, C]);
    expect(findUsedFeaturesWithoutGuard(inputOf(result, [builtin(7, "A")]))).toEqual([]);
  });
});

describe("GuardWithoutUser", () => {
  const guarded: Record<string, Section> = {
    main: { root: true, to: ["guardA", "laterGuardA"] },
    guardA: { to: ["entryA", "otherEntryA"] },
    laterGuardA: { to: ["entryA"] },
    otherEntryA: {},
    entryA: {},
  };
  const guards = (feature: number): Guard[] => [
    ["laterGuardA", "entryA", feature],
    ["guardA", "entryA", feature],
    ["guardA", "otherEntryA", feature],
  ];

  test("a feature of the program with a guard, no use and no entering edge fails, at its lowest guard and entry point", () => {
    const { result, failures } = check(guarded, guards(A), []);
    expect(failures).toEqual([
      { kind: "GuardWithoutUser", guard: result.node("guardA"), entry: result.node("otherEntryA"), feature: A },
    ]);
  });

  test("a use, also a conditional one, is a user", () => {
    expect(check(guarded, guards(A), [builtin(7, "A")]).failures).toEqual([]);
    expect(check(guarded, guards(A), [builtin(7, { conditional: "A" })]).failures).toEqual([]);
  });

  test("an edge from another feature's code is a user, followed or not", () => {
    const { result, failures } = check(
      callsC,
      callsCGuards,
      [builtin(7, "A", "C")].map(entry => ({ ...entry, uses: entry.uses.slice(0, 1) })),
    );
    expect(result.edges).toEqual([{ from: A, to: C, strength: "RecoverableGuard", isFollowed: false }]);
    expect(failures).toEqual([{ kind: "UndeclaredUse", builtin: 7, entry: result.node("entryA"), feature: C }]);
  });

  test.each([
    ["a setting enters at start-up", Startup],
    ["only the command line enters", Tools],
  ])("a feature that %s needs no user", (_, feature) => {
    expect(check(guarded, guards(feature), []).failures).toEqual([]);
  });
});

test("failures come by kind, each kind sorted by its numbers", () => {
  const { result, failures } = check(
    {
      main: { root: true, to: ["guardA", "guardB", "guardT"] },
      guardA: { to: ["entryA", "secondA"] },
      guardB: { to: ["entryB"] },
      guardT: { to: ["unknownA"] },
      entryA: { to: ["entryC"] },
      secondA: { to: ["entryC"] },
      entryB: {},
      unknownA: {},
      entryC: {},
    },
    [
      ["guardT", "unknownA", A, { builtin: 99 }],
      ["guardA", "secondA", A, { builtin: 6 }],
      ["guardA", "entryA", A, { builtin: 5 }],
      ["guardB", "entryB", B],
      ["entryA", "entryC", C, { stub: "Throw" }],
      ["secondA", "entryC", C, { stub: "Throw" }],
    ],
    [builtin(5, "A"), builtin(6, "A"), builtin(10, "C")],
  );
  expect(failures).toEqual([
    {
      kind: "GuardOfUnknownBuiltin",
      builtin: 99,
      guard: result.node("guardT"),
      entry: result.node("unknownA"),
      feature: A,
    },
    { kind: "UndeclaredUse", builtin: 5, entry: result.node("entryA"), feature: C },
    { kind: "UndeclaredUse", builtin: 6, entry: result.node("secondA"), feature: C },
    { kind: "UseWithoutGuard", builtin: 10, feature: C },
    { kind: "GuardWithoutUser", guard: result.node("guardB"), entry: result.node("entryB"), feature: B },
  ]);
});

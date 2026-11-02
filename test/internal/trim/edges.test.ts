import { describe, expect, test } from "bun:test";

import { deriveFeatureEdges, findNativeEntries, type EdgeInput } from "../../../scripts/build/trim/edges.ts";
import {
  EdgeKind,
  stubKinds,
  type EdgeStrength,
  type FeatureEdge,
  type StubKind,
} from "../../../scripts/build/trim/types.ts";
import {
  A,
  B,
  C,
  Startup,
  Tools,
  abcWith,
  edgeKindOf,
  partitioned,
  tableOutput,
  type Guard,
  type Partitioned,
  type Section,
} from "./toy-graph.ts";

const edge = (from: number, to: number, strength: EdgeStrength, isFollowed: boolean): FeatureEdge => ({
  from,
  to,
  strength,
  isFollowed,
});

function inputOf(result: Partitioned): EdgeInput {
  const folded = new Set(result.foldedEntryPoints.map(record => record.entry));
  const entries = new Set(result.entryPoints.map(record => record.entry).filter(entry => !folded.has(entry)));
  return {
    graph: result.graph,
    model: result.model,
    entryPoints: result.entryPoints,
    edgeKind: result.edgeKind,
    entryFeatures: new Map([...result.seeds].filter(([node]) => entries.has(node))),
    seeds: result.seeds,
    isRetained: result.isRetained,
    exactSetOf: result.exactSetOf,
    sets: result.sets,
  };
}

const nativeEntriesOf = (result: Partitioned) => findNativeEntries(inputOf(result));
const nodesOf = (result: Partitioned, ...names: string[]) => names.map(result.node).sort((a, b) => a - b);

const asBuiltin = { builtin: 7 };

const enteredFromA: Record<string, Section> = {
  main: { root: true, to: ["guardA", "guardC"] },
  guardA: { to: ["entryA"] },
  guardC: { to: ["entryC"] },
  entryA: { to: ["entryC"] },
  entryC: {},
};
const guardsOf = (entryOfA: Guard[3], stub: StubKind = "ReturnDefault"): Guard[] => [
  ["guardA", "entryA", A, entryOfA],
  ["guardC", "entryC", C],
  ["entryA", "entryC", C, { stub }],
];

describe("the strength of an edge", () => {
  test("a reference that is no guard is a Reference, and is followed", () => {
    const result = partitioned(enteredFromA, guardsOf(asBuiltin).slice(0, 2));
    expect(result.failures).toEqual([]);
    expect(edgeKindOf(result, "entryA", "entryC")).toBe(EdgeKind.Unguarded);
    expect(result.edges).toEqual([edge(A, C, "Reference", true)]);
  });

  test.each<[StubKind, EdgeStrength]>([
    ["Abort", "AbortingGuard"],
    ["Throw", "RecoverableGuard"],
    ["ReturnUndefined", "RecoverableGuard"],
    ["ReturnDefault", "RecoverableGuard"],
  ])("a guard with the stub %s is a %s", (stub, strength) => {
    const result = partitioned(enteredFromA, guardsOf({}, stub));
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([edge(A, C, strength, stub !== "Throw")]);
  });

  test("every stub has a strength", () => {
    expect(stubKinds).toEqual(["Abort", "Throw", "ReturnUndefined", "ReturnDefault"]);
  });

  const twoSites: Record<string, Section> = {
    ...enteredFromA,
    entryA: { to: ["entryC", "moreOfA"] },
    moreOfA: { to: ["entryC"] },
  };

  test("of two guards the one that aborts decides", () => {
    for (const stubs of [
      ["Throw", "Abort"],
      ["Abort", "Throw"],
    ] as const) {
      const result = partitioned(twoSites, [...guardsOf({}, stubs[0]), ["moreOfA", "entryC", C, { stub: stubs[1] }]]);
      expect(result.failures).toEqual([]);
      expect(result.edges).toEqual([edge(A, C, "AbortingGuard", true)]);
    }
  });

  test("of a guard and a reference the reference decides, and the edge is followed though the guard alone is not", () => {
    const result = partitioned(twoSites, guardsOf(asBuiltin, "Abort"));
    expect(result.failures).toEqual([]);
    expect(edgeKindOf(result, "entryA", "entryC")).toBe(EdgeKind.Guarded);
    expect(edgeKindOf(result, "moreOfA", "entryC")).toBe(EdgeKind.Unguarded);
    expect(result.edges).toEqual([edge(A, C, "Reference", true)]);
  });
});

describe("whether a guard's edge is followed", () => {
  test("a guard that is reached only from an entry point JavaScript enters as a built-in is not: its table entry answers", () => {
    const result = partitioned(enteredFromA, guardsOf(asBuiltin));
    expect(result.failures).toEqual([]);
    expect(nativeEntriesOf(result)).toEqual(nodesOf(result, "entryC"));
    expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", false)]);
  });

  test("two calls below such an entry point it is not either", () => {
    const result = partitioned(
      { ...enteredFromA, entryA: { to: ["helper"] }, helper: { to: ["deeper"] }, deeper: { to: ["entryC"] } },
      [...guardsOf(asBuiltin).slice(0, 2), ["deeper", "entryC", C, { stub: "ReturnDefault" }]],
    );
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", false)]);
  });

  test("it is when native code enters the same entry point through a guard", () => {
    const result = partitioned(
      {
        ...enteredFromA,
        main: { root: true, to: ["guardA", "guardC", "nativeGuardA"] },
        nativeGuardA: { to: ["entryA"] },
      },
      [...guardsOf(asBuiltin), ["nativeGuardA", "entryA", A]],
    );
    expect(result.failures).toEqual([]);
    expect(nativeEntriesOf(result)).toEqual(nodesOf(result, "entryA", "entryC"));
    expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", true)]);
  });

  test("it is when the entry point is exported: an addon calls it", () => {
    const result = partitioned(
      { ...enteredFromA, entryA: { exported: true, to: ["entryC"] } },
      guardsOf(asBuiltin),
      abcWith(B, { exports: true }),
    );
    expect(result.failures).toEqual([]);
    expect(result.exactFeatures("entryA")).toEqual([A, B]);
    expect(nativeEntriesOf(result)).toEqual(nodesOf(result, "entryA", "entryC"));
    expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", true), edge(B, C, "RecoverableGuard", true)]);
  });

  test("it is below an exported symbol that is no entry point", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardC"] },
        guardC: { to: ["entryC"] },
        api: { exported: true, to: ["entryC"] },
        entryC: {},
      },
      [
        ["guardC", "entryC", C],
        ["api", "entryC", C, { stub: "ReturnDefault" }],
      ],
      abcWith(B, { exports: true }),
    );
    expect(result.failures).toEqual([]);
    expect(nativeEntriesOf(result)).toEqual(nodesOf(result, "api", "entryC"));
    expect(result.edges).toEqual([edge(B, C, "RecoverableGuard", true)]);
  });

  test("it is when another feature's code refers to the entry point without a guard", () => {
    const result = partitioned(
      {
        ...enteredFromA,
        main: { root: true, to: ["guardA", "guardB", "guardC"] },
        guardB: { to: ["entryB"] },
        entryB: { to: ["entryA"] },
      },
      [...guardsOf(asBuiltin), ["guardB", "entryB", B, { builtin: 8 }]],
    );
    expect(result.failures).toEqual([]);
    expect(edgeKindOf(result, "entryB", "entryA")).toBe(EdgeKind.Unguarded);
    expect(nativeEntriesOf(result)).toEqual(nodesOf(result, "entryA", "entryC"));
    expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", true), edge(B, A, "Reference", true)]);
  });

  describe("in code that two features share", () => {
    const shared: Record<string, Section> = {
      main: { root: true, to: ["guardA", "guardB", "guardC"] },
      guardA: { to: ["entryA"] },
      guardB: { to: ["entryB"] },
      guardC: { to: ["entryC"] },
      entryA: { to: ["shared"] },
      entryB: { to: ["shared"] },
      shared: { to: ["entryC"] },
      entryC: {},
    };
    const sharedGuards = (entryOfA: Guard[3], entryOfB: Guard[3]): Guard[] => [
      ["guardA", "entryA", A, entryOfA],
      ["guardB", "entryB", B, entryOfB],
      ["guardC", "entryC", C],
      ["shared", "entryC", C, { stub: "ReturnDefault" }],
    ];

    test("each feature is asked by itself: only the one that native code enters is followed", () => {
      const result = partitioned(shared, sharedGuards(asBuiltin, {}));
      expect(result.failures).toEqual([]);
      expect(result.exactFeatures("shared")).toEqual([A, B]);
      expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", false), edge(B, C, "RecoverableGuard", true)]);
    });

    test("neither is when JavaScript alone enters both", () => {
      const result = partitioned(shared, sharedGuards(asBuiltin, { builtin: 8 }));
      expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", false), edge(B, C, "RecoverableGuard", false)]);
    });

    test("both are when native code enters both", () => {
      const result = partitioned(shared, sharedGuards({}, {}));
      expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", true), edge(B, C, "RecoverableGuard", true)]);
    });
  });

  describe("a feature that a setting enters at start-up", () => {
    const startup: Record<string, Section> = {
      main: { root: true, to: ["guardS", "guardA", "guardC"] },
      guardS: { to: ["entryS"] },
      guardA: { to: ["entryA"] },
      guardC: { to: ["entryC"] },
      entryS: { to: ["entryC"] },
      entryA: { to: ["entryS"] },
      entryC: {},
    };
    const startupGuards: Guard[] = [
      ["guardS", "entryS", Startup],
      ["guardA", "entryA", A],
      ["guardC", "entryC", C],
    ];

    test("a guard in its code is not followed, and neither is a guard of it: the setting's own requirement answers", () => {
      const result = partitioned(startup, [...startupGuards, ["entryS", "entryC", C], ["entryA", "entryS", Startup]]);
      expect(result.failures).toEqual([]);
      expect(result.edges).toEqual([
        edge(A, Startup, "AbortingGuard", false),
        edge(Startup, C, "AbortingGuard", false),
      ]);
    });

    test("its references are followed", () => {
      const result = partitioned(startup, startupGuards);
      expect(result.failures).toEqual([]);
      expect(result.edges).toEqual([edge(A, Startup, "Reference", true), edge(Startup, C, "Reference", true)]);
    });
  });

  test("a guard that throws is not: the error names what is missing", () => {
    const result = partitioned(enteredFromA, guardsOf({}, "Throw"));
    expect(result.failures).toEqual([]);
    expect(nativeEntriesOf(result)).toEqual(nodesOf(result, "entryA", "entryC"));
    expect(result.edges).toEqual([edge(A, C, "RecoverableGuard", false)]);
  });

  test("a record that the entry point's own definition writes is not: whoever calls it holds what only its feature makes", () => {
    const guards = guardsOf({}).slice(0, 2);
    const result = partitioned(enteredFromA, [...guards, ["entryA", "entryC", C, { origin: "Definition" }]]);
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([edge(A, C, "AbortingGuard", false)]);
  });

  test("it is when a guard of its own stands beside such a record", () => {
    const guards = guardsOf({}, "Abort");
    const result = partitioned(enteredFromA, [...guards, ["entryA", "entryC", C, { origin: "Definition" }]]);
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([edge(A, C, "AbortingGuard", true)]);
  });

  test("native code enters an entry point whose definition writes the record", () => {
    const result = partitioned(enteredFromA, [
      ["guardA", "entryA", A, { origin: "Definition" }],
      ["guardC", "entryC", C],
      ["entryA", "entryC", C],
    ]);
    expect(result.failures).toEqual([]);
    expect(nativeEntriesOf(result)).toEqual(nodesOf(result, "entryA", "entryC"));
    expect(result.edges).toEqual([edge(A, C, "AbortingGuard", true)]);
  });

  test("a guard of a feature that only the command line enters is not followed from a feature of the program", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA", "guardT"] },
        guardA: { to: ["entryA"] },
        guardT: { to: ["entryT"] },
        entryA: { to: ["entryT"] },
        entryT: {},
      },
      [
        ["guardA", "entryA", A],
        ["guardT", "entryT", Tools],
        ["entryA", "entryT", Tools],
      ],
    );
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([edge(A, Tools, "AbortingGuard", false)]);
  });

  test("a guard in the code of a feature that only the command line enters is followed", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardT", "guardC"] },
        guardT: { to: ["entryT"] },
        guardC: { to: ["entryC"] },
        entryT: { to: ["entryC"] },
        entryC: {},
      },
      [
        ["guardT", "entryT", Tools],
        ["guardC", "entryC", C],
        ["entryT", "entryC", C],
      ],
    );
    expect(result.failures).toEqual([]);
    expect(result.edges).toEqual([edge(Tools, C, "AbortingGuard", true)]);
  });
});

describe("no edge", () => {
  test("from a guard in retained code: the graph cannot say on whose behalf it runs", () => {
    const result = partitioned({ ...enteredFromA, entryA: {} }, guardsOf({}).slice(0, 2));
    expect(result.failures).toEqual([]);
    expect(result.retained()).toEqual(["main", "guardA", "guardC"]);
    expect(result.edges).toEqual([]);
  });

  test("from a feature to itself", () => {
    const result = partitioned(
      {
        main: { root: true, to: ["guardA"] },
        guardA: { to: ["entryA", "thirdA"] },
        entryA: { to: ["secondA", "thirdA"] },
        secondA: {},
        thirdA: {},
      },
      [
        ["guardA", "entryA", A],
        ["guardA", "thirdA", A],
        ["entryA", "secondA", A],
      ],
    );
    expect(result.failures).toEqual([]);
    expect(edgeKindOf(result, "entryA", "secondA")).toBe(EdgeKind.Guarded);
    expect(edgeKindOf(result, "entryA", "thirdA")).toBe(EdgeKind.Unguarded);
    expect(result.edges).toEqual([]);
  });

  test("to an entry point that is folded with other code, which is not removable", () => {
    const result = partitioned({ ...enteredFromA, entryC: { foldedWith: ["alias"] } }, guardsOf({}));
    expect(result.failures).toEqual([]);
    expect(result.foldedEntryPoints.map(record => record.entry)).toEqual([
      result.node("entryC"),
      result.node("entryC"),
    ]);
    expect(result.edges).toEqual([]);
  });

  test("from a removable table to the functions it lists: JavaScript enters those, as built-ins with uses of their own", () => {
    const result = partitioned(
      { ...enteredFromA, entryA: { to: ["tableOfA"] }, tableOfA: { output: tableOutput, to: ["entryC"] } },
      [...guardsOf({}).slice(0, 2), ["tableOfA", "entryC", C, { builtin: 9 }]],
    );
    expect(result.failures).toEqual([]);
    expect(result.exactFeatures("tableOfA")).toEqual([A]);
    expect(edgeKindOf(result, "tableOfA", "entryC")).toBe(EdgeKind.Soft);
    expect(result.edges).toEqual([]);
  });
});

test("edges ascend by source, then by target, one for each pair", () => {
  const result = partitioned(
    {
      main: { root: true, to: ["guardA", "guardB", "guardC"] },
      guardA: { to: ["entryA"] },
      guardB: { to: ["entryB"] },
      guardC: { to: ["entryC"] },
      entryC: { to: ["entryB", "entryA", "moreOfC"] },
      moreOfC: { to: ["entryA", "entryB"] },
      entryB: { to: ["entryC", "entryA"] },
      entryA: {},
    },
    [
      ["guardA", "entryA", A],
      ["guardB", "entryB", B],
      ["guardC", "entryC", C],
    ],
  );
  expect(result.failures).toEqual([]);
  expect(result.edges).toEqual([
    edge(B, A, "Reference", true),
    edge(B, C, "Reference", true),
    edge(C, A, "Reference", true),
    edge(C, B, "Reference", true),
  ]);
  expect(deriveFeatureEdges(inputOf(result))).toEqual(result.edges);
});

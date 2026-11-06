import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

import { BuildError } from "../../../scripts/build/error.ts";
import {
  checkBuiltinUses,
  entriesById,
  featuresWithDeclaredUse,
  guardFeatureOf,
  readBuiltinUses,
  serializeBuiltinUses,
} from "../../../scripts/build/trim/builtin-uses.ts";
import { builtinKinds, type BuiltinEntry, type BuiltinUses } from "../../../scripts/build/trim/types.ts";
import { A, C, abc } from "./toy-graph.ts";

function buildErrorOf(action: () => unknown): BuildError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BuildError);
    return error as BuildError;
  }
  throw new Error("expected a BuildError");
}

const builtinIdLimit = 2 ** 32;
const always = (feature: string) => ({ feature, isConditional: false });
const sometimes = (feature: string) => ({ feature, isConditional: true });
const entry = (id: number, uses: BuiltinEntry["uses"], more: Partial<BuiltinEntry> = {}): BuiltinEntry => ({
  id,
  path: `Bun.builtin${id}`,
  kind: "Function",
  uses,
  nativeSymbols: [],
  hasHiddenRoot: false,
  ...more,
});

const sample: BuiltinUses = {
  entries: [
    entry(0, [always("A")]),
    entry(812, [always("A"), sometimes("C")], {
      path: "process.on",
      kind: "Method",
      nativeSymbols: ["Process_functionOn", "Bun::on"],
    }),
    entry(builtinIdLimit - 1, [sometimes("B")], {
      path: "%Hidden%.prototype.next",
      kind: "Method",
      hasHiddenRoot: true,
    }),
    ...builtinKinds.map((kind, index) => entry(builtinIdLimit + index - 100, [always("B")], { kind })),
  ].sort((a, b) => a.id - b.id),
};

test("the JSON form round trips", () => {
  using directory = tempDir("builtin-uses", { "builtin-uses.json": serializeBuiltinUses(sample) });
  expect(readBuiltinUses(join(String(directory), "builtin-uses.json"))).toEqual(sample);
});

describe("checkBuiltinUses", () => {
  const rejected = (entries: BuiltinEntry[]) =>
    buildErrorOf(() => checkBuiltinUses({ entries }, abc, "builtin-uses.json"));

  test("accepts ascending ids and declared features, each once for an entry", () => {
    expect(() => checkBuiltinUses(sample, abc, "builtin-uses.json")).not.toThrow();
    expect(() => checkBuiltinUses({ entries: [] }, abc, "builtin-uses.json")).not.toThrow();
  });

  test("rejects an id that does not ascend", () => {
    expect(rejected([entry(2, [always("A")]), entry(1, [always("A")])]).message).toBe(
      "the id of Bun.builtin1 does not ascend",
    );
    expect(rejected([entry(2, [always("A")]), entry(2, [always("A")], { path: "Bun.again" })]).message).toBe(
      "the id of Bun.again does not ascend",
    );
  });

  test("rejects a feature that no file declares", () => {
    const error = rejected([entry(1, [always("A"), always("Missing")])]);
    expect(error.message).toBe("Bun.builtin1 uses Missing, which src/trim/features does not declare");
    expect(error.file).toBe("builtin-uses.json");
  });

  test("rejects a feature that only the command line enters, and the JIT, also with a condition", () => {
    const withC = (change: object) => ({
      ...abc,
      features: abc.features.map(feature => (feature.name === "C" ? { ...feature, ...change } : feature)),
    });
    const uses = (more: Partial<BuiltinEntry> = {}) => ({ entries: [entry(1, [always("A"), sometimes("C")], more)] });
    const commandLine = withC({ enteredFrom: "command-line" });
    expect(buildErrorOf(() => checkBuiltinUses(uses(), commandLine, "builtin-uses.json")).message).toBe(
      "Bun.builtin1 uses C, which no executable compiled ahead of time has",
    );
    for (const more of [
      { hasHiddenRoot: true },
      { kind: "NativeBinding" },
      { kind: "Module" },
      { kind: "InternalModule" },
    ] as const) {
      expect(() => checkBuiltinUses(uses(more), commandLine, "builtin-uses.json")).not.toThrow();
    }
    expect(() => checkBuiltinUses(uses(), withC({ enteredFrom: "startup" }), "builtin-uses.json")).not.toThrow();
    const jit = { ...abc, features: [...abc.features, { ...abc.features[0]!, name: "JIT", index: 500 }] };
    expect(
      buildErrorOf(() => checkBuiltinUses({ entries: [entry(1, [always("JIT")])] }, jit, "builtin-uses.json")).message,
    ).toBe("Bun.builtin1 uses JIT, which no executable compiled ahead of time has");
  });

  test("rejects a feature that an entry uses twice, also once with a condition", () => {
    expect(rejected([entry(1, [always("A"), sometimes("A")])]).message).toBe("Bun.builtin1 uses A twice");
  });
});

test("entriesById finds an entry by its id", () => {
  const byId = entriesById(sample);
  expect(byId.size).toBe(sample.entries.length);
  expect(byId.get(812)?.path).toBe("process.on");
  expect(byId.get(813)).toBeUndefined();
});

test("guardFeatureOf is the first unconditional use", () => {
  expect(guardFeatureOf(entry(1, [always("A"), always("B")]))).toBe("A");
  expect(guardFeatureOf(entry(1, [sometimes("A"), always("B"), always("C")]))).toBe("B");
  expect(guardFeatureOf(entry(1, [sometimes("A")]))).toBeUndefined();
});

test("featuresWithDeclaredUse holds every declared feature that some entry uses, with or without a condition", () => {
  const uses = { entries: [entry(1, [always("A")]), entry(2, [sometimes("C"), always("Missing")])] };
  expect([...featuresWithDeclaredUse(uses, abc)].sort((a, b) => a - b)).toEqual([A, C]);
  expect(featuresWithDeclaredUse({ entries: [] }, abc).size).toBe(0);
});

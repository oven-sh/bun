import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

import { BuildError } from "../../../scripts/build/error.ts";
import {
  builtinIdLimit,
  builtinUsesVersion,
  checkBuiltinUses,
  entriesById,
  featuresWithDeclaredUse,
  guardFeatureOf,
  parseBuiltinUses,
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

describe("the JSON form", () => {
  test("round trips", () => {
    const text = serializeBuiltinUses(sample);
    const parsed = parseBuiltinUses(JSON.parse(text), "builtin-uses.json");
    expect(parsed).toEqual(sample);
    expect(serializeBuiltinUses(parsed)).toBe(text);
    expect(text).toEndWith("}\n");
  });

  test("writes only what differs from the default", () => {
    expect(builtinUsesVersion).toBe(1);
    expect(JSON.parse(serializeBuiltinUses({ entries: sample.entries.slice(0, 2) }))).toEqual({
      version: 1,
      entries: [
        { id: 0, path: "Bun.builtin0", kind: "Function", uses: [{ feature: "A" }] },
        {
          id: 812,
          path: "process.on",
          kind: "Method",
          uses: [{ feature: "A" }, { feature: "C", isConditional: true }],
          nativeSymbols: ["Process_functionOn", "Bun::on"],
        },
      ],
    });
    expect(
      JSON.parse(serializeBuiltinUses({ entries: [entry(1, [always("A")], { hasHiddenRoot: true })] })).entries[0]
        .hasHiddenRoot,
    ).toBe(true);
  });

  test("what is absent is false or empty", () => {
    const json = { version: 1, entries: [{ id: 1, path: "Bun.one", kind: "Function", uses: [{ feature: "A" }] }] };
    expect(parseBuiltinUses(json, "builtin-uses.json")).toEqual({
      entries: [entry(1, [always("A")], { path: "Bun.one" })],
    });
  });

  test("a list without entries is read", () => {
    expect(parseBuiltinUses({ version: 1, entries: [] }, "builtin-uses.json")).toEqual({ entries: [] });
  });

  const valid = { id: 1, path: "Bun.one", kind: "Function", uses: [{ feature: "A" }] };
  test.each<[string, unknown]>([
    ["the built-in uses are not an object", []],
    ["the built-in uses are not an object", null],
    ["unknown version of the built-in uses: undefined", {}],
    ["unknown version of the built-in uses: 2", { version: 2, entries: [] }],
    ["the built-in uses have no entries", { version: 1 }],
    ["the built-in uses have no entries", { version: 1, entries: {} }],
    ["entries[0] is not an object", { version: 1, entries: ["Bun.one"] }],
    ["entries[1] is not an object", { version: 1, entries: [valid, null] }],
    ["entries[0].id is not a built-in id", { version: 1, entries: [{ ...valid, id: undefined }] }],
    ["entries[0].id is not a built-in id", { version: 1, entries: [{ ...valid, id: -1 }] }],
    ["entries[0].id is not a built-in id", { version: 1, entries: [{ ...valid, id: 1.5 }] }],
    ["entries[0].id is not a built-in id", { version: 1, entries: [{ ...valid, id: builtinIdLimit }] }],
    ["entries[0].id is not a built-in id", { version: 1, entries: [{ ...valid, id: "1" }] }],
    ["entries[0].path is not a path", { version: 1, entries: [{ ...valid, path: "" }] }],
    ["entries[0].path is not a path", { version: 1, entries: [{ ...valid, path: 1 }] }],
    ["entries[0].kind is unknown: Door", { version: 1, entries: [{ ...valid, kind: "Door" }] }],
    ["entries[0].kind is unknown: undefined", { version: 1, entries: [{ ...valid, kind: undefined }] }],
    ["entries[0].uses is not a list with a member", { version: 1, entries: [{ ...valid, uses: [] }] }],
    ["entries[0].uses is not a list with a member", { version: 1, entries: [{ ...valid, uses: undefined }] }],
    ["entries[0].nativeSymbols is not a list of strings", { version: 1, entries: [{ ...valid, nativeSymbols: "f" }] }],
    ["entries[0].nativeSymbols is not a list of strings", { version: 1, entries: [{ ...valid, nativeSymbols: [1] }] }],
    ["entries[0].creationSymbol is not a string", { version: 1, entries: [{ ...valid, creationSymbol: 1 }] }],
    ["entries[0].hasHiddenRoot is not a boolean", { version: 1, entries: [{ ...valid, hasHiddenRoot: 1 }] }],
    ["Bun.one has a use that is not an object", { version: 1, entries: [{ ...valid, uses: ["A"] }] }],
    ["Bun.one has a use without a feature", { version: 1, entries: [{ ...valid, uses: [{}] }] }],
    [
      "Bun.one uses A with an isConditional that is not a boolean",
      { version: 1, entries: [{ ...valid, uses: [{ feature: "A", isConditional: 1 }] }] },
    ],
  ])("rejects: %s", (message, json) => {
    const error = buildErrorOf(() => parseBuiltinUses(json, "codegen/builtin-uses.json"));
    expect(error.message).toBe(message);
    expect(error.file).toBe("codegen/builtin-uses.json");
  });
});

describe("readBuiltinUses", () => {
  test("reads a file", () => {
    using directory = tempDir("builtin-uses", { "builtin-uses.json": serializeBuiltinUses(sample) });
    expect(readBuiltinUses(join(String(directory), "builtin-uses.json"))).toEqual(sample);
  });

  test.each([
    ["a missing file", "absent.json"],
    ["a file that is not JSON", "broken.json"],
  ])("names %s", (_, name) => {
    using directory = tempDir("builtin-uses", { "broken.json": "{" });
    const path = join(String(directory), name);
    const error = buildErrorOf(() => readBuiltinUses(path));
    expect(error.message).toBe("cannot read the built-in uses");
    expect(error.file).toBe(path);
    expect(error.cause).toBeInstanceOf(Error);
  });
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

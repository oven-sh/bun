import { expect, test } from "bun:test";
import { checkMutability } from "../../../src/codegen/builtins/check.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type { ModelBuiltin } from "../../../src/codegen/builtins/model.ts";
import { formatOwnProperties, parseOwnProperties } from "../../../src/codegen/builtins/own-properties.ts";
import type { BuiltinKind, BuiltinMark, Mutability } from "../../../src/codegen/builtins/vocabulary.ts";

const holder = {
  text: "process",
  kind: "Namespace",
  scope: "Realm",
  flags: [],
  holder: null,
} as unknown as ModelBuiltin;

function problemsOf(kind: BuiltinKind, mutability: Mutability, marks: readonly BuiltinMark[] = []): readonly string[] {
  const member = {
    text: "process.member",
    kind,
    mutability,
    scope: "Realm",
    flags: [],
    marks,
    holder,
  } as unknown as ModelBuiltin;
  const problems = new Problems();
  checkMutability({ builtins: [member] }, problems);
  return problems.lines;
}

test("an entry that is an object does not change on its own", () => {
  for (const kind of ["Namespace", "Constructor", "Function", "Prototype", "Method"] as const) {
    expect(problemsOf(kind, "ChangesOnItsOwn")).toEqual([
      expect.stringContaining("process.member is an object and changes on its own"),
    ]);
    expect(problemsOf(kind, "ConstantUnlessWritten")).toEqual([]);
  }
});

test("what the realm of a run may lack is not always locked", () => {
  for (const kind of ["Namespace", "Constructor", "Function"] as const) {
    expect(problemsOf(kind, "AlwaysLocked", ["MayBeAbsent"])).toEqual([
      expect.stringContaining("process.member may be absent and is AlwaysLocked"),
    ]);
    expect(problemsOf(kind, "ConstantUnlessWritten", ["MayBeAbsent"])).toEqual([]);
    expect(problemsOf(kind, "AlwaysLocked")).toEqual([]);
  }
});

test("a property and an accessor may change on their own", () => {
  for (const kind of ["DataProperty", "Accessor"] as const) expect(problemsOf(kind, "ChangesOnItsOwn")).toEqual([]);
});

test("a list of own properties marks what the host creates in some runs only", () => {
  const text = "process : abort/wc noDeprecation/~ title/ac\n";
  const [line] = parseOwnProperties(text);
  expect(line.properties.map(({ name, isCreatedInSomeRuns }) => [name, isCreatedInSomeRuns])).toEqual([
    ["abort", false],
    ["noDeprecation", true],
    ["title", false],
  ]);
  expect(line.properties[1].attributes).toBeNull();
  expect(formatOwnProperties([line])).toBe(text);
});

import { expect, test } from "bun:test";
import { checkNamesReadByNativeCode } from "../../../src/codegen/builtins/check-host-uses.ts";
import { Problems } from "../../../src/codegen/builtins/declarations.ts";
import type { ModelBuiltin, ModelName } from "../../../src/codegen/builtins/model.ts";

const nameOf = (text: string, number: number): ModelName => ({ number, text, kind: "Text", cppConstant: null });
const objectAbove = { text: "Object.prototype" } as ModelBuiltin;
const entry = (columns: Partial<ModelBuiltin> = {}) =>
  ({
    text: "host",
    scope: "Realm",
    flags: [],
    sameObjectAs: null,
    prototype: { link: "Builtin", builtin: objectAbove },
    ...columns,
  }) as ModelBuiltin;

function problemsOf(
  holder: ModelBuiltin,
  names: readonly ModelName[] = [nameOf("emit", 0)],
  namesOnlyInspected: readonly ModelName[] = [],
): readonly string[] {
  const problems = new Problems();
  checkNamesReadByNativeCode({ namesReadByNativeCode: [{ holder, names, namesOnlyInspected }] }, problems);
  return problems.lines;
}

test("an object of the realm with a known chain takes the list", () => {
  expect(problemsOf(entry())).toEqual([]);
  expect(problemsOf(entry({ prototype: { link: "Null" } }), [])).toEqual([]);
});

test("the list is refused where a program stores nothing, where native code reads everything, and where the chain is not known", () => {
  expect(problemsOf(entry({ scope: "Module" }))).toEqual([
    "host lists the names that native code reads, and every module has an object of its own",
  ]);
  expect(problemsOf(entry({ sameObjectAs: entry({ text: "other" }) }))).toEqual([
    "host lists the names that native code reads, and it is the same object as other, where the list belongs",
  ]);
  expect(problemsOf(entry({ flags: ["IsGlobalObject"] }))).toEqual([
    "host lists the names that native code reads, and native code finds every global variable on the global object",
  ]);
  expect(problemsOf(entry({ flags: ["IsLockedObject"] }))).toEqual([
    "host lists the names that native code reads, and it is locked, so a program puts nothing there",
  ]);
  expect(problemsOf(entry({ prototype: { link: "Unknown" } }))).toEqual([
    "host lists the names that native code reads, and nothing says what lies above it, where a lookup goes on",
  ]);
});

test("a name is listed once, and an index is no name", () => {
  const emit = nameOf("emit", 0);
  expect(problemsOf(entry(), [emit, emit])).toEqual([
    "host lists the names that native code reads, and emit is listed twice",
  ]);
  expect(problemsOf(entry(), [nameOf("7", 0)])).toEqual([
    "host lists the names that native code reads, and 7 is an index",
  ]);
});

test("a name that native code only inspects is one of the names that it reads", () => {
  const [emit, flag] = [nameOf("emit", 0), nameOf("flag", 1)];
  expect(problemsOf(entry(), [emit, flag], [flag])).toEqual([]);
  expect(problemsOf(entry(), [emit], [flag])).toEqual([
    "host lists the names that native code reads, and flag, which it only inspects, is not among them",
  ]);
});

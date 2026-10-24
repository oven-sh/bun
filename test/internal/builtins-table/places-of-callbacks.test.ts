import { expect, test } from "bun:test";
import * as b from "../../../src/codegen/builtins/lib.ts";

const once = { afterwards: "TouchesOnlyWhatRowNames", times: "Once" } as const;

test("what a constructed callback sees as new.target is written as a place", () => {
  const use = b.called({
    afterwards: "TouchesOnlyWhatRowNames",
    times: "Once",
    constructs: true,
    newTarget: b.operand("newTarget"),
    args: [],
    spreadArgs: b.ownValues("list"),
  });
  expect(use).toMatchObject({
    use: "Calls",
    constructs: true,
    newTarget: { place: "Operand", operand: "newTarget" },
    spreadArguments: { place: "OwnValues", operand: "list" },
  });
});

test("a bare name is no place", () => {
  // @ts-expect-error A declaration file runs without a type check.
  expect(() => b.called({ ...once, constructs: true, newTarget: "newTarget", args: [] })).toThrow(
    '"newTarget" is no place',
  );
  // @ts-expect-error
  expect(() => b.called({ ...once, this: "thisArgument", args: [] })).toThrow('"thisArgument" is no place');
  // @ts-expect-error
  expect(() => b.called({ ...once, this: b.undefined, args: ["element"] })).toThrow('"element" is no place');
});

test("a called function is told its `this` and its arguments", () => {
  // @ts-expect-error A declaration file runs without a type check.
  expect(() => b.called({ ...once, args: [] })).toThrow("a called function is told its `this`");
  // @ts-expect-error
  expect(() => b.called({ ...once, this: b.undefined })).toThrow("a called function is told its arguments");
  // @ts-expect-error
  expect(() => b.called({ ...once, constructs: true, this: b.any, args: [] })).toThrow("a constructed one is not");
  // @ts-expect-error
  expect(() => b.memberCalled(["fetch"], { times: "PerEvent", args: [] })).toThrow("is told its `this`");
  // @ts-expect-error
  expect(() => b.keptCalled("Realm.cell", { times: "PerEvent", this: b.any })).toThrow("is told its arguments");
  expect(b.called({ ...once, this: b.undefined, args: [] })).toMatchObject({ thisValue: undefined, arguments: [] });
});

test("a called function says what native code does afterwards", () => {
  // @ts-expect-error A declaration file runs without a type check.
  expect(() => b.called({ times: "Once" })).toThrow("a called function says what native code does afterwards");
});

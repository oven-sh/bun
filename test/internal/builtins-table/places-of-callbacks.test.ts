import { expect, test } from "bun:test";
import * as b from "../../../src/codegen/builtins/lib.ts";

test("what a constructed callback sees as new.target is written as a place", () => {
  const use = b.called({
    afterwards: "TouchesOnlyWhatRowNames",
    times: "Once",
    constructs: true,
    newTarget: b.operand("newTarget"),
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
  expect(() =>
    b.called({ afterwards: "TouchesOnlyWhatRowNames", times: "Once", constructs: true, newTarget: "newTarget" }),
  ).toThrow('"newTarget" is no place');
  // @ts-expect-error
  expect(() => b.called({ afterwards: "TouchesOnlyWhatRowNames", times: "Once", this: "thisArgument" })).toThrow(
    '"thisArgument" is no place',
  );
  // @ts-expect-error
  expect(() => b.called({ afterwards: "TouchesOnlyWhatRowNames", times: "PerElement", args: ["element"] })).toThrow(
    '"element" is no place',
  );
});

test("a called function says what native code does afterwards", () => {
  // @ts-expect-error A declaration file runs without a type check.
  expect(() => b.called({ times: "Once" })).toThrow("a called function says what native code does afterwards");
});

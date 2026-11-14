import { expect, test } from "bun:test";
import type { MemberDeclaration } from "../../../src/codegen/builtins/declarations.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";
import { targetPlatforms } from "../../../src/codegen/builtins/vocabulary.ts";

const separator = Object.fromEntries(
  targetPlatforms.map(platform => [platform, b.enumeration([platform === "Windows" ? "\\" : "/"])]),
) as b.TypeByPlatform;

const readOf = (field: b.Field) => (b.static("node:path.sep", field)[0] as MemberDeclaration).signatures[0];

test("a property may hold one thing on one platform and another on the rest", () => {
  const { result, resultsByPlatform } = readOf(b.property(separator));
  expect(resultsByPlatform?.map(({ platform }) => platform)).toEqual([...targetPlatforms]);
  expect(resultsByPlatform?.find(({ platform }) => platform === "Windows")?.result).toEqual({
    type: "StringLiterals",
    values: ["\\"],
  });
  expect(resultsByPlatform?.find(({ platform }) => platform === "Linux")?.result).toEqual({
    type: "StringLiterals",
    values: ["/"],
  });
  expect(result.type).toBe("Union");
});

test("one type is the type on every platform", () => {
  expect(readOf(b.property(b.string))).toMatchObject({ result: b.string.spec });
  expect(readOf(b.property(b.string)).resultsByPlatform).toBeUndefined();
});

test("every platform has a type", () => {
  const { Windows, ...others } = separator;
  expect(() => b.static("node:path.sep", b.property(others as b.TypeByPlatform))).toThrow(
    "node:path.sep: there is no type for Windows",
  );
});

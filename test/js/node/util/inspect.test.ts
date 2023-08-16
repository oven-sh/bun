import { expect, test } from "bun:test";
import { inspect } from "node:util";

test("util.inspect prints the string", () => {
  const obj = {
    [inspect.custom]() {
      return "42";
    },
  };

  expect(Bun.inspect(obj)).toBe("42");
});

const exceptions = [new Error("don't crash!"), 42];

test.each(exceptions)("util.inspect handles exceptions %s", err => {
  const obj = {
    [inspect.custom]() {
      throw err;
    },
  };

  if (typeof err === "object" && err instanceof Error) {
    expect(() => Bun.inspect(obj)).toThrow(err.message);
  } else {
    expect(() => Bun.inspect(obj)).toThrow(err + "");
  }
});

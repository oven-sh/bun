import { expect, test } from "bun:test";
import util from "node:util";

test("util.inspect.custom exists", () => {
  expect(util.inspect.custom).toEqual(Symbol.for("nodejs.util.inspect.custom"));
});

const customSymbol = util.inspect.custom;

for (const [name, inspect] of [
  ["util.inspect", util.inspect],
  ["Bun.inspect", Bun.inspect],
] as const) {
  test(name + " calls inspect.custom", () => {
    const obj = {
      [customSymbol]() {
        return "42";
      },
    };

    expect(inspect(obj)).toBe("42");
  });

  test(name + " calls inspect.custom recursivly", () => {
    const obj = {
      [customSymbol]() {
        return {
          [customSymbol]() {
            return "42";
          },
        };
      },
    };

    expect(inspect(obj)).toBe("42");
  });

  test(name + " calls inspect.custom recursivly nested", () => {
    const obj = {
      [customSymbol]() {
        return {
          prop: {
            [customSymbol]() {
              return "42";
            },
          },
        };
      },
    };

    expect(inspect(obj).replace(/\s/g, "")).toBe("{prop:42}");
  });

  test(name + " calls inspect.custom recursivly nested 2", () => {
    const obj = {
      prop: {
        [customSymbol]() {
          return {
            [customSymbol]() {
              return "42";
            },
          };
        },
      },
    };

    expect(inspect(obj).replace(/\s/g, "")).toBe("{prop:42}");
  });

  test(name + " calls inspect.custom with valid options", () => {
    const obj = {
      [customSymbol](depth: any, options: any, inspect: any) {
        expect(this === obj).toBe(true);
        expect(inspect).toBe(util.inspect);
        expect(options.stylize).toBeDefined();
        expect(depth).toBe(2);
        return "good";
      },
    };

    expect(inspect(obj).replace(/\s/g, "")).toBe("good");
  });

  const exceptions = [new Error("don't crash!"), 42];

  test.each(exceptions)(name + " handles exceptions %s", err => {
    const obj = {
      [customSymbol]() {
        throw err;
      },
    };

    if (typeof err === "object" && err instanceof Error) {
      expect(() => inspect(obj)).toThrow(err.message);
    } else {
      expect(() => inspect(obj)).toThrow(err + "");
    }
  });
}

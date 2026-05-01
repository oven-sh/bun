// this file is compatible with jest to test node.js' util.inspect as well as bun's

const util = require("util");

test("util.inspect.custom exists", () => {
  expect(util.inspect.custom).toEqual(Symbol.for("nodejs.util.inspect.custom"));
});

const customSymbol = util.inspect.custom;

for (const [name, inspect] of process.versions.bun
  ? [
      ["util.inspect", util.inspect],
      ["Bun.inspect", Bun.inspect],
    ]
  : [["util.inspect", util.inspect]]) {
  const isBunInspect = name === "Bun.inspect";

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

    const expected = isBunInspect ? "{prop:42,}" : "{prop:42}";
    expect(inspect(obj).replace(/\s/g, "")).toBe(expected);
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

    const expected = isBunInspect ? "{prop:42,}" : "{prop:42}";
    expect(inspect(obj).replace(/\s/g, "")).toBe(expected);
  });

  test(name + " calls inspect.custom with valid options", () => {
    const obj = {
      [customSymbol](depth, options, inspect) {
        expect(this === obj).toBe(true);
        expect(inspect).toBe(util.inspect);
        expect(options.stylize).toBeDefined();
        expect(depth).toBeDefined(2);
        return "good";
      },
    };

    expect(inspect(obj).replace(/\s/g, "")).toBe("good");
  });

  test(name + " stylize function works without color", () => {
    const obj = {
      [customSymbol](depth, options, inspect) {
        expect(options.stylize).toBeDefined();
        expect(options.stylize("foo", "whatever")).toBe("foo");
        expect(options.stylize("hello", "string")).toBe("hello");
        return "good";
      },
    };

    expect(inspect(obj).replace(/\s/g, "")).toBe("good");
  });

  test(name + " stylize function works with color", () => {
    const obj = {
      [customSymbol](depth, options, inspect) {
        expect(options.stylize).toBeDefined();
        expect(options.stylize("foo", "invalid")).toBe("foo");
        expect(options.stylize("foo", "boolean")).toBe("\u001b[33mfoo\u001b[39m");
        expect(options.stylize("hello", "string")).toBe("\u001b[32mhello\u001b[39m");
        return "good";
      },
    };

    expect(inspect(obj, { colors: true }).replace(/\s/g, "")).toBe("good");
  });

  test(name + " stylize function gives correct depth", () => {
    const obj = {
      [customSymbol](depth, options, inspect) {
        return [depth, options.depth];
      },
    };
    expect(inspect(obj, { depth: 3 }).replace(/\s/g, "")).toBe("[3,3]");
  });
  test(name + " stylize function gives correct depth", () => {
    const obj = {
      prop: {
        [customSymbol](depth, options, inspect) {
          return [depth, options.depth];
        },
      },
    };

    const expected = isBunInspect ? "{prop:[2,3],}" : "{prop:[2,3]}";
    expect(inspect(obj, { depth: 3 }).replace(/\s/g, "")).toBe(expected);
  });
  test(name + " non-callable does not get called", () => {
    const obj = {
      [customSymbol]: 512,
    };

    const expected = isBunInspect
      ? "{[Symbol(nodejs.util.inspect.custom)]:512,}"
      : "{Symbol(nodejs.util.inspect.custom):512}";
    expect(inspect(obj, { depth: 3 }).replace(/\s/g, "")).toBe(expected);
  });

  const exceptions = [new Error("don't crash!"), 42];

  test.each(exceptions)(name + " handles exceptions %s", err => {
    const obj = {
      [customSymbol]() {
        throw err;
      },
    };

    expect(() => inspect(obj)).toThrow();
  });
}

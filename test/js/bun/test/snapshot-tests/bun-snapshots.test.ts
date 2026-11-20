import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("it will create a snapshot file if it doesn't exist", () => {
  expect({ a: { b: { c: false } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Boolean) } } });
  expect({ a: { b: { c: "string" } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(String) } } });
  expect({ a: { b: { c: 4 } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Number) } } });
  expect({ a: { b: { c: 2n } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(BigInt) } } });
  expect({ a: new Date() }).toMatchSnapshot({ a: expect.any(Date) });
  expect({ j: 2, a: "any", b: "any2" }).toMatchSnapshot({ j: expect.any(Number), a: "any", b: expect.any(String) });
  expect({ j: /regex/, a: "any", b: "any2" }).toMatchSnapshot({
    j: expect.any(RegExp),
    a: "any",
    b: expect.any(String),
  });
});

test("ArrayBuffer values are serialized like typed arrays", () => {
  expect(new Uint8Array([1, 2, 3]).buffer).toMatchInlineSnapshot(`
    ArrayBuffer [
      1,
      2,
      3,
    ]
  `);
  expect({ a: 1, b: new Uint8Array([4, 5]).buffer }).toMatchInlineSnapshot(`
    {
      "a": 1,
      "b": ArrayBuffer [
        4,
        5,
      ],
    }
  `);
});

test("a Proxy, an arguments object and a generator print like other objects", () => {
  const target: Record<string, unknown> = { a: 1n };
  target.self = target;
  expect(new Proxy(target, {})).toMatchInlineSnapshot(`
    {
      "a": 1n,
      "self": {
        "a": 1n,
        "self": [Circular],
      },
    }
  `);
  expect({ list: new Proxy([1, 2n], {}), named: new Proxy(function foo() {}, {}) }).toMatchInlineSnapshot(`
    {
      "list": [
        1,
        2n,
      ],
      "named": [Function: foo],
    }
  `);
  (function (..._: unknown[]) {
    expect(arguments).toMatchInlineSnapshot(`
      Arguments [
        1n,
        "x",
      ]
    `);
  })(1n, "x");
  expect((function* () {})()).toMatchInlineSnapshot(`Generator {}`);
});

// These are in the snapshot file because an inline snapshot also passes when Jest's format gives the same text.
test("a snapshot serializer prints the values inside a Proxy and an arguments object", () => {
  class Money {
    constructor(public amount: number) {}
  }
  expect.addSnapshotSerializer({
    test: value => value instanceof Money,
    serialize: (value: Money) => `Money<${value.amount}>`,
  });
  expect(new Proxy({ price: new Money(1) }, {})).toMatchSnapshot();
  (function (..._: unknown[]) {
    expect(arguments).toMatchSnapshot();
  })(new Money(2));
  expect(new Proxy(new Map([["price", new Money(3)]]), {})).toMatchSnapshot();

  // A serializer gets the Proxy, not its target.
  const proxyOfMap = new Proxy(new Map([["k", 1]]), {});
  expect.addSnapshotSerializer({ test: value => value === proxyOfMap, serialize: () => "the Proxy of a Map" });
  expect({ proxyOfMap }).toMatchSnapshot();
});

// Bun 1.4.4 wrote formats/bun-1.4.4, both the .snap file and the inline snapshots. It printed these values with JSON.stringify().
// To add a case, run it under that version. Never update the folder with a later Bun.
describe.concurrent("the snapshots that Bun 1.4.4 wrote for a Proxy, an arguments object and a generator", () => {
  const fixtures = ["inline.fixture.js", "values.fixture.js"];
  const snap = join("__snapshots__", "values.fixture.js.snap");

  function copy() {
    const dir = tempDir("snapshot-formats-bun-1.4.4", {});
    cpSync(join(import.meta.dir, "formats", "bun-1.4.4"), String(dir), { recursive: true });
    return dir;
  }
  const contentsOf = (dir: string) =>
    Object.fromEntries([...fixtures, snap].map(name => [name, readFileSync(join(dir, name), "utf8")]));
  async function run(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args, ...fixtures.map(name => "./" + name)],
      env: { ...bunEnv, CI: "true" },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const count = (what: string) => Number(stderr.match(new RegExp(`^ *(\\d+) ${what}$`, "m"))?.[1] ?? -1);
    return { pass: count("pass"), fail: count("fail"), exitCode, stderr };
  }

  test("pass, and are left alone", async () => {
    using dir = copy();
    const before = contentsOf(String(dir));
    const { stderr, ...result } = await run(String(dir));
    expect({ ...result, stderr: result.exitCode ? stderr : "" }).toEqual({
      pass: 41,
      fail: 0,
      exitCode: 0,
      stderr: "",
    });
    expect(contentsOf(String(dir))).toEqual(before);
  });

  test("--update-snapshots rewrites them once", async () => {
    using dir = copy();
    const before = contentsOf(String(dir));
    const first = await run(String(dir), "--update-snapshots");
    const updated = contentsOf(String(dir));
    const second = await run(String(dir), "--update-snapshots");
    const read = await run(String(dir));
    expect(contentsOf(String(dir))).toEqual(updated);
    expect([first, second, read].map(({ pass, fail, exitCode }) => ({ pass, fail, exitCode }))).toEqual(
      Array.from({ length: 3 }, () => ({ pass: 41, fail: 0, exitCode: 0 })),
    );

    expect(updated["values.fixture.js"]).toBe(before["values.fixture.js"]);
    for (const entry of [
      'exports[`Proxy of an object 1`] = `\n{\n  "a": 1,\n  "b": "x",\n}\n`;',
      "exports[`Proxy of an array 1`] = `\n[\n  1,\n  2,\n  3,\n]\n`;",
      "exports[`Proxy of a function 1`] = `[Function: foo]`;",
      "exports[`Proxy of a class 1`] = `[class K]`;",
      "exports[`arguments 1`] = `\nArguments [\n  1,\n  2,\n]\n`;",
      "exports[`arguments with no items 1`] = `Arguments []`;",
      "exports[`generator 1`] = `Generator {}`;",
    ]) {
      expect(updated[snap]).toContain(entry);
    }
    for (const written of [
      "expect(new Proxy([1, 2, 3], {})).toMatchInlineSnapshot(`\n    [\n      1,\n      2,\n      3,\n    ]\n  `);",
      "expect(new Proxy(function foo() {}, {})).toMatchInlineSnapshot(`[Function: foo]`);",
      "expect(args(1, 2)).toMatchInlineSnapshot(`\n    Arguments [\n      1,\n      2,\n    ]\n  `);",
      "expect((function* () {})()).toMatchInlineSnapshot(`Generator {}`);",
    ]) {
      expect(updated["inline.fixture.js"]).toContain(written);
    }
  });

  test("fail for another value", async () => {
    using dir = copy();
    const stored = readFileSync(join(String(dir), snap), "utf8");
    const other = stored.replace('`{"a":1,"b":"x"}`', '`{"a":2,"b":"x"}`').replace("`[1,2,3]`", "`[1,2,4]`");
    expect(other).not.toBe(stored);
    writeFileSync(join(String(dir), snap), other);
    const { stderr, ...result } = await run(String(dir));
    expect(result).toEqual({ pass: 39, fail: 2, exitCode: 1 });
    expect(stderr).toContain(`- {"a":2,"b":"x"}\n+ \n+ {\n+   "a": 1,\n+   "b": "x",\n+ }\n+ \n`);
    expect(stderr).toContain(`- [1,2,4]\n+ \n+ [\n+   1,\n+   2,\n+   3,\n+ ]\n+ \n`);
    expect(readFileSync(join(String(dir), snap), "utf8")).toBe(other);
  });
});

describe("toMatchSnapshot errors", () => {
  it("should throw if property matchers exist and received is not an object", () => {
    expect(() => {
      expect(1).toMatchSnapshot({ a: 1 });
    }).toThrow();
  });
  it("should throw if property matchers don't match", () => {
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: 1 });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(Date) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(String) });
    }).toThrow();
    expect(() => {
      expect({ a: 4n }).toMatchSnapshot({ a: expect.any(Number) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(BigInt) });
    }).toThrow();
  });
  it("should throw if arguments are in the wrong order", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: "oops" }).toMatchSnapshot("wrong spot", { a: "oops" });
    }).toThrow();
    expect(() => {
      expect({ a: "oops" }).toMatchSnapshot({ a: "oops" }, "right spot");
    }).not.toThrow();
  });

  it("should throw if expect.any() doesn't received a constructor", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any() });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 5 }).toMatchSnapshot({ a: expect.any(5) });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any("not a constructor") });
    }).toThrow();
  });
});

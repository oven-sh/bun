import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
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

// These are in the snapshot file because an inline snapshot also passes with what Jest or an older Bun wrote.
test("an own enumerable 'constructor' property is part of the snapshot", () => {
  class Foo {}
  expect({
    object: { constructor: "K", a: 1 },
    parsed: JSON.parse('{"constructor":"_class"}'),
    list: [{ constructor: "K" }],
    // The non-enumerable constructor that a class puts on its prototype is still left out.
    prototype: Foo.prototype,
  }).toMatchSnapshot();
});

// Bun 1.4.3 and 1.4.4 wrote `olderBun`. Until Bun printed an object's own `constructor` key, it left out every key of that name.
describe.concurrent("a snapshot that an older Bun wrote for objects with a 'constructor' key", () => {
  const values = `
    class Foo { m() {} }
    function Big(value) { this.c = [value]; this.constructor = Big; }
    function form(constructor) {
      const form = new FormData();
      form.set("constructor", constructor);
      form.set("a", "b");
      return form;
    }
    const values = (constructor = process.env.CONSTRUCTOR_VALUE ?? "K") => ({
      own: { constructor, a: 1 },
      getter: { get constructor() { return constructor; }, a: 1 },
      symbol: { [Symbol("constructor")]: constructor, a: 1 },
      hidden: Object.defineProperty({ constructor, a: 1 }, "hidden", { value: 2 }),
      prototype: Foo.prototype,
      list: [{ constructor }],
      class: new Big(7),
      form: form(constructor),
    });
  `;
  const olderBun = `{
  "class": Big {
    "c": [
      7,
    ],
  },
  "form": FormData (entries) FormData FormData {
    "a": "b",
  },
  "getter": {
    "a": 1,
  },
  "hidden": {
    "a": 1,
    "hidden": 2,
  },
  "list": [
    {},
  ],
  "own": {
    "a": 1,
  },
  "prototype": Foo {
    "m": [Function: m],
  },
  "symbol": {
    "a": 1,
  },
}`;
  const now = `{
  "class": Big {
    "c": [
      7,
    ],
    "constructor": [Function: Big],
  },
  "form": FormData (entries) FormData FormData {
    "a": "b",
    "constructor": "K",
  },
  "getter": {
    "a": 1,
    "constructor": "K",
  },
  "hidden": {
    "a": 1,
    "constructor": "K",
  },
  "list": [
    {
      "constructor": "K",
    },
  ],
  "own": {
    "a": 1,
    "constructor": "K",
  },
  "prototype": Foo {},
  "symbol": {
    "a": 1,
    [Symbol(constructor)]: "K",
  },
}`;
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const entry = (name: string, text: string) => `\nexports[\`${name} 1\`] = \`\n${text}\n\`;\n`;
  const inAFile = `${values}\ntest("in a file", () => { expect(values()).toMatchSnapshot(); });`;
  const read = (dir: string, ...path: string[]) => readFileSync(join(dir, ...path), "utf8");
  const saved = (dir: string) => read(dir, "__snapshots__", "a.test.js.snap");

  async function run(cwd: string, env: Record<string, string> = {}, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, CI: "true", ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const count = (what: string) => Number(stderr.match(new RegExp(`^ *(\\d+) ${what}$`, "m"))?.[1] ?? -1);
    return { pass: count("pass"), fail: count("fail"), exitCode, stderr };
  }

  test.each(["bun:test", "vitest"])("passes and is left alone, in a test of %j", async module => {
    const testFile = `
      import { test, expect } from ${JSON.stringify(module)};
      ${values}
      // An older Bun printed nothing else of this value in another way.
      test("the key alone", () => {
        expect({ constructor: "K", a: 1 }).toMatchSnapshot();
        expect({ constructor: "K", a: 1 }).toMatchInlineSnapshot(\`\n{\n  "a": 1,\n}\n\`);
      });
      test("in a file", () => { expect(values()).toMatchSnapshot(); });
      test("inline", () => { expect(values()).toMatchInlineSnapshot(\`\n${olderBun}\n\`); });
      test("with property matchers", () => {
        expect({ constructor: "K", id: 5 }).toMatchSnapshot({ id: expect.any(Number) });
      });
      test("but for one line", () => {
        expect(() => expect({ ...values(), more: 1 }).toMatchInlineSnapshot(\`\n${olderBun}\n\`)).toThrow('+   "more": 1,');
      });
    `;
    const snapshots =
      header +
      entry("the key alone", `{\n  "a": 1,\n}`) +
      entry("in a file", olderBun) +
      entry("with property matchers", `{\n  "id": Any<Number>,\n}`);
    using dir = tempDir("snapshot-constructor-key", {
      "a.test.js": testFile,
      "__snapshots__/a.test.js.snap": snapshots,
    });
    const { stderr, ...result } = await run(String(dir));
    expect({ ...result, stderr: result.exitCode ? stderr : "" }).toEqual({ pass: 5, fail: 0, exitCode: 0, stderr: "" });
    expect({ testFile: read(String(dir), "a.test.js"), snapshots: saved(String(dir)) }).toEqual({
      testFile,
      snapshots,
    });
  });

  // The older print leaves the key out, so it cannot tell a value that has the key from one that never had it.
  test("without the key also passes for a value that has gained it", async () => {
    using dir = tempDir("snapshot-constructor-key-gained", {
      "a.test.js": `
        const value = () => (process.env.CONSTRUCTOR_VALUE ? { a: 1, constructor: process.env.CONSTRUCTOR_VALUE } : { a: 1 });
        test("in a file", () => { expect(value()).toMatchSnapshot(); });
        test("inline", () => { expect(value()).toMatchInlineSnapshot(\`\n{\n  "a": 1,\n}\n\`); });
      `,
      "__snapshots__/a.test.js.snap": header + entry("in a file", `{\n  "a": 1,\n}`),
    });
    const [without, gained] = await Promise.all([run(String(dir)), run(String(dir), { CONSTRUCTOR_VALUE: "K" })]);
    expect({
      without: { pass: without.pass, fail: without.fail, exitCode: without.exitCode },
      gained: { pass: gained.pass, fail: gained.fail, exitCode: gained.exitCode },
    }).toEqual({
      without: { pass: 2, fail: 0, exitCode: 0 },
      gained: { pass: 2, fail: 0, exitCode: 0 },
    });
  });

  test("--update-snapshots adds the key, once", async () => {
    // `inline` and `matched` are the text between the backticks of the two inline snapshots.
    const testFile = (inline: string, matched: string) =>
      [
        values,
        `test("in a file", () => { expect(values()).toMatchSnapshot(); });`,
        `test("inline", () => { expect(values()).toMatchInlineSnapshot(\`${inline}\`); });`,
        `test("inline with a property matcher", () => {`,
        `  expect({ constructor: "K", id: 5 }).toMatchInlineSnapshot({ id: expect.any(Number) }, \`${matched}\`);`,
        `});`,
        ``,
      ].join("\n");
    using dir = tempDir("snapshot-constructor-key-update", {
      "a.test.js": testFile(`\n${olderBun}\n`, `\n{\n  "id": Any<Number>,\n}\n`),
      "__snapshots__/a.test.js.snap": header + entry("in a file", olderBun),
    });
    const updated = {
      testFile: testFile(`\n${now}\n`, `\n{\n  "constructor": "K",\n  "id": Any<Number>,\n}\n`),
      snapshots: header + entry("in a file", now),
    };
    const contents = () => ({ testFile: read(String(dir), "a.test.js"), snapshots: saved(String(dir)) });

    const first = await run(String(dir), {}, "--update-snapshots");
    expect(contents()).toEqual(updated);
    const second = await run(String(dir), {}, "--update-snapshots");
    expect(contents()).toEqual(updated);
    expect([first.exitCode, second.exitCode]).toEqual([0, 0]);
  });

  test("with the key, fails for another value of it", async () => {
    using dir = tempDir("snapshot-constructor-key-value", {
      "a.test.js": inAFile,
      "__snapshots__/a.test.js.snap": header + entry("in a file", now),
    });
    const [same, other] = await Promise.all([run(String(dir)), run(String(dir), { CONSTRUCTOR_VALUE: "L" })]);
    expect(other.stderr).toContain('-     "constructor": "K",\n+     "constructor": "L",');
    expect({
      same: { pass: same.pass, fail: same.fail, exitCode: same.exitCode },
      other: { pass: other.pass, fail: other.fail, exitCode: other.exitCode },
    }).toEqual({
      same: { pass: 1, fail: 0, exitCode: 0 },
      other: { pass: 0, fail: 1, exitCode: 1 },
    });
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

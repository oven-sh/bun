// Decimal of https://tc39.es/proposal-decimal/, which is off by default. Its value is in an internal slot and it has no
// own properties, so code that walks the properties of an object takes every Decimal for {}.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";
import { locksEnvironment } from "../../../aot/hardened";
import { unsupported } from "../../../aot/harness/compiler";
import { canTrim } from "../../../bundler/compile-trim-features";

const env = { ...bunEnv, BUN_JSC_useDecimal: "1", NO_COLOR: "1" };
const { BUN_JSC_useDecimal: _, ...off } = env;

async function run(code: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: { ...env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Prints each expression of `expressions` as JSON, or the name of what it throws.
const evaluate = async (setup: string, expressions: string[], extraEnv?: Record<string, string>) => {
  const { stdout, stderr, exitCode } = await run(
    `
    const d = text => new Decimal(text);
    const exact = value => value instanceof Decimal ? value.toExponential() : "not a Decimal";
    ${setup}
    const results = [];
    for (const f of [${expressions.map(e => `async () => (${e})`).join(",\n")}]) {
      try {
        results.push(await f());
      } catch (error) {
        results.push("throws " + error.name);
      }
    }
    console.write(JSON.stringify(results));
  `,
    extraEnv,
  );
  expect(stderr).toBe("");
  const results = JSON.parse(stdout);
  expect(exitCode).toBe(0);
  return results;
};

const clones = {
  "structuredClone": `const clone = async x => structuredClone(x);`,
  "bun:jsc": `const jsc = require("bun:jsc"); const clone = async x => jsc.deserialize(jsc.serialize(x));`,
  "node:v8": `const v8 = require("node:v8"); const clone = async x => v8.deserialize(v8.serialize(x));`,
  "MessageChannel": `const clone = x => new Promise(resolve => {
    const { port1, port2 } = new MessageChannel();
    port1.postMessage(x);
    port2.onmessage = event => { resolve(event.data); port1.close(); port2.close(); };
  });`,
};

const formats = [
  `JSON.stringify({ a: x })`,
  `Bun.YAML.stringify({ a: x })`,
  `Bun.YAML.stringify({ a: [x] }, null, 2)`,
  `Bun.YAML.stringify(x)`,
  `Bun.JSON5.stringify({ a: x })`,
  `Bun.JSON5.stringify([{ a: [x] }], null, 2)`,
  `Bun.TOML.stringify({ a: x })`,
  `Bun.TOML.stringify({ a: [x] })`,
  `Bun.TOML.stringify({ a: { b: x } })`,
  `Bun.XML.stringify({ root: { a: x } })`,
  `Bun.XML.stringify({ root: { "@a": x } })`,
  `Bun.XML.stringify({ root: { a: [x] } })`,
  `Bun.XML.stringify({ name: "a", children: [x] })`,
];
const indents = ["YAML", "JSON5", "XML"].map(
  name => `Bun.${name}.stringify(x, null, d("2")) === Bun.${name}.stringify(x, null, {})`,
);

describe("Decimal", () => {
  describe.concurrent("equality", () => {
    test("Bun.deepEquals", async () => {
      const all: string[] = [];
      const expected: boolean[] = [];
      for (const strict of [true, false]) {
        for (const wrap of [(x: string) => x, (x: string) => `{ a: [${x}] }`, (x: string) => `new Set([${x}])`]) {
          const add = (a: string, b: string, equal: boolean) => {
            all.push(`Bun.deepEquals(${wrap(a)}, ${wrap(b)}, ${strict})`);
            expected.push(equal);
          };
          add(`d("1.5")`, `d("1.50")`, true);
          add(`d("NaN")`, `d("NaN")`, true);
          add(`d("1")`, `d("2")`, false);
          add(`d("0")`, `d("-0")`, false);
          add(`d("1")`, `d("1.000000000000000000000000000000001")`, false);
          add(`d("1")`, `d("NaN")`, false);
          add(`d("Infinity")`, `d("-Infinity")`, false);
          add(`d("1")`, `1`, false);
          add(`d("1")`, `"1"`, false);
          add(`d("1")`, `{}`, false);
          add(`{}`, `d("1")`, false);
          add(`[]`, `d("1")`, false);
          add(`d("1")`, `new Date(1)`, false);
          add(`Object(1n)`, `d("1")`, false);
        }
      }
      expect(await evaluate("", all)).toEqual(expected);
    });

    test("node:assert and node:util", async () => {
      expect(
        await evaluate(`const assert = require("node:assert"), util = require("node:util");`, [
          `assert.deepStrictEqual(d("1"), d("1.0")) ?? "ok"`,
          `assert.deepStrictEqual(d("1"), d("2"))`,
          `assert.deepEqual({ a: d("1") }, { a: d("2") })`,
          `assert.notDeepStrictEqual(d("1"), d("2")) ?? "ok"`,
          `util.isDeepStrictEqual([d("1")], [d("1")])`,
          `util.isDeepStrictEqual([d("1")], [d("2")])`,
          `assert.partialDeepStrictEqual({ a: d("1"), b: 1 }, { a: d("1") }) ?? "ok"`,
          `assert.partialDeepStrictEqual({ a: d("1"), b: 1 }, { a: d("2") })`,
          `assert.partialDeepStrictEqual({ a: d("1") }, { a: {} })`,
        ]),
      ).toEqual([
        "ok",
        "throws AssertionError",
        "throws AssertionError",
        "ok",
        true,
        false,
        "ok",
        "throws AssertionError",
        "throws AssertionError",
      ]);
    });

    test("expect()", async () => {
      using dir = tempDir("decimal-expect", {
        "a.test.ts": `
          import { test, expect } from "bun:test";
          const d = (text: string) => new Decimal(text);
          test("equal", () => {
            expect(d("1")).toEqual(d("1.0"));
            expect({ a: [d("1")] }).toStrictEqual({ a: [d("1")] });
            expect({ a: d("1"), b: 2 }).toMatchObject({ a: d("1") });
            expect([d("1")]).toContainEqual(d("1"));
            expect({ a: d("1") }).toEqual(expect.objectContaining({ a: d("1") }));
          });
          test("not equal", () => {
            expect(d("1")).not.toEqual(d("2"));
            expect(d("1")).not.toEqual({});
            expect({}).not.toEqual(d("1"));
            expect({ a: [d("1")] }).not.toStrictEqual({ a: [d("2")] });
            expect({ a: d("1"), b: 2 }).not.toMatchObject({ a: d("2") });
            expect([d("1")]).not.toContainEqual(d("2"));
            expect({ a: d("1") }).not.toEqual(expect.objectContaining({ a: d("2") }));
          });
          test("own properties", () => {
            class Money extends Decimal { currency = "EUR" }
            const money = new Money("1");
            expect(money).toMatchObject({ currency: "EUR" });
            expect({ a: money }).toMatchObject({ a: { currency: "EUR" } });
            expect(money).toEqual(expect.objectContaining({ currency: "EUR" }));
            expect(money).not.toMatchObject({ currency: "USD" });
            expect(money).toEqual(new Money("1"));
            expect(money).not.toEqual(new Money("2"));
            expect(money).not.toStrictEqual(d("1"));
            expect(() => expect(money).toEqual(new Money("2"))).toThrow("[Decimal (Money): 2]");
            expect(() => expect(Object.assign(d("1.5"), { a: 1 })).toEqual(Object.assign(d("2.5"), { a: 1 }))).toThrow("[Decimal: 2.5]");
          });
          test.each([[d("1.5")]])("title %d %i %f %s", () => {});
          test.each([[d("1.5")], [{ a: d("1.5") }]])("title %j", () => {});
          test("snapshots", () => {
            class Money extends Decimal { currency = "EUR" }
            const read = (value: unknown) => {
              try {
                expect(value).toMatchInlineSnapshot("no");
              } catch (error) {
                return error.message;
              }
            };
            for (const [value, text] of [
              [d("1.5"), "[Decimal: 1.5]"],
              [{ a: d("1.5") }, '"a": [Decimal: 1.5],'],
              [new Money("3"), "[Decimal (Money): 3] {"],
              [{ m: new Money("3") }, '"m": [Decimal (Money): 3] {'],
            ] as const) {
              const message = read(value);
              expect(message).toContain(text);
              expect(message).not.toContain("Money {");
              expect(message).not.toContain("Decimal {");
            }
          });
          test("message", () => {
            expect(() => expect(d("1.5")).toEqual(d("2.5"))).toThrow("[Decimal: 2.5]");
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "a.test.ts"],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(" 8 pass");
      expect(stderr).toContain(" 0 fail");
      expect(exitCode).toBe(0);
    });
  });

  test.concurrent("vitest snapshots and titles", async () => {
    using dir = tempDir("decimal-vitest", {
      "a.test.ts": `
        import { test, expect } from "vitest";
        test.each([[new Decimal("1.5")]])("title %d %j", () => {});
        test("snapshot", () => {
          class Money extends Decimal { currency = "EUR" }
          expect({ a: new Decimal("1.5"), m: new Money("2"), n: [new (class Plain extends Decimal {})("3")] }).toMatchSnapshot();
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.ts"],
      env: { ...env, CI: "false" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 2 pass");
    expect(await Bun.file(`${dir}/__snapshots__/a.test.ts.snap`).text()).toMatchInlineSnapshot(`
      "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html

      exports[\`snapshot 1\`] = \`
      {
        "a": [Decimal: 1.5],
        "m": [Decimal (Money): 2] {
          "currency": "EUR",
        },
        "n": [
          [Decimal (Plain): 3],
        ],
      }
      \`;
      "
    `);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each(Object.entries(clones))("%s throws, and does not make an empty object", async (_, setup) => {
    const holders = [
      "x",
      "[x]",
      "{ a: x }",
      "[{ a: x }, { a: x }]",
      "new Map([[1, x]])",
      "new (class extends Decimal {})(1)",
    ];
    expect(
      await evaluate(
        `${setup} const x = d("1.5");`,
        holders.map(holder => `clone(${holder})`),
      ),
    ).toEqual(holders.map(() => "throws DataCloneError"));
  });

  describe.concurrent("formats", () => {
    test("XML attributes", async () => {
      expect(await evaluate("", [`Bun.XML.stringify({ name: "a", attributes: d("1"), children: [] })`])).toEqual([
        "throws Error",
      ]);
    });

    test("throw, and do not write an empty object", async () => {
      expect(await evaluate(`const x = d("1.5");`, formats)).toEqual(formats.map(() => "throws TypeError"));
    });

    test.each(["() => 1", "() => undefined", "() => Symbol()", "() => { throw new Error() }", "1"])(
      "call no toJSON of the program: %s",
      async toJSON => {
        expect(await evaluate(`Decimal.prototype.toJSON = ${toJSON}; const x = d("1.5");`, formats.slice(1))).toEqual(
          formats.slice(1).map(() => "throws TypeError"),
        );
      },
    );

    test("a Decimal is not an indent", async () => {
      expect(await evaluate(`const x = { a: { b: 1 } };`, indents)).toEqual([true, true, true]);
    });
  });

  describe.concurrent("databases", () => {
    test("bun:sqlite and node:sqlite bind it as text", async () => {
      const text = "1.234567890123456789012345678901234";
      expect(
        await evaluate(
          `const { Database } = require("bun:sqlite"), { DatabaseSync } = require("node:sqlite");
           const db = new Database(":memory:"), node = new DatabaseSync(":memory:");
           for (const x of [db, node]) x.exec("create table t (a text, b)");
           const x = d("${text}");`,
          [
            `(db.query("insert into t values (?, 0)").run(x), db.query("select a, typeof(a) as t from t").get())`,
            `(db.query("insert into t values (?, ?)").run([x, x]), db.query("select a, b, typeof(b) as t from t where b <> 0").get())`,
            `(db.query("insert into t values ($a, 7)").run({ $a: x }), db.query("select a from t where b = 7").get())`,
            `(node.prepare("insert into t values (?, 0)").run(x), node.prepare("select a from t").get())`,
          ],
        ),
      ).toEqual([{ a: text, t: "text" }, { a: text, b: text, t: "text" }, { a: text }, { a: text }]);
    });
  });

  test.concurrent(
    "sql.array() of Postgres has the text of an element, whatever the program made of toString()",
    async () => {
      expect(
        await evaluate(`Decimal.prototype.toString = () => "replaced";`, [
          `new Bun.SQL("postgres://localhost:1").array([d("1.5"), null, d("-0")], "NUMERIC").serializedValues`,
        ]),
      ).toEqual([`{"1.5",NULL,"-0"}`]);
    },
  );

  // The mocks answer what a server would, and the real ones do not show what they received.
  test.concurrent(
    "Postgres and MySQL get the text of a parameter, whatever the program made of toString()",
    async () => {
      const wireFrames = path.join(import.meta.dir, "../../sql/wire-frames.ts");
      const { stdout, stderr, exitCode } = await run(`
      import { SQL } from "bun";
      import * as wire from ${JSON.stringify(wireFrames)};
      Decimal.prototype.toString = () => "replaced";
      const text = "-1.234567890123456789012345678901234", values = [new Decimal(text), new Decimal("NaN")];

      const NUMERIC = 1700, bound = [];
      const postgres = await wire.pgMockServer((type, body) => {
        switch (type) {
          case "P": return wire.pgParseComplete();
          case "D": return [wire.pgParameterDescription([NUMERIC, NUMERIC]), wire.pgNoData()];
          case "B": bound.push(...wire.pgBindParameters(body).map(String)); return wire.pgBindComplete();
          case "E": return wire.pgCommandComplete("SELECT 0");
          case "S": return wire.pgReadyForQuery();
        }
      });
      const pg = new SQL({ url: "postgres://postgres@127.0.0.1:" + postgres.port + "/db", max: 1 });
      await pg\`select \${values[0]}, \${values[1]}\`;
      await pg.close();
      postgres.server.close();

      let executed;
      const mysql = await wire.listeningServer(socket => {
        let buffered = Buffer.alloc(0), authenticated = false;
        socket.write(wire.mysqlHandshakeV10());
        socket.on("data", chunk => {
          buffered = wire.mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
            if (!authenticated) {
              authenticated = true;
              socket.write(wire.mysqlOkPacket(seq + 1));
            } else if (wire.mysqlAckSessionSetup(socket, payload)) {
            } else if (payload[0] === 0x16) {
              const parameter = seq => wire.mysqlColumnDefinition(seq, { name: "?", type: 0xfd });
              socket.write(Buffer.concat([wire.mysqlStmtPrepareOk(1, 1, 0, 2), parameter(2), parameter(3)]));
            } else if (payload[0] === 0x17) {
              executed = payload.toString("latin1");
              socket.write(wire.mysqlOkPacket(seq + 1));
            }
          });
        });
        socket.on("error", () => {});
      });
      const my = new SQL({ url: "mysql://root@127.0.0.1:" + mysql.port + "/db", max: 1 });
      await my\`select \${values[0]}, \${values[1]}\`;
      await my.close();
      mysql.server.close();

      // Each with its length in front, at the end of COM_STMT_EXECUTE.
      const inMySQL = executed.endsWith(String.fromCharCode(text.length) + text + "\\x03NaN");
      console.write(JSON.stringify({ bound, inMySQL }));
    `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ bound: ["-1.234567890123456789012345678901234", "NaN"], inMySQL: true });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("a macro cannot return one", async () => {
    using dir = tempDir("decimal-macro", {
      "macro.ts": `export function price() { return { a: new Decimal("1.5") }; }`,
      "main.ts": `import { price } from "./macro.ts" with { type: "macro" }; console.log(price());`,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.ts"], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("cannot coerce Decimal to Bun's AST");
    expect(stdout).not.toContain("{");
    expect(exitCode).not.toBe(0);
  });

  describe.concurrent("printing", () => {
    test("console.log and Bun.inspect", async () => {
      const { stdout, exitCode } = await run(`
        const d = text => new Decimal(text);
        console.log(d("1.5"));
        console.log([d("-0"), d("NaN")]);
        console.log({ price: d("19.90") });
        console.log(new Map([[d("1"), d("2")]]));
        console.log(Bun.inspect(d("1e40")));
        console.log("%s %o %d %i %f", d("1.5"), d("2.5"), d("3.5"), d("-4.5"), d("5.5"));
        console.log("%d %i %f %f", d("NaN"), d("Infinity"), d("Infinity"), d("-Infinity"));
        console.log([{ order: { price: d("19.90") } }]);
        console.log(Bun.inspect({ a: d("1") }, { depth: 0 }));
        console.log(Object.setPrototypeOf(d("4"), null), new (class extends Decimal {})("5"));
        class Money extends Decimal { currency = "EUR"; method() {} }
        console.log(new Money("2"), new (class Plain extends Decimal {})("3"), Object.assign(d("1"), { a: 1 }));
        console.log(Object.setPrototypeOf(d("4"), Object.prototype));
        console.log(Array.from({ length: 20 }, (_, i) => d("1.234567890123456789" + i)));
        const shared = { a: d("1") };
        console.log({ ...shared, b: shared.a, c: { d: { e: { f: { g: d("9") } } } } });
        Decimal.prototype.toString = () => "replaced";
        console.log(d("3"));
        delete Decimal.prototype.toJSON;
        console.log(d("6"), [d("7")]);
        console.log({}, Object.create(null), new (class A {})());
      `);
      expect(stdout).toMatchInlineSnapshot(`
        "[Decimal: 1.5]
        [
          [Decimal: -0], [Decimal: NaN]
        ]
        {
          price: [Decimal: 19.9],
        }
        Map(1) {
          [Decimal: 1]: [Decimal: 2],
        }
        [Decimal: 1e40]
        1.5 [Decimal: 2.5] 3 -4 5.5
        NaN NaN Infinity -Infinity
        [
          {
            order: {
              price: [Decimal: 19.9],
            },
          }
        ]
        {
          a: [Decimal: 1],
        }
        [Decimal: 4] [Decimal: 5]
        [Decimal (Money): 2] {
          currency: "EUR",
          method: [Function: method],
        } [Decimal (Plain): 3] [Decimal: 1] {
          a: 1,
        }
        [Decimal: 4]
        [
          [Decimal: 1.234567890123456789], [Decimal: 1.2345678901234567891], [Decimal: 1.2345678901234567892],
          [Decimal: 1.2345678901234567893], [Decimal: 1.2345678901234567894], [Decimal: 1.2345678901234567895],
          [Decimal: 1.2345678901234567896], [Decimal: 1.2345678901234567897], [Decimal: 1.2345678901234567898],
          [Decimal: 1.2345678901234567899], [Decimal: 1.2345678901234567891], [Decimal: 1.23456789012345678911],
          [Decimal: 1.23456789012345678912], [Decimal: 1.23456789012345678913], [Decimal: 1.23456789012345678914],
          [Decimal: 1.23456789012345678915], [Decimal: 1.23456789012345678916], [Decimal: 1.23456789012345678917],
          [Decimal: 1.23456789012345678918], [Decimal: 1.23456789012345678919]
        ]
        {
          a: [Decimal: 1],
          b: [Decimal: 1],
          c: {
            d: {
              e: [Object ...],
            },
          },
        }
        [Decimal: 3]
        [Decimal: 6] [
          [Decimal: 7]
        ]
        {} [Object: null prototype] {} A {}
        "
      `);
      expect(exitCode).toBe(0);
    });

    test("node:util inspect", async () => {
      expect(
        await evaluate(`const { inspect } = require("node:util");`, [
          `inspect(d("1.5"))`,
          `inspect({ a: [d("-0")] })`,
          `inspect(new (class Money extends Decimal {})("2"))`,
          `inspect(Object.assign(d("1"), { a: 1 }))`,
          `inspect(Object.setPrototypeOf(d("1"), null))`,
          `inspect(Object.setPrototypeOf(d("1.5"), Object.prototype))`,
          `inspect({}) + inspect(new (class A {})())`,
          `inspect(Object.getPrototypeOf(Object(1n)))`,
          `inspect(new Proxy(d("1"), {}))`,
          `Bun.inspect(Object.assign(d("1"), { a: 1 }), { colors: true }).split(" {")[0]`,
          `(() => { const x = d("8"); delete globalThis.Decimal; return inspect(x); })()`,
        ]),
      ).toMatchInlineSnapshot(`
        [
          "[Decimal: 1.5]",
          "{ a: [ [Decimal: -0] ] }",
          "[Decimal (Money): 2]",
          "[Decimal: 1] { a: 1 }",
          "[Decimal (null prototype): 1]",
          "[Decimal (Object): 1.5]",
          "{}A {}",
          "Object [BigInt] {}",
          "[Decimal: 1]",
          "\x1B[0m\x1B[33m[Decimal: 1]\x1B[0m",
          "[Decimal: 8]",
        ]
      `);
    });
  });
});

test("Decimal is off by default", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.write(typeof Decimal)"],
    env: off,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "undefined", stderr: "" });
  expect(exitCode).toBe(0);
});

async function spawn(cmd: string[], cwd: string, variables: Record<string, string | undefined> = env) {
  await using proc = Bun.spawn({ cmd, cwd, env: variables, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const executable = isWindows ? "program.exe" : "program";

async function compileAndRun(
  flags: string[],
  sources: Record<string, string>,
  variables: typeof off,
  variablesOfRun: typeof off = off,
) {
  using dir = tempDir("decimal-executable", sources);
  const built = await spawn(
    [bunExe(), "build", "--compile", ...flags, "main.js", "--outfile", executable],
    String(dir),
    variables,
  );
  expect(built.stderr).not.toMatch(/^error\b/m);
  return await spawn([path.join(String(dir), executable)], String(dir), variablesOfRun);
}

describe.concurrent("an executable", () => {
  test("has Decimal without the variable", async () => {
    const sources = { "main.js": `console.log(new Decimal("0.1").add(new Decimal("0.2")).toString());` };
    const result = await compileAndRun(["--bytecode", "--format=esm"], sources, env);
    expect(result).toEqual({ stdout: "0.3\n", stderr: "", exitCode: 0 });
  }, 60_000);

  test("hands it on to an executable that it builds", async () => {
    const sources = {
      "main.js": `
        const outfile = process.cwd() + "/inner" + (process.platform === "win32" ? ".exe" : "");
        await Bun.build({ entrypoints: [process.cwd() + "/inner.js"], compile: { outfile, executablePath: ${JSON.stringify(bunExe())} } });
        console.write(Bun.spawnSync([outfile]).stdout);
      `,
      "inner.js": `console.log(typeof Decimal);`,
    };
    expect(await compileAndRun([], sources, env)).toEqual({ stdout: "function\n", stderr: "", exitCode: 0 });
  }, 60_000);

  test("leaves the last word to the variable", async () => {
    const sources = { "main.js": `console.log(typeof Decimal);` };
    const result = await compileAndRun([], sources, env, { ...off, BUN_JSC_useDecimal: "0" });
    expect(result).toEqual({ stdout: "undefined\n", stderr: "", exitCode: 0 });
  }, 60_000);

  test("that was built without it has none", async () => {
    const result = await compileAndRun(["--compile-jit-policy=2"], { "main.js": "console.log(typeof Decimal);" }, off);
    expect(result).toEqual({ stdout: "undefined\n", stderr: "", exitCode: 0 });
  }, 60_000);

  test.skipIf(!!unsupported).concurrent.each([
    ["an alias", `const D = Decimal; console.log(["1.50"].map(text => new D(text)).join());`],
    [
      "a method added",
      `Decimal.prototype.half = function () { return this.divide(new Decimal(2)); }; console.log(String(new Decimal(3).half()));`,
    ],
    [
      "an accessor handed over",
      `console.log(new Decimal("1.45").add(new Decimal("0.01")).toFixed({ get digits() { return 1; } }));`,
    ],
    ["a polyfill", `globalThis.Decimal ??= function () {}; console.log([1.5].map(x => new Decimal(x)).join());`],
  ])(
    "--aot knows that the global is there: %s",
    async (_, source) => {
      const result = await compileAndRun(["--aot"], { "main.js": source }, env);
      expect(result).toEqual({ stdout: "1.5\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!!unsupported).each([[[]], [["--aot-references", "wide"]], ...(canTrim ? [[["--trim"]]] : [])])(
    "--aot %j computes with Decimals in place, and calls what is none",
    async flags => {
      const source = `
        class Line {
          constructor(price, quantity) { this.price = price; this.quantity = quantity; }
          total() { return this.price.multiply(new Decimal(this.quantity)); }
        }
        function invoice(lines, parts) {
          let sum = new Decimal(0);
          const texts = [];
          for (const line of lines) {
            const total = line.total();
            sum = total.greaterThan(new Decimal(500)) ? sum.add(total.multiply(new Decimal(95)).divide(new Decimal(100)).round(2)) : sum.add(total);
            if (line.quantity === 9) texts.push(total.toFixed({ digits: 1 }), total.negate());
          }
          Bun.gc(true);
          return [sum, sum.divide(parts).round(2, "ceil"), texts.length, texts.at(-2), texts.at(-1)].join();
        }
        const lines = Array.from({ length: 20000 }, (_, i) => new Line(new Decimal((i * 7919 % 100003) + "e-2"), 1 + i % 9));
        console.log(invoice(lines, new Decimal(7)));
        class Free extends Decimal {}
        Object.assign(Free.prototype, { ["multi" + "ply"]: () => new Decimal(0) });
        console.log(invoice([new Line(new Free(5), 9)], new Decimal(1)));
        try { invoice(lines, 7); } catch (error) { console.log(error.name); }
        Reflect.set(Decimal.prototype, "round", () => new Decimal(1));
        console.log(invoice(lines.slice(0, 20), new Decimal(7)));
      `;
      const result = await compileAndRun(["--aot", ...flags], { "main.js": source }, env);
      expect(result).toEqual({
        stdout: [
          "47532015.16,6790287.88,4444,4634.5,-4634.46",
          "0,0,2,0.0,-0",
          "TypeError",
          "1221.11,1,4,3115.8,-3115.8",
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(!!unsupported)(
    "--aot leaves alone what was kept of a running total",
    async () => {
      const totals = `
        declare const Decimal: any;
        const step = new Decimal("1.25");
        function* sums(limit: number): Generator<number, number, any> {
          let sum = 0;
          for (let i = 0; i < limit; i++) sum += Number(yield sum) || 1;
          return sum;
        }
        function besideGenerator(held: any, total: any) {
          const kept: any[] = [];
          for (let round = 0; round < 4; round++) {
            kept.push(total);
            const it = sums(round);
            held.y = held.inner.z;
            while (true) {
              if (it.next(held.x++).done) break;
              total = total.add(step);
            }
          }
          return [...kept, total].join();
        }
        console.log(besideGenerator(JSON.parse('{"x":3,"y":2,"inner":{"z":3}}'), new Decimal(1)));
        console.log(besideGenerator({ x: 1, y: 2, inner: { z: 1 } }, new Decimal(2)));

        class Settings { static text = "ab".repeat(2); }
        function besideReads(at: number, total: any) {
          const kept: any[] = [], seen: number[] = [];
          for (let round = 0; round < 3; round++) {
            kept.push(total);
            for (let i = 0; i < 8; i++) {
              seen.push(Settings.text.length);
              if (i === at % 8) {
                total = total.add(step);
                "x".replace(/x/, () => (Settings.text = "b"));
              }
              seen.push(Settings.text.indexOf("b"));
            }
          }
          return [...kept, total].join() + " " + seen.slice(0, 6).join("");
        }
        const unseen: any = new Map([["read", besideReads]]);
        console.log(unseen.get("read")(1, new Decimal(3)));
      `;
      const sources = { "main.js": `import "./totals.ts";`, "totals.ts": totals };
      expect(await compileAndRun(["--aot"], sources, env)).toEqual({
        stdout: "1,1,2.25,4.75,8.5\n2,2,3.25,5.75,9.5\n3,4.25,5.5,6.75 414010\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(!!unsupported || locksEnvironment)(
    "--aot without the variable leaves it to the run whether the global is there",
    async () => {
      using dir = tempDir("decimal-executable", {
        "main.js": `
          const D = globalThis.Decimal ?? class { toString() { return "polyfill"; } };
          console.log(["1.50"].map(text => new D(text)).join());
        `,
      });
      await spawn([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], String(dir), off);
      const run = (variables: typeof off) => spawn([path.join(String(dir), executable)], String(dir), variables);
      expect(await run(off)).toEqual({ stdout: "polyfill\n", stderr: "", exitCode: 0 });
      expect(await run(env)).toEqual({ stdout: "1.5\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!!unsupported || !canTrim)(
    "--aot --trim keeps what toLocaleString() needs",
    async () => {
      const sources = { "main.js": `console.log(new Decimal("1234.5").toLocaleString("en-US"));` };
      const result = await compileAndRun(["--aot", "--trim"], sources, env);
      expect(result).toEqual({ stdout: "1,234.5\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );
});

test.concurrent("there is no literal", async () => {
  using dir = tempDir("decimal-literal", { "a.js": "f(1.5m);" });
  for (const command of ["run", "build", "fmt"]) {
    const { stderr, exitCode } = await spawn([bunExe(), command, "a.js"], String(dir));
    expect(stderr).toContain("error: ");
    expect(exitCode).not.toBe(0);
  }
  expect(await evaluate("", [`(0, eval)("1.5m")`])).toEqual(["throws SyntaxError"]);
});

describe.concurrent("BUN_JSC_useDecimalStructuredClone", () => {
  const option = { BUN_JSC_useDecimalStructuredClone: "1" };
  const values = ["NaN", "Infinity", "-Infinity", "0", "-0", "1", "-1.5", "1e-7", "1e34", "-1e6144", "1e-6176"];
  values.push("1.234567890123456789012345678901234");

  test.each(Object.entries(clones))("%s", async (_, setup) => {
    const expressions: string[] = [];
    const expected: unknown[] = [];
    for (const text of values) {
      expressions.push(`clone(d("${text}")).then(exact)`, `clone({ a: [d("${text}")] }).then(x => exact(x.a[0]))`);
      expressions.push(`exact(d("${text}"))`);
    }
    expressions.push(
      // Identity, and that the numbering of other objects stays right.
      `(async () => {
        const x = d("1.5"), o = {}, big = Object(1n);
        const c = await clone([x, o, x, d("1.5"), big, o, x, big, new Map([[x, x]])]);
        const [[key, value]] = [...c[8]];
        return [c[0] === c[2], c[0] === c[6], c[0] !== c[3], c[1] === c[5], c[4] === c[7], key === c[0], value === c[0]];
      })()`,
      `clone(Object.assign(new (class extends Decimal {})("2"), { own: 1 })).then(x => [exact(x), x.constructor === Decimal, "own" in x])`,
    );
    const results = await evaluate(setup, expressions, option);
    for (let i = 0; i < values.length; i++) {
      expected.push(results[3 * i + 2], results[3 * i + 2], results[3 * i + 2]);
      expect(results[3 * i + 2]).not.toBe("not a Decimal");
    }
    expected.push([true, true, true, true, true, true, true], ["2e0", true, false]);
    expect(results).toEqual(expected);
  });

  test("Worker", async () => {
    using dir = tempDir("decimal-worker", {
      "main.js": `
        const worker = new Worker(new URL("./worker.js", import.meta.url));
        worker.onmessage = event => {
          console.write(event.data.sum instanceof Decimal ? event.data.sum.toString() : "not a Decimal");
          worker.terminate();
        };
        worker.postMessage({ a: new Decimal("0.1"), b: new Decimal("0.2") });
      `,
      "worker.js": `onmessage = event => postMessage({ sum: event.data.a.add(event.data.b) });`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: { ...env, ...option },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0.3");
    expect(exitCode).toBe(0);
  });

  test("bytes cut short or changed are rejected", async () => {
    expect(
      await evaluate(
        `const { serialize, deserialize } = require("bun:jsc");`,
        [
          `(() => {
          const bytes = new Uint8Array(serialize({ a: d("12345.6789") }));
          let accepted = 0;
          for (let length = 1; length < bytes.length; length++) {
            try { deserialize(bytes.slice(0, length).buffer); accepted++; } catch {}
          }
          return accepted;
        })()`,
          `(() => {
          const bytes = new Uint8Array(serialize(d("12345.6789")));
          const text = Buffer.from("1.23456789e4");
          const at = Buffer.from(bytes).indexOf(text);
          bytes[at] = 0x78;
          return [at > 0, (() => { try { deserialize(bytes.buffer); return "accepted"; } catch { return "rejected"; } })()];
        })()`,
        ],
        option,
      ),
    ).toEqual([0, [true, "rejected"]]);
  });

  test.each([
    ["Decimal", { ...off, ...option }],
    ["the option", env],
  ])("bytes with a Decimal are rejected by a process without %s", async (_, variables) => {
    const { stdout } = await run(
      `console.write(Buffer.from(require("bun:jsc").serialize({ a: new Decimal("1.5") })).toString("hex"))`,
      option,
    );
    expect(stdout.length).toBeGreaterThan(20);
    const read = `try { console.write(String(require("bun:jsc").deserialize(Buffer.from("${stdout}", "hex")))) } catch { console.write("rejected") }`;
    expect(await spawn([bunExe(), "-e", read], import.meta.dir, variables)).toEqual({
      stdout: "rejected",
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.concurrent("BUN_JSC_useDecimalToJSON", () => {
  const option = { BUN_JSC_useDecimalToJSON: "1" };

  test("the formats write the exact value", async () => {
    const text = "1.234567890123456789012345678901234";
    const results = await evaluate(`const x = d("${text}");`, formats, option);
    for (const result of results) expect(result).toContain(text);
  });

  test("a Decimal is still not an indent", async () => {
    expect(await evaluate(`const x = { a: { b: 1 } };`, indents, option)).toEqual([true, true, true]);
  });
});

test.concurrent.each([
  ["StructuredClone", "Operators", "1.5 TypeError 3"],
  ["ToJSON", "Operators", 'DataCloneError "1.5" 3'],
])(
  "an executable keeps BUN_JSC_useDecimal%s and %s, and no other option",
  async (first, second, expected) => {
    const source = `
    const x = new Decimal("1.5");
    const outcome = f => { try { return String(f()); } catch (error) { return error.name; } };
    console.write([() => structuredClone(x), () => JSON.stringify(x), () => x + x].map(outcome).join(" "));
  `;
    const variables = { ...env, ["BUN_JSC_useDecimal" + first]: "1", ["BUN_JSC_useDecimal" + second]: "1" };
    const result = await compileAndRun(["--bytecode", "--format=esm"], { "main.js": source }, variables);
    expect(result).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  },
  60_000,
);

test.concurrent.each(["Operators", "Literals"])(
  "bytecode is used with the BUN_JSC_useDecimal%s it was made with",
  async option => {
    using dir = tempDir("decimal-bytecode", {
      "write.js": `require("fs").writeFileSync(process.argv[2], new (require("vm").Script)("1 + 1").createCachedData());`,
      "read.js": `
      const isRejected = file => new (require("vm").Script)("1 + 1", { cachedData: require("fs").readFileSync(file) }).cachedDataRejected;
      console.write(isRejected("0") + " " + isRejected("1"));
    `,
    });
    const runWith = (value: string, ...args: string[]) =>
      spawn([bunExe(), ...args], String(dir), { ...env, ["BUN_JSC_useDecimal" + option]: value });
    await Promise.all([runWith("0", "write.js", "0"), runWith("1", "write.js", "1")]);
    expect(await Promise.all([runWith("0", "read.js"), runWith("1", "read.js")])).toEqual([
      { stdout: "false true", stderr: "", exitCode: 0 },
      { stdout: "true false", stderr: "", exitCode: 0 },
    ]);
  },
);

// Compiled code has no operators, so == would compare identity where bun run compares values.
test.skipIf(!!unsupported).concurrent.each([
  ["--aot", ["build", "--compile", "--aot", "main.js"]],
  ["bun compile", ["compile", "main.js"]],
  ["compile.aot", ["build.js"]],
])("%s refuses BUN_JSC_useDecimalOperators", async (subject, command) => {
  using dir = tempDir("decimal-executable", {
    "main.js": "console.log(new Decimal(1) == new Decimal(1));",
    "build.js": `await Bun.build({ entrypoints: ["main.js"], compile: { aot: true, outfile: "program" } });`,
  });
  const variables = { ...env, BUN_JSC_useDecimalOperators: "1" };
  const { stderr, exitCode } = await spawn([bunExe(), ...command], String(dir), variables);
  expect(stderr).toContain(`${subject} doesn't support BUN_JSC_useDecimalOperators`);
  expect(exitCode).toBe(1);
});

test.skipIf(!!unsupported || locksEnvironment)(
  "an --aot executable does not take BUN_JSC_useDecimalOperators from the environment",
  async () => {
    const sources = {
      "main.js": `console.log(new Decimal(1) == new Decimal(1), eval("new Decimal(1) == new Decimal(1)"));`,
    };
    const result = await compileAndRun(["--aot"], sources, env, { ...off, BUN_JSC_useDecimalOperators: "1" });
    expect(result).toEqual({ stdout: "false false\n", stderr: "", exitCode: 0 });
  },
  120_000,
);

// 1.5m. It is not in the proposal.
const literals = { ...env, BUN_JSC_useDecimalLiterals: "1" };

async function transform(source: string, name = "in.js", flags = ["--minify-syntax", "--minify-whitespace"]) {
  using dir = tempDir("decimal-literal", { [name]: source });
  return await spawn([bunExe(), "build", "--no-bundle", ...flags, name], String(dir), literals);
}

const invalid = ["010m", "08m", "08.5m", "00m", "0_1m", "0x1m", "0b1m", "0o1m", "1_m", "1.5_m", "1em", "1M", "1mm"];
invalid.push("1m1", "1mn", "1nm", "1m\\u0061", "1m = 2", "1m++", "-1m ** 2m", "({ 1m: 2 })", "class A { 1m }");
invalid.push("var { 1m: a } = b");

describe.concurrent("literals, in the front ends", () => {
  test.each([
    ["1m, 1.50m, .5m, 1.m, 0m, 0.5m, 1e3m, 1E-3m", "1m,1.50m,.5m,1.m,0m,0.5m,1e3m,1E-3m"],
    ["1_000.000_1m, 1e1_0m", "1000.0001m,1e10m"],
    ["12345678901234567890.12345678901234m", "12345678901234567890.12345678901234m"],
    [
      "-1m, - -1m, -(1m), (-1m).a, -1m.a, (-1m) ** a, a - -1m, a - 1m",
      "-1m,- -1m,-1m,(-1m).a,-1m.a,(-1m)**a,a- -1m,a-1m",
    ],
    ["(1m).a, 1m['a'], 1m?.a, new (1m).a, 1m in a, a in 1m", "1m.a,1m.a,1m.a,new 1m.a,1m in a,a in 1m"],
    // It is an object.
    ["typeof 1m, !0m, 0m ? a : b, 0m ?? a, 0m || a, 0m && a, void 1m", '"object",!1,a,0m,0m,a,void 0'],
    ["typeof -1m, !-0m, -0m ? a : b", "typeof-1m,!-0m,-0m?a:b"],
    ["1m === 1m, 1m == 1m, 1m !== 1m, -1m === -1m, 1m == 1", "1m===1m,1m==1m,1m!==1m,-1m===-1m,1m==1"],
    ["1m + 2m, 1m * 2, +1m, ~1m, 'a' + 1m, 1m + '', `${1.50m}`", '1m+2m,1m*2,+1m,~1m,"a"+1m,1m+"",`${1.50m}`'],
    ["{ [1.50m]: a }, a[1m], [1.50m] + ''", '{[1.50m]:a},a[1m],[1.50m]+""'],
  ])("prints %s", async (source, expected) => {
    const { stdout, stderr, exitCode } = await transform(`f(${source})`);
    expect({ stdout, stderr }).toEqual({ stdout: `f(${expected});`, stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("a constant stays one object", async () => {
    const { stdout, exitCode } = await transform(`function f() { const a = 1m; return [a, a]; }`);
    expect(stdout).toBe("function f(){const a=1m;return[a,a]}");
    expect(exitCode).toBe(0);
  });

  test("behind keywords", async () => {
    const source = `export default 1m; async function* f() { yield 1m; await 2m; switch (a) { case 3m: throw 4m; } return 5m; }`;
    const { stdout, exitCode } = await transform(source);
    expect(stdout).toBe("export default 1m;async function*f(){yield 1m;await 2m;switch(a){case 3m:throw 4m}return 5m}");
    expect(exitCode).toBe(0);
  });

  test("TypeScript and JSX", async () => {
    const source = `const a: unknown = 1m as any, b = 2m!, c = f<T>(3m), d = e < g > 4m, h = <i j={5m}>6m{7m}</i>;`;
    const { stdout, exitCode } = await transform(source, "in.tsx", ["--minify-whitespace", "--jsx-runtime=classic"]);
    expect(stdout).toBe(`const a=1m,b=2m,c=f(3m),d=e<g>4m,h=React.createElement("i",{j:5m},"6m",7m);`);
    expect(exitCode).toBe(0);
  });

  test("the bundler removes those that are not used", async () => {
    using dir = tempDir("decimal-literal", {
      "main.js": `import { used } from "./rates.js"; console.log(used);`,
      "rates.js": `export const used = 1.5m, unused = 2.5m, negative = -3.5m, nested = { a: [4.5m] }, throws = +5.5m;`,
    });
    const { stdout, exitCode } = await spawn([bunExe(), "build", "main.js"], String(dir), literals);
    expect(stdout.match(/\d\.5m/g)).toEqual(["1.5m", "5.5m"]);
    expect(exitCode).toBe(0);
  });

  test.each(invalid)("bun build rejects %s", async source => {
    const { stdout, stderr, exitCode } = await transform(source);
    expect(stdout).toBe("");
    expect(stderr).toContain("error: ");
    expect(exitCode).toBe(1);
  });

  test("bun fmt rejects the same", async () => {
    // It leaves the targets of assignments to others.
    const sources = invalid.filter(source => !/^1m( = 2|\+\+)$/.test(source));
    using dir = tempDir("decimal-literal", Object.fromEntries(sources.map((source, i) => [`${i}.js`, source])));
    const { stderr, exitCode } = await spawn([bunExe(), "fmt"], String(dir), literals);
    expect(sources.filter((_, i) => !stderr.includes(`at ${i}.js:`))).toEqual([]);
    expect(exitCode).not.toBe(0);
  });

  test("bun fmt", async () => {
    using dir = tempDir("decimal-literal", {
      "a.ts": `f(1.50m,.5m,1.m,1E+3m,1_000m,(-1m).abs(),(1m).add(2m),- -1m,-(1m), 12345678901234567890.123m)`,
    });
    const { exitCode } = await spawn([bunExe(), "fmt", "a.ts"], String(dir), literals);
    expect(await Bun.file(path.join(String(dir), "a.ts")).text()).toBe(
      "f(\n  1.5m,\n  0.5m,\n  1m,\n  1e3m,\n  1_000m,\n  (-1m).abs(),\n  1m.add(2m),\n  -(-1m),\n  -1m,\n  12345678901234567890.123m,\n);\n",
    );
    expect(exitCode).toBe(0);
  });

  test("bun lint", async () => {
    using dir = tempDir("decimal-literal", {
      "a.js": `export const a = 1m.add(-2m);\nif (0m) a === 1m.abs();\nexport const b = a === 1m;\n`,
    });
    const { stdout, stderr } = await spawn([bunExe(), "lint", "a.js"], String(dir), literals);
    expect((stdout + stderr).match(/no-constant-[a-z-]+/g)).toEqual([
      "no-constant-condition",
      "no-constant-binary-expression",
    ]);
  });

  test("bun check", async () => {
    using dir = tempDir("decimal-literal", {
      "tsconfig.json": `{ "compilerOptions": { "strict": true, "skipLibCheck": true, "types": [], "lib": ["es5"] } }`,
      "a.ts": `export const a = 1m.add(2m), b = (-1m).abs(), c = (- -1m).abs();\nexport const d = a === 1m, e = a == 1m, f = (-(1m as number)).abs();\n`,
    });
    const { stdout, stderr, exitCode } = await spawn([bunExe(), "check"], String(dir), literals);
    expect((stdout + stderr).match(/TS\d+/g)).toEqual(["TS2839"]);
    expect(exitCode).toBe(1);
  });

  test.each([
    [undefined, "1"],
    ["0", "1"],
    ["false", "1"],
    ["1", "0"],
    ["1", "false"],
  ])("a syntax error with BUN_JSC_useDecimal=%s and BUN_JSC_useDecimalLiterals=%s", async (decimal, literal) => {
    const variables = { ...off, BUN_JSC_useDecimal: decimal, BUN_JSC_useDecimalLiterals: literal };
    using dir = tempDir("decimal-literal", { "a.js": "f(1.5m);" });
    for (const command of ["build", "fmt"]) {
      const { stderr, exitCode } = await spawn([bunExe(), command, "a.js"], String(dir), variables);
      expect(stderr).toContain("error: ");
      expect(exitCode).not.toBe(0);
    }
  });
});

describe.concurrent("literals", () => {
  const files = {
    "rate.cjs": `module.exports = { rate: .07m };`,
    "main.js": `
      import { rate } from "./rate.cjs";
      class Decimal {}
      const price = 19.99m, literal = () => 1m, negative = (sign = -1.50m) => sign;
      class Account { balance = -0m; static limit = 1_000m; }
      let total = 0m;
      for (let i = 0; i < 10; i++) total = total.add(0.1m);
      console.log([price.multiply(rate).round(2), total, negative(), - -1m, -(1m), (-1m).abs(), 1e6145m].join());
      console.log(1m.divide(new Account().balance).toString(), Account.limit.toString(), { [1.50m]: 1 }[1.5]);
      console.log(typeof 1m, typeof -1m, !0m, !-0m, -0m ? 1 : 2, 1m === 1m, literal() === literal(), price === price);
      console.log(-1m instanceof Decimal, -1m instanceof globalThis.Decimal, new Array(-1m).length);
      for (const f of [() => -1m.abs(), () => +1m, () => 1m + 1m, () => "a" + -1m, () => -price, () => 1m.nothing()]) {
        try {
          console.log(f());
        } catch (error) {
          console.log(error.name);
        }
      }
    `,
  };
  const printed = [
    "1.4,1,-1.5,1,-1,1,Infinity",
    "-Infinity 1000 1",
    "object object false false 1 false false true",
    "false true 1",
    ...Array(6).fill("TypeError"),
    "",
  ].join("\n");

  test("bun run", async () => {
    using dir = tempDir("decimal-literal", files);
    expect(await spawn([bunExe(), "main.js"], String(dir), literals)).toEqual({
      stdout: printed,
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([[["--format=esm"]], [["--format=cjs"]], [["--minify"]], [["--format=cjs", "--bytecode"]]])(
    "bun build %j",
    async flags => {
      using dir = tempDir("decimal-literal", files);
      const built = await spawn(
        [bunExe(), "build", "--target=bun", "--outdir=out", ...flags, "main.js"],
        String(dir),
        literals,
      );
      expect(built.stderr).toBe("");
      expect(await spawn([bunExe(), "out/main.js"], String(dir), literals)).toEqual({
        stdout: printed,
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // The bytecode has the code of a function for calls only, so `new` would be the first to meet the syntax.
  test("--bytecode does not start without the variable", async () => {
    using dir = tempDir("decimal-literal", {
      "main.js": `function Money() { this.value = 0m; } console.log("started"); new Money();`,
    });
    const flags = ["--target=bun", "--outdir=out", "--format=cjs", "--bytecode"];
    expect((await spawn([bunExe(), "build", ...flags, "main.js"], String(dir), literals)).stderr).toBe("");
    const { stdout, stderr, exitCode } = await spawn([bunExe(), "out/main.js"], String(dir), env);
    expect(stdout).toBe("");
    expect(stderr).toContain("SyntaxError");
    expect(exitCode).toBe(1);
  });

  test("an executable has them without the variables", async () => {
    const result = await compileAndRun(["--bytecode", "--format=esm"], files, literals);
    expect(result).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  }, 60_000);

  test("also in what it loads from disk", async () => {
    const sources = {
      "main.js": `console.log(String(-1m), String((await import(process.cwd() + "/late.ts")).default));`,
      "late.ts": `export default 1.50m as unknown;`,
    };
    const result = await compileAndRun(["--compile-jit-policy=2"], sources, literals);
    expect(result).toEqual({ stdout: "-1 1.5\n", stderr: "", exitCode: 0 });
  }, 60_000);

  test.skipIf(!!unsupported)(
    "--aot",
    async () => {
      expect(await compileAndRun(["--aot"], files, literals)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.skipIf(!!unsupported || !canTrim)(
    "--aot --trim",
    async () => {
      const sources = { "main.js": `console.log(1234.5m.toLocaleString("en-US"), -0.125m.round(2).toString());` };
      const result = await compileAndRun(["--aot", "--trim"], sources, literals);
      expect(result).toEqual({ stdout: "1,234.5 -0.12\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test("with operators", async () => {
    using dir = tempDir("decimal-literal", {
      "main.js": `const a = 0.1m; console.log([a + 0.2m, -a, a * a, 1m == 1.0m, 1m === 1m, 1m < 2m, typeof (a - a)].join());`,
    });
    const variables = { ...literals, BUN_JSC_useDecimalOperators: "1" };
    const expected = { stdout: "0.3,-0.1,0.01,true,false,true,object\n", stderr: "", exitCode: 0 };
    expect(await spawn([bunExe(), "main.js"], String(dir), variables)).toEqual(expected);
    await spawn([bunExe(), "build", "--minify", "--outdir=out", "main.js"], String(dir), variables);
    expect(await spawn([bunExe(), "out/main.js"], String(dir), variables)).toEqual(expected);
  });

  test("Bun.Transpiler, eval and node:vm", async () => {
    using dir = tempDir("decimal-literal", {
      "main.js": `
        console.write(new Bun.Transpiler({ loader: "ts" }).transformSync("f(1_0.5m as any)"));
        console.log(String(eval("-1.50m")), String(require("node:vm").runInNewContext("2.50m")));
      `,
    });
    expect(await spawn([bunExe(), "main.js"], String(dir), literals)).toEqual({
      stdout: "f(10.5m);\n-1.5 2.5\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("the transpiler cache does not hand them to a process without the option", async () => {
    using dir = tempDir("decimal-literal", { "main.js": `console.log(String(1.5m)); // ${Buffer.alloc(60_000, "x")}` });
    const cache = {
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(String(dir), "cache"),
      BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
    };
    for (let i = 0; i < 2; i++) {
      const { stdout } = await spawn([bunExe(), "main.js"], String(dir), { ...literals, ...cache });
      expect(stdout).toBe("1.5\n");
    }
    const { stderr, exitCode } = await spawn([bunExe(), "main.js"], String(dir), { ...env, ...cache });
    expect(stderr).toContain("error: Syntax Error");
    expect(exitCode).toBe(1);
  });
});

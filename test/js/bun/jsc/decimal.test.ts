// Decimal of https://tc39.es/proposal-decimal/, which is off by default. Its value is in an internal slot and it has no
// own properties, so code that walks the properties of an object takes every Decimal for {}.
// The tests that build executables are in test/bundler/compile-aot-decimal.test.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

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

  // The tests of the engine run on ICU4C, not on src/icu. No Number or string takes exponents like these there.
  test.concurrent("Intl", async () => {
    const max = "9.999999999999999999999999999999999e6144";
    const third = "0." + Buffer.alloc(34, "3");
    const cases: [string, unknown][] = [
      [`d("1234567.891").toLocaleString("de-DE")`, "1.234.567,891"],
      [`["NaN", "Infinity", "-Infinity", "-0"].map(x => format(x))`, ["NaN", "∞", "-∞", "-0"]],
      [`format("${third}", { maximumFractionDigits: 40 })`, third],
      [`format("${third}", { style: "percent", maximumFractionDigits: 2 })`, "33.33%"],
      [`format("${third}", { ...cents, roundingIncrement: 25 })`, "0.25"],
      [`format("9007199254740993.995", { style: "currency", currency: "USD" })`, "$9,007,199,254,740,994.00"],
      [`format("9007199254740993.5", { style: "unit", unit: "meter" })`, "9,007,199,254,740,993.5 m"],
      [`format("${max}", { useGrouping: false })`, "" + Buffer.alloc(34, "9") + Buffer.alloc(6111, "0")],
      [`format("${max}", { notation: "scientific" })`, "1E6145"],
      [`format("-1e6144", { notation: "engineering" })`, "-1E6144"],
      [`format("1e400", { notation: "compact", useGrouping: false })`, "1" + Buffer.alloc(388, "0") + "T"],
      [`format("1e-6176", { notation: "scientific" })`, "1E-6176"],
      [`format("1e-6176", { maximumSignificantDigits: 1 })`, "0." + Buffer.alloc(6175, "0") + "1"],
      [`["ceil", "floor"].map(roundingMode => format("1e-6176", { ...cents, roundingMode }))`, ["0.01", "0.00"]],
      [`["ceil", "floor"].map(roundingMode => format("-1e-6176", { ...cents, roundingMode }))`, ["-0.00", "-0.01"]],
      [`scientific.formatToParts(d("-1.5e-400")).map(part => part.value)`, ["-", "1", ".", "5", "E", "-", "400"]],
      [`scientific.formatRange(d("1e-400"), d("1e400")).split(/\\s*–\\s*/)`, ["1E-400", "1E400"]],
      [`scientific.formatRange(d("NaN"), d("1"))`, "throws RangeError"],
      [`["1", "1.5", "1e400"].map(x => new Intl.PluralRules("en").select(d(x)))`, ["one", "other", "other"]],
      [`new Intl.PluralRules("en").selectRange(d("1.0001"), d("1"))`, "one"],
      [`new Intl.PluralRules("sl").selectRange(d("101"), d("3"))`, "few"],
      [`new Intl.PluralRules("en").selectRange(d("1e400"), d("1e401"))`, "other"],
    ];
    const setup = `
      const format = (text, options) => new Intl.NumberFormat("en-US", options).format(d(text));
      const cents = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
      const scientific = new Intl.NumberFormat("en-US", { notation: "scientific" });
    `;
    const expressions = cases.map(([expression]) => expression);
    expect(await evaluate(setup, expressions)).toEqual(cases.map(([, expected]) => expected));
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

    test("tables", async () => {
      const { stdout, exitCode } = await run(`
        const d = text => new Decimal(text);
        class Money extends Decimal {
          currency = "EUR";
          rate = { to: 2 };
          note = [1];
          method() {}
          [Bun.inspect.custom]() { throw new Error("is not called"); }
        }
        const stream = new (require("node:stream").Writable)({
          write(chunk, _, done) { console.write(chunk); done(); },
        });
        const inspected = (...args) => console.write(Bun.inspect.table(...args));
        for (const table of [console.table, inspected, new console.Console(stream).table]) {
          table({ total: d("19.90"), count: 2 });
          table(new Set([d("3")]));
          table([{ price: d("4") }, new Money("5")]);
          table([new Money("6"), d("7")], ["currency"]);
        }
        console.write(JSON.stringify(Bun.inspect.table([d("8"), 9], { colors: true }).split("\\n").slice(3, 5)));
      `);
      expect(stdout.replace(/^[┌├└].*\n/gm, "")).toMatchInlineSnapshot(`
        "│       │ Values          │
        │ total │ [Decimal: 19.9] │
        │ count │ 2               │
        │   │ Values       │
        │ 0 │ [Decimal: 3] │
        │   │ price        │ currency │ rate      │ note  │ Values               │
        │ 0 │ [Decimal: 4] │          │           │       │                      │
        │ 1 │              │ EUR      │ { to: 2 } │ [ 1 ] │ [Decimal (Money): 5] │
        │   │ currency │
        │ 0 │ EUR      │
        │ 1 │          │
        │       │ Values          │
        │ total │ [Decimal: 19.9] │
        │ count │ 2               │
        │   │ Values       │
        │ 0 │ [Decimal: 3] │
        │   │ price        │ currency │ rate      │ note  │ Values               │
        │ 0 │ [Decimal: 4] │          │           │       │                      │
        │ 1 │              │ EUR      │ { to: 2 } │ [ 1 ] │ [Decimal (Money): 5] │
        │   │ currency │
        │ 0 │ EUR      │
        │ 1 │          │
        │ (index) │     Values      │
        │  total  │ [Decimal: 19.9] │
        │  count  │        2        │
        │ (iteration index) │    Values    │
        │         0         │ [Decimal: 3] │
        │ (index) │    price     │ currency │   rate    │ note  │        Values        │
        │    0    │ [Decimal: 4] │          │           │       │                      │
        │    1    │              │  'EUR'   │ { to: 2 } │ [ 1 ] │ [Decimal (Money): 5] │
        │ (index) │ currency │
        │    0    │  'EUR'   │
        │    1    │          │
        ["│ 0 │ \\u001b[0m\\u001b[33m[Decimal: 8]\\u001b[0m │","│ 1 │ \\u001b[0m\\u001b[33m9\\u001b[0m            │"]"
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
          `inspect({ a: Object.assign(d("1"), { a: 1 }) }, { depth: 0 })`,
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
          "{ a: [Decimal: 1] }",
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

test.concurrent("there is no literal", async () => {
  using dir = tempDir("decimal-literal", { "a.js": "f(1.5m);" });
  for (const command of ["run", "build", "fmt"]) {
    const { stderr, exitCode } = await spawn([bunExe(), command, "a.js"], String(dir));
    expect(stderr).toContain("error: ");
    expect(exitCode).not.toBe(0);
  }
  expect(await evaluate("", [`(0, eval)("1.5m")`])).toEqual(["throws SyntaxError"]);
});

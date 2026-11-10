// Decimal of https://tc39.es/proposal-decimal/, which is off by default. Its value is in an internal slot and it has no
// own properties, so code that walks the properties of an object takes every Decimal for {}.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

const env = { ...bunEnv, BUN_JSC_useDecimal: "1", NO_COLOR: "1" };

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

// The WebKit this was built with may not have Decimal, and then there is no such option. Nothing else is a reason to skip.
const probe = Bun.spawnSync({ cmd: [bunExe(), "-e", "0"], env, stderr: "pipe" });
const hasDecimal = !probe.stderr.toString().includes("invalid JSC environment variable");
if (hasDecimal && !probe.success) throw new Error("the probe for Decimal failed: " + probe.stderr);

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

describe.skipIf(!hasDecimal)("Decimal", () => {
  const values = ["NaN", "Infinity", "-Infinity", "0", "-0", "1", "-1.5", "1e-7", "1e34", "-1e6144", "1e-6176"];
  values.push("1.234567890123456789012345678901234");

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

  describe.concurrent("structured clone", () => {
    const clones = {
      "structuredClone": `const clone = async x => structuredClone(x);`,
      "bun:jsc": `const jsc = require("bun:jsc"); const clone = async x => jsc.deserialize(jsc.serialize(x));`,
      "node:v8": `const v8 = require("node:v8"); const clone = async x => v8.deserialize(v8.serialize(x));`,
      "MessageChannel": `const clone = x => new Promise(resolve => {
        const { port1, port2 } = new MessageChannel();
        port2.onmessage = event => { resolve(event.data); port1.close(); port2.close(); };
        port1.postMessage(x);
      });`,
    };
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
      const results = await evaluate(setup, expressions);
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
        env,
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
        await evaluate(`const { serialize, deserialize } = require("bun:jsc");`, [
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
        ]),
      ).toEqual([0, [true, "rejected"]]);
    });
  });

  describe.concurrent("formats", () => {
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

    test.each([undefined, "1"])("a Decimal is not an indent (useDecimalToJSON %p)", async option => {
      expect(
        await evaluate(
          `const x = { a: { b: 1 } };`,
          ["YAML", "JSON5", "XML"].map(
            name => `Bun.${name}.stringify(x, null, d("2")) === Bun.${name}.stringify(x, null, {})`,
          ),
          option ? { BUN_JSC_useDecimalToJSON: option } : undefined,
        ),
      ).toEqual([true, true, true]);
    });

    test("write the exact value with useDecimalToJSON", async () => {
      const text = "1.234567890123456789012345678901234";
      const results = await evaluate(`const x = d("${text}");`, formats, { BUN_JSC_useDecimalToJSON: "1" });
      for (const result of results) expect(result).toContain(text);
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

  test.concurrent("bytes with a Decimal do not bring one into a process without it", async () => {
    const { stdout } = await run(
      `console.write(Buffer.from(require("bun:jsc").serialize({ a: new Decimal("1.5") })).toString("hex"))`,
    );
    expect(stdout.length).toBeGreaterThan(20);
    const { BUN_JSC_useDecimal: _, ...envWithout } = env;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try { console.write(String(require("bun:jsc").deserialize(Buffer.from("${stdout}", "hex")))) } catch { console.write("rejected") }`,
      ],
      env: envWithout,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [off, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ off, stderr }).toEqual({ off: "rejected", stderr: "" });
    expect(exitCode).toBe(0);
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
  const { BUN_JSC_useDecimal: _, ...off } = env;
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

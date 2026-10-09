import { jscDescribe } from "bun:jsc";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, mock, test, vi } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import assert from "node:assert";
import { stringify } from "node:querystring";
import { DatabaseSync } from "node:sqlite";
import { format, inspect, isDeepStrictEqual } from "node:util";
import { createContext, runInContext, runInNewContext } from "node:vm";

const viteVariables = ["BASE_URL", "MODE", "DEV", "PROD", "SSR"] as const;
const env: Record<PropertyKey, any> = import.meta.env;

/** The environment of the spawned process without Vite's variables and NODE_ENV, whatever this process was started with. */
const cleanEnv = {
  ...bunEnv,
  NODE_ENV: undefined,
  ...Object.fromEntries(viteVariables.map(name => [name, undefined])),
};

async function run(cwd: string, args: string[], extraEnv: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...cleanEnv, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    // What the fixtures print, one JSON value per line. (--parallel prints what its workers print to stderr.)
    printed: (stdout + stderr)
      .split("\n")
      .filter(line => line.startsWith("@"))
      .map(line => JSON.parse(line.slice(1))),
    failures: stderr.split("\n").filter(line => /^(\(fail\)|error:)/.test(line)),
    exitCode,
  };
}

const printVariables = `console.log("@" + JSON.stringify([import.meta.env.BASE_URL, import.meta.env.MODE, import.meta.env.DEV, import.meta.env.PROD, import.meta.env.SSR]));`;

// A failed assertion prints what it received. These tests never hand the real environment to `expect()`:
// where the whole object is looked at, `process.env` is a small object, which `import.meta.env` follows.
describe("import.meta.env in a test file", () => {
  const realEnv = process.env;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Each of these tests is about the object that stands in for process.env.
    expect(env === realEnv).toBe(false);
    for (const name of viteVariables) {
      saved[name] = realEnv[name];
      delete realEnv[name];
    }
  });

  afterEach(() => {
    Object.defineProperty(process, "env", { value: realEnv, writable: true, enumerable: true, configurable: true });
    for (const name of viteVariables) {
      if (saved[name] === undefined) delete realEnv[name];
      else realEnv[name] = saved[name];
    }
    for (const name of Object.keys(realEnv)) {
      if (name.startsWith("IMPORT_META_ENV_TEST_")) delete realEnv[name];
    }
  });

  test("is one object, and not process.env", () => {
    expect(env === process.env).toBe(false);
    expect(env === import.meta.env).toBe(true);
    expect(Bun.env === process.env).toBe(true);
    Bun.gc(true);
    expect(env === import.meta.env).toBe(true);
  });

  test("has Vite's variables, and process.env does not", () => {
    const { BASE_URL, MODE, DEV, PROD, SSR } = import.meta.env;
    expect<unknown>({ BASE_URL, MODE, DEV, PROD, SSR }).toEqual({
      BASE_URL: "/",
      MODE: "test",
      DEV: true,
      PROD: false,
      SSR: true,
    });
    for (const name of viteVariables) {
      expect([name, name in env, Object.hasOwn(env, name), name in process.env]).toEqual([name, true, true, false]);
    }
  });

  test("lists them after the names of process.env, once", () => {
    const names = Object.keys(process.env);
    expect(Bun.deepEquals(Object.keys(env), [...names, ...viteVariables])).toBe(true);
    process.env.MODE = "staging";
    expect(Bun.deepEquals(Object.keys(env), [...names, "MODE", "BASE_URL", "DEV", "PROD", "SSR"])).toBe(true);
  });

  test("reads and writes process.env", () => {
    process.env.IMPORT_META_ENV_TEST_A = "from process.env";
    expect(env.IMPORT_META_ENV_TEST_A).toBe("from process.env");
    expect(Object.keys(env)).toContain("IMPORT_META_ENV_TEST_A");

    env.IMPORT_META_ENV_TEST_B = 5;
    expect(process.env.IMPORT_META_ENV_TEST_B).toBe("5");
    expect(env.IMPORT_META_ENV_TEST_B).toBe("5");

    expect(delete env.IMPORT_META_ENV_TEST_B).toBe(true);
    expect("IMPORT_META_ENV_TEST_B" in process.env).toBe(false);
    expect(env.IMPORT_META_ENV_TEST_B).toBeUndefined();
    expect("IMPORT_META_ENV_TEST_B" in env).toBe(false);
  });

  test("a write has the effect it has on process.env", () => {
    const date = new Date("2020-01-01T00:00:00.000Z");
    const before = process.env.TZ;
    try {
      env.TZ = "Asia/Tokyo";
      expect(date.getHours()).toBe(9);
      expect([env.TZ, process.env.TZ]).toEqual(["Asia/Tokyo", "Asia/Tokyo"]);
    } finally {
      if (before === undefined) delete env.TZ;
      else env.TZ = before;
    }
    expect(process.env.TZ).toBe(before);
  });

  describe.each(["DEV", "PROD", "SSR"] as const)("%s", name => {
    test.each([
      [true, "1", true],
      [false, "", false],
      ["0", "1", true],
      ["false", "1", true],
      ["", "", false],
      [0, "", false],
      [1, "1", true],
      [null, "", false],
      [undefined, "", false],
      [{}, "1", true],
    ])("assigned %p is %p in process.env and reads %p", (value, stored, read) => {
      env[name] = value;
      expect([process.env[name], env[name]]).toEqual([stored, read]);
      expect(Object.getOwnPropertyDescriptor(env, name)).toEqual({
        value: read,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    });

    test.each([
      ["1", true],
      ["yes", true],
      ["false", true],
      ["0", true],
      ["", false],
    ])("process.env's %p reads %p", (stored, read) => {
      process.env[name] = stored;
      expect(env[name]).toBe(read);
    });

    test("has its default again once it is deleted", () => {
      const initial = env[name];
      env[name] = !initial;
      expect(env[name]).toBe(!initial);
      expect(delete env[name]).toBe(true);
      expect([name in process.env, env[name]]).toEqual([false, initial]);
    });
  });

  test.each([
    ["MODE", "test"],
    ["BASE_URL", "/"],
  ])("%s is a string, process.env's if it has one", (name, initial) => {
    env[name] = true;
    expect([process.env[name], env[name]]).toEqual(["true", "true"]);
    process.env[name] = "";
    expect(env[name]).toBe("");
    delete process.env[name];
    expect(env[name]).toBe(initial);
  });

  test("DEV and PROD do not follow a NODE_ENV or MODE that a test assigns", () => {
    const before = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      env.MODE = "production";
      expect([env.DEV, env.PROD]).toEqual([true, false]);
    } finally {
      process.env.NODE_ENV = before;
    }
  });

  test("SSR is false while there is a document", () => {
    expect(env.SSR).toBe(true);
    globalThis.document = {} as Document;
    try {
      expect(env.SSR).toBe(false);
      env.SSR = true;
      expect(env.SSR).toBe(true);
      delete env.SSR;
      expect(env.SSR).toBe(false);
    } finally {
      delete (globalThis as { document?: Document }).document;
    }
    expect(env.SSR).toBe(true);
  });

  describe("as a whole", () => {
    const whole = { GREETING: "hello", DEV: false, BASE_URL: "/", MODE: "test", PROD: false, SSR: true };

    beforeEach(() => {
      process.env = { GREETING: "hello", DEV: "" };
    });

    test("spread, Object.assign, entries, for-in", () => {
      expect({ ...env }).toEqual(whole);
      expect(Object.assign({}, env)).toEqual(whole);
      expect(Object.entries(env)).toEqual(Object.entries(whole));
      expect(Object.values(env)).toEqual(Object.values(whole));
      const names: string[] = [];
      for (const name in env) names.push(name);
      expect(names).toEqual(Object.keys(whole));
    });

    test("Reflect.ownKeys, getOwnPropertyNames, getOwnPropertyDescriptors", () => {
      expect(Reflect.ownKeys(env)).toEqual(Object.keys(whole));
      expect(Object.getOwnPropertyNames(env)).toEqual(Object.keys(whole));
      expect(Object.getOwnPropertySymbols(env)).toEqual([]);
      expect(Object.getOwnPropertyDescriptors(env)).toEqual(Object.getOwnPropertyDescriptors(whole));
    });

    test("JSON.stringify", () => {
      expect(JSON.stringify(env)).toBe(JSON.stringify(whole));
      expect(JSON.stringify({ env })).toBe(JSON.stringify({ env: whole }));
    });

    test("matchers", () => {
      expect(env).toEqual(whole);
      expect<unknown>(whole).toEqual(env);
      expect(env).toMatchObject({ MODE: "test", DEV: false });
      expect(env).toHaveProperty("GREETING", "hello");
      expect(env).not.toEqual({ ...whole, DEV: true });
      expect(env).not.toEqual({ GREETING: "hello", DEV: false });
      expect(Bun.deepEquals(env, whole)).toBe(true);
    });

    test("Bun.inspect and console.log", () => {
      // As `ProcessEnv { ... }` for process.env.
      expect(Bun.inspect(env)).toBe("ImportMetaEnv " + Bun.inspect(whole));
      expect(Bun.inspect([env], { compact: true })).toBe(
        Bun.inspect([whole], { compact: true }).replace("{", "ImportMetaEnv {"),
      );
      expect(require("node:util").inspect(env)).toBe(require("node:util").inspect(whole));
      expect(Bun.inspect(env, { sorted: true })).toBe("ImportMetaEnv " + Bun.inspect(whole, { sorted: true }));
    });

    test("a snapshot has the variables of process.env", () => {
      expect(env).toMatchInlineSnapshot(`
        ImportMetaEnv {
          "BASE_URL": "/",
          "DEV": false,
          "GREETING": "hello",
          "MODE": "test",
          "PROD": false,
          "SSR": true,
        }
      `);
      expect({ nested: env }).toMatchInlineSnapshot(`
        {
          "nested": ImportMetaEnv {
            "BASE_URL": "/",
            "DEV": false,
            "GREETING": "hello",
            "MODE": "test",
            "PROD": false,
            "SSR": true,
          },
        }
      `);
    });

    function messageOf(fails: () => void) {
      try {
        fails();
      } catch (error) {
        return Bun.stripANSI((error as Error).message);
      }
      return "it passes";
    }

    test("a snapshot does not match once a variable has changed", () => {
      process.env.GREETING = "goodbye";
      expect(
        messageOf(() =>
          expect(env).toMatchInlineSnapshot(`
            ImportMetaEnv {
              "BASE_URL": "/",
              "DEV": false,
              "GREETING": "hello",
              "MODE": "test",
              "PROD": false,
              "SSR": true,
            }
          `),
        ),
      ).toContain('"GREETING": "goodbye"');
    });

    test("a snapshot of Vite's variables alone does not match once there is another", () => {
      process.env = { ADDED: "1" };
      expect(
        messageOf(() =>
          expect(env).toMatchInlineSnapshot(`
            ImportMetaEnv {
              "BASE_URL": "/",
              "DEV": true,
              "MODE": "test",
              "PROD": false,
              "SSR": true,
            }
          `),
        ),
      ).toContain('"ADDED": "1"');
    });

    test("the message of a failed matcher has the variables of process.env", () => {
      expect(messageOf(() => expect(env).toEqual({}))).toContain('"GREETING": "hello"');
      expect(messageOf(() => expect<unknown>({ nested: env }).toStrictEqual({}))).toContain('"GREETING": "hello"');
    });

    // Native code that reads an object past its hooks sees an empty one here. Each of these is given `import.meta.env`
    // and then an ordinary object with the same properties.
    describe("is to every API what an ordinary object with the same properties is", () => {
      const defaults = { DEV: false, BASE_URL: "/", MODE: "test", PROD: false, SSR: true };
      const unnamed = (printed: string) => printed.replaceAll("ImportMetaEnv ", "");
      const outcome = (matcher: () => void) => unnamed(messageOf(matcher));
      const names = (object: object) => {
        const names: string[] = [];
        for (const name in object) names.push(name);
        return names;
      };
      const apis: Record<string, (object: any) => unknown> = {
        "Object.keys": object => Object.keys(object),
        "Object.values": object => Object.values(object),
        "Object.entries": object => Object.entries(object),
        "Object.getOwnPropertyNames": object => Object.getOwnPropertyNames(object),
        "Object.getOwnPropertyDescriptors": object => Object.getOwnPropertyDescriptors(object),
        "Reflect.ownKeys": object => Reflect.ownKeys(object),
        "for-in": names,
        "for-in of an object that inherits from it": object => names(Object.create(object)),
        "in, Object.hasOwn, propertyIsEnumerable": object =>
          ["GREETING", "MODE", "MISSING"].map(name => [
            name in object,
            Object.hasOwn(object, name),
            Object.prototype.propertyIsEnumerable.call(object, name),
          ]),
        "spread": object => ({ ...object }),
        "rest": ({ MODE, ...rest }) => [MODE, rest],
        "Object.assign": object => Object.assign({}, object),
        "with": object => new Function("object", "with (object) return [GREETING, MODE, typeof MISSING];")(object),
        "a Proxy of it": object => [Object.keys(new Proxy(object, {})), JSON.stringify(new Proxy(object, {}))],
        "JSON.stringify": object => JSON.stringify(object),
        "JSON.stringify, nested and indented": object => JSON.stringify({ object, list: [object] }, null, 2),
        "JSON.stringify with a list of names": object => JSON.stringify(object, ["GREETING", "SSR"]),
        "JSON.stringify with a replacer": object =>
          JSON.stringify(object, (key, value) => (key === "MODE" ? 1 : value)),
        "Response.json": object => Response.json(object).text(),
        "Bun.YAML.stringify": object => Bun.YAML.stringify(object),
        "Bun.inspect": object => unnamed(Bun.inspect(object)),
        "Bun.inspect, sorted": object => unnamed(Bun.inspect(object, { sorted: true })),
        "Bun.inspect, sorted and nested": object => unnamed(Bun.inspect({ object, list: [object] }, { sorted: true })),
        "Bun.inspect, compact": object => unnamed(Bun.inspect([object], { compact: true })),
        "Bun.inspect.table": object => [Bun.inspect.table(object), Bun.inspect.table([object])],
        "util.inspect": object => [
          inspect(object),
          inspect(object, { showHidden: true, sorted: true, compact: false }),
        ],
        "util.format": object => format("%o %O %j", object, object, object),
        "Bun.deepEquals": object => [
          Bun.deepEquals(object, whole),
          Bun.deepEquals(whole, object),
          Bun.deepEquals(object, { ...whole, MORE: 1 }),
          Bun.deepEquals(object, defaults),
          Bun.deepEquals(defaults, object),
        ],
        "Bun.deepMatch": object => [
          Bun.deepMatch({ GREETING: "hello" }, object),
          Bun.deepMatch({ GREETING: "other" }, object),
          Bun.deepMatch(object, whole),
          Bun.deepMatch(object, defaults),
        ],
        "util.isDeepStrictEqual": object => [
          isDeepStrictEqual(object, whole),
          isDeepStrictEqual(whole, object),
          isDeepStrictEqual(object, defaults),
        ],
        "assert.deepEqual": object => [
          outcome(() => assert.deepEqual(object, whole)),
          outcome(() => assert.deepEqual(whole, object)),
          outcome(() => assert.deepEqual(object, defaults)),
          outcome(() => assert.partialDeepStrictEqual(object, { GREETING: "hello" })),
          outcome(() => assert.partialDeepStrictEqual(object, { GREETING: "other" })),
        ],
        "toEqual": object => [
          outcome(() => expect(object).toEqual(whole)),
          outcome(() => expect(whole).toEqual(object)),
          outcome(() => expect([object]).toContainEqual(whole)),
          outcome(() => expect(object).not.toEqual(defaults)),
          outcome(() => expect(defaults).not.toEqual(object)),
        ],
        "toMatchObject": object => [
          outcome(() => expect(object).toMatchObject({ GREETING: "hello", MODE: "test" })),
          outcome(() => expect(object).not.toMatchObject({ GREETING: "other" })),
          outcome(() => expect(whole).toMatchObject(object)),
          outcome(() => expect(defaults).not.toMatchObject(object)),
        ],
        "expect.objectContaining": object => [
          outcome(() => expect(object).toEqual(expect.objectContaining({ GREETING: "hello" }))),
          outcome(() => expect(object).not.toEqual(expect.objectContaining({ GREETING: "other" }))),
          outcome(() => expect(whole).toEqual(expect.objectContaining(object))),
          outcome(() => expect(defaults).not.toEqual(expect.objectContaining(object))),
        ],
        "toHaveProperty": object => [
          outcome(() => expect(object).toHaveProperty("GREETING", "hello")),
          outcome(() => expect({ object }).toHaveProperty("object.MODE", "test")),
          outcome(() => expect(object).not.toHaveProperty("MISSING")),
        ],
        "toContainKeys, toContainValues": object => [
          outcome(() => expect(object).toContainKey("GREETING")),
          outcome(() => expect(object).toContainAllKeys(Object.keys(whole))),
          outcome(() => expect(object).not.toContainKey("MISSING")),
          outcome(() => expect(object).toContainValue("hello")),
          outcome(() => expect(object).toContainAllValues(Object.values(whole))),
          outcome(() => expect(object).not.toBeEmptyObject()),
        ],
        "toHaveBeenCalledWith": object => {
          const fn = mock();
          fn(object);
          return [
            outcome(() => expect(fn).toHaveBeenCalledWith(whole)),
            outcome(() => expect(fn).not.toHaveBeenCalledWith(defaults)),
          ];
        },
        "what a failed toEqual prints": object => outcome(() => expect<unknown>({ object }).toEqual({})),
        "what a failed toStrictEqual prints": object => outcome(() => expect<unknown>({ object }).toStrictEqual({})),
        "what a failed toMatchObject prints": object => outcome(() => expect({ object }).toMatchObject({ object: 1 })),
        "what a failed toMatchInlineSnapshot prints": object =>
          outcome(() => expect({ object }).toMatchInlineSnapshot(`other`)),
        "new Headers": object => [...new Headers(object)],
        "the headers of a Request": object => [...new Request("http://localhost/", { headers: object }).headers],
        "new URLSearchParams": object => new URLSearchParams(object).toString(),
        "querystring.stringify": object => stringify(object),
        "new Bun.CookieMap": object => [...new Bun.CookieMap(object)],
        "the parameters of a bun:sqlite statement": object => {
          using database = new Database(":memory:", { strict: true });
          return database.query("select $GREETING as greeting, $MODE as mode").get(object);
        },
        "the parameters of a node:sqlite statement": object => {
          using database = new DatabaseSync(":memory:");
          const statement = database.prepare("select $GREETING as greeting, $MODE as mode");
          statement.setAllowUnknownNamedParameters(true);
          return { ...statement.get(object) };
        },
        "the sandbox of vm.runInNewContext": object =>
          runInNewContext("[GREETING, MODE, typeof MISSING, Object.keys(globalThis)]", object),
        "the define of a Bun.Transpiler": object =>
          outcome(() => void new Bun.Transpiler({ define: object }).transformSync("GREETING")),
      };

      test.each(Object.keys(apis))("%s", async name => {
        expect(await apis[name](env)).toEqual(await apis[name]({ ...whole }));
      });
    });

    test("structuredClone refuses it", () => {
      expect(() => structuredClone(env)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
    });

    test("a property that is not enumerable, writable or configurable is reported as such", () => {
      Object.defineProperty(process.env, "HIDDEN", { value: "secret" });
      expect(Object.getOwnPropertyDescriptor(env, "HIDDEN")).toEqual({
        value: "secret",
        writable: false,
        enumerable: false,
        configurable: false,
      });
      expect(Object.keys(env)).toEqual(Object.keys(whole));
      expect(Reflect.ownKeys(env)).toEqual(["GREETING", "DEV", "HIDDEN", "BASE_URL", "MODE", "PROD", "SSR"]);
      expect(() => {
        env.HIDDEN = "other";
      }).toThrow(TypeError);
      expect(() => delete env.HIDDEN).toThrow(TypeError);
      expect(env.HIDDEN).toBe("secret");
    });

    test("a variable of Vite's that process.env has and does not enumerate is not enumerated", () => {
      Object.defineProperty(process.env, "MODE", { value: "hidden", configurable: true });
      const { MODE, ...enumerable } = whole;
      const names: string[] = [];
      for (const name in env) names.push(name);
      expect({
        keys: Object.keys(env),
        forIn: names,
        entries: Object.entries(env),
        spread: { ...env },
        json: JSON.parse(JSON.stringify(env)),
      }).toEqual({
        keys: Object.keys(enumerable),
        forIn: Object.keys(enumerable),
        entries: Object.entries(enumerable),
        spread: enumerable,
        json: enumerable,
      });
      expect(Reflect.ownKeys(env)).toContain("MODE");
      expect(env.MODE).toBe("hidden");
    });

    test("an accessor runs on process.env, and only its result is seen", () => {
      const receivers: unknown[] = [];
      Object.defineProperty(process.env, "COMPUTED", {
        get() {
          receivers.push(this);
          return "computed";
        },
        set(value) {
          receivers.push(this, value);
        },
        enumerable: true,
        configurable: true,
      });
      expect(env.COMPUTED).toBe("computed");
      expect(Object.getOwnPropertyDescriptor(env, "COMPUTED")).toEqual({
        value: "computed",
        writable: true,
        enumerable: true,
        configurable: true,
      });
      env.COMPUTED = "assigned";
      expect(receivers.map(receiver => (receiver === process.env ? "process.env" : receiver))).toEqual([
        "process.env",
        "process.env",
        "process.env",
        "assigned",
      ]);
    });

    test("a function is not a variable", () => {
      process.env.toJSON = (() => ({ replaced: true })) as any;
      process.env.MODE = (() => {}) as any;
      expect([env.toJSON, "toJSON" in env, env.MODE]).toEqual([undefined, false, "test"]);
      expect(JSON.parse(JSON.stringify(env))).toEqual(whole);
    });

    test("symbols", () => {
      const symbol = Symbol("key");
      expect([env[Symbol.iterator], env[Symbol.toStringTag], env[symbol], symbol in env]).toEqual([
        undefined,
        undefined,
        undefined,
        false,
      ]);
      expect(Object.prototype.toString.call(env)).toBe("[object Object]");
      env[symbol] = "value";
      expect([(process.env as any)[symbol], env[symbol], symbol in env]).toEqual(["value", "value", true]);
      expect(Object.getOwnPropertySymbols(env)).toEqual([symbol]);
      expect(Object.getOwnPropertyNames(env)).toEqual(Object.keys(whole));
      expect(Reflect.ownKeys(env)).toHaveLength(Object.keys(whole).length + 1);
      expect(delete env[symbol]).toBe(true);
      expect(symbol in process.env).toBe(false);
    });

    test("indices", () => {
      env[7] = "seven";
      expect([process.env[7], env[7], env["7"], 7 in env, Object.hasOwn(env, 7)]).toEqual([
        "seven",
        "seven",
        "seven",
        true,
        true,
      ]);
      expect(Object.keys(env)).toEqual(["7", ...Object.keys(whole)]);
      expect(delete env[7]).toBe(true);
      expect([7 in process.env, env[7], 7 in env]).toEqual([false, undefined, false]);
      expect(env[4294967295]).toBeUndefined();
    });
  });

  test("a symbol is refused as process.env refuses it", () => {
    expect(() => {
      env[Symbol("key")] = "value";
    }).toThrow(TypeError);
    expect(env[Symbol("key")]).toBeUndefined();
  });

  test("an index is a variable of process.env", () => {
    try {
      env[70707] = 1;
      expect([process.env[70707], env[70707]]).toEqual(["1", "1"]);
    } finally {
      delete env[70707];
    }
    expect(70707 in process.env).toBe(false);
  });

  test("inherits from Object.prototype", () => {
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(env.__proto__).toBe(Object.prototype);
    expect(env.hasOwnProperty("MODE")).toBe(true);
    expect(env.propertyIsEnumerable("MODE")).toBe(true);
    expect(env.hasOwnProperty("hasOwnProperty")).toBe(false);
    expect(env instanceof Object).toBe(true);
    expect(String(env)).toBe("[object Object]");
  });

  test("Object.defineProperty is process.env's", () => {
    Object.defineProperty(env, "IMPORT_META_ENV_TEST_A", {
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(process.env.IMPORT_META_ENV_TEST_A).toBe("1");
    expect(() => Object.defineProperty(env, "IMPORT_META_ENV_TEST_B", { get: () => "x", configurable: true })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_OBJECT_DEFINE_PROPERTY" }),
    );
    expect(() => Object.defineProperty(env, "IMPORT_META_ENV_TEST_B", { value: "x" })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_OBJECT_DEFINE_PROPERTY" }),
    );
    expect("IMPORT_META_ENV_TEST_B" in process.env).toBe(false);
  });

  test("cannot be frozen, sealed or made non-extensible", () => {
    expect(() => Object.freeze(env)).toThrow(TypeError);
    expect(() => Object.seal(env)).toThrow(TypeError);
    expect(() => Object.preventExtensions(env)).toThrow(TypeError);
    expect(Reflect.preventExtensions(env)).toBe(false);
    expect([Object.isExtensible(env), Object.isFrozen(env), Object.isSealed(env)]).toEqual([true, false, false]);
    expect(Object.isExtensible(process.env)).toBe(true);
    env.IMPORT_META_ENV_TEST_A = "still writable";
    expect(process.env.IMPORT_META_ENV_TEST_A).toBe("still writable");
  });

  test("a function that has read it many times sees what changes", () => {
    const read = () => [import.meta.env.DEV, import.meta.env.MODE, "IMPORT_META_ENV_TEST_A" in import.meta.env];
    for (let i = 0; i < 10_000; i++) read();
    expect<unknown>(read()).toEqual([true, "test", false]);
    Object.assign(process.env, { DEV: "", MODE: "changed", IMPORT_META_ENV_TEST_A: "" });
    expect<unknown>(read()).toEqual([false, "changed", true]);
    for (const name of ["DEV", "MODE", "IMPORT_META_ENV_TEST_A"]) delete process.env[name];
    expect<unknown>(read()).toEqual([true, "test", false]);
  });

  test("its prototype can be changed, but not into a cycle", () => {
    try {
      Object.setPrototypeOf(env, null);
      expect([env.MODE, env.hasOwnProperty, Object.getPrototypeOf(env)]).toEqual(["test", undefined, null]);
      Object.setPrototypeOf(env, { inherited: "yes", MODE: "inherited" });
      expect([env.MODE, env.inherited, "inherited" in env, Object.hasOwn(env, "inherited")]).toEqual([
        "test",
        "yes",
        true,
        false,
      ]);
      expect(() => Object.setPrototypeOf(env, env)).toThrow(TypeError);
      expect(() => Object.setPrototypeOf(env, Object.create(env))).toThrow(TypeError);
    } finally {
      Object.setPrototypeOf(env, Object.prototype);
    }
  });

  // There process.env is a Proxy, whose `set` trap does not look at the prototype chain.
  test.skipIf(isWindows)("as the prototype of process.env, a new variable is a RangeError", () => {
    Object.setPrototypeOf(realEnv, env);
    try {
      expect<unknown>([realEnv.MODE, realEnv.DEV, realEnv.IMPORT_META_ENV_TEST_A]).toEqual(["test", true, undefined]);
      expect(() => {
        realEnv.IMPORT_META_ENV_TEST_A = "value";
      }).toThrow(RangeError);
      expect(() => {
        env.IMPORT_META_ENV_TEST_A = "value";
      }).toThrow(RangeError);
    } finally {
      Object.setPrototypeOf(realEnv, Object.prototype);
    }
    env.IMPORT_META_ENV_TEST_A = "value";
    expect(realEnv.IMPORT_META_ENV_TEST_A).toBe("value");
  });

  test("a write to an object that inherits from it is that object's", () => {
    const child = Object.create(env);
    expect([child.MODE, child.DEV]).toEqual(["test", true]);
    child.DEV = false;
    child.IMPORT_META_ENV_TEST_A = 1;
    child[3] = "three";
    expect(Object.getOwnPropertyDescriptors(child)).toEqual(
      Object.getOwnPropertyDescriptors({ 3: "three", DEV: false, IMPORT_META_ENV_TEST_A: 1 }),
    );
    expect(["DEV" in process.env, "IMPORT_META_ENV_TEST_A" in process.env, 3 in process.env]).toEqual([
      false,
      false,
      false,
    ]);

    const receiver: Record<string, unknown> = {};
    expect(Reflect.set(env, "PROD", true, receiver)).toBe(true);
    expect([receiver.PROD, "PROD" in process.env]).toEqual([true, false]);
    expect(Reflect.get(env, "PROD", receiver)).toBe(false);

    child.__proto__ = null;
    expect(Object.getPrototypeOf(child)).toBe(null);
  });

  // Native code that writes to an object past its hooks leaves here what no script can see or delete.
  describe("every write is a write to process.env", () => {
    /** The names of the properties in the storage of the cell. */
    const stored = () => /\{(.*?)\}/.exec(jscDescribe(env))![1];
    const writes: Record<string, (object: any) => unknown> = {
      "an assignment": object => void (object.ADDED = "x"),
      "delete": object => delete object.GREETING,
      "delete of a variable of Vite's": object => delete object.MODE,
      "Object.defineProperty": object =>
        void Object.defineProperty(object, "ADDED", {
          value: "x",
          writable: true,
          enumerable: true,
          configurable: true,
        }),
      "Object.defineProperty of an accessor": object =>
        void Object.defineProperty(object, "ADDED", { get: () => "computed", enumerable: true, configurable: true }),
      "__defineGetter__": object => void object.__defineGetter__("ADDED", () => "computed"),
      "Object.assign": object => void Object.assign(object, { ADDED: "x", MODE: "assigned" }),
      "Reflect.set": object => Reflect.set(object, "ADDED", "x"),
      "a class field": object => {
        class Returns {
          constructor(object: object) {
            return object;
          }
        }
        class Defines extends Returns {
          ADDED = "x";
        }
        new Defines(object);
      },
      "Array.prototype.push": object => Array.prototype.push.call(object, "x"),
      "vi.stubEnv": object => {
        vi.stubEnv("GREETING", "stubbed");
        const stubbed = object.GREETING;
        vi.unstubAllEnvs();
        return stubbed;
      },
      "an assignment in a node:vm context of it": object => runInContext("ADDED = 'x'", createContext(object)),
    };

    test.each(Object.keys(writes))("%s", name => {
      const after = (object: () => object) => {
        process.env = { GREETING: "hello" };
        const result = writes[name](object());
        return { result, env: { ...env }, "process.env": { ...process.env } };
      };
      expect(after(() => env)).toEqual(after(() => process.env));
      expect(stored()).toBe("");
    });

    test("Error.captureStackTrace, which does not write to process.env, is refused", () => {
      expect(() => Error.captureStackTrace(env)).toThrow("invalid_argument");
      expect(stored()).toBe("");
    });
  });

  describe("when process.env is", () => {
    test("import.meta.env itself, the original is used", () => {
      realEnv.IMPORT_META_ENV_TEST_A = "original";
      process.env = env;
      expect([env.IMPORT_META_ENV_TEST_A, env.MODE, "IMPORT_META_ENV_TEST_A" in env]).toEqual([
        "original",
        "test",
        true,
      ]);
      env.IMPORT_META_ENV_TEST_B = "written";
      expect(realEnv.IMPORT_META_ENV_TEST_B).toBe("written");
      expect(Object.keys(env)).toContain("IMPORT_META_ENV_TEST_B");
      expect(delete env.IMPORT_META_ENV_TEST_B).toBe(true);
      expect("IMPORT_META_ENV_TEST_B" in realEnv).toBe(false);
    });

    test.each([
      ["a number", 5],
      ["undefined", undefined],
      ["null", null],
    ])("%s, the original is used", (_, value) => {
      realEnv.IMPORT_META_ENV_TEST_A = "original";
      process.env = value as any;
      expect([env.IMPORT_META_ENV_TEST_A, env.MODE]).toEqual(["original", "test"]);
    });

    test("an object that inherits from import.meta.env", () => {
      process.env = Object.create(env, { OWN: { value: "own", writable: true, enumerable: true, configurable: true } });
      expect({ ...env }).toEqual({ OWN: "own", BASE_URL: "/", MODE: "test", DEV: true, PROD: false, SSR: true });
      expect(process.env.MODE).toBe("test");
      expect(env.MISSING).toBeUndefined();
      env.WRITTEN = "written";
      env.DEV = false;
      expect(Object.keys(process.env)).toEqual(["OWN", "WRITTEN", "DEV"]);
      expect([env.WRITTEN, env.DEV, process.env.DEV]).toEqual(["written", false, ""]);
    });

    test.each([
      ["an array", () => ["zero"], ["zero", undefined, 1], ["0"], ["0", "length"]],
      ["a typed array", () => new Uint8Array([7]), [7, undefined, undefined], ["0"], ["0"]],
      ["a String", () => new String("s"), ["s", undefined, 1], ["0"], ["0", "length"]],
      ["a function", () => function (_: unknown) {}, [undefined, undefined, 1], [], ["length", "name", "prototype"]],
    ])("%s", (_, make, read, enumerable, all) => {
      process.env = make() as any;
      expect([env[0], env[1], env.length]).toEqual(read);
      expect([env.MODE, env.DEV]).toEqual(["test", true]);
      expect(Object.keys(env)).toEqual([...enumerable, ...viteVariables]);
      expect(Reflect.ownKeys(env)).toEqual([...all, ...viteVariables]);
    });

    // What it is on Windows, where TZ is such a getter.
    test("a Proxy whose target has a getter that only answers the target", () => {
      const target = {
        get ONLY_THE_TARGET() {
          return this === target ? "value" : undefined;
        },
      };
      process.env = new Proxy(target, { get: (_, key) => target[key] }) as any;
      expect([process.env.ONLY_THE_TARGET, env.ONLY_THE_TARGET]).toEqual(["value", "value"]);
    });

    test("a Proxy of import.meta.env, every operation is a RangeError", () => {
      process.env = new Proxy(env, {});
      expect(() => env.MODE).toThrow(RangeError);
      expect(() => "MODE" in env).toThrow(RangeError);
      expect(() => Object.keys(env)).toThrow(RangeError);
      expect(() => {
        env.MODE = "x";
      }).toThrow(RangeError);
      expect(() => delete env.MODE).toThrow(RangeError);
      expect(() =>
        Object.defineProperty(env, "MODE", { value: "x", writable: true, enumerable: true, configurable: true }),
      ).toThrow(RangeError);
      expect(() => env[0]).toThrow(RangeError);
      expect(() => {
        env[0] = "x";
      }).toThrow(RangeError);
      expect(() => delete env[0]).toThrow(RangeError);
    });

    test("a Proxy, its traps are called", () => {
      const calls: string[] = [];
      const log =
        (name: keyof typeof Reflect) =>
        (...args: any[]) => {
          calls.push(`${name} ${String(args[1] ?? "")}`.trim());
          return (Reflect[name] as any)(...args);
        };
      process.env = new Proxy(
        { A: "a" },
        {
          get: log("get"),
          set: log("set"),
          has: log("has"),
          deleteProperty: log("deleteProperty"),
          defineProperty: log("defineProperty"),
          getOwnPropertyDescriptor: log("getOwnPropertyDescriptor"),
          ownKeys: log("ownKeys"),
        },
      );
      expect(env.A).toBe("a");
      expect("A" in env).toBe(true);
      expect(env.DEV).toBe(true);
      env.B = "b";
      delete env.B;
      expect(Reflect.ownKeys(env)).toEqual(["A", ...viteVariables]);
      expect(calls).toEqual([
        "getOwnPropertyDescriptor A",
        "getOwnPropertyDescriptor A",
        "getOwnPropertyDescriptor DEV",
        "set B",
        "getOwnPropertyDescriptor B",
        "defineProperty B",
        "deleteProperty B",
        "ownKeys",
      ]);
    });

    test("a getter that throws, every operation throws its error", () => {
      const error = new Error("no environment");
      Object.defineProperty(process, "env", {
        get() {
          throw error;
        },
        configurable: true,
      });
      const thrownBy = (operation: () => unknown) => {
        try {
          operation();
        } catch (thrown) {
          return thrown;
        }
      };
      for (const operation of [
        () => env.MODE,
        () => env.OTHER,
        () => env[0],
        () => "MODE" in env,
        () => Object.keys(env),
        () => ({ ...env }),
        () => JSON.stringify(env),
        () => (env.MODE = "x"),
        () => (env[0] = "x"),
        () => delete env.MODE,
        () => delete env[0],
        () => Object.getOwnPropertyDescriptor(env, "MODE"),
        () => Object.defineProperty(env, "A", { value: "x", writable: true, enumerable: true, configurable: true }),
      ]) {
        expect(thrownBy(operation)).toBe(error);
      }
    });

    test("an object whose property throws, reading it throws that error", () => {
      const error = new Error("unreadable");
      process.env = {
        get DEV(): string {
          throw error;
        },
      };
      expect(() => env.DEV).toThrow(error);
      expect(() => ({ ...env })).toThrow(error);
      expect(env.PROD).toBe(false);
    });
  });

  test("a document that cannot be looked for", () => {
    const error = new Error("no document");
    const prototype = Object.getPrototypeOf(globalThis);
    Object.setPrototypeOf(
      globalThis,
      new Proxy(prototype, {
        has(target, name) {
          if (name === "document") throw error;
          return Reflect.has(target, name);
        },
      }),
    );
    try {
      expect(() => env.SSR).toThrow(error);
      expect(env.DEV).toBe(true);
    } finally {
      Object.setPrototypeOf(globalThis, prototype);
    }
    expect(env.SSR).toBe(true);
  });
});

describe.concurrent("import.meta.env", () => {
  test("is process.env outside bun test", async () => {
    using dir = tempDir("import-meta-env", {
      "script.ts": `console.log("@" + JSON.stringify([import.meta.env === process.env, import.meta.env === Bun.env, typeof import.meta.env.MODE, typeof import.meta.env.DEV]));`,
      "in.test.ts": `console.log("@" + JSON.stringify([import.meta.env === process.env, process.env === Bun.env, typeof import.meta.env.MODE, typeof import.meta.env.DEV]));`,
    });
    expect(await run(String(dir), ["script.ts"])).toEqual({
      printed: [[true, true, "undefined", "undefined"]],
      failures: [],
      exitCode: 0,
    });
    expect((await run(String(dir), ["test", "./in.test.ts"])).printed).toEqual([[false, true, "string", "boolean"]]);
  });

  test.each([
    [{}, ["/", "test", true, false, true]],
    [{ NODE_ENV: "test" }, ["/", "test", true, false, true]],
    [{ NODE_ENV: "development" }, ["/", "test", true, false, true]],
    [{ NODE_ENV: "production" }, ["/", "test", false, true, true]],
    [{ NODE_ENV: "Production" }, ["/", "test", true, false, true]],
    [{ MODE: "production" }, ["/", "production", true, false, true]],
    [{ MODE: "staging", BASE_URL: "/app/" }, ["/app/", "staging", true, false, true]],
    [{ DEV: "", PROD: "1", SSR: "" }, ["/", "test", false, true, false]],
    [{ NODE_ENV: "production", DEV: "1", PROD: "" }, ["/", "test", true, false, true]],
  ])("started with %j", async (variables, expected) => {
    using dir = tempDir("import-meta-env", {
      "variables.test.ts": `import { test } from "bun:test"; test("prints", () => { ${printVariables} });`,
    });
    expect(await run(String(dir), ["test"], variables)).toEqual({ printed: [expected], failures: [], exitCode: 0 });
  });

  test("the variables of a .env file count", async () => {
    using dir = tempDir("import-meta-env", {
      ".env": "MODE=from-dotenv\nPROD=1\n",
      ".env.test": "BASE_URL=/from-dotenv-test/\nSSR=\n",
      "variables.test.ts": `import { test } from "bun:test"; test("prints", () => { ${printVariables} });`,
    });
    expect(await run(String(dir), ["test"])).toEqual({
      printed: [["/from-dotenv-test/", "from-dotenv", true, true, false]],
      failures: [],
      exitCode: 0,
    });
  });

  test.each([
    ["--define", {}, ["--define", `import.meta.env.MODE="defined"`, "--define", "import.meta.env.DEV=0"]],
    [
      "bunfig's define",
      { "bunfig.toml": `[define]\n"import.meta.env.MODE" = "'defined'"\n"import.meta.env.DEV" = "0"\n` },
      [],
    ],
  ])("%s comes first", async (_, files, args) => {
    using dir = tempDir("import-meta-env", {
      ...files,
      "variables.test.ts": `
        import { test } from "bun:test";
        test("prints", () => {
          ${printVariables}
          const { MODE, DEV } = import.meta.env;
          console.log("@" + JSON.stringify([MODE, DEV]));
        });
      `,
    });
    expect(await run(String(dir), ["test", ...args])).toEqual({
      printed: [
        ["/", "defined", 0, false, true],
        ["test", true],
      ],
      failures: [],
      exitCode: 0,
    });
  });

  test("is the same object in every module of a test file, in preloads and in dependencies", async () => {
    using dir = tempDir("import-meta-env", {
      "preload.ts": `globalThis.fromPreload = import.meta.env;`,
      "helper.ts": `export default import.meta.env;`,
      "node_modules/dependency/package.json": JSON.stringify({ name: "dependency", type: "module", main: "index.js" }),
      "node_modules/dependency/index.js": `export default import.meta.env; export const mode = import.meta.env.MODE;`,
      "modules.test.ts": `
        import fromDependency, { mode } from "dependency";
        import fromHelper from "./helper.ts";
        const fromImport = (await import("./helper.ts?again")).default;
        console.log("@" + JSON.stringify([fromPreload, fromHelper, fromDependency, fromImport].map(env => env === import.meta.env).concat(mode)));
      `,
    });
    expect((await run(String(dir), ["test", "--preload", "./preload.ts"])).printed).toEqual([
      [true, true, true, true, "test"],
    ]);
  });

  test.each([[["--isolate"]], [["--parallel=2"]], [[]]])(
    "bun test %j: what a file leaves is not the next file's",
    async args => {
      const file = `
      import { test, vi } from "bun:test";
      test("prints", () => {
        console.log("@" + JSON.stringify([import.meta.env === process.env, import.meta.env.MODE, import.meta.env.DEV]));
        vi.stubEnv("MODE", "stubbed");
        vi.stubEnv("DEV", false);
      });
    `;
      using dir = tempDir("import-meta-env", { "a.test.ts": file, "b.test.ts": file });
      expect(await run(String(dir), ["test", ...args])).toEqual({
        printed: [
          [false, "test", true],
          [false, "test", true],
        ],
        failures: [],
        exitCode: 0,
      });
    },
  );

  test("--isolate: every global has one, made when it is first read, that goes with the global", async () => {
    const count = `
      import { heapStats } from "bun:jsc";
      Bun.gc(true);
      const { ImportMetaEnv, GlobalObject } = heapStats().objectTypeCounts;
    `;
    const reads = `import.meta.env.MODE; ${count} console.log("@" + JSON.stringify(ImportMetaEnv === GlobalObject));`;
    using dir = tempDir("import-meta-env", {
      "reads/a.test.ts": reads,
      "reads/b.test.ts": reads,
      "reads/c.test.ts": reads,
      "reads/d.test.ts": reads,
      "never-reads/a.test.ts": `import.meta.url; ${count} console.log("@" + JSON.stringify(ImportMetaEnv ?? "none"));`,
    });
    expect((await run(String(dir), ["test", "--isolate", "./reads"])).printed).toEqual([true, true, true, true]);
    expect((await run(String(dir), ["test", "--isolate", "./never-reads"])).printed).toEqual(["none"]);
  });

  test("in other realms", async () => {
    using dir = tempDir("import-meta-env", {
      "helper.ts": `
        export default import.meta.env;
        export const mode = import.meta.env.MODE;
        export const read = name => import.meta.env[name];
        export const isProcessEnv = () => import.meta.env === process.env;
      `,
      "realms.test.ts": `
        import vm from "node:vm";
        import env from "./helper.ts";
        const helper = import.meta.dir + "/helper.ts";

        const context = vm.createContext({ env, results: [] });
        const module = new vm.SourceTextModule("results.push(typeof import.meta.env)", { context });
        await module.link(() => {});
        await module.evaluate();
        console.log("@" + JSON.stringify(context.results));

        const imported = await vm.runInContext("import(" + JSON.stringify(helper) + ")", context, {
          importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
        });
        console.log("@" + JSON.stringify([imported.default === env, imported.mode]));

        console.log("@" + JSON.stringify(vm.runInContext(
          '[env.MODE, env.DEV, "SSR" in env, Object.keys(env).slice(-5), (env.WRITTEN = 5, env.WRITTEN), delete env.WRITTEN, "WRITTEN" in env]',
          context,
        )));

        const realm = new ShadowRealm();
        const [mode, read, isProcessEnv] = await Promise.all(["mode", "read", "isProcessEnv"].map(name => realm.importValue(helper, name)));
        env.MODE = "the main realm's";
        console.log("@" + JSON.stringify([mode, read("MODE"), read("DEV"), isProcessEnv()]));
      `,
    });
    expect(await run(String(dir), ["test"])).toEqual({
      printed: [
        ["undefined"],
        [true, "test"],
        ["test", true, true, [...viteVariables], "5", true, false],
        ["test", "test", true, false],
      ],
      failures: [],
      exitCode: 0,
    });
  });

  test("given to a child process as its environment, it has Vite's variables", async () => {
    using dir = tempDir("import-meta-env", {
      "child.ts": `console.log("@" + JSON.stringify(["BASE_URL", "MODE", "DEV", "PROD", "SSR"].map(name => process.env[name])));`,
      "parent.test.ts": `
        for (const env of [process.env, import.meta.env, { ...import.meta.env }]) {
          const { stdout } = Bun.spawnSync({ cmd: [process.execPath, "child.ts"], env, cwd: import.meta.dir });
          console.log(stdout.toString().trim());
        }
      `,
    });
    expect((await run(String(dir), ["test"])).printed).toEqual([
      [null, null, null, null, null],
      ["/", "test", "true", "false", "true"],
      ["/", "test", "true", "false", "true"],
    ]);
  });

  test("in a Worker", async () => {
    using dir = tempDir("import-meta-env", {
      "worker.ts": `
        postMessage([import.meta.env === process.env, import.meta.env.BASE_URL, import.meta.env.MODE, import.meta.env.DEV, import.meta.env.PROD, import.meta.env.SSR, import.meta.env.FROM_PARENT, Object.keys(import.meta.env)]);
      `,
      "worker.test.ts": `
        import { test } from "bun:test";
        test("prints", async () => {
          globalThis.document = {};
          for (const options of [{}, { env: { FROM_PARENT: "parent", PROD: "1" } }]) {
            const worker = new Worker(new URL("./worker.ts", import.meta.url).href, options);
            const { promise, resolve, reject } = Promise.withResolvers();
            worker.onmessage = event => resolve(event.data);
            worker.onerror = event => reject(new Error(event.message));
            const [same, ...rest] = await promise;
            const names = rest.pop();
            console.log("@" + JSON.stringify([same, ...rest, options.env ? names : names.slice(-5)]));
            worker.terminate();
          }
        });
      `,
    });
    expect(await run(String(dir), ["test"])).toEqual({
      printed: [
        [false, "/", "test", true, false, true, null, [...viteVariables]],
        [false, "/", "test", true, true, true, "parent", ["FROM_PARENT", "PROD", "BASE_URL", "MODE", "DEV", "SSR"]],
      ],
      failures: [],
      exitCode: 0,
    });
  });

  // Windows' process.env has a toJSON and a Bun.inspect.custom of its own.
  test("the real environment is shown with Vite's variables", async () => {
    using dir = tempDir("import-meta-env", {
      "shown.test.ts": `
        const json = JSON.parse(JSON.stringify(import.meta.env));
        const inspected = Bun.inspect(import.meta.env);
        console.log("@" + JSON.stringify([json.MODE, json.DEV, json.SHOWN, /\\bMODE: "test"/.test(inspected), /\\bDEV: true/.test(inspected), /\\bSHOWN: "yes"/.test(inspected)]));
      `,
    });
    expect((await run(String(dir), ["test"], { SHOWN: "yes" })).printed).toEqual([
      ["test", true, "yes", true, true, true],
    ]);
  });

  test("SSR is false in a DOM environment", async () => {
    using dir = tempDir("import-meta-env", {
      "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.js" }),
      "node_modules/happy-dom/index.js": `
        exports.Window = class Window {
          document = { defaultView: this };
          happyDOM = { async abort() {} };
          close() {}
        };
      `,
      "a-dom.test.ts": `console.log("@" + JSON.stringify([typeof document, import.meta.env.SSR]));`,
      "b-node.test.ts": `// @${"vitest"}-environment node\nconsole.log("@" + JSON.stringify([typeof document, import.meta.env.SSR]));`,
    });
    expect((await run(String(dir), ["test", "--environment=happy-dom"])).printed).toEqual([
      ["object", false],
      ["undefined", true],
    ]);
  });
});

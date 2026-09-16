// `ctx.storage` of Bun.DurableObject: kv, sql, transactions, persistence.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Ctx = Bun.DurableObjectState;
type Env = { made: number; [key: string]: any };

// Arguments are passed to the object by reference, so every test hands the object a closure
// to run with its `ctx`. An assertion that fails inside the closure rejects the call with it.
class Store extends Bun.DurableObject<Env> {
  constructor(ctx: Ctx, env: Env) {
    super(ctx, env);
    env.made++;
  }
  run(fn: (ctx: Ctx, env: Env) => unknown) {
    return fn(this.ctx, this.env);
  }
  alarm() {}
}

type Namespace = Bun.DurableObjectNamespace<Store>;
type Stub = Bun.DurableObjectStub<Store>;

function open(options: Partial<Bun.DurableObjectNamespaceOptions<Store>> = {}) {
  const env: Env = { made: 0 };
  const ns: Namespace = new Bun.DurableObjectNamespace({ class: Store, env, ...options });
  return { ns, env, stub: ns.getByName("object") };
}

function run<T>(stub: Stub, fn: (ctx: Ctx, env: Env) => T | Promise<T>): Promise<T> {
  return stub.run(fn) as Promise<T>;
}

/** Waits until the object behind `stub` was evicted: the next call constructs a new instance. */
async function evict(stub: Stub, env: Env, idleTimeout: number) {
  const before = env.made;
  const deadline = Date.now() + 20_000;
  while (env.made === before) {
    if (Date.now() > deadline) throw new Error("The object was not evicted");
    await Bun.sleep(idleTimeout * 2);
    await run(stub, () => {});
  }
}

function caught(fn: () => unknown): any {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the function to throw");
}

const reset = { code: "ERR_DURABLE_OBJECT_RESET" };

function userSchema(ctx: Ctx) {
  return ctx.storage.sql
    .exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name")
    .toArray()
    .map(row => `${row.type}:${row.name}`);
}

describe("kv", () => {
  test("get, put, delete and list, synchronously", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { kv } }) => {
      expect(kv.get("missing")).toBeUndefined();
      expect(kv.put("a", 1)).toBeUndefined();
      expect(kv.get("a")).toBe(1);
      kv.put("a", 2);
      expect(kv.get("a")).toBe(2);
      expect(kv.delete("a")).toBe(true);
      expect(kv.delete("a")).toBe(false);
      expect(kv.get("a")).toBeUndefined();

      kv.put("b", "B");
      kv.put("c", "C");
      kv.put("a", "A");
      const entries = kv.list();
      expect(typeof entries.next).toBe("function");
      expect(entries[Symbol.iterator]()).toBe(entries);
      expect(entries.next()).toEqual({ done: false, value: ["a", "A"] });
      expect([...entries]).toEqual([
        ["b", "B"],
        ["c", "C"],
      ]);
      expect(entries.next()).toEqual({ done: true, value: undefined });
      // What list() returned is what was there when it was called.
      const snapshot = kv.list();
      kv.delete("b");
      kv.put("d", "D");
      expect([...snapshot].map(([key]) => key)).toEqual(["a", "b", "c"]);
      expect([...kv.list()].map(([key]) => key)).toEqual(["a", "c", "d"]);
    });
    // Another event sees what the first one wrote.
    expect(await run(stub, ctx => ctx.storage.kv.get("d"))).toBe("D");
  });

  test("get, put, delete and list, with promises", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      const pending = storage.put("one", 1);
      expect(pending).toBeInstanceOf(Promise);
      expect(await pending).toBeUndefined();
      expect(storage.get("one")).toBeInstanceOf(Promise);
      expect(await storage.get("one")).toBe(1);
      expect(await storage.get("missing")).toBeUndefined();

      // An object of entries; the kv view reads the same store.
      expect(await storage.put({ c: 3, a: 1, b: 2 })).toBeUndefined();
      expect(storage.kv.get("b")).toBe(2);

      const some = await storage.get(["c", "missing", "a", "one"]);
      expect(some).toBeInstanceOf(Map);
      expect([...some]).toEqual([
        ["a", 1],
        ["c", 3],
        ["one", 1],
      ]);
      expect(await storage.get([])).toEqual(new Map());

      const all = await storage.list();
      expect(all).toBeInstanceOf(Map);
      expect([...all]).toEqual([
        ["a", 1],
        ["b", 2],
        ["c", 3],
        ["one", 1],
      ]);
      expect([...(await storage.list({ prefix: "o" }))]).toEqual([["one", 1]]);

      expect(await storage.delete("one")).toBe(true);
      expect(await storage.delete("one")).toBe(false);
      expect(await storage.delete(["a", "b", "missing"])).toBe(2);
      expect(await storage.delete([])).toBe(0);
      expect([...(await storage.list())]).toEqual([["c", 3]]);
      expect(await storage.sync()).toBeUndefined();
    });
  });

  test("put() with entries skips undefined values and stores the rest", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      await storage.put({ kept: 1, skipped: undefined, last: null });
      expect([...(await storage.list())]).toEqual([
        ["kept", 1],
        ["last", null],
      ]);
    });
  });

  test("the promise forms reject instead of throwing", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      const invalidType = { code: "ERR_INVALID_ARG_TYPE" };
      const attempts = [
        () => storage.get(1 as any),
        () => storage.get(undefined as any),
        () => storage.get(["a", 2] as any),
        () => storage.put(1 as any, 1),
        () => storage.put(null as any),
        () => storage.delete({} as any),
        () => storage.delete([Symbol()] as any),
        () => storage.list("prefix" as any),
        () => storage.list({ prefix: 1 } as any),
      ];
      for (const attempt of attempts) {
        const result = attempt();
        expect(result).toBeInstanceOf(Promise);
        await expect(result).rejects.toMatchObject(invalidType);
      }
      await expect(storage.put("key", undefined)).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      await expect(storage.put("key", () => {})).rejects.toThrow();
      await expect(storage.put({ fine: 1, bad: () => {} })).rejects.toThrow();
      // put() of entries is all or nothing.
      expect([...(await storage.list())]).toEqual([]);
    });
  });

  test("stores every kind of value structuredClone() accepts", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    const buffer = new Uint8Array([1, 2, 3, 250]).buffer;
    const values: Record<string, unknown> = {
      zero: 0,
      negativeZero: -0,
      integer: 42,
      float: 1.5,
      large: 2 ** 53,
      nan: NaN,
      infinity: -Infinity,
      empty: "",
      ascii: "hello",
      latin1: "café",
      utf16: "привет 你好",
      emoji: "\u{1F600}\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
      nul: "a\0b",
      null: null,
      false: false,
      true: true,
      bigint: 2n ** 70n + 1n,
      negativeBigint: -5n,
      date: new Date(1700000000123),
      array: [1, "two", [3, [4]], null, undefined],
      sparse: [, 1, , 2],
      object: { a: { b: { c: [1, { d: "deep" }] } }, "key with spaces": 1, "\u{1F511}": "emoji key" },
      map: new Map<unknown, unknown>([
        ["k", 1],
        [2, { nested: new Set([1, 2]) }],
      ]),
      set: new Set(["a", 1, null]),
      uint8: new Uint8Array([0, 1, 255]),
      float64: new Float64Array([1.5, -2.5]),
      bigint64: new BigInt64Array([1n, -1n]),
      subarray: new Uint8Array([9, 8, 7, 6, 5]).subarray(1, 4),
      arrayBuffer: buffer,
      dataView: new DataView(buffer, 1, 2),
      regexp: /a+b/gi,
      error: new RangeError("stored error"),
      boxed: Object(1),
    };
    await run(stub, async ({ storage }) => {
      for (const [key, value] of Object.entries(values)) storage.kv.put(key, value);
      for (const [key, value] of Object.entries(values)) {
        expect(storage.kv.get(key)).toEqual(value);
      }
      expect(Object.is(storage.kv.get("negativeZero"), -0)).toBe(true);
      expect(storage.kv.get("bigint")).toBe(2n ** 70n + 1n);
      expect(storage.kv.get<Date>("date")!.getTime()).toBe(1700000000123);
      expect(storage.kv.get("map")).toBeInstanceOf(Map);
      expect(storage.kv.get<Map<unknown, any>>("map")!.get(2).nested).toBeInstanceOf(Set);
      expect(storage.kv.get("set")).toBeInstanceOf(Set);
      expect(storage.kv.get("uint8")).toBeInstanceOf(Uint8Array);
      expect(storage.kv.get("float64")).toBeInstanceOf(Float64Array);
      expect(storage.kv.get("bigint64")).toBeInstanceOf(BigInt64Array);
      const subarray = storage.kv.get<Uint8Array>("subarray")!;
      expect([...subarray]).toEqual([8, 7, 6]);
      expect(storage.kv.get("arrayBuffer")).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(storage.kv.get<ArrayBuffer>("arrayBuffer")!)).toEqual(new Uint8Array([1, 2, 3, 250]));
      const view = storage.kv.get<DataView>("dataView")!;
      expect(view).toBeInstanceOf(DataView);
      expect([view.byteLength, view.getUint8(0), view.getUint8(1)]).toEqual([2, 2, 3]);
      expect(storage.kv.get("regexp")).toEqual(/a+b/gi);
      const error = storage.kv.get<RangeError>("error")!;
      expect(error).toBeInstanceOf(RangeError);
      expect(error.message).toBe("stored error");
      expect(1 in storage.kv.get<unknown[]>("sparse")!).toBe(true);
      expect(0 in storage.kv.get<unknown[]>("sparse")!).toBe(false);

      // The same through the promise API and list().
      const listed = await storage.list();
      expect(listed.size).toBe(Object.keys(values).length);
      for (const [key, value] of Object.entries(values)) {
        expect(listed.get(key)).toEqual(value);
        expect(await storage.get(key)).toEqual(value);
      }
    });
    // And from a later event, after the commit.
    await run(stub, ({ storage }) => {
      for (const [key, value] of Object.entries(values)) expect(storage.kv.get(key)).toEqual(value);
    });
  });

  test("a cyclic value keeps its shape", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { kv } }) => {
      const cyclic: any = { name: "loop", list: [] };
      cyclic.self = cyclic;
      cyclic.list.push(cyclic);
      kv.put("cyclic", cyclic);
      const stored = kv.get<any>("cyclic");
      expect(stored).not.toBe(cyclic);
      expect(stored.self).toBe(stored);
      expect(stored.list[0]).toBe(stored);
      expect(stored.name).toBe("loop");
    });
  });

  test("undefined, functions and symbols cannot be stored", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { kv } }) => {
      kv.put("key", "before");
      expect(caught(() => kv.put("key", undefined))).toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      expect(caught(() => (kv.put as any)("key"))).toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      const values = [
        () => {},
        function named() {},
        class {},
        Symbol("s"),
        { nested: { fn() {} } },
        [Symbol.iterator],
        new WeakMap(),
      ];
      for (const value of values) {
        expect(() => kv.put("key", value)).toThrow();
        expect(() => kv.put("other", value)).toThrow();
      }
      expect(kv.get("key")).toBe("before");
      expect(kv.get("other")).toBeUndefined();
      expect([...kv.list()]).toEqual([["key", "before"]]);
    });
  });

  test("keys must be strings of at most 2048 bytes", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { kv } }) => {
      const invalidType = { code: "ERR_INVALID_ARG_TYPE" };
      for (const key of [
        1,
        0n,
        null,
        undefined,
        true,
        Symbol("k"),
        {},
        ["a"],
        { toString: () => "a" },
        new String("a"),
      ] as any[]) {
        expect(caught(() => kv.get(key))).toMatchObject(invalidType);
        expect(caught(() => kv.put(key, 1))).toMatchObject(invalidType);
        expect(caught(() => kv.delete(key))).toMatchObject(invalidType);
      }
      expect(caught(() => (kv.get as any)())).toMatchObject(invalidType);

      const tooLong = { code: "ERR_INVALID_ARG_VALUE" };
      const fits = ["a".repeat(2048), "é".repeat(1024), "你".repeat(682) + "ab", "\u{1F600}".repeat(512)];
      const over = ["a".repeat(2049), "é".repeat(1024) + "a", "你".repeat(683), "\u{1F600}".repeat(512) + "a"];
      for (const key of fits) {
        expect(Buffer.byteLength(key)).toBe(2048);
        kv.put(key, key.length);
        expect(kv.get(key)).toBe(key.length);
      }
      for (const key of over) {
        expect(Buffer.byteLength(key)).toBeGreaterThan(2048);
        expect(caught(() => kv.put(key, 1))).toMatchObject(tooLong);
        expect(caught(() => kv.get(key))).toMatchObject(tooLong);
        expect(caught(() => kv.delete(key))).toMatchObject(tooLong);
        expect(caught(() => kv.list({ start: key }))).toMatchObject(tooLong);
        expect(caught(() => kv.list({ prefix: key }))).toMatchObject(tooLong);
      }
      expect([...kv.list()].length).toBe(fits.length);
      for (const key of fits) expect(kv.delete(key)).toBe(true);
    });
    await run(stub, async ({ storage }) => {
      const over = "k".repeat(2049);
      await expect(storage.get(over)).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      await expect(storage.get(["a", over])).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      await expect(storage.put({ a: 1, [over]: 2 })).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      await expect(storage.delete(["a", over])).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      expect((await storage.list()).size).toBe(0);
    });
  });

  test("keys that are empty, not ASCII, or look like something else", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      const { kv } = storage;
      const keys = [
        "",
        " ",
        "ключ",
        "café",
        "\u{1F511}",
        "a\0b",
        "a\0c",
        "a",
        "%",
        "_",
        "'quoted'",
        '"',
        "__proto__",
        "constructor",
        "0",
        "-1",
      ];
      keys.forEach((key, index) => kv.put(key, index));
      keys.forEach((key, index) => expect(kv.get(key)).toBe(index));
      expect([...kv.list()].map(([key]) => key)).toEqual(
        keys.toSorted((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
      );
      expect([...kv.list()][0]).toEqual(["", 0]);
      expect([...kv.list({ prefix: "a" })].map(([key]) => key)).toEqual(["a", "a\0b", "a\0c"]);
      expect([...kv.list({ prefix: "a\0" })].map(([key]) => key)).toEqual(["a\0b", "a\0c"]);
      // LIKE wildcards in a prefix are only themselves.
      expect([...kv.list({ prefix: "%" })].map(([key]) => key)).toEqual(["%"]);
      expect([...kv.list({ prefix: "_" })].map(([key]) => key)).toEqual(["_", "__proto__"]);

      // Entries that are own properties named like Object.prototype's.
      const fetched = await storage.get(["__proto__", "constructor", "", "\u{1F511}"]);
      expect([...fetched]).toEqual([
        ["", 0],
        ["__proto__", 12],
        ["constructor", 13],
        ["\u{1F511}", 4],
      ]);
      expect(kv.delete("")).toBe(true);
      expect(kv.get("")).toBeUndefined();
      expect(await storage.delete(keys)).toBe(keys.length - 1);
    });
  });

  test("what is stored is a copy", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      const { kv } = storage;
      const value = { n: 1, inner: { list: [1, 2] }, bytes: new Uint8Array([1, 2, 3]) };
      kv.put("value", value);
      value.n = 2;
      value.inner.list.push(3);
      value.bytes[0] = 99;
      const first = kv.get<typeof value>("value")!;
      expect(first).toEqual({ n: 1, inner: { list: [1, 2] }, bytes: new Uint8Array([1, 2, 3]) });
      expect(first).not.toBe(value);
      // Every get() is a copy of its own.
      first.n = 3;
      first.inner.list.length = 0;
      first.bytes[1] = 98;
      const second = kv.get<typeof value>("value")!;
      expect(second).not.toBe(first);
      expect(second).toEqual({ n: 1, inner: { list: [1, 2] }, bytes: new Uint8Array([1, 2, 3]) });
      const listed = (await storage.list<typeof value>()).get("value")!;
      expect(listed).not.toBe(second);
      expect(listed.inner).not.toBe(second.inner);

      const entries = { shared: { count: 1 } };
      await storage.put(entries);
      entries.shared.count = 2;
      expect(await storage.get("shared")).toEqual({ count: 1 });
    });
  });
});

describe("list options", () => {
  const keys = ["a", "aa", "ab", "b", "ba", "c"];
  const fill = (ctx: Ctx) => keys.forEach((key, index) => ctx.storage.kv.put(key, index));
  const listed = (ctx: Ctx, options?: Bun.DurableObjectListOptions) =>
    [...ctx.storage.kv.list(options)].map(([key]) => key);

  test("start, startAfter, end, prefix, reverse and limit", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ctx => {
      fill(ctx);
      const cases: [Bun.DurableObjectListOptions | undefined | null, string[]][] = [
        [undefined, keys],
        [null, keys],
        [{}, keys],
        [{ start: "aa" }, ["aa", "ab", "b", "ba", "c"]],
        [{ start: "a0" }, ["aa", "ab", "b", "ba", "c"]],
        [{ start: "" }, keys],
        [{ start: "d" }, []],
        [{ startAfter: "aa" }, ["ab", "b", "ba", "c"]],
        [{ startAfter: "a0" }, ["aa", "ab", "b", "ba", "c"]],
        [{ startAfter: "" }, keys],
        [{ startAfter: "c" }, []],
        [{ end: "b" }, ["a", "aa", "ab"]],
        [{ end: "a" }, []],
        [{ end: "" }, []],
        [{ start: "aa", end: "ba" }, ["aa", "ab", "b"]],
        [{ startAfter: "aa", end: "ba" }, ["ab", "b"]],
        [{ start: "b", end: "a" }, []],
        [{ prefix: "a" }, ["a", "aa", "ab"]],
        [{ prefix: "aa" }, ["aa"]],
        [{ prefix: "b" }, ["b", "ba"]],
        [{ prefix: "c" }, ["c"]],
        [{ prefix: "" }, keys],
        [{ prefix: "x" }, []],
        [{ prefix: "a", start: "aa" }, ["aa", "ab"]],
        [{ prefix: "a", startAfter: "aa" }, ["ab"]],
        [{ prefix: "a", end: "ab" }, ["a", "aa"]],
        [{ prefix: "b", start: "a" }, ["b", "ba"]],
        [{ reverse: true }, keys.toReversed()],
        [{ reverse: false }, keys],
        [{ limit: 2 }, ["a", "aa"]],
        [{ limit: 1 }, ["a"]],
        [{ limit: 6 }, keys],
        [{ limit: 1000 }, keys],
        [{ reverse: true, limit: 2 }, ["c", "ba"]],
        [{ reverse: true, prefix: "a" }, ["ab", "aa", "a"]],
        [{ reverse: true, start: "aa", end: "c" }, ["ba", "b", "ab", "aa"]],
        [{ reverse: true, startAfter: "aa", limit: 3 }, ["c", "ba", "b"]],
        [{ prefix: "a", limit: 2, reverse: true }, ["ab", "aa"]],
        [{ start: undefined, end: undefined, prefix: undefined, limit: undefined, reverse: undefined }, keys],
      ];
      for (const [options, expected] of cases) {
        expect(listed(ctx, options as any)).toEqual(expected);
        const map = await ctx.storage.list(options as any);
        expect([...map.keys()]).toEqual(expected);
        for (const key of expected) expect(map.get(key)).toBe(keys.indexOf(key));
      }
    });
  });

  test("options that make no sense are rejected", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ctx => {
      fill(ctx);
      const { kv } = ctx.storage;
      expect(caught(() => kv.list({ start: "a", startAfter: "a" }))).toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      await expect(ctx.storage.list({ start: "a", startAfter: "b" })).rejects.toMatchObject({
        code: "ERR_INVALID_ARG_VALUE",
      });
      for (const limit of [0, -1, 1.5, NaN, Infinity, -Infinity, "3", 3n, null, true, {}, 2 ** 60] as any[]) {
        expect(caught(() => kv.list({ limit }))).toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
        await expect(ctx.storage.list({ limit })).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      }
      for (const name of ["start", "startAfter", "end", "prefix"]) {
        for (const value of [1, null, {}, ["a"], Symbol("s")] as any[]) {
          expect(caught(() => kv.list({ [name]: value }))).toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
        }
      }
      for (const options of [1, "a", true, Symbol("o")] as any[]) {
        expect(caught(() => kv.list(options))).toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
      }
      // Nothing above changed anything.
      expect(listed(ctx)).toEqual(keys);
    });
  });

  test("a prefix that ends in the highest code points", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ctx => {
      const { kv } = ctx.storage;
      const max = "\u{10FFFF}";
      const stored = [
        "k",
        "k" + max,
        "k" + max + "a",
        "k" + max + max,
        "k" + max + max + "z",
        "ka",
        "l",
        max,
        max + "a",
        max + max,
        "p\uD7FF",
        "p\uD7FF1",
        "p\uE000",
        "q\uFFFF",
        "q\uFFFFz",
        "q\u{10000}",
        "\u{1F600}",
        "\u{1F600}a",
        "\u{1F600}\u{1F600}",
        "\u{1F600}" + max,
        "\u{1F601}",
        "\u{1F5FF}",
        "é",
        "éé",
        "ê",
      ];
      for (const key of stored) kv.put(key, true);
      const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
      const expectPrefix = async (prefix: string) => {
        const expected = stored.filter(key => key.startsWith(prefix)).sort(byBytes);
        expect(expected.length).toBeGreaterThan(0);
        expect(listed(ctx, { prefix })).toEqual(expected);
        expect(listed(ctx, { prefix, reverse: true })).toEqual(expected.toReversed());
        expect([...(await ctx.storage.list({ prefix })).keys()]).toEqual(expected);
      };
      for (const prefix of [
        "k",
        "k" + max,
        "k" + max + max,
        max,
        max + max,
        "p\uD7FF",
        "q\uFFFF",
        "q",
        "\u{1F600}",
        "\u{1F600}\u{1F600}",
        "\u{1F600}" + max,
        "é",
        "éé",
        "\u{1F5FF}",
      ]) {
        await expectPrefix(prefix);
      }
      expect(listed(ctx)).toEqual(stored.toSorted(byBytes));
    });
  });

  test("keys are ordered by their UTF-8 bytes, not by UTF-16 code units", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ctx => {
      const { kv } = ctx.storage;
      const bmp = "\uFFFF";
      const astral = "\u{10000}";
      // UTF-16 puts the surrogate pair (D800 DC00) before U+FFFF; UTF-8 puts it after.
      expect([bmp, astral].sort()).toEqual([astral, bmp]);
      const stored = [astral, bmp, "z", "Z", "a", "é", "\uFF5E", "\u{1F600}", "\uE000", bmp + "a", astral + "a", "~"];
      for (const key of stored) kv.put(key, key);
      const expected = ["Z", "a", "z", "~", "é", "\uE000", "\uFF5E", bmp, bmp + "a", astral, astral + "a", "\u{1F600}"];
      expect(expected).toEqual(stored.toSorted((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
      expect(listed(ctx)).toEqual(expected);
      expect(listed(ctx, { reverse: true })).toEqual(expected.toReversed());
      expect([...(await ctx.storage.list()).keys()]).toEqual(expected);
      expect([...(await ctx.storage.get(stored)).keys()]).toEqual(expected);
      expect([...(await ctx.storage.get([astral, bmp])).keys()]).toEqual([bmp, astral]);

      expect(listed(ctx, { start: bmp })).toEqual([bmp, bmp + "a", astral, astral + "a", "\u{1F600}"]);
      expect(listed(ctx, { startAfter: bmp + "a" })).toEqual([astral, astral + "a", "\u{1F600}"]);
      expect(listed(ctx, { end: astral })).toEqual(expected.slice(0, expected.indexOf(astral)));
      expect(listed(ctx, { start: astral, end: bmp })).toEqual([]);
      expect(listed(ctx, { start: bmp, end: astral })).toEqual([bmp, bmp + "a"]);
    });
  });
});

describe("sql.exec", () => {
  test("DDL and DML", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      const created = sql.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL DEFAULT 0)");
      expect(created.toArray()).toEqual([]);
      expect(created.columnNames).toEqual([]);
      sql.exec("CREATE INDEX users_name ON users (name)");
      sql.exec("INSERT INTO users (name, score) VALUES ('ann', 1.5), ('bob', 2)");
      sql.exec("INSERT INTO users (id, name) VALUES (?, ?)", 10, "cy");
      expect(sql.exec("SELECT * FROM users ORDER BY id").toArray()).toEqual([
        { id: 1, name: "ann", score: 1.5 },
        { id: 2, name: "bob", score: 2 },
        { id: 10, name: "cy", score: 0 },
      ]);
      sql.exec("UPDATE users SET score = score + 1 WHERE name = ?", "bob");
      expect(sql.exec("SELECT score FROM users WHERE name = 'bob'").one()).toEqual({ score: 3 });
      sql.exec("DELETE FROM users WHERE id = 1");
      expect(sql.exec("SELECT count(*) AS n FROM users").one().n).toBe(2);
      expect(sql.exec("INSERT INTO users (name) VALUES ('dee') RETURNING id, name").toArray()).toEqual([
        { id: 11, name: "dee" },
      ]);
      sql.exec("ALTER TABLE users ADD COLUMN email TEXT");
      sql.exec("ALTER TABLE users RENAME TO people");
      expect(sql.exec("SELECT name, email FROM people WHERE id = 11").one()).toEqual({ name: "dee", email: null });
      sql.exec("DROP INDEX users_name");
      sql.exec("DROP TABLE people");
      expect(() => sql.exec("SELECT * FROM people")).toThrow("no such table");
    });
    // In a later event, after the commit.
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE later (a)");
      sql.exec("INSERT INTO later VALUES (1)");
    });
    expect(await run(stub, ({ storage: { sql } }) => sql.exec("SELECT a FROM later").toArray())).toEqual([{ a: 1 }]);
  });

  test("bindings of every type", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      const roundTrip = (value: any) => sql.exec("SELECT ?1 AS value, typeof(?1) AS type", value).one();
      expect(roundTrip(42)).toEqual({ value: 42, type: "integer" });
      expect(roundTrip(-7)).toEqual({ value: -7, type: "integer" });
      expect(roundTrip(0)).toEqual({ value: 0, type: "integer" });
      expect(roundTrip(1.5)).toEqual({ value: 1.5, type: "real" });
      expect(roundTrip(-0.25)).toEqual({ value: -0.25, type: "real" });
      expect(roundTrip(Infinity)).toEqual({ value: Infinity, type: "real" });
      expect(roundTrip("text")).toEqual({ value: "text", type: "text" });
      expect(roundTrip("")).toEqual({ value: "", type: "text" });
      expect(roundTrip("héllo \u{1F600} 你好")).toEqual({ value: "héllo \u{1F600} 你好", type: "text" });
      expect(roundTrip(123n)).toEqual({ value: 123, type: "integer" });
      expect(roundTrip(-(2n ** 63n))).toEqual({ value: -(2 ** 63), type: "integer" });
      expect(roundTrip(true)).toEqual({ value: 1, type: "integer" });
      expect(roundTrip(false)).toEqual({ value: 0, type: "integer" });
      expect(roundTrip(null)).toEqual({ value: null, type: "null" });
      expect(roundTrip(undefined)).toEqual({ value: null, type: "null" });
      expect(roundTrip(NaN)).toEqual({ value: null, type: "null" });

      const bytes = roundTrip(new Uint8Array([1, 2, 3, 0, 255]));
      expect(bytes.type).toBe("blob");
      expect(bytes.value).toBeInstanceOf(Uint8Array);
      expect(bytes.value).toEqual(new Uint8Array([1, 2, 3, 0, 255]));
      expect(roundTrip(new Uint8Array([1, 2, 3, 4]).buffer)).toEqual({
        value: new Uint8Array([1, 2, 3, 4]),
        type: "blob",
      });
      expect(roundTrip(new Uint8Array([9, 8, 7, 6, 5]).subarray(1, 3))).toEqual({
        value: new Uint8Array([8, 7]),
        type: "blob",
      });
      expect(roundTrip(new Uint16Array([0x0201, 0x0403]))).toEqual({
        value: new Uint8Array(new Uint16Array([0x0201, 0x0403]).buffer),
        type: "blob",
      });
      expect(roundTrip(new DataView(new Uint8Array([1, 2, 3]).buffer, 1))).toEqual({
        value: new Uint8Array([2, 3]),
        type: "blob",
      });
      expect(roundTrip(Buffer.from("buf"))).toEqual({ value: new Uint8Array([98, 117, 102]), type: "blob" });
      expect(roundTrip(new Uint8Array(0))).toEqual({ value: new Uint8Array(0), type: "blob" });

      // 64-bit integers are bound exactly.
      expect(sql.exec("SELECT CAST(? AS TEXT) AS text", 2n ** 62n + 1n).one().text).toBe("4611686018427387905");
      expect(sql.exec("SELECT CAST(? AS TEXT) AS text", 2n ** 63n - 1n).one().text).toBe("9223372036854775807");
      expect(caught(() => sql.exec("SELECT ?", 2n ** 63n))).toMatchObject({ code: "ERR_OUT_OF_RANGE" });
      expect(caught(() => sql.exec("SELECT ?", -(2n ** 63n) - 1n))).toMatchObject({ code: "ERR_OUT_OF_RANGE" });

      // A column's affinity decides what a whole number beyond 32 bits is stored as.
      sql.exec("CREATE TABLE numbers (i INTEGER, r REAL, t TEXT, b BLOB, n)");
      sql.exec("INSERT INTO numbers VALUES (?, ?, ?, ?, ?)", 2 ** 40, 3, 5, "blob", null);
      expect(
        sql
          .exec(
            "SELECT i, typeof(i) AS it, r, typeof(r) AS rt, t, typeof(t) AS tt, typeof(b) AS bt, typeof(n) AS nt FROM numbers",
          )
          .one(),
      ).toEqual({
        i: 2 ** 40,
        it: "integer",
        r: 3,
        rt: "real",
        t: "5",
        tt: "text",
        bt: "text",
        nt: "null",
      });

      // Numbered parameters count once.
      expect(sql.exec("SELECT ?2 AS second, ?1 AS first, ?1 AS again", "a", "b").one()).toEqual({
        second: "b",
        first: "a",
        again: "a",
      });
      // Many of them.
      const many = Array.from({ length: 200 }, (_, index) => index);
      expect(sql.exec(`SELECT ${many.map(() => "?").join(" + ")} AS sum`, ...many).one().sum).toBe(19900);
    });
  });

  test("the number of bindings must be the number of parameters", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a, b)");
      expect(() => sql.exec("INSERT INTO t VALUES (?, ?)", 1)).toThrow("Wrong number of parameter bindings");
      expect(() => sql.exec("INSERT INTO t VALUES (?, ?)")).toThrow("Wrong number of parameter bindings");
      expect(() => sql.exec("INSERT INTO t VALUES (?, ?)", 1, 2, 3)).toThrow("Wrong number of parameter bindings");
      expect(() => sql.exec("INSERT INTO t VALUES (1, 2)", 1)).toThrow("Wrong number of parameter bindings");
      expect(() => sql.exec("SELECT ?3", 1)).toThrow("Wrong number of parameter bindings");
      // The statement is as usable as before.
      sql.exec("INSERT INTO t VALUES (?, ?)", 1, 2);
      expect(sql.exec("SELECT * FROM t").toArray()).toEqual([{ a: 1, b: 2 }]);
    });
  });

  test("only the last statement of a script takes bindings", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a, b)");
      // Not run with NULL for every parameter.
      expect(() => sql.exec("INSERT INTO t VALUES (?, ?); SELECT * FROM t", 1, 2)).toThrow();
      expect(() => sql.exec("INSERT INTO t VALUES (?, ?); SELECT * FROM t")).toThrow();
      expect(sql.exec("SELECT count(*) AS n FROM t").one().n).toBe(0);
    });
  });

  test("values that cannot be bound", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a)");
      for (const value of [
        {},
        [1],
        Symbol("s"),
        () => {},
        new Date(0),
        new Map(),
        { valueOf: () => 1 },
        new String("s"),
      ] as any[]) {
        expect(caught(() => sql.exec("INSERT INTO t VALUES (?)", value))).toMatchObject({
          code: "ERR_INVALID_ARG_TYPE",
        });
        expect(caught(() => sql.exec("SELECT ?, ?", 1, value))).toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
      }
      for (const query of [undefined, null, 1, {}, ["SELECT 1"], Symbol("q")] as any[]) {
        expect(caught(() => sql.exec(query))).toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
      }
      expect(sql.exec("SELECT count(*) AS n FROM t").one().n).toBe(0);
      sql.exec("INSERT INTO t VALUES (?)", "fine");
      expect(sql.exec("SELECT a FROM t").one()).toEqual({ a: "fine" });
    });
  });

  test("the cursor", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a INTEGER, b TEXT)");
      sql.exec("INSERT INTO t VALUES (1, 'one'), (2, 'two'), (3, 'three')");
      const query = "SELECT a, b FROM t ORDER BY a";
      const rows = [
        { a: 1, b: "one" },
        { a: 2, b: "two" },
        { a: 3, b: "three" },
      ];

      // for..of and spread
      const seen: unknown[] = [];
      for (const row of sql.exec(query)) seen.push(row);
      expect(seen).toEqual(rows);
      expect([...sql.exec(query)]).toEqual(rows);
      expect(Array.from(sql.exec(query), row => row.a)).toEqual([1, 2, 3]);
      const cursor = sql.exec(query);
      expect(cursor[Symbol.iterator]()).toBe(cursor);
      expect(Object.prototype.toString.call(cursor)).toBe("[object SqlStorageCursor]");

      // next()
      expect(cursor.columnNames).toEqual(["a", "b"]);
      expect(cursor.next()).toEqual({ done: false, value: rows[0] });
      expect(cursor.next()).toEqual({ done: false, value: rows[1] });
      expect(cursor.next()).toEqual({ done: false, value: rows[2] });
      expect(cursor.next()).toEqual({ done: true, value: undefined });
      expect(cursor.next()).toEqual({ done: true, value: undefined });
      expect(cursor.toArray()).toEqual([]);
      expect(cursor.columnNames).toEqual(["a", "b"]);
      expect(cursor.rowsRead).toBe(3);

      // toArray(), then nothing is left
      const all = sql.exec(query);
      expect(all.toArray()).toEqual(rows);
      expect(all.toArray()).toEqual([]);
      expect(all.next().done).toBe(true);
      expect(() => all.one()).toThrow("no results");

      // Partly read, toArray() is the rest.
      const partly = sql.exec(query);
      expect(partly.next().value).toEqual(rows[0]);
      expect(partly.toArray()).toEqual(rows.slice(1));
      const broken = sql.exec(query);
      for (const row of broken) {
        expect(row).toEqual(rows[0]);
        break;
      }
      expect(broken.toArray()).toEqual(rows.slice(1));

      // one()
      expect(sql.exec("SELECT a, b FROM t WHERE a = ?", 2).one()).toEqual(rows[1]);
      expect(() => sql.exec("SELECT a FROM t WHERE a > 100").one()).toThrow(
        "Expected exactly one result from SQL query, but got no results.",
      );
      expect(() => sql.exec(query).one()).toThrow(
        "Expected exactly one result from SQL query, but got multiple results.",
      );
      expect(() => sql.exec("INSERT INTO t VALUES (4, 'four')").one()).toThrow("no results");
      expect(sql.exec("DELETE FROM t WHERE a = 4 RETURNING b").one()).toEqual({ b: "four" });
      const last = sql.exec(query);
      last.next();
      last.next();
      expect(last.one()).toEqual(rows[2]);

      // raw()
      expect(sql.exec(query).raw().toArray()).toEqual([
        [1, "one"],
        [2, "two"],
        [3, "three"],
      ]);
      expect([...sql.exec(query).raw()]).toEqual([
        [1, "one"],
        [2, "two"],
        [3, "three"],
      ]);
      const source = sql.exec(query);
      const raw = source.raw();
      expect(raw[Symbol.iterator]()).toBe(raw);
      expect(raw.next()).toEqual({ done: false, value: [1, "one"] });
      // They read the same statement.
      expect(source.next()).toEqual({ done: false, value: rows[1] });
      expect(raw.toArray()).toEqual([[3, "three"]]);
      expect(source.next().done).toBe(true);
      expect(raw.next()).toEqual({ done: true, value: undefined });
      expect(source.rowsRead).toBe(3);

      // Rows are plain objects of their own.
      const [first, second] = sql.exec(query).toArray();
      expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
      expect(Object.keys(first)).toEqual(["a", "b"]);
      (first as any).a = 100;
      (first as any).extra = true;
      expect(second).toEqual(rows[1]);
      expect(JSON.stringify(second)).toBe('{"a":2,"b":"two"}');
    });
  });

  test("rowsRead and rowsWritten", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      const created = sql.exec("CREATE TABLE t (a INTEGER, b TEXT)");
      expect(created.rowsRead).toBe(0);
      const inserted = sql.exec("INSERT INTO t VALUES (1, 'x'), (2, 'y'), (3, 'z')");
      expect(inserted.rowsWritten).toBe(3);
      expect(inserted.rowsRead).toBe(0);
      expect(sql.exec("INSERT INTO t VALUES (?, ?)", 4, "w").rowsWritten).toBe(1);

      const selected = sql.exec("SELECT * FROM t");
      expect(selected.rowsWritten).toBe(0);
      const before = selected.rowsRead;
      expect(before).toBeLessThanOrEqual(1);
      selected.next();
      selected.next();
      expect(selected.rowsRead).toBeGreaterThan(before);
      selected.toArray();
      expect(selected.rowsRead).toBe(4);
      expect(selected.rowsWritten).toBe(0);

      expect(sql.exec("UPDATE t SET b = 'q' WHERE a > 2").rowsWritten).toBe(2);
      expect(sql.exec("UPDATE t SET b = 'q' WHERE a > 100").rowsWritten).toBe(0);
      expect(sql.exec("DELETE FROM t WHERE a = 1").rowsWritten).toBe(1);
      expect(sql.exec("DELETE FROM t").rowsWritten).toBe(3);
      expect(sql.exec("DELETE FROM t").rowsWritten).toBe(0);
    });
  });

  test("rowsWritten of a statement that writes and returns rows", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a INTEGER, b TEXT)");
      const returning = sql.exec("INSERT INTO t VALUES (1, 'a'), (2, 'b') RETURNING a");
      expect(returning.toArray()).toEqual([{ a: 1 }, { a: 2 }]);
      expect(returning.rowsWritten).toBe(2);
      const updated = sql.exec("UPDATE t SET b = 'c' RETURNING a, b");
      expect(updated.toArray()).toEqual([
        { a: 1, b: "c" },
        { a: 2, b: "c" },
      ]);
      expect(updated.rowsWritten).toBe(2);
    });
  });

  test("column names and values", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      // INTEGER, REAL, TEXT, NULL, BLOB
      const row = sql
        .exec("SELECT 1 AS i, 1.5 AS r, 2.0 AS whole, 'x' AS t, NULL AS n, x'00ff10' AS b, x'' AS empty, '' AS blank")
        .one();
      expect(row).toEqual({
        i: 1,
        r: 1.5,
        whole: 2,
        t: "x",
        n: null,
        b: new Uint8Array([0, 255, 16]),
        empty: new Uint8Array(0),
        blank: "",
      });
      expect(row.b).toBeInstanceOf(Uint8Array);
      expect(row.empty).toBeInstanceOf(Uint8Array);

      // BLOB columns
      sql.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB)");
      const big = new Uint8Array(100_000).map((_, index) => index % 251);
      sql.exec("INSERT INTO blobs (data) VALUES (?), (?), (?)", big, new Uint8Array([1, 2, 3]).buffer, null);
      const blobs = sql.exec("SELECT data FROM blobs ORDER BY id").toArray();
      expect(blobs[0].data).toBeInstanceOf(Uint8Array);
      expect(Buffer.compare(blobs[0].data as Uint8Array, big)).toBe(0);
      expect(blobs[1].data).toEqual(new Uint8Array([1, 2, 3]));
      expect(blobs[2].data).toBeNull();
      // Each row's bytes are its own.
      (blobs[1].data as Uint8Array)[0] = 99;
      expect(sql.exec("SELECT data FROM blobs WHERE id = 2").one().data).toEqual(new Uint8Array([1, 2, 3]));

      // Large integers become the nearest number.
      const large = sql
        .exec(
          "SELECT 9007199254740991 AS safe, -9007199254740991 AS negative, 9223372036854775807 AS max, 4611686018427387904 AS power",
        )
        .one();
      expect(large).toEqual({
        safe: Number.MAX_SAFE_INTEGER,
        negative: -Number.MAX_SAFE_INTEGER,
        max: 2 ** 63,
        power: 2 ** 62,
      });
      expect(sql.exec("SELECT 1e300 AS r, -1e-300 AS tiny").one()).toEqual({ r: 1e300, tiny: -1e-300 });

      // Expressions without a name are named by their text.
      expect(sql.exec("SELECT 1 + 1, 'a' || 'b'").columnNames).toEqual(["1 + 1", "'a' || 'b'"]);
      expect(sql.exec('SELECT 1 AS "with space", 2 AS "é\u{1F600}", 3 AS __proto__, 4 AS constructor').one()).toEqual(
        Object.defineProperty({ "with space": 1, "é\u{1F600}": 2, constructor: 4 } as any, "__proto__", {
          value: 3,
          enumerable: true,
          writable: true,
          configurable: true,
        }),
      );

      // Two columns with one name: the later one is the property, raw() has both.
      const duplicated = sql.exec("SELECT 1 AS a, 2 AS b, 3 AS a");
      expect(duplicated.columnNames).toEqual(["a", "b", "a"]);
      expect(duplicated.toArray()).toEqual([{ a: 3, b: 2 }]);
      expect(sql.exec("SELECT 1 AS a, 2 AS b, 3 AS a").raw().toArray()).toEqual([[1, 2, 3]]);
      sql.exec(
        "CREATE TABLE left (id, v); CREATE TABLE right (id, w); INSERT INTO left VALUES (1, 'l'); INSERT INTO right VALUES (1, 'r')",
      );
      const joined = sql.exec("SELECT * FROM left JOIN right ON left.id = right.id");
      expect(joined.columnNames).toEqual(["id", "v", "id", "w"]);
      expect(joined.one()).toEqual({ id: 1, v: "l", w: "r" });

      // More columns than an object keeps inline.
      const wide = Array.from({ length: 100 }, (_, index) => `${index} AS c${index}`);
      const wideRow = sql.exec(`SELECT ${wide.join(", ")}`).one();
      expect(Object.keys(wideRow)).toEqual(Array.from({ length: 100 }, (_, index) => `c${index}`));
      expect(wideRow.c99).toBe(99);
    });
  });

  test("columns named like array indices", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      const cursor = sql.exec("SELECT 'zero' AS \"0\", 'one' AS \"1\", 'name' AS name");
      expect(cursor.columnNames).toEqual(["0", "1", "name"]);
      const row = cursor.one() as any;
      expect(Object.keys(row).sort()).toEqual(["0", "1", "name"]);
      expect(row[0]).toBe("zero");
      expect(row["1"]).toBe("one");
      expect(row.name).toBe("name");
      expect(row).toEqual({ 0: "zero", 1: "one", name: "name" });
      expect(JSON.stringify(row)).toBe('{"0":"zero","1":"one","name":"name"}');
      // The same when two columns share a name (another way of making the row).
      const other = sql.exec('SELECT 1 AS "7", 2 AS "7"').one() as any;
      expect(other[7]).toBe(2);
    });
  });

  test("several statements in one string", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      const cursor = sql.exec(`
        -- the schema
        CREATE TABLE IF NOT EXISTS m (a INTEGER, b TEXT);
        /* some rows; with a semicolon in a comment */
        INSERT INTO m VALUES (1, 'semi;colon'), (2, '-- not a comment');
        INSERT INTO m VALUES (3, '/* nor this */');
        SELECT a, b FROM m ORDER BY a;
      `);
      expect(cursor.columnNames).toEqual(["a", "b"]);
      expect(cursor.toArray()).toEqual([
        { a: 1, b: "semi;colon" },
        { a: 2, b: "-- not a comment" },
        { a: 3, b: "/* nor this */" },
      ]);
      // The bindings are the last statement's.
      expect(sql.exec("INSERT INTO m VALUES (4, 'four'); SELECT b FROM m WHERE a = ?", 4).one()).toEqual({ b: "four" });
      // The cursor is the last statement's, whatever that is.
      const insert = sql.exec("SELECT * FROM m; INSERT INTO m VALUES (5, 'five')");
      expect(insert.toArray()).toEqual([]);
      expect(insert.columnNames).toEqual([]);
      expect(sql.exec("SELECT count(*) AS n FROM m").one().n).toBe(5);

      // Comments, semicolons and white space around one statement.
      for (const query of [
        "SELECT 7 AS x;",
        "SELECT 7 AS x ;;; ",
        "SELECT 7 AS x; -- done",
        "SELECT 7 AS x /* c */ ; /* d */\n\t",
        "-- first\nSELECT 7 AS x",
        "/* first */ SELECT 7 AS x;\n-- last",
        ";;SELECT 7 AS x",
        "\n\n  SELECT 7 AS x\n\n",
      ]) {
        expect(sql.exec(query).one()).toEqual({ x: 7 });
        // Again, now that it may be cached.
        expect(sql.exec(query).one()).toEqual({ x: 7 });
      }

      // A statement that fails stops the script, and what the statements before it did is undone.
      expect(() =>
        sql.exec("INSERT INTO m VALUES (6, 'six'); INSERT INTO missing VALUES (1); INSERT INTO m VALUES (7, 'seven')"),
      ).toThrow("no such table: missing");
      expect(sql.exec("SELECT a FROM m WHERE a > 5").toArray()).toEqual([]);
    });
  });

  test("a query without a statement throws", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      for (const query of [
        "",
        " ",
        "\n\t",
        ";",
        ";;  ;",
        "-- only a comment",
        "/* only a comment */",
        "-- one\n/* two */ ; -- three",
      ]) {
        expect(() => sql.exec(query)).toThrow();
        expect(() => sql.exec(query, 1)).toThrow();
      }
      expect(sql.exec("SELECT 1 AS ok").one()).toEqual({ ok: 1 });
    });
  });

  test("errors are SQLiteErrors", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql, kv } }) => {
      const syntax = caught(() => sql.exec("SELEC 1"));
      expect(syntax).toBeInstanceOf(Error);
      expect(syntax.name).toBe("SQLiteError");
      expect(syntax.message).toContain("syntax error");
      expect(syntax.code).toBe("SQLITE_ERROR");
      expect(typeof syntax.errno).toBe("number");
      expect(caught(() => sql.exec("SELECT * FROM nowhere"))).toMatchObject({
        name: "SQLiteError",
        message: "no such table: nowhere",
      });
      expect(caught(() => sql.exec("SELECT 1; SELECT FROM"))).toMatchObject({ name: "SQLiteError" });
      expect(caught(() => sql.exec("SELECT 'unterminated"))).toMatchObject({ name: "SQLiteError" });

      sql.exec("CREATE TABLE u (id INTEGER PRIMARY KEY, v TEXT UNIQUE NOT NULL)");
      sql.exec("INSERT INTO u VALUES (1, 'a')");
      const unique = caught(() => sql.exec("INSERT INTO u VALUES (2, 'a')"));
      expect(unique.name).toBe("SQLiteError");
      expect(unique.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
      expect(unique.message).toContain("UNIQUE constraint failed");
      expect(caught(() => sql.exec("INSERT INTO u VALUES (1, 'b')")).code).toBe("SQLITE_CONSTRAINT_PRIMARYKEY");
      expect(caught(() => sql.exec("INSERT INTO u VALUES (3, NULL)")).code).toBe("SQLITE_CONSTRAINT_NOTNULL");
      // An error while stepping to a later row.
      sql.exec("INSERT INTO u VALUES (2, 'b'), (3, 'c')");
      const stepping = sql.exec(
        "SELECT id, CASE WHEN id = 3 THEN abs(-9223372036854775807 - 1) ELSE id END AS v FROM u ORDER BY id",
      );
      expect(stepping.next().value).toEqual({ id: 1, v: 1 });
      expect(stepping.next().value).toEqual({ id: 2, v: 2 });
      expect(caught(() => stepping.next())).toMatchObject({ name: "SQLiteError", message: "integer overflow" });
      expect(stepping.next()).toEqual({ done: true, value: undefined });
      // Foreign keys are enforced.
      sql.exec("CREATE TABLE child (u_id INTEGER REFERENCES u (id))");
      expect(caught(() => sql.exec("INSERT INTO child VALUES (99)")).code).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");

      // None of it stopped the database from working, and the failed statements wrote nothing.
      expect(sql.exec("SELECT id, v FROM u ORDER BY id").toArray()).toEqual([
        { id: 1, v: "a" },
        { id: 2, v: "b" },
        { id: 3, v: "c" },
      ]);
      kv.put("still", "works");
      expect(kv.get("still")).toBe("works");
    });
  });

  test("the same query many times", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a INTEGER)");
      for (let i = 0; i < 200; i++) expect(sql.exec("INSERT INTO t VALUES (?)", i).rowsWritten).toBe(1);
      for (let i = 0; i < 50; i++) expect(sql.exec("SELECT a FROM t WHERE a = ?", i).one()).toEqual({ a: i });
      expect(sql.exec("SELECT count(*) AS n, sum(a) AS total FROM t").one()).toEqual({ n: 200, total: 19900 });
      // More different queries than are kept, and each of them again.
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 80; i++)
          expect(sql.exec(`SELECT a + ${i} AS v FROM t WHERE a = ?`, 1).one()).toEqual({ v: i + 1 });
      }
      // A statement whose table changed shape is compiled again.
      expect(sql.exec("SELECT * FROM t WHERE a = 0").one()).toEqual({ a: 0 });
      sql.exec("ALTER TABLE t ADD COLUMN b TEXT DEFAULT 'new'");
      const changed = sql.exec("SELECT * FROM t WHERE a = 0");
      expect(changed.columnNames).toEqual(["a", "b"]);
      expect(changed.one()).toEqual({ a: 0, b: "new" });
      // A failed exec of a cached statement leaves it usable.
      expect(() => sql.exec("SELECT a FROM t WHERE a = ?")).toThrow("Wrong number");
      expect(() => sql.exec("SELECT a FROM t WHERE a = ?", {} as any)).toThrow();
      expect(sql.exec("SELECT a FROM t WHERE a = ?", 7).one()).toEqual({ a: 7 });
    });
    // And from later events.
    for (let i = 0; i < 3; i++) {
      expect(await run(stub, ({ storage: { sql } }) => sql.exec("SELECT a FROM t WHERE a = ?", i).one())).toEqual({
        a: i,
      });
    }
  });

  test("two cursors over the same query at once", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a INTEGER)");
      sql.exec("INSERT INTO t VALUES (1), (2), (3)");
      const query = "SELECT a FROM t WHERE a >= ? ORDER BY a";
      // Once alone, so that the statement is one that is kept.
      expect(sql.exec(query, 1).toArray()).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
      const first = sql.exec(query, 1);
      const second = sql.exec(query, 2);
      const third = sql.exec(query, 3);
      expect(first.next().value).toEqual({ a: 1 });
      expect(second.next().value).toEqual({ a: 2 });
      expect(first.next().value).toEqual({ a: 2 });
      expect(third.toArray()).toEqual([{ a: 3 }]);
      expect(second.toArray()).toEqual([{ a: 3 }]);
      expect(first.toArray()).toEqual([{ a: 3 }]);
      expect(sql.exec(query, 3).toArray()).toEqual([{ a: 3 }]);
      expect(sql.exec(query, 0).raw().toArray()).toEqual([[1], [2], [3]]);

      // A cursor sees rows written while it is open, or not; either way it ends and nothing breaks.
      const open = sql.exec("SELECT a FROM t ORDER BY a");
      expect(open.next().value).toEqual({ a: 1 });
      sql.exec("INSERT INTO t VALUES (4)");
      const rest = open.toArray().map(row => row.a);
      expect(rest.slice(0, 2)).toEqual([2, 3]);
      expect(sql.exec("SELECT count(*) AS n FROM t").one().n).toBe(4);
    });
  });

  test("a cursor that was not read to its end is no obstacle", async () => {
    const { ns, stub, env } = open();
    await using _ = ns;
    await run(stub, ({ storage }) => {
      const { sql, kv } = storage;
      sql.exec("CREATE TABLE t (a INTEGER)");
      sql.exec("CREATE TABLE other (a INTEGER)");
      sql.exec("INSERT INTO t VALUES (1), (2), (3)");
      // Held on to, so that it is not collected.
      env.abandoned = [sql.exec("SELECT a FROM t ORDER BY a"), sql.exec("SELECT a FROM t ORDER BY a")];
      expect(env.abandoned[1].next().value).toEqual({ a: 1 });
      sql.exec("INSERT INTO t VALUES (4)");
      sql.exec("UPDATE t SET a = a * 10");
      sql.exec("DELETE FROM t WHERE a = 10");
      sql.exec("CREATE INDEX t_a ON t (a)");
      sql.exec("CREATE TABLE made (a)");
      kv.put("key", "value");
      expect(sql.exec("SELECT a FROM t ORDER BY a").toArray()).toEqual([{ a: 20 }, { a: 30 }, { a: 40 }]);
    });
    // The writes were committed, and later events are not affected either.
    await run(stub, async ({ storage }) => {
      const { sql, kv } = storage;
      expect(kv.get("key")).toBe("value");
      expect(sql.exec("SELECT count(*) AS n FROM t").one().n).toBe(3);
      storage.transactionSync(() => sql.exec("INSERT INTO t VALUES (50)"));
      expect(() =>
        storage.transactionSync(() => {
          sql.exec("INSERT INTO t VALUES (60)");
          throw new Error("undo");
        }),
      ).toThrow("undo");
      expect(sql.exec("SELECT count(*) AS n FROM t").one().n).toBe(4);
    });
    expect(env.abandoned.length).toBe(2);
  });

  test("a cursor that was not read to its end does not keep tables from being dropped", async () => {
    const { ns, stub, env } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a INTEGER)");
      sql.exec("CREATE TABLE other (a INTEGER)");
      sql.exec("INSERT INTO t VALUES (1), (2), (3)");
      // The usual way to read the first row of many. Held on to, so that it is not collected.
      env.abandoned = sql.exec("SELECT a FROM t ORDER BY a");
      expect(env.abandoned.next().value).toEqual({ a: 1 });
      sql.exec("DROP TABLE other");
      expect(userSchema({ storage: { sql } } as Ctx)).toEqual(["table:t"]);
    });
    await run(stub, ctx => {
      ctx.storage.sql.exec("DROP TABLE t");
      expect(userSchema(ctx)).toEqual([]);
    });
    expect(env.abandoned).toBeDefined();
  });

  test("databaseSize grows", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    const sizes = await run(stub, async ({ storage }) => {
      const { sql } = storage;
      const empty = sql.databaseSize;
      sql.exec("CREATE TABLE big (data BLOB)");
      for (let i = 0; i < 64; i++) sql.exec("INSERT INTO big VALUES (?)", new Uint8Array(4096));
      const inSameRun = sql.databaseSize;
      await storage.sync();
      return { empty, inSameRun, committed: sql.databaseSize };
    });
    expect(sizes.empty).toBeGreaterThan(0);
    expect(Number.isInteger(sizes.empty)).toBe(true);
    expect(sizes.committed).toBeGreaterThanOrEqual(sizes.empty + 64 * 4096);
    expect(sizes.inSameRun).toBe(sizes.committed);
    expect(await run(stub, ctx => ctx.storage.sql.databaseSize)).toBe(sizes.committed);
    // The key-value store is in the same database.
    await run(stub, ctx => ctx.storage.kv.put("large", new Uint8Array(1_000_000)));
    expect(await run(stub, ctx => ctx.storage.sql.databaseSize)).toBeGreaterThan(sizes.committed + 1_000_000);
  });
});

describe("what sql.exec() may not do", () => {
  const denied = (sql: Bun.DurableObjectSql, query: string, ...bindings: any[]) => {
    let error: any;
    try {
      sql.exec(query, ...bindings).toArray();
    } catch (thrown) {
      error = thrown;
    }
    if (!error) throw new Error(`Expected sql.exec(${JSON.stringify(query)}) to throw`);
    expect(error).toBeInstanceOf(Error);
    expect({ query, name: error.name }).toEqual({ query, name: "SQLiteError" });
    expect({ query, message: error.message }).toEqual({
      query,
      message: expect.stringMatching(/not authorized|prohibited/),
    });
  };

  test("control transactions", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      const { sql, kv } = storage;
      sql.exec("CREATE TABLE t (a)");
      kv.put("before", 1);
      for (const query of [
        "BEGIN",
        "begin",
        "BEGIN TRANSACTION",
        "BEGIN IMMEDIATE",
        "BEGIN EXCLUSIVE",
        "COMMIT",
        "END",
        "END TRANSACTION",
        "ROLLBACK",
        "rollback transaction",
        "SAVEPOINT mine",
        "RELEASE mine",
        "RELEASE SAVEPOINT mine",
        "ROLLBACK TO mine",
        "ROLLBACK TO SAVEPOINT _cf_scope0",
        "RELEASE _cf_scope0",
        "/* hidden */ COMMIT",
        "INSERT INTO t VALUES (1); COMMIT",
        "SELECT 1; ROLLBACK; SELECT 2",
      ]) {
        denied(sql, query);
      }
      // Also inside a transaction the runtime opened.
      storage.transactionSync(() => {
        kv.put("inside", 1);
        for (const query of ["COMMIT", "ROLLBACK", "RELEASE _cf_scope0", "ROLLBACK TO _cf_scope0", "SAVEPOINT s"])
          denied(sql, query);
      });
      await storage.transaction(async txn => {
        await txn.put("inside too", 1);
        for (const query of ["COMMIT", "ROLLBACK", "RELEASE _cf_scope0", "ROLLBACK TO _cf_scope0", "END"])
          denied(sql, query);
      });
      // A script that failed at a later statement did nothing; everything else is there.
      expect(sql.exec("SELECT a FROM t").toArray()).toEqual([]);
      expect([...kv.list()].map(([key]) => key)).toEqual(["before", "inside", "inside too"]);
    });
    expect(await run(stub, async ({ storage }) => [...(await storage.list()).keys()])).toEqual([
      "before",
      "inside",
      "inside too",
    ]);
  });

  test("attach or detach databases", async () => {
    using dir = tempDir("durable-object-attach", {});
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      const file = join(String(dir), "other.sqlite");
      denied(sql, "ATTACH DATABASE ':memory:' AS other");
      denied(sql, "ATTACH ? AS other", file);
      denied(sql, `ATTACH DATABASE '${file}' AS other`);
      denied(sql, "DETACH DATABASE main");
      denied(sql, "DETACH other");
      expect(() => sql.exec(`VACUUM INTO '${file}'`)).toThrow();
      expect(existsSync(file)).toBe(false);
    });
  });

  test("touch the runtime's tables", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      const { sql, kv } = storage;
      kv.put("key", "value");
      await storage.setAlarm(Date.now() + 3_600_000);
      sql.exec("CREATE TABLE t (a)");
      sql.exec("INSERT INTO t VALUES (1)");
      for (const query of [
        "SELECT * FROM _cf_KV",
        "SELECT key FROM _cf_KV",
        "SELECT count(*) FROM _cf_KV",
        "SELECT * FROM _CF_kv",
        'SELECT * FROM "_cf_KV"',
        "SELECT * FROM [_cf_KV]",
        "SELECT * FROM `_cf_KV`",
        "SELECT * FROM main._cf_KV",
        "SELECT * FROM _cf_METADATA",
        "SELECT * FROM t, _cf_KV",
        "SELECT * FROM t WHERE a IN (SELECT length(key) FROM _cf_KV)",
        "SELECT (SELECT value FROM _cf_METADATA) AS alarm",
        "WITH c AS (SELECT * FROM _cf_KV) SELECT * FROM c",
        "INSERT INTO _cf_KV (key, value) VALUES ('mine', x'00')",
        "INSERT OR REPLACE INTO _cf_KV (key, value) VALUES ('key', x'00')",
        "INSERT INTO t SELECT key FROM _cf_KV",
        "UPDATE _cf_KV SET value = x'00'",
        "UPDATE _cf_METADATA SET value = 0",
        "DELETE FROM _cf_KV",
        "DELETE FROM _cf_METADATA",
        "DELETE FROM t WHERE a IN (SELECT 1 FROM _cf_KV)",
        "DROP TABLE _cf_KV",
        "DROP TABLE IF EXISTS _cf_METADATA",
        "ALTER TABLE _cf_KV RENAME TO mine",
        "ALTER TABLE _cf_KV ADD COLUMN extra",
        "ALTER TABLE _cf_KV RENAME COLUMN value TO v",
        "ALTER TABLE _cf_METADATA DROP COLUMN value",
        "CREATE TABLE _cf_mine (a)",
        "CREATE TABLE _cf_ (a)",
        "CREATE TABLE _CF_Mine (a)",
        "CREATE TABLE _Cf_x (a)",
        'CREATE TABLE "_cf_quoted" (a)',
        "CREATE TABLE IF NOT EXISTS _cf_KV (key TEXT)",
        "CREATE TABLE _cf_copy AS SELECT * FROM t",
        "CREATE TABLE copy AS SELECT * FROM _cf_KV",
        "CREATE TEMP TABLE _cf_temp (a)",
        "CREATE INDEX mine ON _cf_KV (value)",
        "CREATE INDEX _cf_index ON t (a)",
        "CREATE UNIQUE INDEX _CF_index ON t (a)",
        "CREATE TRIGGER mine AFTER INSERT ON _cf_KV BEGIN SELECT 1; END",
        "CREATE TRIGGER _cf_trigger AFTER INSERT ON t BEGIN SELECT 1; END",
        "CREATE VIEW _cf_view AS SELECT * FROM t",
        "CREATE VIRTUAL TABLE _cf_fts USING fts5(body)",
      ]) {
        denied(sql, query);
      }
      expect(userSchema({ storage } as Ctx)).toEqual(["table:t"]);
      expect(sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 1 }]);
    });
    // The key-value store and the alarm are as they were, and work.
    await run(stub, async ({ storage }) => {
      expect([...storage.kv.list()]).toEqual([["key", "value"]]);
      expect(await storage.getAlarm()).toBeGreaterThan(Date.now());
      storage.kv.put("key", "changed");
      storage.kv.put("other", 1);
      expect(storage.kv.delete("other")).toBe(true);
      await storage.deleteAlarm();
      expect(await storage.getAlarm()).toBeNull();
    });
    expect(await run(stub, ctx => ctx.storage.kv.get("key"))).toBe("changed");
  });

  test("rename a table to a reserved name", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ctx => {
      const { sql } = ctx.storage;
      sql.exec("CREATE TABLE t (a)");
      denied(sql, "ALTER TABLE t RENAME TO _cf_t");
      denied(sql, "ALTER TABLE t RENAME TO _CF_t");
      expect(userSchema(ctx)).toEqual(["table:t"]);
    });
  });

  test("reach the runtime's tables through a view or a trigger", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql, kv } }) => {
      kv.put("key", "value");
      sql.exec("CREATE TABLE t (a)");
      sql.exec("CREATE TABLE log (a)");
      // Whichever of the two statements it is that fails, no row comes out and none is changed.
      const attempts: [string, string][] = [
        ["CREATE VIEW peek AS SELECT key, value FROM _cf_KV", "SELECT * FROM peek"],
        ["CREATE TRIGGER wipe AFTER INSERT ON log BEGIN DELETE FROM _cf_KV; END", "INSERT INTO log VALUES (1)"],
        [
          "CREATE TRIGGER leak AFTER INSERT ON log BEGIN INSERT INTO t SELECT key FROM _cf_KV; END",
          "INSERT INTO log VALUES (2)",
        ],
      ];
      for (const [create, use] of attempts) {
        let rows: unknown[] | undefined;
        const error = caught(() => {
          sql.exec(create);
          rows = sql.exec(use).toArray();
        });
        expect(rows).toBeUndefined();
        expect(error.name).toBe("SQLiteError");
        expect(error.message).toMatch(/not authorized|prohibited/);
      }
      expect(sql.exec("SELECT a FROM t").toArray()).toEqual([]);
      expect([...kv.list()]).toEqual([["key", "value"]]);
      kv.put("key", "still writable");
      expect(kv.get("key")).toBe("still writable");
    });
    expect(await run(stub, ctx => ctx.storage.kv.get("key"))).toBe("still writable");
  });

  test("PRAGMAs outside the allowed ones", async () => {
    using dir = tempDir("durable-object-pragma", {});
    const { ns, stub } = open({ storage: String(dir) });
    await using _ = ns;
    await run(stub, ({ storage: { sql, kv } }) => {
      sql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'x')");
      sql.exec("CREATE INDEX t_name ON t (name)");
      expect(sql.exec("PRAGMA table_info(t)").toArray()).toEqual([
        { cid: 0, name: "id", type: "INTEGER", notnull: 0, dflt_value: null, pk: 1 },
        { cid: 1, name: "name", type: "TEXT", notnull: 1, dflt_value: "'x'", pk: 0 },
      ]);
      expect(sql.exec("PRAGMA table_info('t')").toArray().length).toBe(2);
      expect(sql.exec("SELECT name FROM pragma_table_info('t')").toArray()).toEqual([{ name: "id" }, { name: "name" }]);
      expect(sql.exec("PRAGMA table_xinfo(t)").toArray().length).toBe(2);
      expect(
        sql
          .exec("PRAGMA index_list(t)")
          .toArray()
          .map(row => row.name),
      ).toEqual(["t_name"]);
      expect(
        sql
          .exec("PRAGMA index_info(t_name)")
          .toArray()
          .map(row => row.name),
      ).toEqual(["name"]);
      expect(sql.exec("PRAGMA foreign_keys").one()).toEqual({ foreign_keys: 1 });
      expect(sql.exec("PRAGMA foreign_key_list(t)").toArray()).toEqual([]);
      expect(sql.exec("PRAGMA quick_check").one()).toEqual({ quick_check: "ok" });
      expect(sql.exec("PRAGMA page_size").one().page_size).toBeGreaterThan(0);
      sql.exec("PRAGMA defer_foreign_keys = ON");
      sql.exec("PRAGMA case_sensitive_like = ON");
      sql.exec("PRAGMA optimize");

      for (const query of [
        "PRAGMA journal_mode",
        "PRAGMA journal_mode = DELETE",
        "PRAGMA journal_mode = OFF",
        "PRAGMA main.journal_mode = MEMORY",
        "PRAGMA locking_mode",
        "PRAGMA locking_mode = NORMAL",
        "PRAGMA synchronous = OFF",
        "PRAGMA writable_schema = ON",
        "PRAGMA schema_version = 0",
        "PRAGMA user_version = 1",
        "PRAGMA application_id = 1",
        "PRAGMA cache_size = 1",
        "PRAGMA mmap_size = 0",
        "PRAGMA temp_store = MEMORY",
        "PRAGMA temp_store_directory = '/tmp'",
        "PRAGMA trusted_schema = ON",
        "PRAGMA query_only = ON",
        "PRAGMA read_uncommitted = 1",
        "PRAGMA wal_checkpoint",
        "PRAGMA wal_checkpoint(TRUNCATE)",
        "PRAGMA wal_autocheckpoint = 1",
        "PRAGMA secure_delete = ON",
        "PRAGMA auto_vacuum = FULL",
        "PRAGMA incremental_vacuum",
        "PRAGMA max_page_count = 1",
        "PRAGMA hard_heap_limit = 1",
        "PRAGMA soft_heap_limit = 1",
        "PRAGMA shrink_memory",
        "PRAGMA database_list",
        "PRAGMA not_a_pragma",
        "SELECT * FROM pragma_journal_mode",
      ]) {
        denied(sql, query);
      }
      // The runtime goes on using the database as it set it up.
      kv.put("key", "value");
      sql.exec("INSERT INTO t (name) VALUES ('row')");
    });
    await run(stub, ({ storage: { sql, kv } }) => {
      expect(kv.get("key")).toBe("value");
      expect(sql.exec("SELECT name FROM t").toArray()).toEqual([{ name: "row" }]);
    });
  });

  test("views, triggers and indexes on the object's own tables work", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage: { sql } }) => {
      sql.exec(`
        CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL);
        CREATE TABLE audit (item INTEGER, what TEXT);
        CREATE INDEX items_name ON items (name);
        CREATE VIEW expensive AS SELECT name, price * 2 AS doubled FROM items WHERE price > 10;
        CREATE TRIGGER items_inserted AFTER INSERT ON items BEGIN INSERT INTO audit VALUES (new.id, 'insert'); END;
        CREATE TRIGGER items_deleted AFTER DELETE ON items BEGIN INSERT INTO audit VALUES (old.id, 'delete'); END;
      `);
      sql.exec("INSERT INTO items (name, price) VALUES ('cheap', 1), ('dear', 20)");
      sql.exec("DELETE FROM items WHERE name = 'cheap'");
      expect(sql.exec("SELECT * FROM expensive").toArray()).toEqual([{ name: "dear", doubled: 40 }]);
      expect(sql.exec("SELECT * FROM audit ORDER BY rowid").toArray()).toEqual([
        { item: 1, what: "insert" },
        { item: 2, what: "insert" },
        { item: 1, what: "delete" },
      ]);
      expect(
        sql
          .exec(
            "WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT sum(i) AS total FROM n",
          )
          .one(),
      ).toEqual({ total: 15 });
      expect(sql.exec("SELECT json_extract(?, '$.a.b') AS value", '{"a":{"b":7}}').one()).toEqual({ value: 7 });
      sql.exec("DROP TRIGGER items_inserted");
      sql.exec("DROP VIEW expensive");
      sql.exec("ANALYZE");
      sql.exec("REINDEX items_name");
    });
  });
});

describe("transactionSync", () => {
  test("keeps what the closure wrote and returns what it returned", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage }) => {
      const { sql, kv } = storage;
      sql.exec("CREATE TABLE t (a)");
      const marker = { returned: true };
      const result = storage.transactionSync(() => {
        kv.put("key", "value");
        sql.exec("INSERT INTO t VALUES (1)");
        // Its own writes are visible to it.
        expect(kv.get("key")).toBe("value");
        expect(sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 1 }]);
        return marker;
      });
      expect(result).toBe(marker);
      expect(storage.transactionSync(() => {})).toBeUndefined();
      expect(storage.transactionSync(() => 0)).toBe(0);
      expect(kv.get("key")).toBe("value");
      expect(sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 1 }]);
    });
    await run(stub, ({ storage: { sql, kv } }) => {
      expect(kv.get("key")).toBe("value");
      expect(sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 1 }]);
    });
  });

  test("rolls back the key-value store and SQL together when the closure throws", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage }) => {
      const { sql, kv } = storage;
      sql.exec("CREATE TABLE t (a)");
      sql.exec("INSERT INTO t VALUES (0)");
      kv.put("kept", "before");
      kv.put("changed", "before");
      const failure = new Error("undo");
      const error = caught(() =>
        storage.transactionSync(() => {
          kv.put("changed", "inside");
          kv.put("added", 1);
          kv.delete("kept");
          sql.exec("INSERT INTO t VALUES (1)");
          sql.exec("CREATE TABLE made (a)");
          sql.exec("UPDATE t SET a = a + 10");
          throw failure;
        }),
      );
      expect(error).toBe(failure);
      // What was written before the transaction, in the same run, is still there.
      expect([...kv.list()]).toEqual([
        ["changed", "before"],
        ["kept", "before"],
      ]);
      expect(sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 0 }]);
      expect(userSchema({ storage } as Ctx)).toEqual(["table:t"]);
      // Anything can be thrown.
      expect(
        caught(() =>
          storage.transactionSync(() => {
            kv.put("added", 2);
            throw "a string";
          }),
        ),
      ).toBe("a string");
      expect(kv.get("added")).toBeUndefined();
      kv.put("after", 1);
    });
    await run(stub, ({ storage: { sql, kv } }) => {
      expect([...kv.list()].map(([key]) => key)).toEqual(["after", "changed", "kept"]);
      expect(sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 0 }]);
    });
  });

  test("nests", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage }) => {
      const { kv } = storage;
      // The inner one fails, the outer one goes on.
      storage.transactionSync(() => {
        kv.put("outer", 1);
        expect(() =>
          storage.transactionSync(() => {
            kv.put("inner", 1);
            storage.transactionSync(() => kv.put("innermost", 1));
            expect(kv.get("innermost")).toBe(1);
            throw new Error("inner");
          }),
        ).toThrow("inner");
        expect(kv.get("inner")).toBeUndefined();
        expect(kv.get("innermost")).toBeUndefined();
        storage.transactionSync(() => kv.put("second inner", 1));
      });
      expect([...kv.list()].map(([key]) => key)).toEqual(["outer", "second inner"]);

      // The outer one fails after the inner one finished.
      expect(() =>
        storage.transactionSync(() => {
          kv.put("outer 2", 1);
          storage.transactionSync(() => kv.put("inner 2", 1));
          expect(kv.get("inner 2")).toBe(1);
          throw new Error("outer");
        }),
      ).toThrow("outer");
      expect([...kv.list()].map(([key]) => key)).toEqual(["outer", "second inner"]);

      // Deep.
      const nest = (depth: number): number =>
        storage.transactionSync(() => (kv.put("depth " + depth, depth), depth ? nest(depth - 1) + 1 : 0));
      expect(nest(20)).toBe(20);
      expect(kv.get("depth 0")).toBe(0);
    });
    expect(await run(stub, ctx => [...ctx.storage.kv.list({ prefix: "depth" })].length)).toBe(21);
  });

  test("needs a function", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage }) => {
      for (const value of [undefined, null, 1, "fn", {}] as any[]) {
        expect(caught(() => storage.transactionSync(value))).toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
      }
      storage.kv.put("fine", 1);
    });
    expect(await run(stub, ctx => ctx.storage.kv.get("fine"))).toBe(1);
  });
});

describe("transaction", () => {
  test("commits when the closure's promise fulfills", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      await storage.put({ a: 1, b: 2, c: 3 });
      storage.sql.exec("CREATE TABLE t (a)");
      const marker = { returned: true };
      const pending = storage.transaction(async txn => {
        expect(await txn.get("a")).toBe(1);
        expect([...(await txn.get(["c", "a", "missing"]))]).toEqual([
          ["a", 1],
          ["c", 3],
        ]);
        await txn.put("a", 10);
        await txn.put({ d: 4, e: 5 });
        expect(await txn.delete("b")).toBe(true);
        expect(await txn.delete(["c", "missing"])).toBe(1);
        expect([...(await txn.list())]).toEqual([
          ["a", 10],
          ["d", 4],
          ["e", 5],
        ]);
        expect([...(await txn.list({ reverse: true, limit: 1 }))]).toEqual([["e", 5]]);
        storage.sql.exec("INSERT INTO t VALUES (1)");
        await Bun.sleep(1);
        storage.kv.put("through kv", true);
        return marker;
      });
      expect(pending).toBeInstanceOf(Promise);
      expect(await pending).toBe(marker);
      // A closure that is not async.
      expect(await storage.transaction(txn => (txn.put("sync closure", 1), "plain"))).toBe("plain");
    });
    await run(stub, async ({ storage }) => {
      expect([...(await storage.list())]).toEqual([
        ["a", 10],
        ["d", 4],
        ["e", 5],
        ["sync closure", 1],
        ["through kv", true],
      ]);
      expect(storage.sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 1 }]);
    });
  });

  test("rolls back the key-value store and SQL together when it rejects", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      await storage.put("kept", "before");
      storage.sql.exec("CREATE TABLE t (a)");
      const failure = new Error("undo");
      const rejected = storage.transaction(async txn => {
        await txn.put("kept", "inside");
        await txn.put("added", 1);
        storage.kv.put("through kv", 1);
        storage.sql.exec("INSERT INTO t VALUES (1)");
        storage.sql.exec("CREATE TABLE made (a)");
        await Bun.sleep(1);
        await txn.put("after a real await", 1);
        throw failure;
      });
      expect(
        await rejected.then(
          () => "fulfilled",
          error => error,
        ),
      ).toBe(failure);
      expect([...(await storage.list())]).toEqual([["kept", "before"]]);
      expect(storage.sql.exec("SELECT a FROM t").toArray()).toEqual([]);
      expect(userSchema({ storage } as Ctx)).toEqual(["table:t"]);

      // A closure that throws before it returns a promise.
      const thrown = new Error("thrown");
      const sync = storage.transaction(txn => {
        txn.put("added", 2);
        throw thrown;
      });
      expect(sync).toBeInstanceOf(Promise);
      expect(
        await sync.then(
          () => "fulfilled",
          error => error,
        ),
      ).toBe(thrown);
      expect(await storage.get("added")).toBeUndefined();
      await storage.put("after", 1);
    });
    expect(await run(stub, async ({ storage }) => [...(await storage.list())])).toEqual([
      ["after", 1],
      ["kept", "before"],
    ]);
  });

  test("rollback() discards what it wrote", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      await storage.put("kept", "before");
      storage.sql.exec("CREATE TABLE t (a)");
      const result = await storage.transaction(async txn => {
        await txn.put("kept", "inside");
        await txn.put("added", 1);
        storage.sql.exec("INSERT INTO t VALUES (1)");
        expect(txn.rollback()).toBeUndefined();
        return "rolled back";
      });
      expect(result).toBe("rolled back");
      expect([...(await storage.list())]).toEqual([["kept", "before"]]);
      expect(storage.sql.exec("SELECT a FROM t").toArray()).toEqual([]);

      // Nothing can be done with it after rollback().
      await storage.transaction(async txn => {
        txn.rollback();
        await expect(txn.put("late", 1)).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
        await expect(txn.get("kept")).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
        expect(caught(() => txn.rollback())).toMatchObject({ code: "ERR_INVALID_STATE" });
      });
      expect(await storage.get("late")).toBeUndefined();
    });
    expect(await run(stub, async ({ storage }) => [...(await storage.list())])).toEqual([["kept", "before"]]);
  });

  test("its methods fail once it has finished", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      let committed!: Bun.DurableObjectTransaction;
      let failed!: Bun.DurableObjectTransaction;
      await storage.transaction(async txn => {
        committed = txn;
        await txn.put("key", 1);
      });
      await storage
        .transaction(async txn => {
          failed = txn;
          throw new Error("failed");
        })
        .catch(() => {});
      for (const txn of [committed, failed]) {
        const finished = { code: "ERR_INVALID_STATE" };
        await expect(txn.get("key")).rejects.toMatchObject(finished);
        await expect(txn.get(["key"])).rejects.toMatchObject(finished);
        await expect(txn.put("key", 2)).rejects.toMatchObject(finished);
        await expect(txn.put({ key: 2 })).rejects.toMatchObject(finished);
        await expect(txn.delete("key")).rejects.toMatchObject(finished);
        await expect(txn.list()).rejects.toMatchObject(finished);
        await expect(txn.getAlarm()).rejects.toMatchObject(finished);
        await expect(txn.setAlarm(Date.now() + 1000)).rejects.toMatchObject(finished);
        await expect(txn.deleteAlarm()).rejects.toMatchObject(finished);
        expect(caught(() => txn.rollback())).toMatchObject(finished);
      }
      expect(await storage.get("key")).toBe(1);
      expect(await storage.getAlarm()).toBeNull();
    });
  });

  test("nests, with itself and with transactionSync()", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      await storage.transaction(async outer => {
        await outer.put("outer", 1);
        await storage.transaction(async inner => {
          await inner.put("inner, rolled back", 1);
          inner.rollback();
        });
        await storage
          .transaction(async inner => {
            await inner.put("inner, failed", 1);
            await Bun.sleep(1);
            throw new Error("inner");
          })
          .catch(() => {});
        await storage.transaction(async inner => {
          await inner.put("inner, kept", 1);
        });
        expect(() =>
          storage.transactionSync(() => {
            storage.kv.put("sync, failed", 1);
            throw new Error("sync");
          }),
        ).toThrow("sync");
        storage.transactionSync(() => storage.kv.put("sync, kept", 1));
        expect([...(await outer.list()).keys()]).toEqual(["inner, kept", "outer", "sync, kept"]);
      });
      await storage
        .transaction(async outer => {
          await storage.transaction(async inner => {
            await inner.put("inner of a failed outer", 1);
          });
          storage.transactionSync(() => storage.kv.put("sync of a failed outer", 1));
          throw new Error("outer");
        })
        .catch(() => {});
    });
    expect(await run(stub, async ({ storage }) => [...(await storage.list()).keys()])).toEqual([
      "inner, kept",
      "outer",
      "sync, kept",
    ]);
  });

  test("the alarm is part of it", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      const time = Date.now() + 3_600_000;
      await storage
        .transaction(async txn => {
          await txn.setAlarm(time);
          expect(await txn.getAlarm()).toBe(time);
          throw new Error("undo");
        })
        .catch(() => {});
      expect(await storage.getAlarm()).toBeNull();
      await storage.transaction(async txn => {
        await txn.setAlarm(new Date(time));
      });
      expect(await storage.getAlarm()).toBe(time);
      await storage.transaction(async txn => {
        await txn.deleteAlarm();
        txn.rollback();
      });
      expect(await storage.getAlarm()).toBe(time);
      await storage.deleteAlarm();
    });
  });

  test("other events wait until it has finished", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    const order: string[] = [];
    const first = run(stub, async ({ storage }) => {
      await storage.transaction(async txn => {
        await txn.put("value", "uncommitted");
        order.push("transaction: wrote");
        await Bun.sleep(40);
        await txn.put("value", "committed");
        order.push("transaction: done");
      });
      order.push("first: done");
    });
    const second = run(stub, ({ storage }) => {
      order.push("second: started");
      return storage.kv.get("value");
    });
    const third = run(stub, ({ storage }) => {
      order.push("third: started");
      return storage.kv.get("value");
    });
    expect(await second).toBe("committed");
    expect(await third).toBe("committed");
    await first;
    expect(order.slice(0, 2)).toEqual(["transaction: wrote", "transaction: done"]);
    expect(order.indexOf("second: started")).toBeGreaterThan(order.indexOf("transaction: done"));
    expect(order.indexOf("third: started")).toBeGreaterThan(order.indexOf("second: started"));

    // Without a transaction the same await lets the next event in, which sees what was written so far.
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const sleeper = run(stub, async ({ storage }) => {
      storage.kv.put("value", "first half");
      await gate;
      storage.kv.put("value", "second half");
    });
    expect(await run(stub, ({ storage }) => storage.kv.get("value"))).toBe("first half");
    release();
    await sleeper;
    expect(await run(stub, ({ storage }) => storage.kv.get("value"))).toBe("second half");
  });

  test("a transaction that fails lets the waiting events see the state before it", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage }) => storage.kv.put("value", "before"));
    const first = run(stub, ({ storage }) =>
      storage.transaction(async txn => {
        await txn.put("value", "inside");
        await Bun.sleep(20);
        throw new Error("undo");
      }),
    );
    const second = run(stub, ({ storage }) => storage.kv.get("value"));
    await expect(first).rejects.toThrow("undo");
    expect(await second).toBe("before");
  });
});

describe("when writes are committed", () => {
  test("writes of a synchronous run are lost when it ends in abort()", async () => {
    const { ns, stub, env } = open();
    await using _ = ns;
    await run(stub, ({ storage }) => {
      storage.kv.put("committed", 1);
      storage.sql.exec("CREATE TABLE committed (a)");
    });
    const aborted = run(stub, ctx => {
      ctx.storage.kv.put("lost", 1);
      ctx.storage.kv.put("committed", 2);
      ctx.storage.put("lost too", 1);
      ctx.storage.put({ "and this": 1 });
      ctx.storage.delete("committed");
      ctx.storage.sql.exec("CREATE TABLE lost (a)");
      ctx.storage.sql.exec("INSERT INTO committed VALUES (1)");
      ctx.storage.transactionSync(() => ctx.storage.kv.put("lost in a transaction", 1));
      ctx.abort("no");
    });
    await expect(aborted).rejects.toMatchObject({ ...reset, message: "no" });
    expect(env.made).toBe(1);
    await run(stub, ctx => {
      expect([...ctx.storage.kv.list()]).toEqual([["committed", 1]]);
      expect(userSchema(ctx)).toEqual(["table:committed"]);
      expect(ctx.storage.sql.exec("SELECT count(*) AS n FROM committed").one().n).toBe(0);
    });
    expect(env.made).toBe(2);
  });

  test("writes followed by an await are kept when abort() comes later", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    const failure = new Error("with an error");
    const aborted = run(stub, async ctx => {
      ctx.storage.kv.put("kept", 1);
      ctx.storage.sql.exec("CREATE TABLE kept (a)");
      await null;
      ctx.storage.kv.put("lost", 1);
      ctx.storage.sql.exec("INSERT INTO kept VALUES (1)");
      ctx.abort(failure);
    });
    expect(
      await aborted.then(
        () => "fulfilled",
        error => error,
      ),
    ).toBe(failure);
    await run(stub, async ctx => {
      expect([...ctx.storage.kv.list()]).toEqual([["kept", 1]]);
      expect(ctx.storage.sql.exec("SELECT count(*) AS n FROM kept").one().n).toBe(0);
    });
    // The same with the promise API: awaiting the put is enough.
    await expect(
      run(stub, async ctx => {
        await ctx.storage.put("kept too", 1);
        ctx.abort();
      }),
    ).rejects.toMatchObject(reset);
    expect(await run(stub, ctx => [...ctx.storage.kv.list()])).toEqual([
      ["kept", 1],
      ["kept too", 1],
    ]);
  });

  test("an open transaction is rolled back by abort()", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await expect(
      run(stub, async ctx => {
        await ctx.storage.put("before", 1);
        await ctx.storage.transaction(async txn => {
          await txn.put("inside", 1);
          await Bun.sleep(1);
          ctx.abort("during a transaction");
        });
      }),
    ).rejects.toMatchObject(reset);
    expect(await run(stub, ctx => [...ctx.storage.kv.list()])).toEqual([["before", 1]]);
    // And the next instance can open one.
    await run(stub, ctx => ctx.storage.transaction(txn => txn.put("next", 1)));
    expect(await run(stub, ctx => [...ctx.storage.kv.list()])).toEqual([
      ["before", 1],
      ["next", 1],
    ]);
  });

  test("abort() from inside a transactionSync() closure or a getter of put()'s entries", async () => {
    const { ns, stub, env } = open();
    await using _ = ns;
    await run(stub, ctx => ctx.storage.kv.put("committed", 1));
    await expect(
      run(stub, ctx => {
        ctx.storage.kv.put("lost", 1);
        ctx.storage.transactionSync(() => {
          ctx.storage.kv.put("lost in the transaction", 1);
          ctx.storage.transactionSync(() => ctx.abort("inside"));
        });
      }),
    ).rejects.toMatchObject({ ...reset, message: "inside" });
    expect(await run(stub, ctx => [...ctx.storage.kv.list()])).toEqual([["committed", 1]]);
    let put: Promise<void> | undefined;
    await expect(
      run(stub, ctx => {
        put = ctx.storage.put({
          first: 1,
          get second() {
            return ctx.abort("from a getter");
          },
          third: 3,
        });
        put.catch(() => {});
      }),
    ).rejects.toMatchObject({ ...reset, message: "from a getter" });
    await expect(put).rejects.toMatchObject({ ...reset, message: "from a getter" });
    // The instances after them are not inside anybody's transaction.
    await run(stub, async ctx => {
      expect([...ctx.storage.kv.list()]).toEqual([["committed", 1]]);
      ctx.storage.kv.put("after", 1);
      expect(() =>
        ctx.storage.transactionSync(() => {
          ctx.storage.kv.put("undone", 1);
          throw new Error("undo");
        }),
      ).toThrow("undo");
    });
    expect(await run(stub, ctx => [...ctx.storage.kv.list()])).toEqual([
      ["after", 1],
      ["committed", 1],
    ]);
    expect(env.made).toBe(3);
  });

  // The test runner fails a test that leaves a rejection unhandled.
  test("an async method that writes and calls abort() before its first await rejects the call and nothing else", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await expect(
      run(stub, async ctx => {
        ctx.storage.kv.put("lost", 1);
        ctx.abort("before the first await");
      }),
    ).rejects.toMatchObject({ ...reset, message: "before the first await" });
    await expect(
      run(stub, ctx => {
        try {
          ctx.abort("swallowed");
        } catch {}
        // What a stale reference answers is the object's to look at, not the process's.
        return ctx.storage.get("lost");
      }),
    ).rejects.toMatchObject({ ...reset, message: "swallowed" });
    expect(await run(stub, ctx => [...ctx.storage.kv.list()])).toEqual([]);
  });

  // An error is not a rollback: what a method wrote before it threw is committed, as on Cloudflare.
  test("a method that throws after writing keeps what it wrote", async () => {
    const { ns, stub, env } = open();
    await using _ = ns;
    await expect(
      run(stub, ctx => {
        ctx.storage.kv.put("written", 1);
        ctx.storage.sql.exec("CREATE TABLE written (a)");
        throw new Error("after writing");
      }),
    ).rejects.toThrow("after writing");
    await expect(
      run(stub, async ctx => {
        await ctx.storage.put("written by an async method", 1);
        throw new Error("after writing");
      }),
    ).rejects.toThrow("after writing");
    await run(stub, ctx => {
      expect([...ctx.storage.kv.list()]).toEqual([
        ["written", 1],
        ["written by an async method", 1],
      ]);
      expect(userSchema(ctx)).toEqual(["table:written"]);
    });
    // The object was not reset.
    expect(env.made).toBe(1);
  });
});

describe("deleteAll", () => {
  test("removes keys, tables, indexes, views, triggers and the alarm", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    let fts = false;
    await run(stub, async ctx => {
      const { storage } = ctx;
      const { sql } = storage;
      await storage.put({ a: 1, b: { nested: true }, "\u{1F511}": "emoji" });
      await storage.setAlarm(Date.now() + 3_600_000);
      sql.exec(`
        CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
        CREATE TABLE child (id INTEGER PRIMARY KEY AUTOINCREMENT, parent INTEGER NOT NULL REFERENCES parent (id));
        CREATE TABLE "quoted ""name""" (a);
        CREATE INDEX child_parent ON child (parent);
        CREATE VIEW family AS SELECT parent.name, child.id FROM parent JOIN child ON child.parent = parent.id;
        CREATE TRIGGER parent_deleted BEFORE DELETE ON parent BEGIN DELETE FROM child WHERE parent = old.id; END;
        INSERT INTO parent VALUES (1, 'p');
        INSERT INTO child (parent) VALUES (1), (1);
      `);
      try {
        sql.exec("CREATE VIRTUAL TABLE documents USING fts5(body)");
        sql.exec("INSERT INTO documents VALUES ('hello world')");
        fts = true;
      } catch {}
      expect(userSchema(ctx).length).toBeGreaterThanOrEqual(7);

      const pending = storage.deleteAll();
      expect(pending).toBeInstanceOf(Promise);
      expect(await pending).toBeUndefined();
      expect((await storage.list()).size).toBe(0);
      expect(await storage.getAlarm()).toBeNull();
      expect(userSchema(ctx).filter(entry => !entry.startsWith("table:sqlite_"))).toEqual([]);
    });
    // Also after the commit, and everything can be made again.
    await run(stub, async ctx => {
      const { storage } = ctx;
      expect([...storage.kv.list()]).toEqual([]);
      expect(await storage.getAlarm()).toBeNull();
      expect(userSchema(ctx).filter(entry => !entry.startsWith("table:sqlite_"))).toEqual([]);
      storage.kv.put("a", "again");
      storage.sql.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY, other TEXT)");
      storage.sql.exec("INSERT INTO parent VALUES (1, 'new')");
      if (fts) storage.sql.exec("CREATE VIRTUAL TABLE documents USING fts5(body)");
      await storage.setAlarm(Date.now() + 3_600_000);
    });
    await run(stub, async ({ storage }) => {
      expect(storage.kv.get("a")).toBe("again");
      expect(storage.sql.exec("SELECT * FROM parent").toArray()).toEqual([{ id: 1, other: "new" }]);
      expect(await storage.getAlarm()).toBeGreaterThan(Date.now());
      await storage.deleteAll();
      await storage.deleteAll();
      expect((await storage.list()).size).toBe(0);
    });
    // FTS5 is part of the SQLite that Bun builds.
    expect(fts).toBe(true);
  });

  test("is undone by abort() in the same run and by a failing transactionSync()", async () => {
    const { ns, stub } = open();
    await using _ = ns;
    await run(stub, ({ storage }) => {
      storage.kv.put("key", "value");
      storage.sql.exec("CREATE TABLE t (a); INSERT INTO t VALUES (1)");
    });
    await expect(
      run(stub, ctx => {
        ctx.storage.deleteAll();
        expect([...ctx.storage.kv.list()]).toEqual([]);
        ctx.abort();
      }),
    ).rejects.toMatchObject(reset);
    await run(stub, async ctx => {
      expect(ctx.storage.kv.get("key")).toBe("value");
      expect(ctx.storage.sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 1 }]);
      expect(() =>
        ctx.storage.transactionSync(() => {
          ctx.storage.deleteAll();
          expect(userSchema(ctx)).toEqual([]);
          throw new Error("undo");
        }),
      ).toThrow("undo");
      expect(ctx.storage.kv.get("key")).toBe("value");
      expect(ctx.storage.sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 1 }]);
    });
  });

  test("drops tables that a cursor is still reading", async () => {
    const { ns, stub, env } = open();
    await using _ = ns;
    await run(stub, async ctx => {
      const { sql } = ctx.storage;
      sql.exec("CREATE TABLE t (a); INSERT INTO t VALUES (1), (2), (3); CREATE TABLE other (a)");
      env.abandoned = sql.exec("SELECT a FROM t");
      expect(env.abandoned.next().value).toEqual({ a: 1 });
      await ctx.storage.deleteAll();
      expect(userSchema(ctx)).toEqual([]);
    });
    expect(await run(stub, userSchema)).toEqual([]);
  });
});

/** Every database file under `root`, relative to it, without the files SQLite keeps next to them. */
function databaseFiles(root: string) {
  return (readdirSync(root, { recursive: true }) as string[])
    .map(file => file.replaceAll("\\", "/"))
    .filter(file => file.endsWith(".sqlite"))
    .sort();
}

function objectFile(id: Bun.DurableObjectId, name = "Store") {
  const hex = String(id);
  return `${encodeURIComponent(name)}/${hex.slice(0, 2)}/${hex}.sqlite`;
}

describe("storage in a directory", () => {
  test("the files are where the documentation says", async () => {
    using dir = tempDir("durable-object-layout", {});
    const name = "my namespace/é";
    const { ns, stub } = open({ storage: String(dir), name });
    const other = ns.get(ns.newUniqueId());
    await run(stub, ctx => ctx.storage.kv.put("key", "value"));
    await run(other, ctx => ctx.storage.sql.exec("CREATE TABLE t (a)"));
    expect(String(stub.id)).toMatch(/^[0-9a-f]{64}$/);
    const expected = [
      objectFile(stub.id, name),
      objectFile(other.id, name),
      `${encodeURIComponent(name)}/namespace.sqlite`,
    ].sort();
    expect(databaseFiles(String(dir))).toEqual(expected);
    await ns.close();
    expect(databaseFiles(String(dir))).toEqual(expected);
    // They are SQLite databases.
    const { Database } = await import("bun:sqlite");
    const database = new Database(join(String(dir), objectFile(stub.id, name)), { readonly: true });
    try {
      expect(database.query("SELECT key FROM _cf_KV").all()).toEqual([{ key: "key" }]);
    } finally {
      database.close();
    }

    // The name defaults to the class's.
    const byDefault = open({ storage: String(dir) });
    await run(byDefault.stub, ctx => ctx.storage.kv.put("key", "value"));
    await byDefault.ns.close();
    expect(databaseFiles(String(dir))).toEqual(
      [...expected, objectFile(byDefault.stub.id), "Store/namespace.sqlite"].sort(),
    );
  });

  test("the namespace's directory is encodeURIComponent(name)", async () => {
    using dir = tempDir("durable-object-layout-name", {});
    const names = ["a/b", "a%2Fb", "plus+and%percent", "q?#&=", "!'()*~", "\u{1F600}"];
    const namespaces: ReturnType<typeof open>[] = [];
    try {
      // Different names never share a directory, so all of them can be open at once.
      for (const name of names) namespaces.push(open({ storage: String(dir), name }));
      for (const [index, { stub }] of namespaces.entries())
        await run(stub, ctx => ctx.storage.kv.put("name", names[index]));
      for (const [index, { stub }] of namespaces.entries())
        expect(await run(stub, ctx => ctx.storage.kv.get("name"))).toBe(names[index]);
    } finally {
      for (const { ns } of namespaces) await ns.close();
    }
    expect(readdirSync(String(dir)).sort()).toEqual(names.map(name => encodeURIComponent(name)).sort());
  });

  test("survives eviction", async () => {
    using dir = tempDir("durable-object-eviction", {});
    const { ns, stub, env } = open({ storage: String(dir), idleTimeout: 20 });
    await using _ = ns;
    await run(stub, async ({ storage }) => {
      await storage.put({ number: 1, object: { nested: [1, 2, new Map([["k", "v"]])] }, "\u{1F511}": "\u{1F600}" });
      storage.sql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, data BLOB, name TEXT)");
      storage.sql.exec("CREATE INDEX t_name ON t (name)");
      storage.sql.exec(
        "INSERT INTO t (data, name) VALUES (?, ?), (?, ?)",
        new Uint8Array([1, 2, 3]),
        "one",
        null,
        "two",
      );
    });
    await evict(stub, env, 20);
    expect(env.made).toBe(2);
    await run(stub, async ({ storage }) => {
      expect([...(await storage.list())]).toEqual([
        ["number", 1],
        ["object", { nested: [1, 2, new Map([["k", "v"]])] }],
        ["\u{1F511}", "\u{1F600}"],
      ]);
      expect(storage.sql.exec("SELECT * FROM t ORDER BY id").toArray()).toEqual([
        { id: 1, data: new Uint8Array([1, 2, 3]), name: "one" },
        { id: 2, data: null, name: "two" },
      ]);
      expect(
        storage.sql
          .exec("PRAGMA index_list(t)")
          .toArray()
          .map(row => row.name),
      ).toEqual(["t_name"]);
      storage.kv.put("number", 2);
    });
    await evict(stub, env, 20);
    expect(await run(stub, ctx => ctx.storage.kv.get("number"))).toBe(2);
  });

  test("survives close() and a new namespace on the same directory", async () => {
    using dir = tempDir("durable-object-reopen", {});
    let id: string;
    {
      const { ns, stub } = open({ storage: String(dir) });
      const unique = ns.get(ns.newUniqueId());
      id = String(unique.id);
      await run(stub, async ({ storage }) => {
        await storage.put({ number: 1, date: new Date(5), big: 2n ** 80n });
        storage.sql.exec("CREATE TABLE t (a INTEGER, b TEXT); INSERT INTO t VALUES (1, 'one'), (2, 'two')");
      });
      await run(unique, ctx => ctx.storage.kv.put("which", "unique"));
      // Written and not awaited by anyone before close().
      void run(stub, ctx => ctx.storage.kv.put("last", "write"));
      await ns.close();
      await expect(run(stub, () => {})).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
    }
    for (let round = 0; round < 2; round++) {
      const { ns, stub, env } = open({ storage: String(dir) });
      await run(stub, async ({ storage }) => {
        expect([...(await storage.list())]).toEqual([
          ["big", 2n ** 80n],
          ["date", new Date(5)],
          ["last", "write"],
          ["number", 1 + round],
        ]);
        expect(storage.sql.exec("SELECT a, b FROM t ORDER BY a").toArray()).toEqual([
          { a: 1, b: "one" },
          { a: 2, b: "two" },
        ]);
        storage.kv.put("number", 2 + round);
      });
      expect(await run(ns.get(ns.idFromString(id)), ctx => ctx.storage.kv.get("which"))).toBe("unique");
      // Another name is another object.
      expect(await run(ns.getByName("another"), ctx => [...ctx.storage.kv.list()])).toEqual([]);
      expect(env.made).toBe(3);
      await ns.close();
    }
  });

  test("a directory is used by one namespace at a time", async () => {
    using dir = tempDir("durable-object-in-use", {});
    const first = open({ storage: String(dir) });
    await run(first.stub, ctx => ctx.storage.kv.put("key", "first"));
    const inUse = caught(() => open({ storage: String(dir) }));
    expect(inUse).toBeInstanceOf(Error);
    expect(inUse.code).toBe("ERR_DURABLE_OBJECT_STORAGE_IN_USE");
    // Also before the first has loaded any object.
    using unused = tempDir("durable-object-in-use-idle", {});
    const idle = open({ storage: String(unused) });
    expect(caught(() => open({ storage: String(unused) })).code).toBe("ERR_DURABLE_OBJECT_STORAGE_IN_USE");
    await idle.ns.close();
    // A namespace of another name keeps its files elsewhere in the directory.
    const sibling = open({ storage: String(dir), name: "Sibling" });
    expect(await run(sibling.stub, ctx => ctx.storage.kv.get("key"))).toBeUndefined();
    await sibling.ns.close();
    // The first one was not disturbed.
    expect(await run(first.stub, ctx => ctx.storage.kv.get("key"))).toBe("first");
    await first.ns.close();

    const second = open({ storage: String(dir) });
    expect(await run(second.stub, ctx => ctx.storage.kv.get("key"))).toBe("first");
    expect(caught(() => open({ storage: String(dir) })).code).toBe("ERR_DURABLE_OBJECT_STORAGE_IN_USE");
    await second.ns.close();
  });

  test("a directory that another process uses cannot be opened", async () => {
    using dir = tempDir("durable-object-other-process", {
      "open.ts": `
        class Store extends Bun.DurableObject {
          get(key) { return this.ctx.storage.kv.get(key); }
        }
        try {
          const ns = new Bun.DurableObjectNamespace({ class: Store, storage: process.argv[2] });
          console.log("opened", await ns.getByName("object").get("key"));
          await ns.close();
        } catch (error) {
          console.log(error.code);
        }
      `,
      "data": {},
    });
    const storage = join(String(dir), "data");
    const spawn = async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "open.ts"), storage],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { stdout: stdout.trim(), exitCode };
    };
    const { ns, stub } = open({ storage });
    await run(stub, ctx => ctx.storage.kv.put("key", "from the first process"));
    expect(await spawn()).toEqual({ stdout: "ERR_DURABLE_OBJECT_STORAGE_IN_USE", exitCode: 0 });
    // This process still has it.
    expect(await run(stub, ctx => ctx.storage.kv.get("key"))).toBe("from the first process");
    await ns.close();
    expect(await spawn()).toEqual({ stdout: "opened from the first process", exitCode: 0 });
  });

  test("a cursor that was not read to its end does not keep the database of an evicted object locked", async () => {
    using dir = tempDir("durable-object-cursor-lock", {});
    const { ns, stub, env } = open({ storage: String(dir), idleTimeout: 20 });
    const held = await run(stub, ({ storage: { sql } }) => {
      sql.exec("CREATE TABLE t (a); INSERT INTO t VALUES (1), (2), (3)");
      const cursor = sql.exec("SELECT a FROM t");
      cursor.next();
      return cursor;
    });
    let heldToo: Bun.DurableObjectSqlCursor<any>;
    try {
      await evict(stub, env, 20);
      expect(await run(stub, ctx => ctx.storage.sql.exec("SELECT count(*) AS n FROM t").one().n)).toBe(3);
      heldToo = await run(stub, ctx => ctx.storage.sql.exec("SELECT a FROM t"));
    } finally {
      await ns.close();
    }
    // Nor after the namespace closed.
    const again = open({ storage: String(dir) });
    expect(await run(again.stub, ctx => ctx.storage.sql.exec("SELECT count(*) AS n FROM t").one().n)).toBe(3);
    await again.ns.close();
    // What they had not read yet went into memory when the object's writes were committed.
    expect(held.toArray()).toEqual([{ a: 2 }, { a: 3 }]);
    expect(heldToo.toArray()).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  test("cursors that are collected after their database was closed", async () => {
    using dir = tempDir("durable-object-cursors", {});
    for (const storage of [String(dir), undefined]) {
      const { ns, stub, env } = open({ storage, idleTimeout: 20 });
      let cursors: Bun.DurableObjectSqlCursor<any>[] = [];
      await run(stub, ({ storage: { sql } }) => {
        sql.exec("CREATE TABLE IF NOT EXISTS t (a); INSERT INTO t VALUES (1), (2), (3)");
        for (let i = 0; i < 50; i++) cursors.push(sql.exec("SELECT a FROM t WHERE a > ?", i % 3));
        for (let i = 0; i < 50; i++) cursors.push(sql.exec("SELECT a FROM t"));
        // Of a database in a file, none is left reading (see the test before this one).
        if (storage) for (const cursor of cursors) cursor.toArray();
      });
      await evict(stub, env, 20);
      // Some are collected while the namespace is open, some after it closed, some are used after.
      cursors.length = 60;
      Bun.gc(true);
      await run(stub, ({ storage: { sql } }) => {
        for (let i = 0; i < 20; i++) cursors.push(sql.exec("SELECT a FROM t"));
        if (storage) for (const cursor of cursors) cursor.toArray();
        expect(sql.exec("SELECT count(*) AS n FROM t").one().n).toBe(3);
      });
      await ns.close();
      cursors.length = 40;
      Bun.gc(true);
      for (const cursor of cursors) {
        if (storage) expect(cursor.toArray()).toEqual([]);
        else expect(cursor.toArray().length).toBeLessThanOrEqual(3);
      }
      cursors = [];
      Bun.gc(true);
    }
    // The files are as usable as ever.
    const again = open({ storage: String(dir) });
    expect(await run(again.stub, ctx => ctx.storage.sql.exec("SELECT count(*) AS n FROM t").one().n)).toBe(3);
    await again.ns.close();
  });

  test("an object that stored nothing has no file", async () => {
    using dir = tempDir("durable-object-empty", {});
    const { ns, env } = open({ storage: String(dir), idleTimeout: 20 });
    const untouched = ns.getByName("untouched");
    const reader = ns.getByName("reader");
    const undone = ns.getByName("undone");
    const emptied = ns.getByName("emptied");
    const writer = ns.getByName("writer");
    await run(untouched, ctx => ctx.id.name);
    await run(reader, async ({ storage }) => {
      expect(storage.kv.get("key")).toBeUndefined();
      expect([...storage.kv.list()]).toEqual([]);
      expect(await storage.getAlarm()).toBeNull();
      expect(storage.sql.exec("SELECT 1 AS one").one()).toEqual({ one: 1 });
      expect(storage.kv.delete("key")).toBe(false);
    });
    await run(undone, ({ storage }) => {
      expect(() =>
        storage.transactionSync(() => {
          storage.kv.put("key", 1);
          throw new Error("undo");
        }),
      ).toThrow("undo");
    });
    await run(emptied, ({ storage }) => {
      storage.kv.put("key", 1);
      storage.sql.exec("CREATE TABLE t (a)");
    });
    await run(emptied, ({ storage }) => {
      storage.kv.delete("key");
      storage.sql.exec("DROP TABLE t");
    });
    await run(writer, ctx => ctx.storage.kv.put("key", 1));
    for (const stub of [untouched, reader, undone, emptied, writer]) await evict(stub, env, 20);
    expect(databaseFiles(String(dir))).toEqual([objectFile(writer.id), "Store/namespace.sqlite"].sort());
    // Read again, left alone again.
    await run(reader, ctx => ctx.storage.kv.get("key"));
    await ns.close();
    expect(databaseFiles(String(dir))).toEqual([objectFile(writer.id), "Store/namespace.sqlite"].sort());
    // Nothing else is left next to them either.
    const leftovers = (readdirSync(join(String(dir), "Store"), { recursive: true }) as string[]).filter(file =>
      /-(wal|shm|journal)$/.test(file),
    );
    expect(leftovers).toEqual([]);
  });

  test("an object's file is removed after deleteAll()", async () => {
    using dir = tempDir("durable-object-deleted", {});
    const { ns, env } = open({ storage: String(dir), idleTimeout: 20 });
    const evicted = ns.getByName("evicted");
    const closed = ns.getByName("closed");
    const kept = ns.getByName("kept");
    for (const stub of [evicted, closed, kept]) {
      await run(stub, async ({ storage }) => {
        await storage.put({ a: 1, b: 2 });
        storage.sql.exec(
          "CREATE TABLE t (a INTEGER PRIMARY KEY, b TEXT); CREATE INDEX t_b ON t (b); INSERT INTO t VALUES (1, 'x')",
        );
        await storage.setAlarm(Date.now() + 3_600_000);
      });
    }
    const all = [objectFile(evicted.id), objectFile(closed.id), objectFile(kept.id), "Store/namespace.sqlite"].sort();
    expect(databaseFiles(String(dir))).toEqual(all);
    await run(evicted, ctx => ctx.storage.deleteAll());
    await evict(evicted, env, 20);
    expect(databaseFiles(String(dir))).toEqual(all.filter(file => file !== objectFile(evicted.id)));
    await run(closed, ctx => ctx.storage.deleteAll());
    await ns.close();
    expect(databaseFiles(String(dir))).toEqual([objectFile(kept.id), "Store/namespace.sqlite"].sort());

    // They start from nothing when they are used again.
    const again = open({ storage: String(dir) });
    expect(await run(again.ns.getByName("evicted"), ctx => [[...ctx.storage.kv.list()], userSchema(ctx)])).toEqual([
      [],
      [],
    ]);
    expect(await run(again.ns.getByName("kept"), ctx => [[...ctx.storage.kv.list()], userSchema(ctx)])).toEqual([
      [
        ["a", 1],
        ["b", 2],
      ],
      ["table:t", "index:t_b"].sort((a, b) => a.split(":")[1].localeCompare(b.split(":")[1])),
    ]);
    await again.ns.close();
  });

  test("an object's file is removed after deleteAll() when a table had AUTOINCREMENT", async () => {
    using dir = tempDir("durable-object-autoincrement", {});
    const { ns, stub } = open({ storage: String(dir) });
    await run(stub, ({ storage }) => {
      storage.sql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT); INSERT INTO t (v) VALUES ('x')");
    });
    await run(stub, ctx => ctx.storage.deleteAll());
    expect(
      await run(stub, ctx => ctx.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE name = 't'").one().n),
    ).toBe(0);
    await ns.close();
    expect(databaseFiles(String(dir))).toEqual(["Store/namespace.sqlite"]);
  });
});

describe("references to the storage of an instance that is gone", () => {
  type References = {
    ctx: Ctx;
    storage: Bun.DurableObjectStorage;
    sql: Bun.DurableObjectSql;
    kv: Bun.DurableObjectKv;
    cursor: Bun.DurableObjectSqlCursor<any>;
    raw: ReturnType<Bun.DurableObjectSqlCursor<any>["raw"]>;
    finished: Bun.DurableObjectSqlCursor<any>;
    transaction: Bun.DurableObjectTransaction;
    cursorsFailed?: boolean;
  };
  const collect = async (ctx: Ctx): Promise<References> => {
    const { storage } = ctx;
    storage.kv.put("key", "value");
    storage.sql.exec("CREATE TABLE IF NOT EXISTS t (a)");
    storage.sql.exec("INSERT INTO t VALUES (1), (2), (3)");
    const cursor = storage.sql.exec("SELECT a FROM t ORDER BY a");
    cursor.next();
    const finished = storage.sql.exec("SELECT a FROM t ORDER BY a");
    finished.toArray();
    let transaction!: Bun.DurableObjectTransaction;
    await storage.transaction(async txn => void (transaction = txn));
    return {
      ctx,
      storage,
      sql: storage.sql,
      kv: storage.kv,
      cursor,
      raw: storage.sql.exec("SELECT a FROM t").raw(),
      finished,
      transaction,
    };
  };
  const expectAllReset = async (references: References) => {
    const { ctx, storage, sql, kv, cursor, raw, finished, transaction } = references;
    expect(ctx.storage).toBe(storage);
    expect(caught(() => kv.get("key"))).toMatchObject(reset);
    expect(caught(() => kv.put("key", 1))).toMatchObject(reset);
    expect(caught(() => kv.delete("key"))).toMatchObject(reset);
    expect(caught(() => kv.list())).toMatchObject(reset);
    expect(caught(() => sql.exec("SELECT 1"))).toMatchObject(reset);
    expect(caught(() => sql.exec("INSERT INTO t VALUES (4)"))).toMatchObject(reset);
    expect(caught(() => sql.databaseSize)).toMatchObject(reset);
    expect(caught(() => storage.transactionSync(() => {}))).toMatchObject(reset);
    for (const attempt of [
      () => storage.get("key"),
      () => storage.get(["key"]),
      () => storage.put("key", 1),
      () => storage.put({ key: 1 }),
      () => storage.delete("key"),
      () => storage.list(),
      () => storage.deleteAll(),
      () => storage.sync(),
      () => storage.getAlarm(),
      () => storage.setAlarm(Date.now() + 1000),
      () => storage.deleteAlarm(),
      () => storage.transaction(async () => {}),
    ]) {
      const result = attempt();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toMatchObject(reset);
    }
    // A cursor that was left unread has the rest of its rows with it; the database is not asked again.
    if (!references.cursorsFailed) {
      references.cursorsFailed = true;
      expect(cursor.toArray().length).toBeGreaterThanOrEqual(1);
      expect(raw.toArray().length).toBeGreaterThanOrEqual(3);
    }
    expect(cursor.next()).toEqual({ done: true, value: undefined });
    expect(raw.toArray()).toEqual([]);
    // A cursor that had reached its end has nothing more to ask the database for.
    expect(finished.next()).toEqual({ done: true, value: undefined });
    expect(finished.columnNames).toEqual(["a"]);
    // The transaction had finished before.
    await expect(transaction.get("key")).rejects.toThrow();
    // Anything else of ctx too.
    expect(caught(() => ctx.getWebSockets())).toMatchObject(reset);
  };

  for (const files of [false, true]) {
    const where = files ? "in files" : "in memory";

    test(`throw after eviction (${where})`, async () => {
      using dir = tempDir("durable-object-stale", {});
      const { ns, stub, env } = open({ idleTimeout: 20, storage: files ? String(dir) : undefined });
      await using _ = ns;
      const references = await run(stub, collect);
      // They work from outside the object as long as the instance is there.
      expect(references.kv.get("key")).toBe("value");
      expect(references.cursor.next().value).toEqual({ a: 2 });
      await evict(stub, env, 20);
      await expectAllReset(references);
      // The new instance has references of its own, and the same data.
      await run(stub, ctx => {
        expect(ctx).not.toBe(references.ctx);
        expect(ctx.storage).not.toBe(references.storage);
        expect(ctx.storage.kv.get("key")).toBe("value");
        expect(ctx.storage.sql.exec("SELECT count(*) AS n FROM t").one().n).toBe(3);
      });
      await expectAllReset(references);
    });

    test(`throw after abort() (${where})`, async () => {
      using dir = tempDir("durable-object-stale", {});
      const { ns, stub, env } = open({ storage: files ? String(dir) : undefined });
      await using _ = ns;
      const references = await run(stub, collect);
      let inside: References | undefined;
      await expect(
        run(stub, async ctx => {
          inside = await collect(ctx);
          ctx.abort();
        }),
      ).rejects.toMatchObject(reset);
      expect(inside!.ctx).toBe(references.ctx);
      // Before the next call made a new instance, and after.
      await expectAllReset(references);
      await expectAllReset(inside!);
      await run(stub, ctx => {
        expect(ctx).not.toBe(references.ctx);
        expect(ctx.storage.kv.get("key")).toBe("value");
        expect(ctx.storage.sql.exec("SELECT count(*) AS n FROM t").one().n).toBe(6);
      });
      expect(env.made).toBe(2);
      await expectAllReset(references);
    });
  }

  test("throw after close()", async () => {
    const { ns, stub } = open();
    const references = await run(stub, collect);
    await ns.close();
    await expectAllReset(references);
  });
});

describe("storage in memory", () => {
  test("survives eviction for as long as the namespace", async () => {
    for (const storage of [undefined, ":memory:"]) {
      const { ns, stub, env } = open({ idleTimeout: 20, storage });
      await using _ = ns;
      const other = ns.getByName("other");
      await run(stub, async ctx => {
        await ctx.storage.put({ key: "value", object: { nested: new Set([1]) } });
        ctx.storage.sql.exec("CREATE TABLE t (a); INSERT INTO t VALUES (1), (2)");
      });
      await run(other, ctx => ctx.storage.kv.put("key", "other"));
      await evict(stub, env, 20);
      await evict(other, env, 20);
      await run(stub, async ctx => {
        expect([...(await ctx.storage.list())]).toEqual([
          ["key", "value"],
          ["object", { nested: new Set([1]) }],
        ]);
        expect(ctx.storage.sql.exec("SELECT a FROM t ORDER BY a").toArray()).toEqual([{ a: 1 }, { a: 2 }]);
        ctx.storage.kv.put("key", "changed");
      });
      await evict(stub, env, 20);
      expect(await run(stub, ctx => ctx.storage.kv.get("key"))).toBe("changed");
      expect(await run(other, ctx => ctx.storage.kv.get("key"))).toBe("other");
      // abort() does not lose what was committed either.
      await expect(run(stub, ctx => ctx.abort())).rejects.toMatchObject(reset);
      expect(await run(stub, ctx => ctx.storage.kv.get("key"))).toBe("changed");
    }
  });

  test("is each namespace's own", async () => {
    const first = open();
    const second = open();
    await using _1 = first.ns;
    await using _2 = second.ns;
    // The same class and name, so the same ids.
    expect(String(first.stub.id)).toBe(String(second.stub.id));
    await run(first.stub, ctx => {
      ctx.storage.kv.put("key", "first");
      ctx.storage.sql.exec("CREATE TABLE only_in_first (a)");
    });
    await run(second.stub, ctx => {
      expect(ctx.storage.kv.get("key")).toBeUndefined();
      expect(userSchema(ctx)).toEqual([]);
      ctx.storage.kv.put("key", "second");
    });
    expect(await run(first.stub, ctx => ctx.storage.kv.get("key"))).toBe("first");
    expect(await run(second.stub, ctx => ctx.storage.kv.get("key"))).toBe("second");
    // Objects of one namespace do not share either.
    expect(await run(first.ns.getByName("another"), ctx => [...ctx.storage.kv.list()])).toEqual([]);
    // It ends with the namespace.
    await first.ns.close();
    const third = open();
    await using _3 = third.ns;
    expect(await run(third.stub, ctx => ctx.storage.kv.get("key"))).toBeUndefined();
  });

  test("leaves no files", async () => {
    using dir = tempDir("durable-object-memory", {});
    const cwd = process.cwd();
    const { ns, stub } = open({ storage: ":memory:" });
    await run(stub, ctx => ctx.storage.kv.put("key", "value"));
    await ns.close();
    expect(readdirSync(String(dir))).toEqual([]);
    expect(existsSync(join(cwd, ":memory:"))).toBe(false);
  });
});

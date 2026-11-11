import { Database } from "bun:sqlite";
import { describe, expect, it, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

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

// https://github.com/oven-sh/bun/issues/3521
describe("property matchers leave the received value as it was", () => {
  // Every own property descriptor reachable from `roots`, as text: toEqual would accept a matcher that was left behind.
  function ownState(...roots: object[]) {
    const ids = new Map<object, number>();
    const queue: object[] = [];
    const show = (value: unknown) => {
      if (value === null || (typeof value !== "object" && typeof value !== "function")) return String(value);
      if (!ids.has(value)) {
        ids.set(value, ids.size);
        queue.push(value);
      }
      return `#${ids.get(value)}`;
    };
    roots.forEach(show);
    const lines: string[] = [];
    for (const object of queue) {
      const properties = Reflect.ownKeys(object).map(key => {
        const { value, get, set, ...flags } = Reflect.getOwnPropertyDescriptor(object, key)!;
        return `${String(key)} ${JSON.stringify(flags)} ${show(value)} ${show(get)} ${show(set)}`;
      });
      lines.push(
        [`#${ids.get(object)} frozen=${Object.isFrozen(object)} sealed=${Object.isSealed(object)}`, ...properties].join(
          "\n  ",
        ),
      );
    }
    return lines.join("\n");
  }

  const any = expect.any;
  class User {
    #id = 3;
    name = "alice";
    profile = { age: 30 };
    get id() {
      return this.#id;
    }
    get self() {
      return this.profile;
    }
  }
  class HttpError extends Error {
    status = 500;
  }
  class ApiError extends Error {
    #body = { text: "boom" };
    code = "E_FOO";
    get message() {
      return this.#body.text;
    }
  }
  class OwnGetterError extends Error {
    #body = { text: "boom" };
    code = "E_FOO";
    constructor() {
      super();
      Object.defineProperty(this, "message", {
        get(this: OwnGetterError) {
          return this.#body.text;
        },
      });
    }
  }
  const deepFreeze = <T extends object>(object: T): T => {
    Object.values(object).forEach(value => typeof value === "object" && deepFreeze(value));
    return Object.freeze(object);
  };
  const symbol = Symbol("key");

  const cases: Record<string, () => [received: any, matchers: any]> = {
    "objects, arrays and dates": () => [
      { id: 42, when: new Date(0), nested: { name: "abc" }, list: [1, "two", 3.5], rows: [{ id: 1 }, { id: 2 }] },
      {
        id: any(Number),
        when: any(Date),
        nested: { name: any(String) },
        list: [1, any(String), any(Number)],
        rows: [{ id: any(Number) }, { id: 2 }],
      },
    ],
    "a class instance": () => [new User(), { name: any(String) }],
    "a getter on the prototype": () => [new User(), { id: any(Number) }],
    "an object reached through a getter": () => [new User(), { self: { age: any(Number) } }],
    "an inherited property": () => [Object.create({ inherited: 1 }), { inherited: any(Number) }],
    "an own getter": () => [
      {
        a: 0,
        get id() {
          return 7;
        },
        z: 1,
      },
      { id: any(Number) },
    ],
    "an own getter and setter that cannot be redefined": () => [
      Object.defineProperty({ a: 0 }, "id", { get: () => 7, set() {}, enumerable: true }),
      { id: any(Number) },
    ],
    "a symbol key": () => [{ [symbol]: 1, a: 2 }, { [symbol]: any(Number) }],
    "a read-only and a hidden property": () => [
      Object.defineProperties(
        { a: 1 },
        { readOnly: { value: 5, enumerable: true }, hidden: { value: 6, writable: true, configurable: true } },
      ),
      { readOnly: any(Number), hidden: any(Number) },
    ],
    "a frozen object": () => [Object.freeze({ foo: "foo", bar: "bar" }), { bar: any(String) }],
    "a sealed object": () => [Object.seal({ foo: "foo", bar: "bar" }), { bar: any(String) }],
    "a frozen tree": () => [
      deepFreeze({ id: "x", items: [{ id: 1 }, { id: 2 }] }),
      { id: any(String), items: [{ id: any(Number) }, { id: 2 }] },
    ],
    "a frozen instance with a getter on the prototype": () => [
      Object.freeze(new User()),
      { id: any(Number), name: any(String) },
    ],
    "an object that appears twice": () => {
      const shared = { x: 1, y: "s" };
      return [{ a: shared, b: shared, log: [{ shared }] }, { a: { x: any(Number) } }];
    },
    "cycles": () => {
      const inner: any = { id: 1 };
      const outer: any = { id: 2, inner };
      inner.parent = outer;
      outer.self = outer;
      return [outer, { id: any(Number), inner: { id: any(Number) } }];
    },
    "an array with a read-only element and an accessor element": () => {
      const array = [1, 2, 3];
      Object.defineProperty(array, 1, { get: () => 2, enumerable: true, configurable: true });
      Object.defineProperty(array, 2, { writable: false });
      return [array, [any(Number), any(Number), any(Number)]];
    },
    "a field of an Error": () => [Object.assign(new TypeError("boom"), { code: "E_FOO" }), { code: any(String) }],
    "the message of an Error": () => [new TypeError("boom"), { message: any(String) }],
    "the message of a frozen Error": () => [Object.freeze(new Error("boom")), { message: any(String) }],
    "the message of an Error in an object": () => [
      { error: new HttpError("boom", { cause: "why" }) },
      { error: { message: any(String), status: any(Number) } },
    ],
    "a field of an Error whose message is a getter that reads a private field": () => [
      new ApiError(),
      { code: any(String) },
    ],
    "a field of an Error whose message is an own getter that reads a private field": () => [
      new OwnGetterError(),
      { code: any(String) },
    ],
    "a matcher on the received side": () => [{ a: any(Number), b: 1 }, { a: 5 }],
  };

  test.each(Object.entries(cases))("%s", (_, make) => {
    const [received, matchers] = make();
    const before = ownState(received, matchers);
    expect(received).toMatchSnapshot(matchers);
    expect(ownState(received, matchers)).toBe(before);
  });

  test("inline snapshots", () => {
    const received = { id: 42, name: "abc" };
    expect(received).toMatchInlineSnapshot(
      { id: expect.any(Number) },
      `
      {
        "id": Any<Number>,
        "name": "abc",
      }
    `,
    );
    expect(received.id).toBe(42);
  });

  test("when they do not match", () => {
    const received = Object.freeze({ id: 42, name: "abc" });
    const matchers = { id: expect.any(Number), name: expect.any(Number) };
    const before = ownState(received, matchers);
    expect(() => expect(received).toMatchSnapshot(matchers)).toThrow("to match properties from received object");
    expect(ownState(received, matchers)).toBe(before);
  });
});

describe("a property matcher on the message of an Error", () => {
  test("is printed in place of the message, so the snapshot does not depend on it", () => {
    for (const message of ["ENOENT: no such file or directory, open '/tmp/a'", "ENOENT: open '/tmp/b'"]) {
      expect(new RangeError(message)).toMatchInlineSnapshot(
        { message: expect.any(String) },
        `[RangeError: [object ExpectAny]]`,
      );
      expect({ errors: [new Error(message)] }).toMatchInlineSnapshot(
        { errors: [{ message: expect.stringContaining("ENOENT") }] },
        `
        {
          "errors": [
            [Error: [object ExpectStringContaining]],
          ],
        }
      `,
      );
    }
  });

  test("does not ask the Error for its stack", () => {
    class AppError extends Error {
      constructor(message: string) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
      }
    }
    const errors = [new Error("boom"), new AppError("boom")];
    const prepared: unknown[] = [];
    const prepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = error => {
      prepared.push(error);
      return "prepared";
    };
    let preparedBySnapshots: unknown[];
    let stacks: unknown[];
    try {
      expect({ errors }).toMatchInlineSnapshot(
        { errors: [{ message: expect.any(String) }, { message: expect.any(String) }] },
        `
        {
          "errors": [
            [Error: [object ExpectAny]],
            [AppError: [object ExpectAny]],
          ],
        }
      `,
      );
      preparedBySnapshots = [...prepared];
      stacks = errors.map(error => error.stack);
    } finally {
      Error.prepareStackTrace = prepareStackTrace;
    }
    expect(preparedBySnapshots).toEqual([]);
    expect(stacks).toEqual(["prepared", "prepared"]);
    expect(prepared[0]).toBe(errors[0]);
    expect(prepared[1]).toBe(errors[1]);
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

// The text stored for these is what Bun 1.4.2 stored, unless a comment says otherwise.
describe("property matchers", () => {
  test("on a class whose Symbol.toStringTag getter reads a private field", () => {
    class Tagged {
      #name = "T";
      a = 1;
      b = 2;
      get [Symbol.toStringTag]() {
        return this.#name;
      }
    }
    const received = new Tagged();
    expect(received).toMatchSnapshot({ a: expect.any(Number) });
    expect({ n: 1, tagged: received }).toMatchInlineSnapshot(
      { tagged: { a: expect.any(Number) } },
      `
      {
        "n": 1,
        "tagged": T Tagged {
          "a": Any<Number>,
          "b": 2,
        },
      }
    `,
    );
    expect(received.a).toBe(1);
  });

  // Bun 1.4.2 stored [Function: GeneratorFunction] for `iterate`, which was a generator function in that version.
  test("on a bun:sqlite Statement", () => {
    using db = new Database(":memory:");
    const statement = db.query("select 1 as a");
    expect(statement).toMatchSnapshot({ columnNames: expect.any(Array) });
    expect({ statement }).toMatchInlineSnapshot(
      { statement: { columnNames: expect.any(Array) } },
      `
      {
        "statement": "select 1 as a" Statement {
          "all": [Function: #allNoArgs],
          "columnNames": Any<Array>,
          "get": [Function: #getNoArgs],
          "iterate": [Function: #iterateNoArgs],
          "raw": [Function: #rawNoArgs],
          "run": [Function: #runNoArgs],
          "values": [Function: #valuesNoArgs],
        },
      }
    `,
    );
    expect(Object.hasOwn(statement, "columnNames")).toBe(false);
  });

  // Not the text of Bun 1.4.2, which stored [native code] for a getter and wrote the matchers into the received object.
  test("a getter runs on the received object, which stays as it is", () => {
    const number = expect.any(Number);
    const matchers = Object.freeze({ a: number });
    const receivers: unknown[] = [];
    const received = Object.freeze({
      a: 1,
      get total() {
        receivers.push(this);
        return this.a + 1;
      },
    });
    expect(received).toMatchSnapshot(matchers);
    expect(receivers.map(receiver => receiver === received)).toEqual([true]);
    expect(received.a).toBe(1);
    expect(matchers.a).toBe(number);

    const list = [1, 0, 3];
    Object.defineProperty(list, 1, {
      get() {
        return this[0] + 1;
      },
    });
    expect({ list: Object.freeze(list) }).toMatchSnapshot({ list: [number, 2, number] });
    expect(list[0]).toBe(1);
  });

  test("on a tree whose children link back to the root", () => {
    // The ids are new in every run, so a stored text with an id in it would not match a second time.
    const tree = (count: number, link: (root: object) => object) => {
      const root = { name: "root", children: [] as object[] };
      for (let i = 0; i < count; i++) root.children.push({ id: Math.random(), ...link(root) });
      return root;
    };
    const direct = (parent: object) => ({ parent });
    // The property matchers do not name `meta`.
    const throughMeta = (parent: object) => ({ meta: { parent } });
    const matchers = (count: number) => ({
      children: Array.from({ length: count }, () => ({ id: expect.any(Number) })),
    });
    expect(tree(2, direct)).toMatchSnapshot(matchers(2));
    expect(tree(2, throughMeta)).toMatchSnapshot(matchers(2));

    // A child is printed once, so twice the children are twice the lines.
    const printed = (count: number, link: string) =>
      `\n{\n  "children": [\n` +
      Array.from({ length: count }, () => `    {\n      "id": Any<Number>,\n${link}    },\n`).join("") +
      `  ],\n  "name": "root",\n}\n`;
    for (const count of [8, 16]) {
      expect(tree(count, direct)).toMatchInlineSnapshot(
        matchers(count),
        printed(count, `      "parent": [Circular],\n`),
      );
      expect(tree(count, throughMeta)).toMatchInlineSnapshot(
        matchers(count),
        printed(count, `      "meta": {\n        "parent": [Circular],\n      },\n`),
      );
    }
  });

  test("on a Headers or a FormData with a property of its own", () => {
    const headers = Object.assign(new Headers(), { id: "v1" });
    expect(headers).toMatchSnapshot({ id: expect.any(String) });
    expect(headers.id).toBe("v1");
    // A FormData prints as its entries, so the property is not in the text.
    const form = Object.assign(new FormData(), { id: "v1" });
    form.append("a", "1");
    expect(form).toMatchSnapshot({ id: expect.any(String) });
  });

  test("on a URL", () => {
    const url = new URL("http://example.com/a");
    expect(url).toMatchSnapshot({ href: expect.any(String) });
    expect({ n: 1, u: url }).toMatchSnapshot({ u: { href: expect.any(String) } });
    expect(Object.hasOwn(url, "href")).toBe(false);
  });

  test("on an Event", () => {
    expect(new Event("x")).toMatchSnapshot({ timeStamp: expect.any(Number) });
  });

  test("on a CryptoHasher", () => {
    expect(new Bun.CryptoHasher("sha1")).toMatchSnapshot({ algorithm: expect.any(String) });
  });

  test("on a MessageEvent", () => {
    expect(new MessageEvent("message", { data: "x" })).toMatchSnapshot({ data: expect.any(String) });
    expect(new MessageEvent("message", { data: { id: 1, k: 2 } })).toMatchSnapshot({
      data: { id: expect.any(Number) },
    });
    // The lines of the event go by its real type, also where a matcher matched the type.
    expect(new MessageEvent("message", { data: "x" })).toMatchSnapshot({ type: expect.any(String) });
  });

  test("on an ErrorEvent", () => {
    const event = () => new ErrorEvent("error", { message: "m", error: new Error("e") });
    expect(event()).toMatchSnapshot({ error: expect.any(Error) });
    // The matcher that the message matched is in its place.
    expect(event()).toMatchSnapshot({ message: expect.any(String), error: expect.any(Error) });
  });

  test("the rows that a call leaves are memory that the collector counts", async () => {
    using dir = tempDir("snapshot-matched-rows-memory", {
      "rows.test.ts": `
        import { heapStats } from "bun:jsc";
        import { expect, test } from "bun:test";

        test("rows", () => {
          // A Date prints as one line, so a call is little more than the 1,000 rows that it leaves: 32 KB.
          const names = Array.from({ length: 1000 }, (_, i) => "k" + i);
          const received = Object.assign(new Date(0), Object.fromEntries(names.map((name, i) => [name, i])));
          const matchers = Object.fromEntries(names.map(name => [name, expect.any(Number)]));
          const live = [];
          for (let call = 1; call <= 40; call++) {
            expect(received).toMatchInlineSnapshot(matchers, \`1970-01-01T00:00:00.000Z\`);
            if (call % 8 === 0) live.push(heapStats().objectTypeCounts.JestMatchedRows ?? 0);
          }
          console.log(JSON.stringify(live));
        });
      `,
    });
    // The collector runs after every 128 KB that it counts, which is four calls. Each run is a full one that ends before the next call.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "rows.test.ts"],
      env: {
        ...bunEnv,
        BUN_JSC_gcMaxHeapSize: String(128 * 1024),
        BUN_JSC_useGenerationalGC: "0",
        BUN_JSC_useConcurrentGC: "0",
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const printed = stdout.trim().split("\n").at(-1) ?? "";
    const live: number[] = printed.startsWith("[") ? JSON.parse(printed) : [];
    expect({ samples: live.length, stderr: live.length === 5 ? "" : stderr }).toEqual({ samples: 5, stderr: "" });
    // Rows that the collector does not count leave 8, 16, 24, 32 and 40 cells, less what one collection frees.
    expect(live.filter(cells => cells >= 10)).toEqual([]);
    // The cell of a call stays until the next collection. If no sample has one, no rows were made and the counts say nothing.
    expect(live.some(cells => cells >= 1)).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("a collection counts the rows of a call that is not over", async () => {
    using dir = tempDir("snapshot-matched-rows-visited", {
      "rows.test.ts": `
        import { heapStats } from "bun:jsc";
        import { expect, test } from "bun:test";

        // Bun offers the value to the serializer while the call has its rows. The serializer collects, and reads what the collector counted.
        let counted = 0;
        expect.addSnapshotSerializer({
          test() {
            Bun.gc(true);
            counted = heapStats().extraMemorySize;
            return false;
          },
          serialize: () => "",
        });
        test("rows", () => {
          const names = Array.from({ length: 4000 }, (_, i) => "k" + i);
          const received = Object.assign(new Date(0), Object.fromEntries(names.map((name, i) => [name, i])));
          const number = expect.any(Number);
          const all = Object.fromEntries(names.map(name => [name, number]));
          const countedWith = matchers => {
            expect(received).toMatchInlineSnapshot(matchers, \`1970-01-01T00:00:00.000Z\`);
            return counted;
          };
          const grown = [1, 2, 3].map(() => -countedWith({ k0: number }) + countedWith(all));
          console.log(JSON.stringify(grown));
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "rows.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const printed = stdout.trim().split("\n").at(-1) ?? "";
    const grown: number[] = printed.startsWith("[") ? JSON.parse(printed) : [];
    expect({ samples: grown.length, stderr: grown.length === 3 ? "" : stderr }).toEqual({ samples: 3, stderr: "" });
    // 3,999 more rows are 127,968 more bytes. Without them the count moves by a few hundred bytes.
    expect(grown.filter(bytes => bytes < 64_000)).toEqual([]);
    expect(exitCode).toBe(0);
  });
});

/** Runs `bun test` in `cwd`, where each test file writes or reads its own snapshot file. */
async function runTests(cwd: string, env: Record<string, string>, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, ...env },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const count = (what: string) => Number(stderr.match(new RegExp(`^ *(\\d+) ${what}$`, "m"))?.[1] ?? 0);
  return { stderr, exitCode, pass: count("pass"), fail: count("fail") };
}
const headers = { bun: "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n" };
const snap = (dir: unknown, name = "a.test.js") =>
  readFileSync(join(String(dir), "__snapshots__", name + ".snap"), "utf8");

describe.concurrent("a snapshot serializer, for a value with property matchers", () => {
  const money = `
    class Money {
      constructor(amount, currency) {
        this.amount = amount;
        this.currency = currency;
      }
    }
  `;
  const moneySerializer = `{ test: value => value instanceof Money, serialize: value => value.amount + " " + value.currency }`;

  test("is offered a plain object that has the property matchers in place of the values they matched", async () => {
    const printed = [
      `serialize(Any<Number>)`,
      `\n{\n  "in": serialize(Any<Number>),\n}\n`,
      `print(Any<Number>)`,
      `\n{\n  "in": print(Any<Number>),\n}\n`,
      `T \nTagged {\n  "a": Any<Number>,\n  "by": "nobody",\n}\n`,
      `\n{\n  "in": T Tagged {\n    "a": Any<Number>,\n    "by": "nobody",\n  },\n}\n`,
      `\nBox({\n  "a": Any<Number>,\n  "by": "nobody",\n})\n`,
      `Claimed(z=1, m=2, b=3, id=Any<Number>, Symbol(k)=Any<Number>)`,
      `Claimed(id=Any<Number>)`,
      `\nClaimed(list=[\n  Any<Number>,\n  2,\n])\n`,
      `Claimed(0=Any<Number>, 1=2, length=3)`,
      `Claimed(at=1970-01-01T00:00:00.000Z, id=Any<Number>)`,
      `\nClaimed(list=[\n  ObjectContaining {\n    "sku": "x",\n  },\n])\n`,
      `Claimed(fn=[Function])`,
      `Claimed(second=Any<Number>, first=Any<Number>)`,
      `Claimed(id=Any<Number>)`,
    ];
    // With a serializer that is for no value, Bun prints what it prints without one.
    const unclaimed = [
      `\n{\n  "boom": [native code],\n  "id": Any<Number>,\n  "in": {\n    "boom": [native code],\n    "id": Any<Number>,\n  },\n}\n`,
      `\n{\n  "id": Any<Number>,\n  "self": [Circular],\n}\n`,
      `\n{\n  "id": Any<Number>,\n  "user": {\n    "login": "u",\n    "self": [Circular],\n  },\n}\n`,
      `\n{\n  "id": Any<Number>,\n  "in": {\n    "id": Any<Number>,\n    "in": {\n      "id": Any<Number>,\n      "read": 0,\n    },\n    "read": 0,\n  },\n  "read": 0,\n}\n`,
    ];
    using dir = tempDir("snapshot-serializer-matchers", {
      "a.test.js": `
          // Only an instance has #name, so the getter throws a TypeError for any other object that has the prototype.
          class Tagged {
            #name = "T";
            constructor(a, by) {
              this.a = a;
              this.by = by;
            }
            get [Symbol.toStringTag]() {
              return this.#name;
            }
          }
          const number = expect.any(Number);
          expect.addSnapshotSerializer({
            test: value => value?.by === "serialize",
            serialize: (value, config, indentation, depth, refs, printer) =>
              "serialize(" + printer(value.a, config, indentation, depth, refs) + ")",
          });
          expect.addSnapshotSerializer({
            test: value => value?.by === "print",
            print: (value, print) => "print(" + print(value.a) + ")",
          });
          expect.addSnapshotSerializer({
            test: value => value?.box !== undefined,
            print: (value, print) => "Box(" + print(value.box) + ")",
          });
          // Prints the keys of what it is offered in the order that they have there.
          expect.addSnapshotSerializer({
            test: value => value?.claimed === true,
            print: (value, print) => {
              const keys = Reflect.ownKeys(value).filter(key => key !== "claimed");
              return "Claimed(" + keys.map(key => String(key) + "=" + print(value[key])).join(", ") + ")";
            },
          });
          const symbol = Symbol("k");
          const offered = [];
          expect.addSnapshotSerializer({
            test(value) {
              if (value?.by) {
                const isPlain = Object.getPrototypeOf(value) === Object.prototype;
                offered.push({ isPlain, a: value.a === number ? "the matcher" : value.a });
              }
              return false;
            },
            serialize: () => "",
          });
          test("t", () => {
            for (const a of [1, 2]) {
              for (const by of ["serialize", "print", "nobody"]) {
                expect(new Tagged(a, by)).toMatchSnapshot({ a: number });
                expect({ in: new Tagged(a, by) }).toMatchSnapshot({ in: { a: number } });
              }
              expect({ box: new Tagged(a, "nobody") }).toMatchSnapshot({ box: { a: number } });
              // Its own keys are in their order, and the one that is a symbol has its matcher too.
              expect({ z: 1, claimed: true, m: 2, b: 3, [symbol]: a, id: a }).toMatchSnapshot({ [symbol]: number, id: number });
              // A matcher that the property matchers inherit.
              expect({ claimed: true, id: a }).toMatchSnapshot(Object.create({ id: number }));
              // An array that is compared with an object.
              expect({ claimed: true, list: [a, 2] }).toMatchSnapshot({ list: { 0: number } });
              // An array is offered as an array, which has the length of the value and so the hole at its end.
              expect(Object.assign([a, 2], { claimed: true, length: 3 })).toMatchSnapshot({ 0: number, length: number });
              // A Date among the property matchers is no matcher, so the Date of the value stays.
              expect({ claimed: true, at: new Date(0), id: a }).toMatchSnapshot({ at: new Date(0), id: number });
              // The matcher is there in place of the element that it matched.
              expect({ claimed: true, list: [{ sku: "x", amount: a }] }).toMatchSnapshot({ list: [expect.objectContaining({ sku: "x" })] });
              // A function is offered as it is.
              expect({ claimed: true, fn: Object.assign(() => {}, { id: a }) }).toMatchSnapshot({ fn: { id: number } });
              // What matched in the prototype comes after the own keys, in the order of the property matchers.
              expect({ claimed: true, __proto__: { get second() { return a; }, get first() { return a; } } }).toMatchSnapshot({ second: number, first: number });
              // A getter that throws leaves its property out.
              expect({ claimed: true, id: a, get boom() { throw new Error("boom"); } }).toMatchSnapshot({ id: number });
            }
            expect(new Tagged(3, "print")).toMatchInlineSnapshot({ a: number }, \`print(Any<Number>)\`);
            expect(offered).toEqual(Array(15).fill({ isPlain: true, a: "the matcher" }));
          });
        `,
      "b.test.js": `
          expect.addSnapshotSerializer({ test: () => false, serialize: () => "" });
          test("t", () => {
            const number = expect.any(Number);
            expect({
              id: 1,
              get boom() {
                throw new Error("boom");
              },
              in: {
                id: 2,
                get boom() {
                  throw new Error("boom");
                },
              },
            }).toMatchSnapshot({ id: number, in: { id: number } });

            const cycle = { id: 1 };
            cycle.self = cycle;
            const cyclicMatchers = { id: number };
            cyclicMatchers.self = cyclicMatchers;
            expect(cycle).toMatchSnapshot(cyclicMatchers);
            const user = { login: "u" };
            user.self = user;
            expect({ user, id: 1 }).toMatchSnapshot({ user, id: number });

            let reads = 0;
            const counted = (count, inside) => ({
              id: count,
              get read() {
                reads += count;
                return 0;
              },
              ...inside,
            });
            expect(counted(1, { in: counted(100, { in: counted(10000) }) })).toMatchSnapshot({
              id: number,
              in: { id: number, in: { id: number } },
            });
            // Each getter runs once for the object that the serializer is offered and once for the text, however deep it is.
            expect(reads).toBe(20202);
          });
        `,
    });
    const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "false" });
    expect({ pass, stderr: pass === 2 ? "" : stderr }).toEqual({ pass: 2, stderr: "" });
    // Each text is there twice, once for each value that the matcher matched.
    expect(snap(dir)).toBe(
      headers.bun + [...printed, ...printed].map((text, i) => `\nexports[\`t ${i + 1}\`] = \`${text}\`;\n`).join(""),
    );
    expect(snap(dir, "b.test.js")).toBe(
      headers.bun + unclaimed.map((text, i) => `\nexports[\`t ${i + 1}\`] = \`${text}\`;\n`).join(""),
    );
    expect(exitCode).toBe(0);
  });

  test("is offered a Response, a Map or a URL itself when a property matcher matched inside it", async () => {
    const printed = [
      `\n{\n  "response": Response<ok=true>,\n}\n`,
      `\n{\n  "id": Any<Number>,\n  "map": Map<a,b>,\n}\n`,
      `\n{\n  "url": URL<example.com>,\n}\n`,
      `URL<example.com>`,
      `\n{\n  "failure": Failure<failed>,\n}\n`,
    ];
    const written = headers.bun + printed.map((text, i) => `\nexports[\`t ${i + 1}\`] = \`${text}\`;\n`).join("");
    using dir = tempDir("snapshot-serializer-instance", {
      "a.test.js": `
          expect.addSnapshotSerializer({
            test: value => value instanceof Response,
            serialize: value => "Response<ok=" + value.ok + ">",
          });
          expect.addSnapshotSerializer({
            test: value => value instanceof Map,
            serialize: value => "Map<" + [...value.keys()].sort().join() + ">",
          });
          expect.addSnapshotSerializer({
            test: value => value instanceof URL,
            serialize: value => "URL<" + value.host + ">",
          });
          class Failure extends Error {
            constructor(status) {
              super("failed");
              this.status = status;
            }
          }
          expect.addSnapshotSerializer({
            test: value => value instanceof Failure,
            serialize: value => "Failure<" + value.message + ">",
          });
          // What the matchers match is another value in each run.
          const run = Number(process.env.RUN);
          test("t", () => {
            const number = expect.any(Number);
            const string = expect.any(String);
            expect({ response: new Response("x", { status: 200 + run }) }).toMatchSnapshot({ response: { status: number } });
            expect({ id: run, map: new Map([["a", run], ["b", run]]) }).toMatchSnapshot({ id: number, map: { size: number } });
            expect({ url: new URL("http://example.com/" + run) }).toMatchSnapshot({ url: { href: string } });
            expect(new URL("http://example.com/" + run)).toMatchSnapshot({ href: string });
            // So is an instance of a class that extends one of them.
            expect({ failure: new Failure(500 + run) }).toMatchSnapshot({ failure: { status: number } });
          });
        `,
    });
    const first = await runTests(String(dir), { CI: "false", RUN: "1" });
    expect({ pass: first.pass, stderr: first.pass ? "" : first.stderr }).toEqual({ pass: 1, stderr: "" });
    expect(snap(dir)).toBe(written);
    const second = await runTests(String(dir), { CI: "true", RUN: "2" });
    expect({ pass: second.pass, stderr: second.pass ? "" : second.stderr }).toEqual({ pass: 1, stderr: "" });
    expect(snap(dir)).toBe(written);
    expect([first.exitCode, second.exitCode]).toEqual([0, 0]);
  });

  test("is offered a plain object or array for an instance of a class that has a matched property, so a test of its class is not for it", async () => {
    const printed = [
      `\nMoney {\n  "amount": Any<Number>,\n  "currency": "EUR",\n}\n`,
      `\n{\n  "price": Money {\n    "amount": Any<Number>,\n    "currency": "EUR",\n  },\n  "tax": 1 EUR,\n}\n`,
      `\n{\n  "list": [\n    Any<Number>,\n    2,\n  ],\n  "rest": List<1>,\n}\n`,
    ];
    using dir = tempDir("snapshot-serializer-class", {
      "a.test.js": `
          ${money}
          class List extends Array {}
          expect.addSnapshotSerializer(${moneySerializer});
          expect.addSnapshotSerializer({
            test: value => value instanceof List,
            serialize: value => "List<" + value.length + ">",
          });
          // Is asked first and is for no value. It keeps the class of what stands for each Money and List.
          const offered = [];
          expect.addSnapshotSerializer({
            test(value) {
              if (value?.currency || Array.isArray(value)) offered.push(value.constructor.name);
              return false;
            },
            serialize: () => "",
          });
          test("t", () => {
            const number = expect.any(Number);
            expect(new Money(5, "EUR")).toMatchSnapshot({ amount: number });
            // The tax and the rest have no matched property, so they are offered as they are.
            expect({ price: new Money(5, "EUR"), tax: new Money(1, "EUR") }).toMatchSnapshot({ price: { amount: number } });
            expect({ list: List.of(5, 2), rest: List.of(1) }).toMatchSnapshot({ list: [number, 2] });
            expect(offered).toEqual(["Object", "Object", "Money", "Array", "List"]);
          });
        `,
    });
    const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "false" });
    expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
    expect(snap(dir)).toBe(
      headers.bun + printed.map((text, i) => `\nexports[\`t ${i + 1}\`] = \`${text}\`;\n`).join(""),
    );
    expect(exitCode).toBe(0);
  });

  test("keeps what the rows hold, and what stands for an object, while a serializer collects garbage", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `  "row${String(i).padStart(2, "0")}": Any<Number>,\n`);
    using dir = tempDir("snapshot-serializer-gc", {
      "a.test.js": `
          // Bun offers each value to the serializer before it prints the value. The serializer collects garbage,
          // and then makes matchers and objects that take the cells which the collection freed.
          let collections = 0;
          expect.addSnapshotSerializer({
            test(value) {
              Bun.gc(true);
              collections++;
              Array.from({ length: 64 }, () => [expect.any(Boolean), new Object(), { id: "other", leaf: false }]);
              return value?.leaf === true;
            },
            serialize: (value, config, indentation, depth, refs, printer) =>
              "Leaf(" + printer(value.id, config, indentation, depth, refs) + ")",
          });
          test("t", () => {
            const names = Array.from({ length: 40 }, (_, i) => "row" + String(i).padStart(2, "0"));
            const received = {};
            const matchers = {};
            // Each read gives a new matcher or object, so only the rows hold what the comparison read.
            for (const [i, name] of names.entries()) {
              received[name] = i;
              Object.defineProperty(matchers, name, { enumerable: true, get: () => expect.any(Number) });
            }
            for (const name of ["first", "second", "third"]) {
              Object.defineProperty(received, name, { enumerable: true, get: () => ({ id: 1, leaf: true }) });
              Object.defineProperty(matchers, name, { enumerable: true, get: () => ({ id: expect.any(Number) }) });
            }
            // The serializer gets a URL as it is, so nothing but a row holds the matcher of its href.
            Object.defineProperty(received, "link", { enumerable: true, get: () => new URL("http://example.com/a") });
            Object.defineProperty(matchers, "link", { enumerable: true, get: () => ({ href: expect.any(String) }) });
            expect(received).toMatchSnapshot(matchers);
            expect(collections).toBeGreaterThan(names.length);
          });
        `,
    });
    const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "false" });
    expect({ pass, stderr: pass ? "" : stderr }).toEqual({ pass: 1, stderr: "" });
    // The serializer is for what stands for each of the three objects, and a matcher is in each row.
    expect(snap(dir)).toBe(
      headers.bun +
        `\nexports[\`t 1\`] = \`\n{\n  "first": Leaf(Any<Number>),\n  "link": URL URL {\n    "href": Any<String>,\n  },\n` +
        rows.join("") +
        `  "second": Leaf(Any<Number>),\n  "third": Leaf(Any<Number>),\n}\n\`;\n`,
    );
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("a snapshot with property matchers that an older Bun wrote", () => {
  test("passes when it is what an older Bun wrote where the property matchers became properties of the object", async () => {
    // Bun 1.4.2 wrote these. To add one, run its test under that version.
    const printed = {
      "Headers": `Headers \nHeaders {\n  "id": Any<String>,\n}\n`,
      "Event": `Event \nEvent {\n  "isTrusted": false,\n  "timeStamp": Any<Number>,\n}\n`,
      "URL": `URL \nURL {\n  "href": Any<String>,\n}\n`,
      "CryptoHasher": `CryptoHasher \nCryptoHasher {\n  "algorithm": Any<String>,\n}\n`,
      "URL in an object": `\n{\n  "n": 1,\n  "u": URL URL {\n    "href": Any<String>,\n  },\n}\n`,
      "MessageEvent": `MessageEvent {\n  type: "message",\n  data: Any<String>, \n}`,
      "object in a MessageEvent": `MessageEvent {\n  type: "message",\n  data: {\n    "id": Any<Number>,\n    "k": 2,\n  }, \n}`,
      "type of a MessageEvent": `MessageEvent \nMessageEvent {\n  "isTrusted": false,\n  "type": Any<String>,\n}\n`,
      "ErrorEvent": `ErrorEvent {\n  type: "error",\n  error: Any<Error>\n}`,
      "class with a private tag": `T \nTagged {\n  "a": Any<Number>,\n  "b": 2,\n}\n`,
      "own getter": `\n{\n  "a": Any<Number>,\n  "total": [native code],\n}\n`,
      // A matcher of the object, and one in an object that a getter returns. That version printed no line for the getter of a class.
      "CustomEvent and its detail": `CustomEvent \nCustomEvent {\n  "isTrusted": false,\n  "timeStamp": Any<Number>,\n}\n`,
      "URL and its searchParams": `URL \nURL {\n  "href": Any<String>,\n}\n`,
      "object from a getter of the class": `\nPost {\n  "id": Any<Number>,\n  "title": "t",\n}\n`,
      "object from an own getter": `\n{\n  "author": [native code],\n  "id": Any<Number>,\n}\n`,
      // In each of these, that version printed something that Bun prints another way now, so the text is not what a new snapshot gets.
      "array element": `\n{\n  "g": [native code],\n  "list": [\n    Any<Number>,\n    "two",\n    {\n      "id": Any<Number>,\n    },\n  ],\n}\n`,
      "nested object": `\n{\n  "g": [native code],\n  "inner": {\n    "deep": {\n      "id": Any<Number>,\n      "k": "k",\n    },\n    "id": Any<Number>,\n  },\n}\n`,
      "root array": `\n[\n  {\n    "g": [native code],\n    "id": Any<Number>,\n  },\n  2,\n]\n`,
      "symbol key": `\n{\n  "a": 2,\n  "g": [native code],\n  [Symbol(key)]: Any<Number>,\n}\n`,
      "getter of a class": `\nUser {\n  "hidden": "h",\n  "id": Any<Number>,\n  "name": "n",\n}\n`,
      "React 19 element": `\n{\n  "$$typeof": Symbol(react.transitional.element),\n  "_owner": null,\n  "_store": {},\n  "key": null,\n  "props": {\n    "children": {\n      "$$typeof": Symbol(react.transitional.element),\n      "_owner": null,\n      "_store": {},\n      "key": null,\n      "props": {\n        "id": Any<String>,\n      },\n      "type": "b",\n    },\n    "id": Any<String>,\n  },\n  "type": "div",\n}\n`,
      "DOM-like class": `\n{\n  "node": HTMLDivElement {\n    "attributes": [],\n    "childNodes": [],\n    "id": Any<String>,\n    "nodeType": 1,\n    "tagName": "DIV",\n  },\n}\n`,
      "property that is not enumerable": `\n{\n  "hidden": "h",\n  "id": Any<Number>,\n}\n`,
      "same object with the same matchers twice": `\n{\n  "a": {\n    "g": [native code],\n    "id": Any<Number>,\n  },\n  "b": {\n    "g": [native code],\n    "id": Any<Number>,\n  },\n}\n`,
      // Neither object keeps the property named by an integer in the vector of its elements.
      "frozen object keyed by integers": `\n{\n  "7": {\n    "g": [native code],\n    "id": Any<Number>,\n  },\n  "8": {\n    "g": [native code],\n    "id": 2,\n  },\n}\n`,
      "object keyed by a large integer": `\n{\n  "123456": {\n    "g": [native code],\n    "id": Any<Number>,\n  },\n}\n`,
    };
    const older =
      headers.bun +
      Object.entries(printed)
        .map(([name, text]) => `\nexports[\`${name} 1\`] = \`${text}\`;\n`)
        .join("");
    using dir = tempDir("snapshot-older-bun-matchers", {
      "a.test.js": `
          class Tagged {
            #name = "T";
            a = 1;
            b = 2;
            get [Symbol.toStringTag]() {
              return this.#name;
            }
          }
          class Author {
            id = 9;
            name = "a";
          }
          class Post {
            id = 1;
            title = "t";
            get author() {
              return new Author();
            }
          }
          const string = expect.any(String);
          const number = expect.any(Number);
          const withGetter = () => ({ a: 1, get total() { return this.a + 1; } });
          test("Headers", () => { expect(Object.assign(new Headers(), { id: "v1" })).toMatchSnapshot({ id: string }); });
          test("Event", () => { expect(new Event("x")).toMatchSnapshot({ timeStamp: number }); });
          test("URL", () => { expect(new URL("http://example.com/a")).toMatchSnapshot({ href: string }); });
          test("CryptoHasher", () => { expect(new Bun.CryptoHasher("sha1")).toMatchSnapshot({ algorithm: string }); });
          test("URL in an object", () => { expect({ u: new URL("http://example.com/a"), n: 1 }).toMatchSnapshot({ u: { href: string } }); });
          test("MessageEvent", () => { expect(new MessageEvent("message", { data: "x" })).toMatchSnapshot({ data: string }); });
          test("object in a MessageEvent", () => { expect(new MessageEvent("message", { data: { id: 1, k: 2 } })).toMatchSnapshot({ data: { id: number } }); });
          test("type of a MessageEvent", () => { expect(new MessageEvent("message", { data: "x" })).toMatchSnapshot({ type: string }); });
          test("ErrorEvent", () => { expect(new ErrorEvent("error", { message: "m", error: new Error("e") })).toMatchSnapshot({ message: string, error: expect.any(Error) }); });
          test("class with a private tag", () => { expect(new Tagged()).toMatchSnapshot({ a: number }); });
          test("own getter", () => {
            expect(withGetter()).toMatchSnapshot({ a: number });
            expect(withGetter()).toMatchInlineSnapshot({ a: number }, \`${printed["own getter"]}\`);
          });
          test("CustomEvent and its detail", () => { expect(new CustomEvent("x", { detail: { id: 1, k: 2 } })).toMatchSnapshot({ timeStamp: number, detail: { id: number } }); });
          test("URL and its searchParams", () => { expect(new URL("http://example.com/a?b=1")).toMatchSnapshot({ href: string, searchParams: { size: number } }); });
          test("object from a getter of the class", () => { expect(new Post()).toMatchSnapshot({ id: number, author: { id: number } }); });
          test("object from an own getter", () => { expect({ id: 1, get author() { return new Author(); } }).toMatchSnapshot({ id: number, author: { id: number } }); });
          const andGetter = fields => ({ ...fields, get g() { return 1; } });
          test("array element", () => { expect(andGetter({ list: [1, "two", { id: 3 }] })).toMatchSnapshot({ list: [number, "two", { id: number }] }); });
          test("nested object", () => { expect(andGetter({ inner: { id: 1, deep: { id: 2, k: "k" } } })).toMatchSnapshot({ inner: { id: number, deep: { id: number } } }); });
          test("root array", () => { expect([andGetter({ id: 1 }), 2]).toMatchSnapshot([{ id: number }, 2]); });
          test("symbol key", () => {
            const key = Symbol("key");
            expect(andGetter({ [key]: 1, a: 2 })).toMatchSnapshot({ [key]: number });
          });
          test("getter of a class", () => {
            class User {
              name = "n";
              constructor() {
                Object.defineProperty(this, "hidden", { value: "h" });
              }
              get id() {
                return 3;
              }
            }
            expect(new User()).toMatchSnapshot({ id: number });
          });
          test("React 19 element", () => {
            const element = (type, props) => ({ $$typeof: Symbol.for("react.transitional.element"), type, key: null, props, _owner: null, _store: {} });
            expect(element("div", { id: "a1", children: element("b", { id: "c1" }) })).toMatchSnapshot({ props: { id: string, children: { props: { id: string } } } });
          });
          test("DOM-like class", () => {
            class HTMLDivElement {
              nodeType = 1;
              tagName = "DIV";
              attributes = [];
              childNodes = [];
              id = "a1";
            }
            expect({ node: new HTMLDivElement() }).toMatchSnapshot({ node: { id: string } });
          });
          test("property that is not enumerable", () => { expect(Object.defineProperty({ id: 1 }, "hidden", { value: "h" })).toMatchSnapshot({ id: number }); });
          test("same object with the same matchers twice", () => {
            const shared = andGetter({ id: 1 });
            const matchers = { id: number };
            expect({ a: shared, b: shared }).toMatchSnapshot({ a: matchers, b: matchers });
          });
          test("frozen object keyed by integers", () => { expect(Object.freeze({ 7: andGetter({ id: 1 }), 8: andGetter({ id: 2 }) })).toMatchSnapshot({ 7: { id: number } }); });
          test("object keyed by a large integer", () => { expect({ 123456: andGetter({ id: 1 }) }).toMatchSnapshot({ 123456: { id: number } }); });
        `,
      "__snapshots__/a.test.js.snap": older,
    });
    const { stderr, exitCode, pass } = await runTests(String(dir), { CI: "true" });
    const count = Object.keys(printed).length;
    expect({ pass, stderr: pass === count ? "" : stderr }).toEqual({ pass: count, stderr: "" });
    expect(readFileSync(join(String(dir), "__snapshots__", "a.test.js.snap"), "utf8")).toBe(older);
    expect(exitCode).toBe(0);
  });

  test("fails when it is what an older Bun wrote where a matcher changed how the object is named", async () => {
    // Bun 1.4.2 wrote the first text of each, with the matcher in the object. To add one, run its test under that version.
    // The second text is what Bun prints: the object names itself as it is, which is by the value that the matcher matched.
    const printed = {
      "own tag": [
        `\n{\n  [Symbol(Symbol.toStringTag)]: Any<String>,\n  "a": 1,\n}\n`,
        `Foo \nFoo {\n  [Symbol(Symbol.toStringTag)]: Any<String>,\n  "a": 1,\n}\n`,
      ],
      "own constructor": [`\n{\n  "a": 1,\n}\n`, `\nNamed {\n  "a": 1,\n}\n`],
      "tag that a getter makes from a matched property": [
        `Row[object ExpectAny] \nRow {\n  "id": Any<Number>,\n}\n`,
        `Row7 \nRow {\n  "id": Any<Number>,\n}\n`,
      ],
      "$$typeof of a React element": [
        `\n{\n  "$$typeof": Any<Symbol>,\n  "key": null,\n  "props": {\n    "id": "a",\n  },\n  "ref": null,\n  "type": "div",\n}\n`,
        `<div id="a" />`,
      ],
    };
    await failsUntilUpdated(
      "snapshot-older-bun-names",
      `
          class Named {}
          class Row {
            id = 7;
            get [Symbol.toStringTag]() {
              return "Row" + this.id;
            }
          }
          const string = expect.any(String);
          test("own tag", () => { expect({ [Symbol.toStringTag]: "Foo", a: 1 }).toMatchSnapshot({ [Symbol.toStringTag]: string }); });
          test("own constructor", () => { expect({ constructor: Named, a: 1 }).toMatchSnapshot({ constructor: expect.any(Function) }); });
          test("tag that a getter makes from a matched property", () => { expect(new Row()).toMatchSnapshot({ id: expect.any(Number) }); });
          test("$$typeof of a React element", () => {
            const element = { $$typeof: Symbol.for("react.element"), type: "div", key: null, ref: null, props: { id: "a" } };
            expect(element).toMatchSnapshot({ $$typeof: expect.any(Symbol) });
          });
        `,
      printed,
    );
  });

  test("fails when it is what an older Bun wrote where a matcher shows at a place that the property matchers do not name", async () => {
    // Bun 1.4.2 wrote the first text of each. It wrote a matcher into the object, so the matcher showed wherever the value holds that object.
    // It also compared only the first of two values that got one object of matchers. The second text is what Bun prints.
    await failsUntilUpdated(
      "snapshot-older-bun-places",
      `
          const number = expect.any(Number);
          test("object at a second place", () => {
            const shared = { id: 1 };
            expect({ a: shared, b: shared }).toMatchSnapshot({ a: { id: number } });
          });
          test("one object of matchers for two values", () => {
            const matchers = { id: number };
            expect({ items: [{ id: 1 }, { id: 2 }] }).toMatchSnapshot({ items: [matchers, matchers] });
          });
        `,
      {
        "object at a second place": [
          `\n{\n  "a": {\n    "id": Any<Number>,\n  },\n  "b": {\n    "id": Any<Number>,\n  },\n}\n`,
          `\n{\n  "a": {\n    "id": Any<Number>,\n  },\n  "b": {\n    "id": 1,\n  },\n}\n`,
        ],
        "one object of matchers for two values": [
          `\n{\n  "items": [\n    {\n      "id": Any<Number>,\n    },\n    {\n      "id": 2,\n    },\n  ],\n}\n`,
          `\n{\n  "items": [\n    {\n      "id": Any<Number>,\n    },\n    {\n      "id": Any<Number>,\n    },\n  ],\n}\n`,
        ],
      },
    );
  });
});

/** Runs the tests of `source` on the first text of each entry, which an older Bun wrote. They fail, and --update-snapshots then stores the second text. */
async function failsUntilUpdated(prefix: string, source: string, printed: Record<string, string[]>) {
  const file = (which: 0 | 1) =>
    headers.bun +
    Object.entries(printed)
      .map(([name, texts]) => `\nexports[\`${name} 1\`] = \`${texts[which]}\`;\n`)
      .join("");
  using dir = tempDir(prefix, { "a.test.js": source, "__snapshots__/a.test.js.snap": file(0) });
  const count = Object.keys(printed).length;
  const older = await runTests(String(dir), { CI: "true" });
  expect({ pass: older.pass, fail: older.fail, snap: snap(dir) }).toEqual({ pass: 0, fail: count, snap: file(0) });
  const updated = await runTests(String(dir), { CI: "false" }, "--update-snapshots");
  expect({ pass: updated.pass, stderr: updated.pass === count ? "" : updated.stderr }).toEqual({
    pass: count,
    stderr: "",
  });
  expect(snap(dir)).toBe(file(1));
  expect([older.exitCode, updated.exitCode]).toEqual([1, 0]);
}

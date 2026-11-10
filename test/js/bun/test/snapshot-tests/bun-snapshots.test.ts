import { Database } from "bun:sqlite";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
  });

  test("on an ErrorEvent", () => {
    const event = () => new ErrorEvent("error", { message: "m", error: new Error("e") });
    expect(event()).toMatchSnapshot({ error: expect.any(Error) });
    // `message` has a line only when it is a string, and here the matcher is in its place.
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

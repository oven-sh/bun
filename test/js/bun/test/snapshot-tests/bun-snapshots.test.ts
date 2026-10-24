import { describe, expect, it, test } from "bun:test";
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
describe("property matchers", () => {
  // Own keys, descriptors, prototype and extensibility of every object that
  // `root` reaches. Compared by identity, because toEqual would accept a
  // matcher that was written over the value it matched.
  function shapeOf(root: unknown) {
    const shapes = new Map<object, { slots: unknown[][]; extensible: boolean; prototype: unknown }>();
    const stack = [root];
    while (stack.length) {
      const value = stack.pop();
      if (value === null || (typeof value !== "object" && typeof value !== "function") || shapes.has(value)) continue;
      const slots = Reflect.ownKeys(value).map(key => {
        const d = Object.getOwnPropertyDescriptor(value, key)!;
        if (key !== "stack") stack.push(d.value);
        return [key, d.value, d.get, d.set, d.writable, d.enumerable, d.configurable];
      });
      shapes.set(value, { slots, extensible: Object.isExtensible(value), prototype: Object.getPrototypeOf(value) });
    }
    return shapes;
  }
  function changedKeys(before: ReturnType<typeof shapeOf>, root: unknown) {
    const after = shapeOf(root);
    const changed: string[] = [];
    for (const [object, was] of before) {
      const now = after.get(object);
      if (!now || now.extensible !== was.extensible || now.prototype !== was.prototype) changed.push("(object)");
      else if (now.slots.length !== was.slots.length) changed.push("(keys)");
      else
        for (let i = 0; i < was.slots.length; i++)
          if (was.slots[i].some((field, j) => !Object.is(field, now.slots[i][j])))
            changed.push(String(was.slots[i][0]));
    }
    return changed;
  }

  // Differs from run to run. A matcher that is not recorded puts it into the snapshot.
  const rnd = Math.floor(Math.random() * 1e9);
  const rstr = "s" + rnd;
  const any = expect.any;
  const user = () => ({ id: rnd, name: "ann" });
  const element = (type: string, props: object, key: string | null = null) => ({
    $$typeof: Symbol.for("react.element"),
    type,
    key,
    ref: null,
    props,
  });
  class User {
    id = rnd;
    name = "ann";
  }
  class Wrapper {
    constructor(public _user: unknown) {}
    get user() {
      return this._user;
    }
  }

  // [received, propertyMatchers, an object that no own property of them reaches]
  const cases: Record<string, () => [object, object, object?]> = {
    "plain object": () => [user(), { id: any(Number) }],
    "nested object": () => [{ a: { b: { c: user() } } }, { a: { b: { c: { id: any(Number) } } } }],
    "two matchers on one object": () => [
      { a: rnd, b: rstr, c: 1 },
      { a: any(Number), b: any(String) },
    ],
    "array element": () => [{ list: [1, rnd, 3] }, { list: [1, any(Number), 3] }],
    "array at the root": () => [
      [user(), user()],
      [{ id: any(Number) }, { id: any(Number) }],
    ],
    "nested arrays": () => [
      {
        m: [
          [rnd, 1],
          [rnd, 2],
        ],
      },
      {
        m: [
          [any(Number), 1],
          [any(Number), 2],
        ],
      },
    ],
    "sparse array": () => {
      const a: number[] = [];
      a[3] = rnd;
      return [{ a }, { a: { 3: any(Number) } }];
    },
    "class instance": () => [new User(), { id: any(Number) }],
    "class instance below a plain object": () => [{ u: new User() }, { u: { id: any(Number) } }],
    "null prototype": () => [Object.assign(Object.create(null), { id: rnd }), { id: any(Number) }],
    "symbol key": () => {
      const k = Symbol("k");
      return [{ [k]: rnd, a: 1 }, { [k]: any(Number) }];
    },
    "non-enumerable property": () => {
      const o = { a: 1 };
      Object.defineProperty(o, "id", { value: rnd, enumerable: false });
      return [o, { id: any(Number) }];
    },
    "inherited property": () => [Object.create({ id: rnd }), { id: any(Number) }],
    "frozen object": () => [
      Object.freeze({ id: rnd, f: Object.freeze({ id: rnd }) }),
      { id: any(Number), f: { id: any(Number) } },
    ],
    "own getter on another key": () => [
      {
        get ts() {
          return rnd;
        },
        id: rnd,
      },
      { id: any(Number) },
    ],
    "own getter with the matcher on its key": () => [
      {
        get ts() {
          return rnd;
        },
        id: 1,
      },
      { ts: any(Number) },
    ],
    "prototype getter with the matcher below it": () => [new Wrapper(user()), { user: { id: any(Number) } }],
    "prototype getter with the matcher on its key": () => [new Wrapper(7), { user: any(Number) }],
    "matcher on the received side": () => [{ a: any(String), k: 1 }, { a: "hello" }],
    "objectContaining": () => [{ u: user(), k: 1 }, { u: expect.objectContaining({ name: "ann" }) }],
    "stringMatching": () => [{ s: rstr, k: 1 }, { s: expect.stringMatching(/^s\d+$/) }],

    "shared object, matcher on one path": () => {
      const u = user();
      return [{ a: u, b: u }, { a: { id: any(Number) } }];
    },
    "shared object, matcher on both paths": () => {
      const u = user();
      return [
        { a: u, b: u },
        { a: { id: any(Number) }, b: { id: any(Number) } },
      ];
    },
    "shared object below an object the matchers do not walk": () => {
      const u = user();
      return [{ current: u, log: [{ user: u }] }, { current: { id: any(Number) } }];
    },
    "shared object as a Map value and a Set member": () => {
      const u = user();
      return [{ a: u, m: new Map([["k", u]]), s: new Set([u]) }, { a: { id: any(Number) } }];
    },
    "self cycle": () => {
      const o: any = user();
      o.self = o;
      return [o, { id: any(Number) }];
    },
    "parent cycle": () => {
      const o: any = { inner: user() };
      o.inner.parent = o;
      return [o, { inner: { id: any(Number) } }];
    },

    "Error own property": () => [Object.assign(new TypeError("boom"), { code: rstr }), { code: any(String) }],
    "Error message": () => [new TypeError(rstr), { message: any(String) }],
    "Error with a nested object": () => [
      Object.assign(new Error("e"), { info: user() }),
      { info: { id: any(Number) } },
    ],
    "Event": () => [new Event("x"), { timeStamp: any(Number) }],
    "Event type": () => [new MessageEvent("message", { data: "d" }), { type: any(String) }],
    "MessageEvent data": () => [new MessageEvent("message", { data: rstr }), { data: any(String) }],
    "ErrorEvent message": () => [
      new ErrorEvent("error", { message: rstr, error: { code: 5 } }),
      { message: any(String) },
    ],
    "ErrorEvent error": () => {
      const error = { code: rnd };
      return [new ErrorEvent("error", { message: "m", error }), { error: { code: any(Number) } }, error];
    },
    "Headers": () => [new Headers({ "x-a": "1" }), { append: any(Function) }],
    "FormData": () => {
      const form = new FormData();
      form.append("a", "1");
      return [form, { toJSON: any(Function) }];
    },
    "Response keeps its own rendering": () => [
      { r: new Response("x", { status: 201 }) },
      { r: { status: any(Number) } },
    ],
    "Map size": () => [{ m: new Map([["k", 1]]) }, { m: { size: any(Number) } }],
    "Set size": () => [{ s: new Set([1]) }, { s: { size: any(Number) } }],
    "Date with an own property": () => {
      const d: any = new Date(0);
      d.info = user();
      return [{ d }, { d: { info: { id: any(Number) } } }];
    },
    "function with an own property": () => {
      const f: any = function f() {};
      f.meta = user();
      return [{ f }, { f: { meta: { id: any(Number) } } }];
    },
    "boxed Number with an own property": () => {
      const n: any = new Number(5);
      n.info = user();
      n.id = rnd;
      return [n, { id: any(Number), info: { id: any(Number) } }];
    },
    "boxed Boolean with an own property": () => {
      const b: any = new Boolean(true);
      b.info = user();
      return [b, { info: { id: any(Number) } }];
    },

    "React element props": () => [element("div", { id: rnd, children: "x" }), { props: { id: any(Number) } }],
    "React element key": () => [element("div", { children: "x" }, rstr), { key: any(String) }],
    "React element type": () => [element(rstr, {}), { type: any(String) }],
    "React element children": () => [element("div", { children: rstr }), { props: { children: any(String) } }],
    "React child element": () => [
      element("div", { children: element("b", { id: rnd }) }),
      { props: { children: { props: { id: any(Number) } } } },
    ],
    "React child elements": () => [
      element("ul", { children: [element("li", { id: rnd }), element("li", { id: rnd })] }),
      { props: { children: [{ props: { id: any(Number) } }, { props: { id: any(Number) } }] } },
    ],
    "React children, one of them a matcher": () => [
      element("ul", { children: ["a", rstr] }),
      { props: { children: ["a", any(String)] } },
    ],

    "Proxy at the root": () => [new Proxy({ user: user() }, {}), { user: { id: any(Number) } }],
    "Proxy one level down": () => [
      { state: new Proxy({ user: user() }, {}) },
      { state: { user: { id: any(Number) } } },
    ],
    "Proxy with a BigInt below a matcher": () => [
      new Proxy({ user: { big: BigInt(rnd) } }, {}),
      { user: { big: any(BigInt) } },
    ],
    "arguments object": () => [
      (function (..._: unknown[]) {
        return arguments;
      })({ user: user() }),
      { 0: { user: { id: any(Number) } } },
    ],
    "arguments object with the matcher on its index": () => [
      (function (..._: unknown[]) {
        return arguments;
      })(rnd),
      { 0: any(Number) },
    ],
    "generator object": () => {
      const g: any = (function* () {})();
      g.info = user();
      return [g, { info: { id: any(Number) } }];
    },

    "matcher as the whole propertyMatchers argument": () => [{ id: 1 }, any(Object)],
    "received value is a matcher": () => [any(String), {}],
  };

  for (const [name, make] of Object.entries(cases)) {
    test(name, () => {
      const [received, matchers, other] = make();
      const before = [received, matchers, other].map(shapeOf);
      expect(received).toMatchSnapshot(matchers);
      expect([received, matchers, other].flatMap((root, i) => changedKeys(before[i], root))).toEqual([]);
    });
  }

  // main did not record these matchers, or recorded them by a write that the
  // object kept.
  describe("recorded where main did not", () => {
    test("a matcher on a key of a Proxy", () => {
      const target = { id: rnd, name: "ann" };
      expect(new Proxy(target, {})).toMatchSnapshot({ id: any(Number) });
      expect(target.id).toBe(rnd);
    });

    test("a matcher on an index of a typed array", () => {
      const bytes = new Uint8Array([rnd & 0xff, 6]);
      const buffer = Buffer.from([rnd & 0xff, 6]);
      const floats = new Float64Array([rnd + 0.5, 2.5]);
      expect({ bytes, buffer, floats }).toMatchSnapshot({
        bytes: { 0: any(Number) },
        buffer: { 0: any(Number) },
        floats: { 0: any(Number) },
      });
      expect(bytes[0]).toBe(rnd & 0xff);
      expect(buffer[0]).toBe(rnd & 0xff);
      expect(floats[0]).toBe(rnd + 0.5);
    });
  });

  // The class name and the React element check read these keys from the
  // object, not from the record.
  test("a matcher on a key that selects the rendering", () => {
    const tagged = { [Symbol.toStringTag]: "Tagged", id: rnd };
    expect(tagged).toMatchSnapshot({ [Symbol.toStringTag]: any(String), id: any(Number) });
    expect(tagged[Symbol.toStringTag]).toBe("Tagged");

    const instance = new User();
    expect(instance).toMatchSnapshot({ constructor: any(Function), id: any(Number) });
    expect(Object.hasOwn(instance, "constructor")).toBe(false);

    const notAnElement = element("div", { id: rnd });
    expect(notAnElement).toMatchSnapshot({ $$typeof: any(Symbol), props: { id: any(Number) } });
    expect(notAnElement.$$typeof).toBe(Symbol.for("react.element"));
  });

  test("toJSON below a Proxy reads the value, not the matcher", () => {
    const seen: string[] = [];
    const inner = {
      id: 7,
      toJSON() {
        seen.push(typeof this.id);
        return { id: this.id };
      },
    };
    expect(new Proxy({ inner }, {})).toMatchSnapshot({ inner: { id: any(Number) } });
    expect(seen).toEqual(["number"]);
  });

  test("a getter is read once", () => {
    let reads = 0;
    const received = {
      get a() {
        reads++;
        return { id: rnd };
      },
      get untouched() {
        reads += 100;
        return rnd;
      },
    };
    expect(received).toMatchSnapshot({ a: { id: any(Number) } });
    expect(reads).toBe(1);
  });

  test("toMatchInlineSnapshot", () => {
    const received = { id: rnd, list: [1, rstr, 3], u: new User() };
    expect(received).toMatchInlineSnapshot(
      { id: any(Number), list: [1, any(String), 3], u: { id: any(Number) } },
      `
      {
        "id": Any<Number>,
        "list": [
          1,
          Any<String>,
          3,
        ],
        "u": User {
          "id": Any<Number>,
          "name": "ann",
        },
      }
    `,
    );
    expect(received.id).toBe(rnd);
    expect(received.list[1]).toBe(rstr);
    expect(received.u.id).toBe(rnd);
  });

  test("a snapshot without matchers, after one with matchers, records the value", () => {
    const received = { id: 7, name: "ann" };
    expect(received).toMatchSnapshot({ id: any(Number) });
    expect(received).toMatchInlineSnapshot(`
      {
        "id": 7,
        "name": "ann",
      }
    `);
    expect(received).toMatchSnapshot({ id: any(Number) });
  });

  test("a failed match leaves the received value alone and prints it as it is", () => {
    const received = { id: 7, role: "admin" };
    expect(() => expect(received).toMatchSnapshot({ id: any(Number), role: any(Number) })).toThrow(
      /Received: \{\s+id: 7,/,
    );
    expect(received.id).toBe(7);
  });

  test("the snapshot file is the same on the second run", async () => {
    using dir = tempDir("snapshot-property-matchers", {
      "q.test.js": `
        const id = Math.floor(Math.random() * 1e9);
        const u = () => ({ user: { id, name: "ann" } }), pm = () => ({ user: { id: expect.any(Number) } });
        test("a Proxy at the root", () => { expect(new Proxy(u(), {})).toMatchSnapshot(pm()); });
        test("a Proxy one level down", () => { expect({ state: new Proxy(u(), {}) }).toMatchSnapshot({ state: pm() }); });
        test("an arguments object", () => { expect((function () { return arguments; })(u())).toMatchSnapshot({ 0: pm() }); });
        test("no Proxy", () => { expect(u()).toMatchSnapshot(pm()); });
      `,
    });
    const run = async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./q.test.js"],
        env: { ...bunEnv, CI: "false" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const snapshot = await Bun.file(join(String(dir), "__snapshots__", "q.test.js.snap")).text();
      return { pass: / 4 pass/.test(stderr), fail: / 0 fail/.test(stderr), snapshot, exitCode };
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(first).toMatchObject({ pass: true, fail: true, exitCode: 0 });
    expect(first.snapshot).toContain('{"user":{"id":{},"name":"ann"}}');
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

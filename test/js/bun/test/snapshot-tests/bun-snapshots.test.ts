import { Database } from "bun:sqlite";
import { describe, expect, it, test } from "bun:test";

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
});

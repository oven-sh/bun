// Bun 1.4.4 wrote the snapshots of this file, here and in __snapshots__/print-throws.fixture.js.snap.
// It called no getter at a key and no `toJSON` to print a value. Vitest's format does, and throws what they throw.
// To add a case, run it under that version. Never update them with a later Bun.
import { expect, test } from "vitest";

const bad = () => ({
  ok: 1,
  get bad() {
    throw new Error("not ready");
  },
});
const thrower = error => () => {
  throw error;
};
class Entries extends Map {
  entries() {
    throw new Error("entries");
  }
}

test("an own getter", () => {
  expect(bad()).toMatchInlineSnapshot(`
    {
      "bad": [native code],
      "ok": 1,
    }
  `);
});
test("a getter in a nested object", () => {
  expect({ nested: bad() }).toMatchInlineSnapshot(`
    {
      "nested": {
        "bad": [native code],
        "ok": 1,
      },
    }
  `);
});
test("a getter in an array item", () => {
  expect([bad()]).toMatchInlineSnapshot(`
    [
      {
        "bad": [native code],
        "ok": 1,
      },
    ]
  `);
});
test("a getter in a Map value", () => {
  expect(new Map([["k", bad()]])).toMatchInlineSnapshot(`
    Map {
      "k" => {
        "bad": [native code],
        "ok": 1,
      },
    }
  `);
});
test("a getter under a symbol key", () => {
  expect({
    get [Symbol("s")]() {
      throw new Error("not ready");
    },
  }).toMatchInlineSnapshot(`
    {
      [Symbol(s)]: [native code],
    }
  `);
});
test("a boxed symbol", () => {
  expect(Object(Symbol("s"))).toMatchInlineSnapshot(`Symbol {}`);
  expect({ boxed: Object(Symbol("s")) }).toMatchInlineSnapshot(`
    {
      "boxed": Symbol {},
    }
  `);
});
test("a toJSON that throws", () => {
  expect({
    a: 1,
    toJSON() {
      throw new Error("not ready");
    },
  }).toMatchInlineSnapshot(`
    {
      "a": 1,
      "toJSON": [Function: toJSON],
    }
  `);
});
test("a constructor getter on the prototype", () => {
  const prototype = {
    get constructor() {
      throw new Error("not ready");
    },
  };
  expect(Object.create(prototype, { a: { value: 1, enumerable: true } })).toMatchInlineSnapshot(`
    {
      "a": 1,
    }
  `);
});
test("a Map whose entries() throws", () => {
  expect(new Entries([["k", 1]])).toMatchInlineSnapshot(`
    Map {
      "k" => 1,
    }
  `);
});
test("with property matchers", () => {
  expect(bad()).toMatchInlineSnapshot({ ok: expect.any(Number) }, `
    {
      "bad": [native code],
      "ok": Any<Number>,
    }
  `);
});
test("with property matchers that a frozen array did not keep", () => {
  const value = Object.assign(bad(), { list: Object.freeze([1, 2]) });
  expect(value).toMatchInlineSnapshot({ list: [expect.any(Number), 2] }, `
    {
      "bad": [native code],
      "list": [
        1,
        2,
      ],
      "ok": 1,
    }
  `);
});
test("a thrown object", () => {
  expect(thrower(bad())).toThrowErrorMatchingInlineSnapshot(`undefined`);
});
test("a thrown error whose name getter throws", () => {
  const error = Object.defineProperty(new Error("message"), "name", {
    get() {
      throw new Error("not ready");
    },
  });
  expect(thrower(error)).toThrowErrorMatchingInlineSnapshot(`"message"`);
});
test("a promise", async () => {
  await expect(Promise.resolve(bad())).resolves.toMatchInlineSnapshot(`
    {
      "bad": [native code],
      "ok": 1,
    }
  `);
  await expect(Promise.reject(bad())).rejects.toMatchInlineSnapshot(`
    {
      "bad": [native code],
      "ok": 1,
    }
  `);
});
test("two calls and a snapshot in the file", () => {
  expect(bad()).toMatchInlineSnapshot(`
    {
      "bad": [native code],
      "ok": 1,
    }
  `);
  expect(bad()).toMatchInlineSnapshot(`
    {
      "bad": [native code],
      "ok": 1,
    }
  `);
  expect("the third of the test").toMatchSnapshot();
});

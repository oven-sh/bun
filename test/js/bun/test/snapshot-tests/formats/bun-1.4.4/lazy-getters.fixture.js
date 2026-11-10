// Bun 1.4.4 wrote the snapshots of this file, the inline ones and __snapshots__/lazy-getters.fixture.js.snap.
// It printed an accessor as `[native code]` and did not call it. To add a case, run it under that version.
import { expect, test } from "bun:test";

// Each getter changes the object that a later print of the value reads.
let reads = 0;
class Model {
  constructor() {
    Object.defineProperty(this, "relation", {
      enumerable: true,
      configurable: true,
      get() {
        reads++;
        return (this._relation ??= { loaded: true });
      },
    });
  }
}
const shapes = {
  "replaces itself": () => ({
    id: 1,
    get items() {
      reads++;
      delete this.items;
      return (this.items = [1, 2]);
    },
  }),
  "redefines itself": () =>
    Object.defineProperty({ id: 1 }, "items", {
      enumerable: true,
      configurable: true,
      get() {
        reads++;
        Object.defineProperty(this, "items", { value: [1, 2], enumerable: true });
        return this.items;
      },
    }),
  "fills a field": () => ({
    id: 1,
    get items() {
      reads++;
      return (this._items ??= [1, 2]);
    },
  }),
  "adds a key": () => ({
    id: 1,
    get items() {
      reads++;
      this.cache = true;
      return 2;
    },
  }),
  "counts in an earlier sibling": () => ({
    count: 0,
    get next() {
      reads++;
      return ++this.count;
    },
  }),
  "writes a later sibling": () => ({
    get first() {
      reads++;
      this.second = 5;
      return 1;
    },
    second: 0,
  }),
  "writes into an object beside it": () => ({
    get bump() {
      reads++;
      return ++this.inner.count;
    },
    inner: { count: 0 },
  }),
  "writes into an array beside it": () => ({
    list: [],
    get push() {
      reads++;
      return this.list.push("pushed");
    },
  }),
  "writes into a Map beside it": () => ({
    map: new Map(),
    get set() {
      reads++;
      return this.map.set("key", 1).size;
    },
  }),
  "returns an object whose getter changes the root": () => {
    const root = {
      count: 0,
      get child() {
        reads++;
        return {
          get bump() {
            return ++root.count;
          },
        };
      },
    };
    return root;
  },
  "in an object": () => ({ outer: shapes["replaces itself"]() }),
  "in an array": () => [shapes["replaces itself"]()],
  "in a Map": () => new Map([["key", shapes["replaces itself"]()]]),
  "of a class instance": () => new Model(),
};
const thrower = error => () => {
  throw error;
};

// The same object passes each time, because no match has called its getter.
test.each(Object.keys(shapes))("in a file: %s", name => {
  const value = shapes[name]();
  expect(value).toMatchSnapshot();
  expect(value).toMatchSnapshot();
  expect(reads).toBe(0);
});

test("in a file, with a hint, property matchers, from a promise and from a thrown error", async () => {
  const value = shapes["replaces itself"];
  expect(value()).toMatchSnapshot("hint");
  expect(value()).toMatchSnapshot({ id: expect.any(Number) });
  expect(value()).toMatchSnapshot({ id: expect.any(Number) }, "hint");
  await expect(Promise.resolve(value())).resolves.toMatchSnapshot();
  expect(thrower(Object.assign(new Error(), { message: value() }))).toThrowErrorMatchingSnapshot();
  expect(reads).toBe(0);
});

// The inline matchers print through the same function, so they take four of the shapes.
test("inline: replaces itself", () => {
  expect(shapes["replaces itself"]()).toMatchInlineSnapshot(`
    {
      "id": 1,
      "items": [native code],
    }
  `);
  expect(reads).toBe(0);
});
test("inline: fills a field", () => {
  expect(shapes["fills a field"]()).toMatchInlineSnapshot(`
    {
      "id": 1,
      "items": [native code],
    }
  `);
  expect(reads).toBe(0);
});
test("inline: writes into an array beside it", () => {
  expect(shapes["writes into an array beside it"]()).toMatchInlineSnapshot(`
    {
      "list": [],
      "push": [native code],
    }
  `);
  expect(reads).toBe(0);
});
test("inline: in a Map", () => {
  expect(shapes["in a Map"]()).toMatchInlineSnapshot(`
    Map {
      "key" => {
        "id": 1,
        "items": [native code],
      },
    }
  `);
  expect(reads).toBe(0);
});
test("inline, the same object twice", () => {
  const value = shapes["replaces itself"]();
  expect(value).toMatchInlineSnapshot(`
    {
      "id": 1,
      "items": [native code],
    }
  `);
  expect(value).toMatchInlineSnapshot(`
    {
      "id": 1,
      "items": [native code],
    }
  `);
  expect(reads).toBe(0);
});
test("inline, with property matchers, from a promise and from a thrown error", async () => {
  const value = shapes["replaces itself"];
  expect(value()).toMatchInlineSnapshot({ id: expect.any(Number) }, `
    {
      "id": Any<Number>,
      "items": [native code],
    }
  `);
  await expect(Promise.resolve(value())).resolves.toMatchInlineSnapshot(`
    {
      "id": 1,
      "items": [native code],
    }
  `);
  expect(thrower(Object.assign(new Error(), { message: value() }))).toThrowErrorMatchingInlineSnapshot(`
    {
      "id": 1,
      "items": [native code],
    }
  `);
  expect(reads).toBe(0);
});

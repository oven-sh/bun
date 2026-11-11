// Vitest 5.1.0 wrote the first line of __snapshots__/print-throws-vitest-file.fixture.js.snap and its first two entries.
// Then Bun 1.4.4 appended the others with its own keys, so the keys of the file are not in Vitest's order.
// It called no getter at a key and no `toJSON` to print a value. Vitest's format does, and throws what they throw.
// To add a case, run it under that version. Never update them with a later Bun.
import { describe, expect, test } from "vitest";

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

test("what Vitest wrote", () => {
  expect({ a: 1 }).toMatchSnapshot();
  expect(["b", 2]).toMatchSnapshot();
});
test("an own getter", () => {
  expect(bad()).toMatchSnapshot();
});
test("a getter in a nested object", () => {
  expect({ nested: [bad()] }).toMatchSnapshot();
});
test("with property matchers", () => {
  expect(bad()).toMatchSnapshot({ ok: expect.any(Number) });
});
test("with a hint", () => {
  expect(bad()).toMatchSnapshot("the hint");
});
describe("in a describe", () => {
  test("an own getter", () => {
    expect(bad()).toMatchSnapshot();
  });
});
test("two calls and one that prints", () => {
  expect(bad()).toMatchSnapshot();
  expect(bad()).toMatchSnapshot();
  expect("the third of the test").toMatchSnapshot();
});
test("a toJSON that throws", () => {
  expect({
    a: 1,
    toJSON() {
      throw new Error("not ready");
    },
  }).toMatchSnapshot();
});
test("a constructor getter on the prototype", () => {
  const prototype = {
    get constructor() {
      throw new Error("not ready");
    },
  };
  expect(Object.create(prototype, { a: { value: 1, enumerable: true } })).toMatchSnapshot();
});
test("a Map whose entries() throws", () => {
  expect(new Entries([["k", 1]])).toMatchSnapshot();
});
test("a thrown object", () => {
  expect(thrower(bad())).toThrowErrorMatchingSnapshot();
});
test("a thrown error whose name getter throws", () => {
  const error = Object.defineProperty(new Error("message"), "name", {
    get() {
      throw new Error("not ready");
    },
  });
  expect(thrower(error)).toThrowErrorMatchingSnapshot();
});
test("a promise", async () => {
  await expect(Promise.resolve(bad())).resolves.toMatchSnapshot();
  await expect(Promise.reject(bad())).rejects.toMatchSnapshot();
});

// Bun 1.4.4 wrote __snapshots__/print-throws-bun-file.fixture.js.snap. It printed `[native code]` for a getter and did not call it.
// Bun's format reads these getters now, and throws what the read or the print of its result throws.
// To add a case, run it under that version. Never update them with a later Bun.
import { describe, expect, test } from "bun:test";

const revoked = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};
const bad = () => ({
  ok: 1,
  get proxy() {
    return revoked();
  },
});
const thrower = error => () => {
  throw error;
};
class HTMLDivElement {
  nodeType = 1;
  tagName = "DIV";
  attributes = [];
}

test("a getter that returns a revoked Proxy", () => {
  expect(bad()).toMatchSnapshot();
});
test("a getter that returns a Proxy whose ownKeys throws", () => {
  expect({
    get proxy() {
      return new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("not ready");
          },
        },
      );
    },
  }).toMatchSnapshot();
});
test("what looks like a DOM node, with a getter that throws", () => {
  const node = new HTMLDivElement();
  Object.defineProperty(node, "childNodes", {
    enumerable: true,
    get() {
      throw new Error("not ready");
    },
  });
  expect(node).toMatchSnapshot();
});
test("what looks like a React 19 element, with a getter that throws", () => {
  expect({
    $$typeof: Symbol.for("react.transitional.element"),
    type: "b",
    key: null,
    get props() {
      throw new Error("not ready");
    },
    _owner: null,
  }).toMatchSnapshot();
});
test("with property matchers", () => {
  expect(bad()).toMatchSnapshot({ ok: expect.any(Number) });
});
test("with a hint", () => {
  expect(bad()).toMatchSnapshot("the hint");
});
describe("in a describe", () => {
  test("a getter that returns a revoked Proxy", () => {
    expect(bad()).toMatchSnapshot();
  });
});
test("two calls and one that prints", () => {
  expect(bad()).toMatchSnapshot();
  expect(bad()).toMatchSnapshot();
  expect("the third of the test").toMatchSnapshot();
});
test("a thrown error whose message has such a getter", () => {
  const error = new Error();
  error.message = bad();
  expect(thrower(error)).toThrowErrorMatchingSnapshot();
});
test("a promise", async () => {
  await expect(Promise.resolve(bad())).resolves.toMatchSnapshot();
  await expect(Promise.reject(bad())).rejects.toMatchSnapshot();
});

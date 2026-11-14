// Bun 1.4.4 wrote the inline snapshots of this file. It printed `[native code]` for a getter and did not call it.
// Bun's format reads these getters now, and throws what the read or the print of its result throws.
// To add a case, run it under that version. Never update them with a later Bun.
import { expect, test } from "bun:test";

const revoked = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};
class HTMLDivElement {
  nodeType = 1;
  tagName = "DIV";
  attributes = [];
}

test("a getter that returns a revoked Proxy", () => {
  expect({
    get proxy() {
      return revoked();
    },
  }).toMatchInlineSnapshot(`
    {
      "proxy": [native code],
    }
  `);
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
  }).toMatchInlineSnapshot(`
    {
      "proxy": [native code],
    }
  `);
});
test("what looks like a DOM node, with a getter that throws", () => {
  const node = new HTMLDivElement();
  Object.defineProperty(node, "childNodes", {
    enumerable: true,
    get() {
      throw new Error("not ready");
    },
  });
  expect(node).toMatchInlineSnapshot(`
    HTMLDivElement {
      "attributes": [],
      "childNodes": [native code],
      "nodeType": 1,
      "tagName": "DIV",
    }
  `);
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
  }).toMatchInlineSnapshot(`
    {
      "$$typeof": Symbol(react.transitional.element),
      "_owner": null,
      "key": null,
      "props": [native code],
      "type": "b",
    }
  `);
});

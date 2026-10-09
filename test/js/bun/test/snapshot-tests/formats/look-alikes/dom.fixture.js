import { expect, test } from "vitest";

// A look-alike of a DOM node whose members are not of the types that the DOM gives them is not printed as one:
// it prints as the object that it is, where pretty-format throws. Written by Bun.
class Captured {
  constructor(value) {
    this.value = value;
  }
}
let printed;
expect.addSnapshotSerializer({
  test: value => value instanceof Captured,
  serialize(captured, config, indentation, depth, refs, printer) {
    printed = printer(captured.value, config, indentation, depth, refs);
    return "captured";
  },
});
function print(value) {
  printed = undefined;
  try {
    expect(new Captured(value)).toMatchInlineSnapshot(`captured`);
  } catch {
    return "throws";
  }
  return printed;
}

const revoked = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};
const hostile = {
  undefined: () => undefined,
  null: () => null,
  false: () => false,
  true: () => true,
  zero: () => 0,
  number: () => 5,
  "empty string": () => "",
  string: () => "abc",
  symbol: () => Symbol("s"),
  bigint: () => 10n,
  function: () => function f(a, b) {},
  "empty array": () => [],
  array: () => [1, "two"],
  object: () => ({ a: 1 }),
  proxy: () => new Proxy({ a: 1 }, {}),
  "proxy of an array": () => new Proxy([1], {}),
  "revoked proxy": revoked,
  "throwing getters": () => ({
    get length() {
      throw new Error("length");
    },
    get a() {
      throw new Error("a");
    },
  }),
  "throwing proxy": () =>
    new Proxy(
      {},
      {
        get() {
          throw new Error("get");
        },
        ownKeys() {
          throw new Error("ownKeys");
        },
        has() {
          throw new Error("has");
        },
      },
    ),
};

class HTMLDivElement {
  nodeType = 1;
  tagName = "DIV";
  attributes = [];
  childNodes = [];
  constructor(members) {
    Object.assign(this, members);
  }
}
class Text {
  nodeType = 3;
  data = "text";
  constructor(members) {
    Object.assign(this, members);
  }
}
class Comment {
  nodeType = 8;
  data = "comment";
  constructor(members) {
    Object.assign(this, members);
  }
}
class DocumentFragment {
  nodeType = 11;
  childNodes = [];
  constructor(members) {
    Object.assign(this, members);
  }
}
class NodeList {
  constructor(members) {
    Object.assign(this, members);
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this[i];
  }
}
class NamedNodeMap {
  constructor(members) {
    Object.assign(this, members);
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this[i];
  }
}

const members = {
  "DOM element: nodeType": value => new HTMLDivElement({ nodeType: value }),
  "DOM element: tagName": value => new HTMLDivElement({ tagName: value }),
  "DOM element: attributes": value => new HTMLDivElement({ attributes: value }),
  "DOM element: an attribute": value => new HTMLDivElement({ attributes: [value] }),
  "DOM element: name of an attribute": value => new HTMLDivElement({ attributes: [{ name: value, value: "v" }] }),
  "DOM element: value of an attribute": value => new HTMLDivElement({ attributes: [{ name: "n", value }] }),
  "DOM element: childNodes": value => new HTMLDivElement({ childNodes: value }),
  "DOM element: children, without childNodes": value => new HTMLDivElement({ childNodes: undefined, children: value }),
  "DOM element: a child": value => new HTMLDivElement({ childNodes: [value] }),
  "DOM element: hasAttribute": value => new HTMLDivElement({ hasAttribute: value }),
  "DOM element: shadowRoot": value => new HTMLDivElement({ shadowRoot: value }),
  "DOM element: children of its shadowRoot": value => new HTMLDivElement({ shadowRoot: { children: value } }),
  "DOM text: data": value => new Text({ data: value }),
  "DOM comment: data": value => new Comment({ data: value }),
  "DOM fragment: childNodes": value => new DocumentFragment({ childNodes: value }),
  "NodeList: length": value => new NodeList({ length: value, 0: "a" }),
  "NodeList: Symbol.iterator": value => new NodeList({ length: 1, 0: "a", [Symbol.iterator]: value }),
  "NamedNodeMap: length": value => new NamedNodeMap({ length: value, 0: { name: "n", value: "v" } }),
  "NamedNodeMap: an attribute": value => new NamedNodeMap({ length: 1, 0: value }),
};

for (const [member, make] of Object.entries(members)) {
  test(member, () => {
    for (const [kind, value] of Object.entries(hostile)) {
      expect(print(make(value()))).toMatchSnapshot(kind);
    }
  });
}

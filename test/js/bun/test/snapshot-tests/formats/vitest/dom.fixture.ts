// @ts-nocheck
import { describe, test, expect } from "vitest";

// The least that pretty-format takes for DOM nodes.
class Node {
  childNodes: Node[] = [];
  constructor(public nodeType: number) {}
}
class Text extends Node {
  constructor(public data: string) {
    super(3);
  }
}
class Comment extends Node {
  constructor(public data: string) {
    super(8);
  }
}
class DocumentFragment extends Node {
  constructor(...children: Node[]) {
    super(11);
    this.childNodes = children;
  }
  get children() {
    return this.childNodes.filter(node => node.nodeType === 1);
  }
}
class HTMLElement extends Node {
  attributes: { name: string; value: string }[];
  shadowRoot: DocumentFragment | null = null;
  constructor(
    public tagName: string,
    attributes: Record<string, string> = {},
    ...children: (Node | string)[]
  ) {
    super(1);
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.childNodes = children.map(child => (typeof child === "string" ? new Text(child) : child));
  }
  hasAttribute(name: string) {
    return this.attributes.some(attribute => attribute.name === name);
  }
}
const el = (tagName: string, attributes?: Record<string, string>, ...children: (Node | string)[]) =>
  new HTMLElement(tagName.toUpperCase(), attributes, ...children);
const withShadow = (host: HTMLElement, ...children: Node[]) =>
  Object.assign(host, { shadowRoot: new DocumentFragment(...children) });

const cases: Record<string, () => unknown> = {
  "empty element": () => el("div"),
  "text": () => el("p", {}, "hello"),
  "attributes are sorted": () => el("a", { href: "/x", class: "b a", id: "i" }, "t"),
  "nested": () => el("ul", { class: "l" }, el("li", {}, "one"), el("li", {}, el("b", {}, "two"), " and ", el("i"))),
  "text node": () => new Text("just <text>"),
  "comment": () => new Comment(" a comment "),
  "fragment": () => new DocumentFragment(el("i"), new Text("t")),
  "in an object": () => ({ el: el("p", {}, "x"), n: 1 }),
  "in an array": () => [el("p", { id: "x" }), el("q")],
  "shadow root": () => withShadow(el("div", {}, "light"), el("span", {}, "shadow"), new Text("not an element")),
  "shadow root and attributes": () => withShadow(el("my-host", { id: "h" }), el("slot"), el("b", { class: "c" }, "x")),
  "empty shadow root": () => withShadow(el("div", {}, "light")),
  "shadow root in a shadow root": () => withShadow(el("outer-host"), withShadow(el("inner-host"), el("i"))),
};

describe("nodes", () => {
  for (const [name, make] of Object.entries(cases)) {
    test(name, () => {
      expect(make()).toMatchSnapshot();
    });
  }
});

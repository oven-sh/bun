import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Nodes shaped like the ones of jsdom and happy-dom: what the markup is made of comes from getters on the
// prototypes, and the node's own properties lead to everything else in the document.
const impl = Symbol("impl");

class ArrayLike {
  [index: number]: unknown;
  constructor(items: unknown[]) {
    items.forEach((item, i) => (this[i] = item));
  }
  get length() {
    return Object.keys(this).length;
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this[i];
  }
}
class NodeList extends ArrayLike {}
class HTMLCollection extends ArrayLike {}
class HTMLOptionsCollection extends ArrayLike {}
class NamedNodeMap extends ArrayLike {}
class DOMStringMap {}
class DOMTokenList {}
class Attr {
  constructor(
    public name: string,
    public value: unknown,
  ) {}
}

const ownerDocument = { everything: Array.from({ length: 1000 }, (_, i) => ({ i })) };

class Node {
  ownerDocument = ownerDocument;
  constructor(state: object) {
    Object.defineProperty(this, impl, { value: state });
  }
  get nodeType() {
    return this[impl].nodeType;
  }
  get data() {
    return this[impl].data;
  }
  get tagName() {
    return this[impl].tagName;
  }
  get attributes() {
    return new NamedNodeMap(this[impl].attributes);
  }
  get childNodes() {
    return new NodeList(this[impl].childNodes);
  }
  hasAttribute(name: string) {
    return this[impl].attributes.some((attribute: Attr) => attribute.name === name);
  }
}
class Text extends Node {}
class Comment extends Node {}
class DocumentFragment extends Node {}
class Element extends Node {}
class HTMLElement extends Element {}

const text = (data: string) => new Text({ nodeType: 3, data });
const comment = (data: string) => new Comment({ nodeType: 8, data });
const fragment = (...childNodes: unknown[]) => new DocumentFragment({ nodeType: 11, childNodes });
function elementOf(
  Class: typeof Node,
  tagName: string,
  attributes: Record<string, unknown> = {},
  ...children: unknown[]
) {
  return new Class({
    nodeType: 1,
    tagName,
    attributes: Object.entries(attributes).map(([name, value]) => new Attr(name, value)),
    childNodes: children.map(child => (typeof child === "string" ? text(child) : child)),
  });
}
const h = (tagName: string, attributes?: Record<string, unknown>, ...children: unknown[]) =>
  elementOf(HTMLElement, tagName.toUpperCase(), attributes, ...children);

const button = () => h("button", { id: "x", class: "b a" }, "go");
const nested = (depth: number): Node => (depth === 0 ? h("i") : h("div", {}, nested(depth - 1)));

const repeat = (string: string, count: number) => Buffer.alloc(Buffer.byteLength(string) * count, string).toString();

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the assertion to fail");
}

let utils!: {
  stringify(value: unknown): string;
  printReceived(value: unknown): string;
  printExpected(value: unknown): string;
};
expect.extend({
  toCaptureUtils() {
    utils = this.utils;
    return { pass: true, message: () => "" };
  },
});
(expect(0) as any).toCaptureUtils();

describe("matcher messages", () => {
  test("a node is one line of markup", () => {
    expect(messageOf(() => expect(button()).toBeNull())).toBe(
      'expect(received).toBeNull()\n\nReceived: <button class="b a" id="x">go</button>\n',
    );
    expect(messageOf(() => expect(button()).toBe(1))).toBe(
      'expect(received).toBe(expected)\n\nExpected: 1\nReceived: <button class="b a" id="x">go</button>\n',
    );
    expect(messageOf(() => expect(1).toBe(button()))).toBe(
      'expect(received).toBe(expected)\n\nExpected: <button class="b a" id="x">go</button>\nReceived: 1\n',
    );
  });

  test("inside other values", () => {
    expect(messageOf(() => expect({ el: button(), list: [h("i"), h("b")] }).toBeNull())).toBe(
      'expect(received).toBeNull()\n\nReceived: {\n  el: <button class="b a" id="x">go</button>,\n  list: [\n    <i />, <b />\n  ],\n}\n',
    );
    expect(messageOf(() => expect(new Map([["k", h("i")]])).toBeNull())).toContain('"k": <i />,');
    expect(messageOf(() => expect(new Set([h("i")])).toBeNull())).toContain("  <i />,");
  });

  test("this.utils", () => {
    expect(utils.stringify(button())).toBe('<button class="b a" id="x">go</button>');
    expect(Bun.stripANSI(utils.printReceived(button()))).toBe('<button class="b a" id="x">go</button>');
    expect(Bun.stripANSI(utils.printExpected(button()))).toBe('<button class="b a" id="x">go</button>');
  });

  test("mock calls", () => {
    const fn = mock();
    fn(button());
    const message = messageOf(() => expect(fn).toHaveBeenCalledWith(1));
    expect(message).toContain('<button\n+     class="b a"\n+     id="x"\n+   >\n+     go\n+   </button>');
    expect(message).not.toContain("ownerDocument");
  });

  test("asymmetric matchers", () => {
    expect(messageOf(() => expect(1).toEqual(expect.objectContaining({ el: h("i") })))).toContain('"el": <i />,');
  });

  test("test.each titles", async () => {
    using dir = tempDir("dom-nodes-each", {
      "each.test.js": `
        class HTMLElement {
          nodeType = 1;
          tagName = "I";
          attributes = [{ name: "a", value: "1" }];
          childNodes = [];
        }
        test.each([[new HTMLElement()]])("%p and %o", () => {});
        test.each([{ el: new HTMLElement() }])("$el", () => {});
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "each.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('(pass) <i a="1" /> and %o');
    expect(stderr).toContain('(pass) <i a="1" />');
    expect(exitCode).toBe(0);
  });

  test("every kind of value", () => {
    expect(
      [
        h("div"),
        h("div", { b: "2", a: "1" }),
        h("div", {}, "a", h("i"), comment(" c ")),
        text('a < b > c & "d" \\'),
        text(""),
        comment(" <c> "),
        fragment(),
        fragment(h("i"), "string child"),
        h("a", { title: 'q"q \\ < > &\n\r' }),
        h("div", {}, text("")),
        new NodeList([h("i"), text("t"), "s", 1]),
        new NodeList([]),
        new HTMLCollection([h("i")]),
        new HTMLOptionsCollection([h("option")]),
        new NamedNodeMap([new Attr("b", "2"), new Attr("a", 'q"')]),
        new NamedNodeMap([]),
        Object.assign(new DOMStringMap(), { b: "2", a: "1" }),
        Object.assign(new DOMTokenList(), ["x", "y"]),
      ].map(utils.stringify, utils),
    ).toEqual([
      "<div />",
      '<div a="1" b="2" />',
      "<div>a<i /><!-- c --></div>",
      'a &lt; b &gt; c & "d" \\',
      "",
      "<!-- &lt;c&gt; -->",
      "<DocumentFragment />",
      "<DocumentFragment><i />string child</DocumentFragment>",
      '<a title="q\\"q \\\\ < > &\n\r" />',
      "<div />",
      '[<i />, t, "s", 1]',
      "[]",
      "[<i />]",
      "[<option />]",
      '{"a": "q\\"", "b": "2"}',
      "{}",
      '{"a": "1", "b": "2"}',
      '{"0": "x", "1": "y"}',
    ]);
  });

  test("stops at 10 levels", () => {
    expect(utils.stringify(nested(9))).toBe(`${repeat("<div>", 9)}<i />${repeat("</div>", 9)}`);
    expect(utils.stringify(nested(10))).toBe(`${repeat("<div>", 10)}<i … />${repeat("</div>", 10)}`);
    expect(utils.stringify(nested(11))).toBe(`${repeat("<div>", 10)}<div … />${repeat("</div>", 10)}`);
    expect(utils.stringify(new NodeList([nested(10)]))).toBe(`[${repeat("<div>", 9)}<div … />${repeat("</div>", 9)}]`);
    expect(utils.stringify(h("div", { a: new NodeList([]) }))).toBe("<div a={[]} />");
  });

  test("the levels of the values around it count", () => {
    expect(utils.stringify({ a: { b: nested(10) } })).toContain(
      `b: ${repeat("<div>", 8)}<div … />${repeat("</div>", 8)},`,
    );
  });

  test("lists 10 items", () => {
    const items = Array.from({ length: 11 }, () => h("i"));
    expect(utils.stringify(new NodeList(items.slice(1)))).toBe(`[${Array(10).fill("<i />").join(", ")}]`);
    expect(utils.stringify(new NodeList(items))).toBe(`[${Array(10).fill("<i />").join(", ")}, …]`);
  });

  test("halves the depth, then the width, until it is under 10,000 characters", () => {
    const filler = Buffer.alloc(200, "x").toString();
    const rows = (count: number, li: object, span: object) =>
      h("ul", {}, ...Array.from({ length: count }, () => h("li", li, h("a", {}, h("span", span, "label")))));
    expect(utils.stringify(rows(10, {}, { class: filler }))).toBe(
      `<ul>${repeat(`<li><a><span class="${filler}">label</span></a></li>`, 10)}</ul>`,
    );
    expect(utils.stringify(rows(50, {}, { class: filler }))).toBe(`<ul>${repeat("<li><a … /></li>", 50)}</ul>`);
    expect(utils.stringify(rows(50, { class: filler }, {}))).toBe(`<ul>${repeat("<li … />", 50)}</ul>`);

    const long = Buffer.alloc(3000, "x").toString();
    expect(utils.stringify(new NodeList([text(long), text(long), text(long)]))).toBe(`[${long}, ${long}, ${long}]`);
    expect(utils.stringify(new NodeList([text(long), text(long), text(long), text(long)]))).toBe(
      `[${long}, ${long}, …]`,
    );
    expect(utils.stringify(h("p", {}, long + long + long + long))).toBe(`<p>${long + long + long + long}</p>`);

    // The limit counts UTF-16 code units.
    const wide = (length: number) => h("p", {}, h("i", {}, Buffer.alloc(length * 2, "é").toString()));
    expect(utils.stringify(wide(9_985))).toEndWith("é</i></p>");
    expect(utils.stringify(wide(9_986))).toBe("<p><i … /></p>");
  });

  test("stops printing what is already too long", () => {
    const tagName = Object.getOwnPropertyDescriptor(Node.prototype, "tagName")!;
    let reads = 0;
    Object.defineProperty(Node.prototype, "tagName", {
      configurable: true,
      get() {
        reads++;
        return tagName.get!.call(this);
      },
    });
    try {
      const filler = Buffer.alloc(100, "x").toString();
      const li = () => h("li", {}, h("a", {}, ...Array.from({ length: 100 }, () => h("span", {}, filler))));
      // 1,021 elements, printed with 10, 5 and 2 levels.
      expect(utils.stringify(h("ul", {}, ...Array.from({ length: 10 }, li)))).toBe(
        `<ul>${repeat("<li><a … /></li>", 10)}</ul>`,
      );
      expect(reads).toBeLessThan(1_021);
    } finally {
      Object.defineProperty(Node.prototype, "tagName", tagName);
    }
  });
});

describe("diffs", () => {
  test("a node is indented markup", () => {
    expect(messageOf(() => expect(button()).toEqual({ a: 1 }))).toBe(`expect(received).toEqual(expected)

- {
-   "a": 1,
- }
+ <button
+   class="b a"
+   id="x"
+ >
+   go
+ </button>

- Expected  - 3
+ Received  + 6
`);
  });

  test("only the lines that differ are marked", () => {
    const list = (last: string) => [h("ul", { class: "l" }, h("li", {}, "one"), h("li", {}, last))];
    expect(messageOf(() => expect(list("two")).toStrictEqual(list("three").concat(1 as any))))
      .toBe(`expect(received).toStrictEqual(expected)

@@ -8,6 +8,5 @@
      <li>
-       three
+       two
      </li>
    </ul>,
-   1,
  ]

- Expected  - 2
+ Received  + 1
`);
  });
});

describe("snapshots", () => {
  test("elements", () => {
    expect(h("div")).toMatchInlineSnapshot(`<div />`);
    expect(h("div", { id: "a" })).toMatchInlineSnapshot(`
      <div
        id="a"
      />
    `);
    expect(button()).toMatchInlineSnapshot(`
      <button
        class="b a"
        id="x"
      >
        go
      </button>
    `);
    expect(
      h("ul", { class: "l" }, h("li", {}, "one"), comment(" c "), h("li", { z: "", a: "" }, "two", h("b"), "tail")),
    ).toMatchInlineSnapshot(`
      <ul
        class="l"
      >
        <li>
          one
        </li>
        <!-- c -->
        <li
          a=""
          z=""
        >
          two
          <b />
          tail
        </li>
      </ul>
    `);
  });

  test("text, comments and fragments", () => {
    expect(text("just text")).toMatchInlineSnapshot(`just text`);
    expect(text("")).toMatchInlineSnapshot(``);
    expect(text("two\nlines")).toMatchInlineSnapshot(`
      two
      lines
    `);
    expect(comment(" c ")).toMatchInlineSnapshot(`<!-- c -->`);
    expect(fragment()).toMatchInlineSnapshot(`<DocumentFragment />`);
    expect(fragment(h("b", {}, "x"), "t")).toMatchInlineSnapshot(`
      <DocumentFragment>
        <b>
          x
        </b>
        t
      </DocumentFragment>
    `);
    expect(messageOf(() => expect(h("div", {}, text(""))).toEqual(1))).toContain("+ <div>\n+   \n+ </div>\n");
  });

  test("only < and > are escaped, and line ends are \\n", () => {
    expect(h("a", { title: `q"q 's' \\ < > &` }, `a < b > c & "d" 'e' \\`)).toMatchInlineSnapshot(`
      <a
        title="q"q 's' \\ < > &"
      >
        a &lt; b &gt; c & "d" 'e' \\
      </a>
    `);
    expect(comment(" <b> ")).toMatchInlineSnapshot(`<!-- &lt;b&gt; -->`);
    expect(h("a", { title: "1\r\n2\r3\n4" }, "1\r\n2\r3\n4")).toMatchInlineSnapshot(`
      <a
        title="1
      2
      3
      4"
      >
        1
      2
      3
      4
      </a>
    `);
  });

  test("characters outside ASCII", () => {
    expect(h("p", { "é": "ü", title: "日本語 😀" }, "café 日本語 😀")).toMatchInlineSnapshot(`
      <p
        title="日本語 😀"
        é="ü"
      >
        café 日本語 😀
      </p>
    `);
  });

  test("attributes are sorted by UTF-16 code unit", () => {
    const names = ["b", "a", "B", "a-b", "a1", "aa", "_", "\u{1F600}", "～", "é"];
    const printed = utils.stringify(h("p", Object.fromEntries(names.map(name => [name, ""]))));
    expect(printed).toBe(
      `<p ${names
        .toSorted()
        .map(name => `${name}=""`)
        .join(" ")} />`,
    );
  });

  test("the tag name is lowercased", () => {
    expect(elementOf(HTMLElement, "DIV")).toMatchInlineSnapshot(`<div />`);
    expect(elementOf(class SVGLinearGradientElement extends Element {}, "linearGradient")).toMatchInlineSnapshot(
      `<lineargradient />`,
    );
    expect(elementOf(HTMLElement, "X-ÉÀ")).toMatchInlineSnapshot(`<x-éà />`);
  });

  test("collections", () => {
    expect(new NodeList([])).toMatchInlineSnapshot(`NodeList []`);
    expect(new NodeList([h("i", {}, "x"), text("t"), comment("c"), "s", 1])).toMatchInlineSnapshot(`
      NodeList [
        <i>
          x
        </i>,
        t,
        <!--c-->,
        "s",
        1,
      ]
    `);
    expect(new HTMLCollection([h("i")])).toMatchInlineSnapshot(`
      HTMLCollection [
        <i />,
      ]
    `);
    expect(new HTMLOptionsCollection([h("option")])).toMatchInlineSnapshot(`
      HTMLOptionsCollection [
        <option />,
      ]
    `);
    expect(new NamedNodeMap([])).toMatchInlineSnapshot(`NamedNodeMap {}`);
    expect(new NamedNodeMap([new Attr("id", "x"), new Attr("class", 'b "a"')])).toMatchInlineSnapshot(`
      NamedNodeMap {
        "class": "b "a"",
        "id": "x",
      }
    `);
    expect(new DOMStringMap()).toMatchInlineSnapshot(`DOMStringMap {}`);
    expect(Object.assign(new DOMStringMap(), { fooBar: "1", a: "2" })).toMatchInlineSnapshot(`
      DOMStringMap {
        "a": "2",
        "fooBar": "1",
      }
    `);
    expect(Object.assign(new DOMTokenList(), ["b", "a"])).toMatchInlineSnapshot(`
      DOMTokenList {
        "0": "b",
        "1": "a",
      }
    `);
  });

  test("a collection that is an array or a Proxy", () => {
    expect(new (class NodeList extends Array {})(h("i"), h("b"))).toMatchInlineSnapshot(`
      NodeList [
        <i />,
        <b />,
      ]
    `);
    expect(new Proxy(new NodeList([h("i")]), {})).toMatchInlineSnapshot(`
      NodeList [
        <i />,
      ]
    `);
    expect(new Proxy(h("form", { a: "1" }, h("input")), {})).toMatchInlineSnapshot(`
      <form
        a="1"
      >
        <input />
      </form>
    `);
    const dataset = new Proxy(new DOMStringMap(), {
      ownKeys: () => ["b", "a"],
      getOwnPropertyDescriptor: () => ({ value: "", enumerable: true, configurable: true }),
      get: (target, key) => (key === "constructor" ? DOMStringMap : `value of ${String(key)}`),
    });
    expect(dataset).toMatchInlineSnapshot(`
      DOMStringMap {
        "a": "value of a",
        "b": "value of b",
      }
    `);
  });

  test("the attributes and the items of a collection are the ones its iterator yields", () => {
    class Half extends ArrayLike {
      *[Symbol.iterator]() {
        yield this[0];
      }
    }
    const attributes = new (class NamedNodeMap extends Half {})([new Attr("a", "1"), new Attr("b", "2")]);
    expect(attributes).toMatchInlineSnapshot(`
      NamedNodeMap {
        "a": "1",
      }
    `);
    expect(Object.defineProperty(h("div"), "attributes", { value: attributes })).toMatchInlineSnapshot(`
      <div
        a="1"
      />
    `);
    expect(new (class NodeList extends Half {})([h("i"), h("b")])).toMatchInlineSnapshot(`
      NodeList [
        <i />,
      ]
    `);
  });

  test("inside other values", () => {
    expect({ el: button(), list: [h("i"), { deep: h("b", { a: "1" }) }], attributes: button().attributes })
      .toMatchInlineSnapshot(`
      {
        "attributes": NamedNodeMap {
          "class": "b a",
          "id": "x",
        },
        "el": <button
          class="b a"
          id="x"
        >
          go
        </button>,
        "list": [
          <i />,
          {
            "deep": <b
              a="1"
            />,
          },
        ],
      }
    `);
    expect(new Map([["k", h("i", { a: "1" })]])).toMatchInlineSnapshot(`
      Map {
        "k" => <i
          a="1"
        />,
      }
    `);
  });

  test("indentation does not stop growing", () => {
    const lines = messageOf(() => expect(nested(40)).toEqual(1)).split("\n");
    expect(lines).toContain(`+ ${repeat(" ", 80)}<i />`);
    expect(lines).toContain(`+ ${repeat(" ", 78)}</div>`);
  });

  test("the same attribute name twice", () => {
    const twice = [new Attr("a", "first"), new Attr("b", "x"), new Attr("a", "last")];
    expect(Object.defineProperty(h("div"), "attributes", { value: twice })).toMatchInlineSnapshot(`
      <div
        a="last"
        a="last"
        b="x"
      />
    `);
    expect(new NamedNodeMap(twice)).toMatchInlineSnapshot(`
      NamedNodeMap {
        "a": "last",
        "b": "x",
      }
    `);
  });

  test("values that no DOM has", () => {
    expect(h("div", { n: 1, o: { a: 1 }, e: {}, list: [h("i")], u: undefined })).toMatchInlineSnapshot(`
      <div
        e={{}}
        list={
          [
            <i />,
          ]
        }
        n={1}
        o={
          {
            "a": 1,
          }
        }
        u={undefined}
      />
    `);
    expect(h("div", {}, { not: "a node" }, 1, null)).toMatchInlineSnapshot(`
      <div>
        {
          "not": "a node",
        }
        1
        null
      </div>
    `);
    expect(Object.assign(new DOMStringMap(), { a: 1, b: { c: h("i") } })).toMatchInlineSnapshot(`
      DOMStringMap {
        "a": 1,
        "b": {
          "c": <i />,
        },
      }
    `);
  });
});

describe("what is a node", () => {
  const isMarkup = (value: unknown) => /^(<|\[<|$)/.test(utils.stringify(value));
  const named = (name: string, Base = Node) => ({ [name]: class extends Base {} })[name];

  test.each([
    "Element",
    "HTMLElement",
    "HTMLDivElement",
    "HTML_x1Element",
    "SVGElement",
    "SVGSVGElement",
    "HTMLElementElement",
  ])("an element of the class %s", name => {
    expect(utils.stringify(elementOf(named(name), "DIV"))).toBe("<div />");
  });

  test.each([
    "",
    "Foo",
    "XElement",
    "MathMLElement",
    "Elements",
    "HTMLÉElement",
    "HTML-Element",
    "htmlElement",
    "aHTMLElement",
  ])("not an element of the class %p", name => {
    expect(isMarkup(elementOf(named(name), "DIV"))).toBe(false);
  });

  test("a custom element of any class", () => {
    expect(utils.stringify(elementOf(named("Foo"), "X-FOO"))).toBe("<x-foo />");
    expect(utils.stringify(elementOf(named(""), "X-FOO"))).toBe("<x-foo />");
    expect(utils.stringify(elementOf(named("Foo"), "BUTTON", { is: "x-foo" }))).toBe('<button is="x-foo" />');
  });

  test("the class has to go with the node type", () => {
    expect(isMarkup(new Comment({ nodeType: 3, data: "" }))).toBe(false);
    expect(isMarkup(new Text({ nodeType: 8, data: "" }))).toBe(false);
    expect(isMarkup(new Text({ nodeType: 11, data: "" }))).toBe(false);
    expect(isMarkup(new DocumentFragment({ nodeType: 1, childNodes: [] }))).toBe(false);
    expect(isMarkup(new HTMLElement({ nodeType: 2, tagName: "DIV" }))).toBe(false);
    expect(isMarkup(new HTMLElement({ nodeType: "1", tagName: "DIV" }))).toBe(false);
    expect(isMarkup(new (named("ShadowRoot"))({ nodeType: 11, childNodes: [] }))).toBe(false);
    expect(isMarkup(new (named("Document"))({ nodeType: 9, childNodes: [] }))).toBe(false);
  });

  test("a node has the string its markup is made of", () => {
    expect(isMarkup(new HTMLElement({ nodeType: 1 }))).toBe(false);
    expect(isMarkup(new HTMLElement({ nodeType: 1, tagName: 1 }))).toBe(false);
    expect(isMarkup(new Text({ nodeType: 3 }))).toBe(false);
    expect(isMarkup(new Comment({ nodeType: 8, data: null }))).toBe(false);
  });

  test("other objects print as before", () => {
    expect(utils.stringify({ nodeType: 1, tagName: "DIV" })).toBe('{\n  nodeType: 1,\n  tagName: "DIV",\n}');
    expect(utils.stringify({ nodeType: 1, tagName: "X-FOO" })).toBe('{\n  nodeType: 1,\n  tagName: "X-FOO",\n}');
    expect(isMarkup(Object.setPrototypeOf({ nodeType: 1, tagName: "X-FOO" }, null))).toBe(false);
    expect(utils.stringify({ nodeType: 1, tagName: "DIV", constructor: { name: "HTMLDivElement" } })).toBe("<div />");
    expect({ nodeType: 1, tagName: "DIV" }).toMatchInlineSnapshot(`
      {
        "nodeType": 1,
        "tagName": "DIV",
      }
    `);
    expect(new (class NodeLists extends ArrayLike {})([1])).toMatchInlineSnapshot(`
      NodeLists {
        "0": 1,
      }
    `);
    expect(new (class HTMLCollections extends Array {})(1, 2)).toMatchInlineSnapshot(`
      [
        1,
        2,
      ]
    `);
  });

  test("console.log and Bun.inspect print the object", () => {
    expect(Bun.inspect(button())).toStartWith("HTMLElement {\n  ownerDocument: {");
    expect(Bun.inspect(new NodeList([1]))).toStartWith('NodeList {\n  "0": 1,');
    expect(Bun.inspect(text("t"))).toStartWith("Text {\n  ownerDocument: {");
  });
});

describe("objects that misbehave", () => {
  const thrower = (key: string, on: object) =>
    Object.defineProperty(on, key, {
      get() {
        throw new Error(`${key} was read`);
      },
    });

  test.each(["nodeType", "constructor", "tagName", "hasAttribute"])("a %s that throws is not a node", key => {
    const node = thrower(key, elementOf(class Foo extends Node {}, key === "hasAttribute" ? "DIV" : "X-FOO"));
    expect(messageOf(() => expect(node).toBeNull())).toStartWith("expect(received).toBeNull()\n\nReceived: Foo {\n");
    expect(messageOf(() => expect(node).toEqual(1))).toContain("+ Foo {\n");
  });

  test("inside a node, it is an error", () => {
    const parent = () => h("div", {}, thrower("nodeType", h("i")));
    expect(messageOf(() => expect(parent()).toBeNull())).toBe("expect(received).toBeNull()\n\nReceived: ");
    expect(() => expect(parent()).toEqual(1)).toThrow("nodeType was read");
  });

  test("a hasAttribute() that throws is not a node", () => {
    const node = elementOf(class Foo extends Node {}, "DIV");
    node.hasAttribute = () => {
      throw new Error("hasAttribute was called");
    };
    expect(messageOf(() => expect(node).toBeNull())).toStartWith("expect(received).toBeNull()\n\nReceived: Foo {\n");
  });

  test("a Proxy that throws from every trap is not a node", () => {
    const traps = new Proxy(
      {},
      {
        get: (_, trap) => () => {
          throw new Error(`${String(trap)} trap`);
        },
      },
    );
    expect(messageOf(() => expect(new Proxy({ a: 1 }, traps)).toBeNull())).toBe(
      "expect(received).toBeNull()\n\nReceived: {\n  a: 1,\n}\n",
    );
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(messageOf(() => expect(proxy).toBeNull())).toBe(
      "expect(received).toBeNull()\n\nReceived: <Revoked Proxy>\n",
    );
  });

  test.each(["attributes", "childNodes"])("%s that throws: the assertion still fails, a snapshot reports it", key => {
    expect(messageOf(() => expect(thrower(key, button())).toBeNull())).toBe(
      "expect(received).toBeNull()\n\nReceived: ",
    );
    expect(() => expect(thrower(key, button())).toMatchInlineSnapshot()).toThrow(`${key} was read`);
    expect(() => expect(thrower(key, button())).toEqual(1)).toThrow(`${key} was read`);
  });

  test("an iterator that throws", () => {
    const attributes = new NamedNodeMap([]);
    attributes[Symbol.iterator] = function* () {
      yield new Attr("a", "1");
      throw new Error("the iterator threw");
    };
    expect(() => expect(attributes).toMatchInlineSnapshot()).toThrow("the iterator threw");
    expect(() =>
      expect(thrower("name", new Attr("a", "1")) && new NamedNodeMap([thrower("name", {})])).toEqual(1),
    ).toThrow("name was read");
  });

  test("a node that contains itself", () => {
    const node = h("div");
    Object.defineProperty(node, "childNodes", { value: [node] });
    expect(utils.stringify(node)).toBe(`${repeat("<div>", 10)}<div … />${repeat("</div>", 10)}`);
    expect(() => expect(node).toEqual(1)).toThrow(RangeError);

    const list = new NodeList([]);
    list[0] = list;
    expect(utils.stringify(list)).toBe(`${repeat("[", 10)}[NodeList]${repeat("]", 10)}`);
    expect(() => expect(list).toEqual(1)).toThrow(RangeError);
  });

  test("a length that is not the number of items", () => {
    for (const length of [2 ** 32, Infinity, 1e9, 3.5]) {
      expect(utils.stringify(Object.defineProperty(h("div"), "childNodes", { value: { length, 0: h("i") } }))).toBe(
        "<div><i /></div>",
      );
      expect(
        utils.stringify(Object.defineProperty(h("div"), "attributes", { value: { length, 0: new Attr("a", "1") } })),
      ).toBe('<div a="1" />');
    }
    for (const length of [-1, NaN, "1", undefined, null, {}]) {
      expect(utils.stringify(Object.defineProperty(h("div"), "childNodes", { value: { length, 0: h("i") } }))).toBe(
        "<div />",
      );
    }
  });

  test("attributes and children that are missing", () => {
    for (const missing of [undefined, null, 1, "ab"]) {
      const node = h("div");
      Object.defineProperty(node, "attributes", { value: missing });
      Object.defineProperty(node, "childNodes", { value: missing });
      expect(utils.stringify(node)).toBe("<div />");
    }
    const node = Object.defineProperty(h("div"), "childNodes", { value: undefined });
    expect(utils.stringify(Object.defineProperty(node, "children", { value: [h("i")] }))).toBe("<div><i /></div>");
    expect(
      utils.stringify(Object.defineProperty(h("div"), "attributes", { value: [null, 1, new Attr("a", "1")] })),
    ).toBe('<div a="1" />');
  });

  test("a getter that changes the node while it prints", () => {
    const state = { nodeType: 1, tagName: "DIV", attributes: [] as Attr[], childNodes: [] as unknown[] };
    const node = new HTMLElement(state);
    state.childNodes.push(
      h("i"),
      Object.defineProperty(h("b"), "attributes", {
        get() {
          state.childNodes.length = 0;
          Bun.gc(true);
          return [];
        },
      }),
      h("u"),
    );
    expect(utils.stringify(node)).toBe("<div><i /><b /><u /></div>");
  });
});

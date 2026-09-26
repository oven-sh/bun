// DOM nodes (jsdom, happy-dom) print as markup in `bun test` output, the
// way pretty-format's `DOMElement` plugin prints them for Jest: in snapshots,
// in matcher failure messages, and through `this.utils.printReceived`.
// `console.log` and `Bun.inspect` are not affected.
//
// https://github.com/oven-sh/bun/issues/44045
// https://github.com/oven-sh/bun/issues/5540
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { bunEnv, bunExe } from "harness";
import { JSDOM } from "jsdom";

const window = new Window();
const document = window.document;
const dom = new JSDOM("<!doctype html><html><body></body></html>");

function failureMessage(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return Bun.stripANSI(String((error as Error).message));
  }
  throw new Error("expected the matcher to fail");
}

describe("snapshots", () => {
  test("jsdom DocumentFragment", () => {
    const fragment = dom.window.document.createDocumentFragment();
    const button = dom.window.document.createElement("button");
    button.textContent = "Follow Auctioneer";
    fragment.append(button);

    expect(fragment).toMatchSnapshot();
    expect(fragment).toMatchInlineSnapshot(`
      <DocumentFragment>
        <button>
          Follow Auctioneer
        </button>
      </DocumentFragment>
    `);
  });

  test("happy-dom element: sorted attributes, text, comment, nested elements", () => {
    const div = document.createElement("div");
    div.setAttribute("id", "outer");
    div.setAttribute("data-x", "1");
    div.innerHTML = '<span class="a">hi &lt; there</span><!-- note --><button disabled></button>';

    expect(div).toMatchInlineSnapshot(`
      <div
        data-x="1"
        id="outer"
      >
        <span
          class="a"
        >
          hi &lt; there
        </span>
        <!-- note -->
        <button
          disabled=""
        />
      </div>
    `);
  });

  test("leaf nodes", () => {
    expect(document.createElement("br")).toMatchInlineSnapshot(`<br />`);
    expect(document.createTextNode("a<b>c")).toMatchInlineSnapshot(`a&lt;b&gt;c`);
    expect(document.createComment("c")).toMatchInlineSnapshot(`<!--c-->`);
    expect(document.createElementNS("http://www.w3.org/2000/svg", "svg")).toMatchInlineSnapshot(`<svg />`);
  });

  test("custom element", () => {
    class MyElement extends window.HTMLElement {}
    window.customElements.define("my-element", MyElement);
    const el = document.createElement("my-element");
    el.append(document.createElement("br"));

    expect(el).toMatchInlineSnapshot(`
      <my-element>
        <br />
      </my-element>
    `);
  });

  test("nodes inside objects and arrays", () => {
    expect({ el: document.createElement("br"), text: document.createTextNode("x") }).toMatchInlineSnapshot(`
      {
        "el": <br />,
        "text": x,
      }
    `);
    expect([document.createComment("c"), document.createElement("hr")]).toMatchInlineSnapshot(`
      [
        <!--c-->,
        <hr />,
      ]
    `);
  });
});

describe("matcher messages", () => {
  test("Received: prints markup, not the object graph", () => {
    const button = document.createElement("button");
    button.textContent = "hi";

    const message = failureMessage(() => expect(button).toBe(null));
    expect(message).toContain("Received: <button>\n  hi\n</button>");
    expect(message).not.toContain("Symbol(");
  });

  test("toEqual diff prints markup", () => {
    const text = document.createTextNode("a<b");
    const message = failureMessage(() => expect(text).toEqual({}));
    expect(message).toContain("a&lt;b");
    expect(message).not.toContain("Symbol(");
  });

  test("deep trees stop at the depth limit", () => {
    let el = document.createElement("div");
    for (let i = 0; i < 12; i++) {
      const p = document.createElement("p");
      p.append(el);
      el = p;
    }
    const message = failureMessage(() => expect(el).toBe(null));
    expect(message).toContain("<p \u2026 />");
    expect(message).not.toContain("<div");
  });

  test("printReceived, printExpected and stringify in a custom matcher", () => {
    const button = document.createElement("button");
    button.setAttribute("id", "x");
    let received = "";
    let expected = "";
    let stringified = "";
    expect.extend({
      toCaptureDomPrints(actual, other) {
        received = Bun.stripANSI(this.utils.printReceived(actual));
        expected = Bun.stripANSI(this.utils.printExpected(other));
        stringified = this.utils.stringify(actual);
        return { pass: true, message: () => "" };
      },
    });
    (expect(button) as any).toCaptureDomPrints(document.createTextNode("t"));

    expect(received).toBe('<button\n  id="x"\n/>');
    expect(expected).toBe("t");
    expect(stringified).toBe('<button\n  id="x"\n/>');
  });

  test("customized built-in element (is attribute) is a node", () => {
    class FancyButton {
      nodeType = 1;
      tagName = "BUTTON";
      attributes = [{ name: "is", value: "fancy-button" }];
      childNodes = [];
      hasAttribute(name: string) {
        return name === "is";
      }
    }
    const message = failureMessage(() => expect(new FancyButton()).toBe(null));
    expect(message).toContain('Received: <button\n  is="fancy-button"\n/>');
  });

  test("a class instance that only looks like a node prints as an object", () => {
    class HTMLBogusElement {
      nodeType = 99;
    }
    class Widget {
      nodeType = 1;
      tagName = "WIDGET";
    }
    expect(failureMessage(() => expect(new HTMLBogusElement()).toBe(null))).toContain("Received: HTMLBogusElement {");
    expect(failureMessage(() => expect(new Widget()).toBe(null))).toContain("Received: Widget {");
  });
});

test("console.log and Bun.inspect still print the object", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `class HTMLDivElement { nodeType = 1; tagName = "DIV"; attributes = []; childNodes = []; }
       console.log(new HTMLDivElement());
       console.log(Bun.inspect(new HTMLDivElement()).split("\\n")[0]);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe(
    'HTMLDivElement {\n  nodeType: 1,\n  tagName: "DIV",\n  attributes: [],\n  childNodes: [],\n}\nHTMLDivElement {\n',
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

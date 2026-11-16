import { desktopInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

let nextFontScope = 1000;

function open(html = "") {
  const page = desktopInternals.createPage({ native: null, surface: 0, fontScope: nextFontScope++ });
  page.parseHTML("<!doctype html>" + html);
  const $ = (selector: string) => page.document.querySelector(selector);
  return { ...page, $, [Symbol.dispose]: page.dispose };
}

describe("tree", () => {
  test("mutation, and live collections", () => {
    using page = open("<ul><li>a<li>b</ul>");
    const list = page.$("ul");
    const { children, childNodes } = list;
    const byTag = page.document.getElementsByTagName("li");
    list.prepend(page.document.createElement("li"), "text");
    expect([children.length, childNodes.length, byTag.length]).toEqual([3, 4, 3]);
    children[0].replaceWith(children[2]);
    expect(list.outerHTML).toBe("<ul><li>b</li>text<li>a</li></ul>");
    expect(() => list.firstChild.append(list)).toThrow(expect.objectContaining({ name: "HierarchyRequestError" }));
  });

  test("selectors match alike in and out of the document", () => {
    using page = open(
      `<section><p id=a class="x  Y" data-k=1><b class=xy hidden></b></p><svg><foreignObject class=x /></svg><input type=TEXT></section>`,
    );
    const ask = (root: any, selector: string) => [
      Array.from(root.querySelectorAll(selector), (it: any) => it.localName),
      root.querySelector(selector)?.localName,
      root.querySelector("b").closest(selector)?.localName,
      root.firstChild.matches(selector),
    ];
    const selectors = [
      "*",
      "p",
      ".x",
      ".x.Y",
      ".y",
      "#a",
      '[data-k="1"]',
      "b[hidden] , p",
      "foreignobject",
      "[type=text]",
    ];
    for (const selector of selectors) {
      expect(ask(page.$("section").cloneNode(true), selector)).toEqual(ask(page.$("section"), selector));
    }
  });

  test("a node has one wrapper, which keeps what scripts put on it", () => {
    using page = open("<p id=a></p>");
    page.$("p").custom = 1;
    Bun.gc(true);
    expect(page.document.getElementById("a").custom).toBe(1);
    expect(page.$("p")).toBeInstanceOf(page.window.HTMLParagraphElement);
  });

  test("selectors work in trees that are not in the document", () => {
    using page = open();
    const root = page.document.createElement("div");
    root.innerHTML = "<a class=x></a><b class='x y'></b>";
    expect(Array.from(root.querySelectorAll(".x"), (it: any) => it.localName)).toEqual(["a", "b"]);
    expect(root.lastChild.matches("a + .y")).toBe(true);
    expect(() => root.querySelector("!")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
  });

  test("nodes move between the documents of two pages", () => {
    using a = open("<p>x</p>");
    using b = open("<style>p { color: rgb(1, 2, 3) }</style>");
    const p = b.document.body.appendChild(a.$("p"));
    expect(p.ownerDocument).toBe(b.document);
    expect(a.$("p")).toBeNull();
    expect(b.window.getComputedStyle(p).color).toBe("rgb(1, 2, 3)");
  });

  test("ranges follow mutations", () => {
    using page = open("<p>hello world</p>");
    const text = page.$("p").firstChild;
    const range = page.document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 11);
    const second = text.splitText(5);
    expect([range.startContainer === second, range.startOffset, String(range)]).toEqual([true, 1, "world"]);
    range.surroundContents(page.document.createElement("b"));
    expect(page.$("p").innerHTML).toBe("hello <b>world</b>");
  });

  test("MutationObserver", async () => {
    using page = open("<div><i></i></div>");
    const { promise, resolve } = Promise.withResolvers<any[]>();
    const options = { subtree: true, childList: true, attributes: true, attributeOldValue: true };
    new page.window.MutationObserver(resolve).observe(page.$("div"), options);
    const i = page.$("i");
    i.id = "a";
    i.remove();
    i.id = "b";
    expect((await promise).map(it => [it.type, it.oldValue])).toEqual([
      ["attributes", null],
      ["childList", null],
      ["attributes", "a"],
    ]);
  });
});

test.each([
  ["<b>1<p>2</b>3</p>", "<b>1</b><p><b>2</b>3</p>"],
  ["<table>a<tr><td>b</table>", "a<table><tbody><tr><td>b</td></tr></tbody></table>"],
  ["<svg><foreignobject><p>a</svg>", "<svg><foreignObject><p>a</p></foreignObject></svg>"],
  ["<math><mi><style><img src=x></style>", "<math><mi><style><img src=x></style></mi></math>"],
  ["<template><td>a</template>", "<template><td>a</td></template>"],
  ["<a title='<&quot;>'>&notit; &amp &#x80;</a>", '<a title="&lt;&quot;&gt;">¬it; &amp; €</a>'],
  ["<textarea>\n\n</textarea ><!-->", "<textarea>\n</textarea><!---->"],
])("parses %j", (source, expected) => {
  using page = open();
  page.document.body.innerHTML = source;
  expect(page.document.body.innerHTML).toBe(expected);
});

describe("events", () => {
  test("phases, once, signal and stopPropagation", () => {
    using page = open("<div><p></p></div>");
    const log: string[] = [];
    const controller = new AbortController();
    page.window.addEventListener("x", () => log.push("window capture"), true);
    page.$("div").addEventListener("x", () => log.push("div once"), { once: true });
    page.$("p").addEventListener("x", () => log.push("p"), { signal: controller.signal });
    page.document.body.addEventListener("x", (event: Event) => event.stopPropagation());
    page.document.addEventListener("x", () => log.push("unreachable"));
    page.$("p").dispatchEvent(new page.window.Event("x", { bubbles: true }));
    controller.abort();
    page.$("p").dispatchEvent(new page.window.Event("x", { bubbles: true }));
    expect(log).toEqual(["window capture", "p", "div once", "window capture"]);
  });

  test("targets are retargeted out of shadow trees", () => {
    using page = open("<div></div>");
    const root = page.$("div").attachShadow({ mode: "closed" });
    root.innerHTML = "<button></button>";
    const seen: unknown[] = [];
    page.document.onclick = (event: any) => seen.push(event.target.localName, event.composedPath().length);
    root.firstChild.click();
    expect(seen).toEqual(["div", 5]);
  });

  test("an error in a listener goes to the window, and the next listener runs", () => {
    using page = open();
    const log: string[] = [];
    page.window.addEventListener("error", (event: ErrorEvent) => {
      event.preventDefault();
      log.push(event.error.message);
    });
    page.document.addEventListener("x", () => {
      throw new Error("first");
    });
    page.document.addEventListener("x", () => log.push("second"));
    page.document.dispatchEvent(new page.window.Event("x"));
    expect(log).toEqual(["first", "second"]);
  });
});

test("custom elements", () => {
  using page = open("<x-a n=1></x-a>");
  const log: string[] = [];
  class A extends page.window.HTMLElement {
    static observedAttributes = ["n"];
    attributeChangedCallback(name: string, old: string | null, value: string | null) {
      log.push(`${name} ${old} ${value}`);
    }
    connectedCallback() {
      log.push("connected");
    }
    disconnectedCallback() {
      log.push("disconnected");
    }
  }
  page.window.customElements.define("x-a", A);
  page.$("x-a").setAttribute("n", "2");
  page.$("x-a").remove();
  expect(log).toEqual(["n null 1", "connected", "n 1 2", "disconnected"]);
  expect(page.document.createElement("x-a")).toBeInstanceOf(A);
});

describe("forms", () => {
  test("FormData, reset and validity", () => {
    using page =
      open(`<form><input name=a value=1 required><input name=b type=checkbox><input name=c type=radio value=x>
      <input name=c type=radio value=y checked><select name=d><option>p<option selected>q</select>
      <textarea name=e>t</textarea><fieldset disabled><input name=f></fieldset></form>`);
    const form = page.$("form");
    const entries = () => String(new URLSearchParams(new page.window.FormData(form)));
    expect(entries()).toBe("a=1&c=y&d=q&e=t");
    form.a.value = "";
    form.b.click();
    form.c.value = "x";
    expect(entries()).toBe("a=&b=on&c=x&d=q&e=t");
    expect([form.checkValidity(), form.matches(":invalid"), form.a.validity.valueMissing]).toEqual([false, true, true]);
    form.reset();
    expect(entries()).toBe("a=1&c=y&d=q&e=t");
  });

  test("a canceled click puts a checkbox back", () => {
    using page = open("<label>a<input type=checkbox></label>");
    page.$("input").onclick = (event: any) => {
      expect(event.target.checked).toBe(true);
      event.preventDefault();
    };
    page.$("label").click();
    expect(page.$("input").checked).toBe(false);
  });

  test.each([
    ["number", "1e400", ""],
    ["range", "250", "100"],
    ["date", "2023-02-29", ""],
    ["week", "2020-W53", "2020-W53"],
    ["datetime-local", "2020-01-01 10:00:00.500", "2020-01-01T10:00:00.5"],
    ["color", "#ABCDEF", "#abcdef"],
    ["email", " a@b ", "a@b"],
  ])("<input type=%s> sanitizes %j", (type, value, expected) => {
    using page = open(`<input type=${type}>`);
    page.$("input").value = value;
    expect(page.$("input").value).toBe(expected);
  });
});

describe("editing", () => {
  function edit(before: string, command: string, value?: string, style = "") {
    using page = open(`<div contenteditable style="${style}">${before}</div>`);
    const host = page.$("div");
    const ends = [];
    const walker = page.document.createTreeWalker(host, 4);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      for (let at; (at = text.data.search(/[\[\]]/)) >= 0; text.deleteData(at, 1)) ends.push(text, at);
    }
    host.focus();
    page.window.getSelection().setBaseAndExtent(...ends);
    page.document.execCommand(command, false, value);
    return host.innerHTML;
  }

  test.each([
    ["a[b]c", "bold", undefined, "a<b>b</b>c"],
    ["<b>a[b]c</b>", "bold", undefined, "<b>a</b>b<b>c</b>"],
    ["a[b]c", "createLink", "x", 'a<a href="x">b</a>c'],
    ["<p>a</p><p>[]b</p>", "delete", undefined, "<p>ab</p>"],
    ["<p>a[]</p><p>b</p>", "forwardDelete", undefined, "<p>ab</p>"],
    ["<p>a[b</p><p>c]d</p>", "delete", undefined, "<p>ad</p>"],
    ["<p>a[]</p>", "delete", undefined, "<p><br></p>"],
    ["<p>a[]b</p>", "insertParagraph", undefined, "<p>a</p><p>b</p>"],
    ["<p>a[]</p>", "insertLineBreak", undefined, "<p>a<br><br></p>"],
    ["<p>a[]</p>", "insertText", " ", "<p>a&nbsp;</p>"],
    ["<p>[a]</p>", "formatBlock", "h1", "<h1>a</h1>"],
    ["[a]", "insertUnorderedList", undefined, "<ul><li>a</li></ul>"],
    ["a[]<span contenteditable=false>x</span>b", "forwardDelete", undefined, "ab"],
  ])("%s, %s", (before, command, value, after) => {
    expect(edit(before, command, value)).toBe(after);
  });

  test("spaces are spaces where they are preserved", () => {
    expect(edit("<p>a[]</p>", "insertText", " ", "white-space: pre-wrap")).toBe("<p>a </p>");
  });

  test("a selection can begin in a shadow tree and end outside of it", () => {
    using page = open("<div></div><p>b</p>");
    const root = page.$("div").attachShadow({ mode: "open" });
    root.textContent = "a";
    const selection = page.window.getSelection();
    selection.setBaseAndExtent(root.firstChild, 0, page.$("p").firstChild, 1);
    const ends = (shadowRoots: object[]) => {
      const [range] = selection.getComposedRanges({ shadowRoots });
      return [range.startContainer.nodeName, range.startOffset, range.endContainer.nodeName, range.endOffset];
    };
    expect([ends([root]), ends([])]).toEqual([
      ["#text", 0, "#text", 1],
      ["BODY", 0, "#text", 1],
    ]);
  });

  test("a range of the value of a text control follows it", () => {
    using page = open("<input value='hello world'>");
    const input = page.$("input");
    const range = input.createValueRange(6, 11);
    input.setRangeText("hi", 0, 5);
    expect([range.startOffset, range.endOffset]).toEqual([3, 8]);
    input.remove();
    expect([range.startOffset, range.endOffset]).toEqual([0, 0]);
  });
});

describe("HTML parser", () => {
  test("processing instructions, and templates that replace what they mark", () => {
    using page = open();
    const { body } = page.document;
    body.innerHTML = '<?a b="c"?><?xml d><p><?start name="x">old<?end></p><template for=x><i>new</template>';
    expect(body.innerHTML).toBe('<?a b="c"?><!--?xml d--><p><i>new</i></p>');
    expect(body.firstChild.getAttribute("b")).toBe("c");
  });

  test("the result does not depend on how the input is cut up", () => {
    const source =
      "<table> x<tr><td>&amp;&notin;\r\n</table><textarea>\na</b></textarea><style>a<b</style><!--c--><?d e>";
    using page = open();
    const written = (chunks: Iterable<string>) => {
      page.document.open();
      for (const chunk of chunks) page.document.write(chunk);
      page.document.close();
      return page.document.documentElement.outerHTML;
    };
    expect(written(source)).toBe(written([source]));
  });

  test("an element that its constructor has made an ancestor of its parent is dropped", () => {
    using page = open();
    const { document, window } = page;
    window.customElements.define(
      "x-a",
      class extends window.HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: "open" }).append(document.body);
        }
      },
    );
    document.write("<body><x-a></x-a>");
    document.close();
    expect(document.documentElement.outerHTML).toBe("<html><head></head></html>");
  });
});

describe("images", () => {
  test.each([
    ["a 1x, b 2x", "", "a"],
    ["a,, b 1x", "", "a"],
    ["a 1x 1w, b 1e0x", "", "b"],
    ["a 50w, b 51w", "(min-width: 0) calc(2px - 1px), 100vw", "a"],
    ["a 50w, b 51w", "all 1px, 100px", "b"],
  ])("srcset=%s sizes=%s", async (srcset, sizes, expected) => {
    using page = open();
    const image = page.document.createElement("img");
    image.sizes = sizes;
    image.srcset = srcset.replace(/\b[ab]\b/g, "data:,$&");
    await image.decode().catch(() => {});
    expect(image.currentSrc).toBe("data:," + expected);
  });
});

describe("CSSOM", () => {
  test("inline styles and the attribute stay in sync", () => {
    using page = open("<p style='margin-top: 1px'></p>");
    const p = page.$("p");
    p.style.width = "nonsense";
    p.style.setProperty("--x", "1", "important");
    expect(p.getAttribute("style")).toBe("margin-top: 1px; --x: 1 !important;");
    p.setAttribute("style", "height: 2px");
    expect([p.style.length, p.style[0], p.style.marginTop]).toEqual([1, "height", ""]);
  });

  test("insertRule, deleteRule and adoptedStyleSheets apply at once", () => {
    using page = open("<style></style><p></p>");
    const order = () => page.window.getComputedStyle(page.$("p")).order;
    const { sheet } = page.$("style");
    sheet.insertRule("p { order: 1 }");
    expect(order()).toBe("1");
    expect(() => sheet.insertRule("p::-nope { order: 2 }")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
    const adopted = new page.window.CSSStyleSheet();
    adopted.replaceSync("p { order: 3 }");
    page.document.adoptedStyleSheets = [adopted];
    expect(order()).toBe("3");
    adopted.cssRules[0].style.order = "4";
    expect(order()).toBe("4");
    page.document.adoptedStyleSheets = [];
    sheet.deleteRule(0);
    expect(order()).toBe("0");
  });
});

test("dialog and popover", () => {
  using page = open("<button popovertarget=p></button><div id=p popover></div><dialog><input></dialog>");
  page.$("button").click();
  expect(page.$("#p").matches(":popover-open")).toBe(true);
  page.$("button").focus();
  page.$("dialog").showModal();
  expect(page.$("#p").matches(":popover-open")).toBe(false);
  expect(page.document.activeElement).toBe(page.$("input"));
  page.$("dialog").close("done");
  expect([page.$("dialog").returnValue, page.document.activeElement.localName]).toEqual(["done", "button"]);
});

test("Web Animations", async () => {
  using page = open("<p></p>");
  const animation = page.$("p").animate({ opacity: [0, 1] }, 1000);
  animation.pause();
  animation.currentTime = 250;
  expect(page.window.getComputedStyle(page.$("p")).opacity).toBe("0.25");
  animation.finish();
  expect(await animation.finished).toBe(animation);
  expect(page.$("p").getAnimations()).toEqual([]);
});

test("history", async () => {
  using page = open();
  page.setUrl("https://example.invalid/a");
  page.window.history.pushState({ n: 1 }, "", "/b?c#d");
  expect(page.window.location.href).toBe("https://example.invalid/b?c#d");
  const { promise, resolve } = Promise.withResolvers<any>();
  page.window.onpopstate = resolve;
  page.window.history.back();
  expect((await promise).state).toBeNull();
  expect(page.window.location.pathname).toBe("/a");
});

test("bun:desktop/dom makes the global object a window", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import * as dom from "bun:desktop/dom";
      addEventListener("x", event => console.log(event.target === window));
      dispatchEvent(new Event("x"));
      new EventTarget().dispatchEvent(new CustomEvent("y"));
      console.log(dom.window === globalThis, dom.document === document, window instanceof Window);
      console.log(document.documentElement.outerHTML);`,
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("true\ntrue true true\n<html><head></head><body></body></html>\n");
  expect(exitCode).toBe(0);
});

test("an initial value does not depend on the element that it is first written for", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import "bun:desktop/dom";
      document.body.innerHTML = '<p style="color: red"></p><b style="color: blue"></b>';
      const [p, b] = document.body.children;
      getComputedStyle(p).textEmphasis;
      b.style.textEmphasis = "dot";
      console.log(b.style.textEmphasisColor, getComputedStyle(b).textEmphasisColor);`,
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("currentcolor rgb(0, 0, 255)\n");
  expect(exitCode).toBe(0);
});

test("margins collapse through a block that is no longer a flex item", () => {
  using page = open(`<div style="display: flex; flex-direction: column">
    <div id="outer" style="display: flex; flex-direction: column"><div id="inner"><p style="margin: 18px 0 2px; height: 32px"></p></div></div>
  </div>`);
  const heights = ["flex", "block", "flex"].map(display => {
    page.$("#outer").style.display = display;
    return page.$("#inner").offsetHeight;
  });
  expect(heights).toEqual([52, 32, 52]);
});

test("a scroll container without a height gets its scrollbar when the overflow changes", () => {
  using page = open(`<div style="overflow-y: auto; height: 0; width: 200px">
    <div id="outer" style="height: 0"><div id="inner" style="height: 0"><p style="margin: 0; height: 100px"></p></div></div>
  </div>`);
  const width = page.$("#outer").offsetWidth;
  page.$("#inner").style.contain = "paint";
  expect(page.$("#outer").offsetWidth).toBe(200);
  page.$("#inner").style.contain = "";
  expect(page.$("#outer").offsetWidth).toBe(width);
});

test("selectAll stays in the shadow tree that has the caret", () => {
  using page = open("<p>outside</p><div></div>");
  const root = page.$("div").attachShadow({ mode: "open" });
  root.innerHTML = "<p>inside</p>";
  page.window.getSelection().collapse(root.firstChild.firstChild, 1);
  page.document.execCommand("selectAll");
  expect(String(page.window.getSelection()).trim()).toBe("inside");
});

test("custom elements and constructed sheets of a frame that shares the interfaces", () => {
  using page = open("<iframe></iframe>");
  const { customElements, document, CSSStyleSheet, HTMLElement, getComputedStyle } = page.$("iframe").contentWindow;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(":host { margin-left: 3px }");
  customElements.define(
    "x-a",
    class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
      }
    },
  );
  expect(getComputedStyle(document.body.appendChild(document.createElement("x-a"))).marginLeft).toBe("3px");
});

test("moveBefore updates inherited custom properties", () => {
  using page = open(
    `<div id=to style="--x:4px"><div style="--x:1px"><div id=moved><p style="margin-left:var(--x)"></div></div></div>`,
  );
  const margin = () => page.window.getComputedStyle(page.$("p")).marginLeft;
  expect(margin()).toBe("1px");
  page.$("#to").moveBefore(page.$("#moved"), null);
  expect(margin()).toBe("4px");
});

test("a registered length is relative to the font of the element that declares it", () => {
  using page = open(
    `<style>@property --x{syntax:"<length>";inherits:true;initial-value:0} p{--x:2em;font-size:20px;margin-left:var(--x)}</style><p>`,
  );
  expect(page.window.getComputedStyle(page.$("p")).marginLeft).toBe("40px");
});

test("an element that is moved with boxes to build still gets boxes for what is added later", () => {
  using page =
    open(`<div><div style="display: contents"><div id=moved style="display: contents"><div id=row><div id=inner></div></div></div></div></div>
    <div><div id=home style="display: contents"></div></div>`);
  expect(page.$("#row").offsetHeight).toBe(0);
  page.$("#inner").append("x");
  page.$("#home").moveBefore(page.$("#moved"), null);
  const before = page.$("#row").offsetHeight;
  page.$("#row").insertAdjacentHTML("beforeend", "<p style='margin: 0; height: 7px'></p>");
  expect(page.$("#row").offsetHeight).toBe(before + 7);
});

test("elements that look alike get the rules that match where they are", () => {
  using page = open(`<style>
    p { width: 1px } [data-on] p { width: 2px } .late p { width: 3px } p:last-child { height: 4px } p + p { margin-left: 5px }
    [style*="color"] > p { padding-left: 6px } @scope (.from) to (.limit) { p { padding-top: 7px } }
  </style><main></main>`);
  const add = (html: string) => {
    page.$("main").insertAdjacentHTML("beforeend", html);
    return [...page.$("main").lastElementChild.querySelectorAll("p")].map(it => {
      const { width, height, marginLeft, paddingLeft, paddingTop } = page.window.getComputedStyle(it);
      return [width, height, marginLeft, paddingLeft, paddingTop].map(parseFloat).join();
    });
  };
  expect(add("<div><p></p><p></p></div>")).toEqual(["1,0,0,0,0", "1,4,5,0,0"]);
  expect(add("<div><p></p></div>")).toEqual(["1,4,0,0,0"]);
  expect(add("<div data-on><p></p></div>")).toEqual(["2,4,0,0,0"]);
  expect(add("<div class=late><p></p></div>")).toEqual(["3,4,0,0,0"]);
  expect(add("<div style='top: 0'><p></p></div>")).toEqual(["1,4,0,0,0"]);
  expect(add("<div style='color: red'><p></p></div>")).toEqual(["1,4,0,6,0"]);
  expect(add("<div class=from><p></p><div class=limit><p></p></div></div>")).toEqual(["1,0,0,0,7", "1,4,0,0,0"]);
  page.$("main").setAttribute("data-on", "");
  expect(add("<div><p></p></div>")).toEqual(["2,4,0,0,0"]);
});

test("styles stay right after many rule lists have come and gone", () => {
  using page = open("<style>p { height: 3px }</style><p id=kept style='width: 9px'></p><main></main>");
  for (let round = 0; round < 3; round++) {
    page.$("main").innerHTML = Array.from(
      { length: 600 },
      (_, i) => `<p style="width: ${round * 600 + i}px"></p>`,
    ).join("");
    expect(page.$("main").lastElementChild.offsetWidth).toBe(round * 600 + 599);
    page.render();
  }
  page.$("#kept").className = "other";
  expect([page.$("#kept").offsetWidth, page.$("#kept").offsetHeight]).toEqual([9, 3]);
});

describe("content-visibility", () => {
  const html = `<style>* { margin: 0 } .big p { height: 70px } p { height: 50px }</style>
    <div id=outer><div id=lock style="height: 40px"><div id=scroller style="height: 40px; overflow: auto"><p>a</p><p id=b>b</p></div></div></div>`;

  test("hidden contents keep their scroll offset, and catch up when they are shown", () => {
    using page = open(html);
    page.$("#scroller").scrollTop = 30;
    page.$("#lock").style.contentVisibility = "hidden";
    expect([page.$("#lock").offsetHeight, page.$("#b").checkVisibility()]).toEqual([40, false]);
    page.$("#outer").className = "big";
    page.$("#outer").style.color = "rgb(1, 2, 3)";
    page.$("#scroller").append(page.document.createElement("p"));
    expect(page.document.elementFromPoint(5, 5).id).toBe("lock");
    page.$("#lock").style.contentVisibility = "";
    expect([page.$("#scroller").scrollHeight, page.$("#b").checkVisibility()]).toEqual([210, true]);
    expect(page.$("#scroller").scrollTop).toBe(30);
    expect(page.window.getComputedStyle(page.$("#b")).color).toBe("rgb(1, 2, 3)");
  });

  test("hidden contents that were laid out before are not text of the page", () => {
    using page = open("<p>a</p><div>b</div>");
    expect(page.document.body.innerText).toBe("a\n\nb");
    page.$("div").style.contentVisibility = "hidden";
    page.window.getSelection().selectAllChildren(page.document.body);
    expect([page.document.body.innerText, String(page.window.getSelection()).trim()]).toEqual(["a", "a"]);
  });

  test("looking at hidden contents brings them up to date", () => {
    using page = open(html.replace("height: 40px", "content-visibility: hidden"));
    expect([page.$("#b").offsetHeight, page.$("#lock").offsetHeight]).toEqual([50, 0]);
    page.$("#outer").className = "big";
    expect(page.window.getComputedStyle(page.$("#b")).height).toBe("70px");
    expect(page.$("#outer").offsetHeight).toBe(0);
  });

  test("a fixed box in an absolute box whose containing block is further up is laid out", () => {
    using page = open(
      `<div style="position: relative"><div><div style="position: absolute"><i style="position: fixed; width: 7px"></i></div></div></div>`,
    );
    expect(page.$("i").offsetWidth).toBe(7);
  });
});

test.skipIf(isWindows)("a panic in the engine does not end the process", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const engine = new (require("bun:internal-for-testing").desktopInternals.engine.Engine)(1, "about:blank");
       const root = engine.createElement("html", 0);
       engine.insert(1, root, 0);
       engine.setAttribute(root, "style", "width:30px;height:20px");
       const state = () => console.log(engine.isBroken(), engine.boundingRect(root).join());
       state();
       for (let i = 0; i < 3; i++) engine.panicForTesting(), state();`,
    ],
    // What a panic interrupts is leaked on purpose (src/dom/recovery.rs).
    env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("false 0,0,30,20\n".repeat(3) + "true \n");
  expect(stderr.split("for testing")).toHaveLength(4);
  expect(exitCode).toBe(0);
});

describe("removed trees are collected", () => {
  const COUNT = 200;
  type Page = ReturnType<typeof open>;

  async function survivors(page: Page, use: (element: any) => unknown) {
    const references: WeakRef<object>[] = [];
    for (let i = 0; i < COUNT; i++) {
      const element = page.document.createElement("div");
      element.textContent = "text";
      references.push(new WeakRef(element));
      page.document.body.append(element);
      await use(element);
      element.remove();
    }
    page.render();
    await new Promise(resolve => setImmediate(resolve));
    page.render();
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
    return references.filter(it => it.deref() !== undefined).length;
  }

  const cases: Record<string, (page: Page) => (element: any) => unknown> = {
    "after they have adopted a shared style sheet": page => {
      const sheet = (page.window.sheet = new page.window.CSSStyleSheet());
      return element => {
        element.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
        element.offsetWidth;
      };
    },
    "after an animation that fills forwards has finished": () => element => {
      const animation = element.animate({ opacity: [1, 0] }, { duration: 1000, fill: "forwards" });
      animation.finish();
      return animation.finished;
    },
    "while an animation that fills forwards is finishing": () => element =>
      element.animate({ opacity: [1, 0] }, { duration: 0, fill: "forwards" }).playState,
    "when a disconnected observer of another element refers to them": page => element => {
      for (const Observer of [page.window.ResizeObserver, page.window.IntersectionObserver]) {
        const observer = new Observer(() => element);
        observer.observe(page.document.createElement("p"));
        observer.observe(page.document.body);
        observer.disconnect();
      }
    },
    "when they are observed": page => {
      const sizes = (page.window.sizes = new page.window.ResizeObserver(() => {}));
      const mutations = (page.window.mutations = new page.window.MutationObserver(() => {}));
      return element => {
        sizes.observe(element);
        mutations.observe(element, { childList: true });
      };
    },
    "when a removed media query listener refers to them": page => element => {
      const list = page.window.matchMedia("(min-width: 1px)");
      const listener = () => element;
      list.held = element;
      list.addEventListener("change", listener);
      list.removeEventListener("change", listener);
    },
    "when a removed listener had a signal that lives on": page => {
      const { signal } = (page.window.controller = new AbortController());
      return element => element.addEventListener("click", () => element, { signal });
    },
  };
  // A compilation that is under way on another thread holds on to the values that it has seen.
  test("in each case", async () => {
    const entries = Object.entries(cases).map(([name, use]) => `[${JSON.stringify(name)}, ${use}]`);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { desktopInternals } = require("bun:internal-for-testing");
         let nextFontScope = 1;
         const COUNT = ${COUNT};
         ${open}
         ${survivors}
         for (const [name, use] of [${entries}]) {
           using page = open();
           console.log(JSON.stringify([name, await survivors(page, use(page))]));
         }`,
      ],
      env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const found = stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    expect(found.map(([name]) => name)).toEqual(Object.keys(cases));
    expect(found.filter(([, alive]) => alive >= COUNT / 10)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("an animation that fills forwards applies again when the element comes back", async () => {
    using page = open("<p>");
    const element = page.$("p");
    const animation = element.animate({ opacity: [1, 0.5] }, { duration: 1000, fill: "forwards" });
    animation.finish();
    await animation.finished;
    element.remove();
    await new Promise(resolve => setImmediate(resolve));
    page.document.body.append(element);
    expect([page.window.getComputedStyle(element).opacity, element.getAnimations()]).toEqual(["0.5", [animation]]);
  });

  test("a shadow root that comes back follows the sheet that it has adopted", () => {
    using page = open("<p>");
    const element = page.$("p");
    const sheet = new page.window.CSSStyleSheet();
    element.attachShadow({ mode: "open" }).adoptedStyleSheets = [sheet];
    const colors = ["red", "blue", "lime"].map((color, i) => {
      if (i === 1) element.remove();
      sheet.replaceSync(`:host { color: ${color} }`);
      if (i === 1) page.document.body.append(element);
      return page.window.getComputedStyle(element).color;
    });
    expect(colors).toEqual(["rgb(255, 0, 0)", "rgb(0, 0, 255)", "rgb(0, 255, 0)"]);
  });

  test("after a live collection has listed them", async () => {
    using page = open();
    const all = page.document.getElementsByTagName("div");
    const references = (() => {
      page.document.body.innerHTML = Buffer.alloc(COUNT * 11, "<div></div>").toString();
      const listed = Array.from(all, (it: object) => new WeakRef(it));
      page.document.body.replaceChildren();
      return listed;
    })();
    page.render();
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
    expect(references.filter(it => it.deref() !== undefined).length).toBeLessThan(COUNT / 4);
    expect(all.length).toBe(0);
  });
});

test.each([
  `<b onclick=x>a</b><a href=" java\tscript:x">b</a>`,
  `<form><math><mtext></form><form><mglyph><style></math><img src=x onerror=x>`,
  `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=x onerror=x&gt;">`,
  `a<template><img src=x onerror=x></template>`,
  `<svg><a><animate attributeName=href values="x;javascript:x" /><text>a</text></a></svg>`,
])("what is pasted has no scripts: %s", html => {
  const clipboard = { readText: () => "a", readHTML: () => html };
  const page = desktopInternals.createPage({ native: null, surface: 0, fontScope: nextFontScope++, clipboard });
  using _ = { [Symbol.dispose]: page.dispose };
  page.parseHTML("<!doctype html><div contenteditable></div>");
  const editor = page.document.querySelector("div");
  editor.focus();
  page.edit("paste");
  expect(editor.childNodes.length).toBeGreaterThan(0);
  expect(editor.querySelector("[onclick], [onerror], [href], template, animate")).toBeNull();
});

test("a <source> in a document without a window", async () => {
  const page = desktopInternals.createPage({ native: null, surface: 0, fontScope: nextFontScope++ });
  using _ = { [Symbol.dispose]: page.dispose };
  const errors: string[] = [];
  page.window.addEventListener("error", (event: ErrorEvent) => errors.push(event.message));
  const parsed = new page.window.DOMParser().parseFromString(
    "<video><source src=http://a.test/a.webm></video>",
    "text/html",
  );
  await Promise.resolve();
  expect([parsed.querySelector("video").currentSrc, errors]).toEqual(["http://a.test/a.webm", []]);
});

test("the clone of a declarative shadow root is available to ElementInternals", () => {
  const page = desktopInternals.createPage({ native: null, surface: 0, fontScope: nextFontScope++ });
  using _ = { [Symbol.dispose]: page.dispose };
  page.parseHTML("<!doctype html><body>");
  page.document.body.setHTMLUnsafe("<a-b><template shadowrootmode=closed shadowrootclonable>x</template></a-b>");
  page.window.customElements.define(
    "a-b",
    class extends page.window.HTMLElement {
      internals = this.attachInternals();
    },
  );
  expect(page.document.querySelector("a-b").cloneNode(true).internals.shadowRoot.textContent).toBe("x");
});

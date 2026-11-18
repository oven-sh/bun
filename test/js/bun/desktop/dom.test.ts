import { desktopInternals } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
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

  test("getElementById() out of the document finds an id that the script has only computed", () => {
    using page = open(`<template><div><h3 id="only-computed"></h3></div></template>`);
    const { content } = page.$("template");
    const shadow = page.document.createElement("div").attachShadow({ mode: "open" });
    shadow.append(page.document.importNode(content, true));
    const id = ["only", "computed"].join("-");
    expect([shadow.getElementById(id)?.localName, content.getElementById(id)?.localName]).toEqual(["h3", "h3"]);
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

  // Each pair has the same public hash in src/dom/name.rs.
  test("names whose hashes collide are different names", () => {
    using page = open(`<style>
      .collision-victim, #collision-victim, collision-victim, [aria-describedby] { color: rgb(255, 0, 0) }
      i { --collision-name: 1px; width: var(--000hdxQNqdW6Ff, 2px) }
    </style><p class=collision-victim></p><b class=x0002yrubADLKLS-></b><u id=x0002yrubADLKLS-></u><s x0001d3kjtxtm9kt></s><q></q><i></i>`);
    page.$("q").setAttribute("x001x7z95^_6e%+", "");
    const custom = page.document.body.appendChild(
      page.document.createElementNS("http://www.w3.org/1999/xhtml", "x0002yrubADLKLS-"),
    );
    const color = (it: any) => page.window.getComputedStyle(it).color;
    expect([page.$("b"), page.$("u"), page.$("s"), custom].map(color)).toEqual(Array(4).fill("rgb(0, 0, 0)"));
    expect(color(page.$("p"))).toBe("rgb(255, 0, 0)");
    expect(page.window.getComputedStyle(page.$("i")).width).toBe("2px");
    const count = (selector: string) => page.document.querySelectorAll(selector).length;
    expect(
      [".collision-victim", ".x0002yrubADLKLS-", "[aria-describedby]", "[contenteditable]", "q:read-write"].map(count),
    ).toEqual([1, 1, 0, 0, 0]);
  });

  test.each([1, 2, 3])("the first element with an id or a name is found among many (seed %d)", seed => {
    using page = open("<div></div><div></div><div></div>");
    const { document } = page;
    const random = (below: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % below;
    const made = Array.from({ length: 40 }, () => document.createElement("img"));
    for (let step = 0; step < 3000; step++) {
      const [it, other, name] = [made[random(40)], made[random(40)], "ab"[random(2)]];
      const changes = [
        () => document.body.children[random(3)].append(it),
        () => document.body.children[random(3)].prepend(it),
        () => other.before(it),
        () => it.remove(),
        () => (it.id = name),
        () => (it.name = name),
        () => it.removeAttribute("id"),
        () => it.removeAttribute("name"),
        () => document.body.prepend(document.body.children[random(3)]),
      ];
      changes[random(changes.length)]();
      if (random(3)) continue;
      const all = [...document.body.children].flatMap(it => [...it.children]);
      const named = all.filter(it => it.name === name || (it.id === name && it.name));
      const found = document[name];
      expect(document.getElementById(name) === (all.find(it => it.id === name) ?? null)).toBe(true);
      expect(document.querySelector("#" + name) === document.getElementById(name)).toBe(true);
      expect(document.querySelectorAll("#" + name).length).toBe(all.filter(it => it.id === name).length);
      expect((found?.nodeType ? [found] : [...(found ?? [])]).map(it => made.indexOf(it))).toEqual(
        named.map(it => made.indexOf(it)),
      );
    }
  });

  test("an attribute that is set to what it is still counts as changed", () => {
    using page = open("<p id=a class=b title=c onclick=d></p><x-a title=c></x-a>");
    const [it, log] = [page.$("p"), [] as string[]];
    const again = (it: any) =>
      it.getAttributeNames().forEach((name: string) => it.setAttribute(name, it.getAttribute(name)));
    again(it);
    expect([page.document.getElementById("a") === it, it.outerHTML]).toEqual([
      true,
      '<p id="a" class="b" title="c" onclick="d"></p>',
    ]);
    page.window.customElements.define(
      "x-a",
      class extends page.window.HTMLElement {
        static observedAttributes = ["title"];
        attributeChangedCallback(...given: string[]) {
          log.push(given.slice(0, 3).join());
        }
      },
    );
    again(page.$("x-a"));
    const observer = new page.window.MutationObserver(() => {});
    observer.observe(it, { attributeOldValue: true });
    again(it);
    expect(log).toEqual(["title,,c", "title,c,c"]);
    expect(observer.takeRecords().map((it: any) => it.oldValue)).toEqual(["a", "b", "c", "d"]);
  });

  test("an attribute node keeps the value that was removed", () => {
    using page = open("<p title=a></p>");
    const node = page.$("p").getAttributeNode("title");
    page.$("p").title = "b";
    page.$("p").removeAttribute("title");
    expect([node.value, node.ownerElement]).toEqual(["b", null]);
  });

  test("classList tidies the attribute up", () => {
    using page = open("<p>");
    const it = page.$("p");
    const after = (value: string, change: (list: any) => void) => (
      (it.className = value),
      change(it.classList),
      it.className
    );
    const values = ["", "a", "a b", "b a", "a b c", "ab a", " a", "a ", "a  b", "a\tb", "a b a", "é a", "\u{1f600} a"];
    expect(values.map(value => after(value, list => list.add("a")))).toEqual([
      "a",
      "a",
      "a b",
      "b a",
      "a b c",
      "ab a",
      "a",
      "a",
      "a b",
      "a b",
      "a b",
      "é a",
      "\u{1f600} a",
    ]);
    expect(values.map(value => after(value, list => list.remove("a")))).toEqual([
      "",
      "",
      "b",
      "b",
      "b c",
      "ab",
      "",
      "",
      "b",
      "b",
      "b",
      "é",
      "\u{1f600}",
    ]);
    expect(values.map(value => after(value, list => list.toggle("b")))).toEqual([
      "b",
      "a b",
      "a",
      "a",
      "a c",
      "ab a b",
      "a b",
      "a b",
      "a",
      "a",
      "a",
      "é a b",
      "\u{1f600} a b",
    ]);
    expect(
      after(
        "a",
        list => (
          list.add("b"),
          list.add("c"),
          list.remove("b"),
          list.add("a"),
          list.remove("c"),
          list.remove("a"),
          list.add("d")
        ),
      ),
    ).toBe("d");
  });

  test("the places of many children are known while they change", () => {
    using page = open("<div></div>");
    const [parent, range] = [page.$("div"), page.document.createRange()];
    const all = Array.from({ length: 100 }, () => parent.appendChild(page.document.createElement("p")));
    for (let step = 0; step < 300; step++) {
      const [moved] = all.splice((step * 37) % all.length, 1);
      const to = (step * 11) % all.length;
      parent.insertBefore(moved, all[to]);
      all.splice(to, 0, moved);
      const [a, b] = [(step * 7) % all.length, (step * 13) % all.length];
      range.setStartBefore(all[a]);
      range.setEndAfter(parent.lastChild);
      expect([range.startOffset, range.endOffset, all[a].compareDocumentPosition(all[b])]).toEqual([
        a,
        100,
        a === b ? 0 : a < b ? 4 : 2,
      ]);
    }
  });

  test.each([
    ["elements with the same id", (it: any) => (it.id = "a"), (it: any) => it.ownerDocument.getElementById("a")],
    ["places of children", () => {}, (it: any, range: any) => range.selectNode(it)],
    ["the order of children", () => {}, (it: any, range: any) => range.comparePoint(it, 0)],
  ])("asking for %s takes time in proportion to their number", (_, prepare, ask) => {
    using page = open();
    const all = Array.from({ length: 100_000 }, () => page.document.body.appendChild(page.document.createElement("p")));
    const range = page.document.createRange();
    range.selectNodeContents(all[50_000]);
    all.forEach(prepare);
    for (const it of all) ask(it, range);
    for (const it of all.reverse()) (ask(it, range), it.remove());
    expect(page.document.body.childNodes.length).toBe(0);
  });

  test.each([
    ["beforetoggle", "<button popovertarget=it></button><p id=it popover></p>"],
    ["command", "<button command=--a commandfor=it></button><p id=it></p>"],
    ["submit", "<form id=it onsubmit='return false'><button></button></form>"],
  ])("%s stays in the shadow tree that has its source", (type, html) => {
    using page = open("<div></div>");
    const [root, seen] = [page.$("div").attachShadow({ mode: "open" }), [] as unknown[]];
    root.innerHTML = html;
    for (const it of [page.$("div"), root])
      it.addEventListener(
        type,
        (event: any) => seen.push([it === root, event.composed, event.composedPath().length]),
        true,
      );
    root.querySelector("button").click();
    expect(seen).toEqual([[true, true, 2]]);
  });

  test("listeners are removed one by one", () => {
    using page = open("<p>");
    const [target, log] = [page.$("p"), [] as number[]];
    const all = Array.from({ length: 12 }, (_, i) => ["ab"[i % 2], () => log.push(i), i % 3 === 0] as const);
    for (const it of all) target.addEventListener(...it);
    for (const i of [7, 0, 11, 4, 3]) target.removeEventListener(...all[i]);
    target.removeEventListener("a", all[1][1]);
    target.addEventListener(...all[0]);
    for (const type of "ab") target.dispatchEvent(new page.window.Event(type));
    expect(log).toEqual([6, 0, 2, 8, 10, 9, 1, 5]);
  });

  test("objects with named properties only take indices like other names", () => {
    using page = open();
    page.document[0] = "a";
    expect([page.document[0], delete page.document[0], page.document[0]]).toEqual(["a", true, undefined]);
    expect(delete page.document.body.dataset[0]).toBe(true);
  });

  test("a click may be passed on by many labels", () => {
    using page = open();
    page.document.body.innerHTML = Array.from(
      { length: 20000 },
      (_, i) => `<label for=c${i + 1}><output id=c${i}></output></label>`,
    ).join("");
    let clicks = 0;
    page.document.getElementById("c3").onclick = () => clicks++;
    page.document.getElementById("c0").click();
    expect(clicks).toBe(1);
  });

  test("custom functions that call each other too often are invalid", () => {
    using page = open();
    const functions = Array.from(
      { length: 40 },
      (_, i) =>
        `@function --f${i}() { --a: --f${i + 1}(); --b: --f${i + 1}(); result: if(style(--a: 1): 1; style(--b: 1): 1; else: 2) }`,
    );
    page.document.body.innerHTML = `<style>${functions.join("")} @function --f40() { result: 2 } b { --x: --f0(); --y: --f35() }</style><b></b>`;
    const style = page.window.getComputedStyle(page.document.body.lastChild);
    expect([style.getPropertyValue("--x"), style.getPropertyValue("--y")]).toEqual(["", "2"]);
  });

  test("elements that were given the same class stay apart", () => {
    using page = open();
    const made = Array.from({ length: 40 }, (_, i) =>
      page.document.createElement("ab"[i % 2], i == 39 ? { is: "x-b" } : {}),
    );
    for (const it of made) it.className = "c";
    made[0].id = "d";
    made[1].className = "e";
    page.document.body.append(...made);
    const tags = page.document.body.innerHTML.split("><");
    expect([...tags.slice(0, 5), ...tags.slice(-4)]).toEqual([
      ...['<a class="c" id="d"', "/a", 'b class="e"', "/b", 'a class="c"'],
      ...['a class="c"', "/a", 'b is="x-b" class="c"', "/b>"],
    ]);
  });

  test("shadow trees and templates may be nested deeply", () => {
    using page = open();
    using other = open();
    let host = page.document.createElement("div");
    let template = page.document.createElement("template");
    for (let i = 0; i < 100_000; i++) {
      const outerHost = page.document.createElement("div");
      outerHost.attachShadow({ mode: "open" }).append(host);
      host = outerHost;
      const outerTemplate = page.document.createElement("template");
      outerTemplate.content.append(template);
      template = outerTemplate;
    }
    page.document.head.append(host);
    expect(host.shadowRoot.firstChild.isConnected).toBe(true);
    host.remove();
    expect(host.shadowRoot.firstChild.isConnected).toBe(false);
    expect(other.document.adoptNode(template).ownerDocument).toBe(other.document);
  });

  test("the names of many pseudo-attributes survive collections", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--preload=bun:desktop/dom",
        "-e",
        `const names = Array.from({ length: 2000 }, (_, i) => "name" + i);
        const instruction = document.createProcessingInstruction("x", names.map(it => it + '=""').join(" "));
        let same = 0;
        for (let i = 0; i < 100; i++) same += instruction.getAttributeNames().join() === names.join();
        console.log(same);`,
      ],
      env: {
        ...bunEnv,
        BUN_JSC_scribbleFreeCells: "1",
        BUN_JSC_sweepSynchronously: "1",
        BUN_JSC_gcMaxHeapSize: "100000",
      },
      stderr: "inherit",
    });
    expect(await proc.stdout.text()).toBe("100\n");
    expect(await proc.exited).toBe(0);
  });

  test("very many pseudo-attributes are read", () => {
    using page = open();
    const data = Array.from({ length: 200_000 }, (_, i) => `a${i}=""`).join(" ");
    expect(page.document.createProcessingInstruction("x", data).getAttribute("a199999")).toBe("");
    expect(page.document.createProcessingInstruction("x", data + ' a0="Ā"').getAttribute("a1")).toBe(null);
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

  test("listeners and handlers outlive a collection, and run in the order in which they were added", () => {
    using page = open("<p onclick='log.push(1)'></p>");
    const log: number[] = (page.window.log = []);
    page.$("p").addEventListener("click", () => log.push(2));
    page.$("p").addEventListener("click", { handleEvent: () => log.push(3) });
    Bun.gc(true);
    page.$("p").onclick = () => void log.push(4);
    page.$("p").click();
    page.$("p").onclick = null;
    page.$("p").onclick = () => void log.push(5);
    page.$("p").click();
    expect(log).toEqual([4, 2, 3, 2, 3, 5]);
  });

  test("a setter for an index on Object.prototype sees nothing of a dispatch", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const page = require("bun:internal-for-testing").desktopInternals.createPage({ native: null, surface: 0, fontScope: 1 });
        page.parseHTML("<!doctype html><div><p></p></div>");
        const p = page.document.querySelector("p");
        let [calls, leaks] = [0, 0];
        p.addEventListener("x", () => calls++);
        for (const index of [0, 1, 2]) page.window.Object.defineProperty(page.window.Object.prototype, index, { set: () => leaks++, configurable: true });
        for (let i = 0; i < 50; i++) p.addEventListener("x", () => calls++);
        Bun.gc(true);
        p.dispatchEvent(new page.window.Event("x", { bubbles: true }));
        for (const index of [0, 1, 2]) delete page.window.Object.prototype[index];
        console.log(calls, leaks);`,
      ],
      env: bunEnv,
      stderr: "inherit",
    });
    expect(await proc.stdout.text()).toBe("51 0\n");
    expect(await proc.exited).toBe(0);
  });

  test("the interfaces of events convert their dictionaries, and check their receivers", () => {
    using page = open();
    const { InputEvent, KeyboardEvent, MouseEvent, PointerEvent, WheelEvent } = page.window;
    const key = new KeyboardEvent("keydown", { key: 1, ctrlKey: 1, modifierCapsLock: true, location: -1 });
    expect([key.key, key.ctrlKey, key.getModifierState("CapsLock"), key.location]).toEqual([
      "1",
      true,
      true,
      2 ** 32 - 1,
    ]);
    const pointer = new PointerEvent("pointerdown", { tiltX: 45, clientX: 1.5, button: 65537 });
    expect([pointer.altitudeAngle, pointer.clientX, pointer.button]).toEqual([expect.closeTo(Math.PI / 4), 1.5, 1]);
    expect(new WheelEvent("wheel", { deltaMode: WheelEvent.DOM_DELTA_PAGE })).toBeInstanceOf(MouseEvent);
    expect(() => new MouseEvent("click", { relatedTarget: {} })).toThrow(TypeError);
    expect(() => new InputEvent("input", { view: {} })).toThrow(TypeError);
    expect(() => MouseEvent.prototype.clientX).toThrow(TypeError);
    expect(() => KeyboardEvent.prototype.getModifierState.call(pointer, "Alt")).toThrow(TypeError);
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

test("a control that changes pages before it was shown is brought up to date", () => {
  using from = open();
  using to = open();
  from.document.body.innerHTML = "<fieldset><input required></fieldset>";
  to.document.body.append(from.document.body.firstChild);
  expect(to.document.querySelectorAll(":invalid").length).toBe(2);
});

test("the text of what is around a modal dialog includes that of the dialog", () => {
  using page = open("<div>out <dialog>in</dialog></div>");
  page.$("dialog").showModal();
  page.window.getSelection().selectAllChildren(page.document.documentElement);
  expect([String(page.window.getSelection()).trim(), page.$("div").innerText]).toEqual(["in", "out\nin"]);
});

describe("radio buttons", () => {
  const radio = (more = "") => `<input type=radio name=a ${more}>`;
  const states = (page: any, test: (it: any) => boolean) =>
    [...page.document.querySelectorAll("input")].map(it => +test(it)).join("");

  test("the last of those that come checked stays so", () => {
    using page = open();
    page.document.body.innerHTML = `<div>${radio("checked")}${radio("checked")}</div><form>${radio("checked")}</form>`;
    expect(states(page, it => it.checked)).toBe("011");
  });

  test("hear of what happens to their group", () => {
    using page = open(radio("checked") + radio() + radio());
    const [first, second] = page.document.querySelectorAll("input");
    const seen = [] as string[];
    const see = () =>
      seen.push(states(page, it => it.matches(":indeterminate")) + " " + states(page, it => it.matches(":invalid")));
    see();
    first.name = "b";
    see();
    second.required = true;
    see();
    first.name = "a";
    see();
    first.type = "checkbox";
    see();
    first.type = "radio";
    first.remove();
    see();
    second.remove();
    see();
    expect(seen).toEqual(["000 000", "011 000", "011 011", "000 000", "011 011", "11 11", "1 0"]);
  });

  test("change groups with their form", () => {
    using page = open(`<form id=x>${radio("checked")}</form>${radio("checked form=f")}${radio("form=f")}`);
    expect(states(page, it => it.checked)).toBe("110");
    page.$("form").id = "f";
    expect(states(page, it => it.checked)).toBe("010");
    page.document.querySelectorAll("input")[1].removeAttribute("form");
    expect(states(page, it => it.matches(":indeterminate"))).toBe("101");
  });
});

test("the controls of a form are in tree order wherever they are", () => {
  using page = open(
    "<input id=a form=f><table><form id=f><tr><td><input id=b></td><td><input id=c></td></tr></form></table><input id=d form=f><form id=g><input id=e form=f><input id=h></form>",
  );
  const ids = (form: string) => Array.from(page.$(form).elements, (it: any) => it.id).join("");
  expect([ids("#f"), ids("#g")]).toEqual(["abcde", "h"]);
  page.$("#f").append(page.$("#h"));
  page.$("#b").parentNode.before(page.$("#c").parentNode);
  expect([ids("#f"), ids("#g")]).toEqual(["ahbde", ""]);
});

test("only the first legend of a disabled fieldset is spared", () => {
  using page = open("<fieldset disabled><legend><input></legend><legend><input></legend></fieldset>");
  const [fieldset, disabled] = [
    page.$("fieldset"),
    () => [...page.document.querySelectorAll("input")].map(it => +it.matches(":disabled")).join(""),
  ];
  const seen = [disabled()];
  fieldset.prepend(fieldset.lastChild);
  seen.push(disabled());
  fieldset.prepend(fieldset.lastChild.cloneNode(true));
  seen.push(disabled());
  page.document.body.append(fieldset.firstChild);
  seen.push(disabled());
  expect(seen).toEqual(["01", "01", "011", "010"]);
});

test.each<[string, (i: number) => string, string?]>([
  ["forms with remote controls", i => `<input form=f${i}><form id=f${i}></form>`],
  ["forms with the same id", () => "<input form=a><form id=a></form>"],
  ["forms in tables", () => "<form><tr><td><input required></form>", "<table>"],
  ["checked radio buttons", () => "<input type=radio name=a checked>" + Buffer.alloc(7 * 20, "<b></b>").toString()],
  [
    "groups of radio buttons",
    i =>
      `<input type=radio name=a${i}><input type=radio name=a${i} checked>` + Buffer.alloc(7 * 20, "<b></b>").toString(),
  ],
  ["radio buttons of a remote form", () => "<input type=radio name=a form=f checked>"],
  ["legends", () => "<legend><input></legend>", "<fieldset disabled>"],
])("many %s take no time", (_, piece, start = "") => {
  using page = open("<body hidden>" + start + Array.from({ length: 12_000 }, (_, i) => piece(i)).join(""));
  expect(page.document.querySelectorAll("input:enabled, input:disabled").length).toBeGreaterThanOrEqual(12_000);
});

describe("all children are removed at once", () => {
  const rows = (row: string) => `<div id=list>${row}${row}${row}</div>`;

  test("and know nothing of their parent or each other", () => {
    using page = open(rows("<p id=a>x<b id=b></b></p>text"));
    const list = page.$("#list");
    const [all, live] = [[...list.childNodes], page.document.getElementsByTagName("b")];
    expect([list.offsetHeight > 0, live.length]).toEqual([true, 3]);
    list.innerHTML = "";
    expect(all.map(it => [it.parentNode, it.previousSibling, it.nextSibling, it.isConnected])).toEqual(
      all.map(() => [null, null, null, false]),
    );
    expect([live.length, list.offsetHeight, list.firstChild, list.lastChild, list.matches(":empty")]).toEqual([
      0,
      0,
      null,
      null,
      true,
    ]);
    expect(["a", "b"].map(it => page.document.getElementById(it))).toEqual([null, null]);
    expect([all[0].outerHTML, all[0].lastChild.isConnected]).toEqual(['<p id="a">x<b id="b"></b></p>', false]);
    list.append(all[2], all[0]);
    expect([page.document.getElementById("b") === all[2].lastChild, live.length, all[0].offsetHeight > 0]).toEqual([
      true,
      2,
      true,
    ]);
  });

  test("and observers hear of it", () => {
    using page = open(rows("<p></p>"));
    const list = page.$("#list");
    const [all, observer] = [[...list.children], new page.window.MutationObserver(() => {})];
    observer.observe(list, { childList: true, attributes: true, subtree: true });
    list.replaceChildren();
    all[1].title = "x";
    expect(observer.takeRecords().map(it => [it.type, it.removedNodes.length])).toEqual([
      ["childList", 3],
      ["attributes", 0],
    ]);
  });

  test("and forms lose their controls", () => {
    using page = open(
      `<form>${rows("<label><input required name=a></label><input type=radio name=b required>")}</form>`,
    );
    const [form, all] = [page.$("form"), [...page.document.querySelectorAll("input")]];
    expect([form.elements.length, form.matches(":invalid")]).toEqual([6, true]);
    page.$("#list").textContent = "";
    expect([form.elements.length, form.matches(":invalid"), all.map(it => it.form)]).toEqual([
      0,
      false,
      all.map(() => null),
    ]);
  });

  test("and transitions are cancelled", async () => {
    using page = open(`<style>b { transition: color 100s } .on b { color: red }</style>${rows("<p><b>x</b></p>")}`);
    const [list, all] = [page.$("#list"), [...page.document.querySelectorAll("b")]];
    list.offsetTop;
    list.className = "on";
    expect(page.document.getAnimations().length).toBe(3);
    list.innerHTML = "";
    expect([page.document.getAnimations().length, all.map(it => it.getAnimations().length)]).toEqual([0, [0, 0, 0]]);
  });

  test.each(["<x-a></x-a>", "<p><x-a></x-a></p>"])("unless scripts run in between: %s", row => {
    using page = open(rows("<i></i>" + row));
    const [list, seen] = [page.$("#list"), [] as boolean[]];
    const first = list.firstChild;
    page.window.customElements.define(
      "x-a",
      class extends page.window.HTMLElement {
        disconnectedCallback() {
          seen.push(this.isConnected || first.isConnected);
        }
      },
    );
    list.innerHTML = "";
    expect(seen).toEqual([false, false, false]);
  });

  test("with the focus, ranges and iterators in them", () => {
    using page = open(rows("<p><input>x</p>"));
    const { document } = page;
    const list = page.$("#list");
    const [range, iterator] = [document.createRange(), document.createNodeIterator(list)];
    range.selectNodeContents(list.children[1].lastChild);
    (iterator.nextNode(), iterator.nextNode());
    page.$("input").focus();
    list.innerHTML = "";
    expect([
      document.activeElement === document.body,
      range.startContainer === list,
      range.collapsed,
      iterator.referenceNode === list,
    ]).toEqual([true, true, true, true]);
  });
});

test("the only element with an attribute is found wherever it is", () => {
  using page = open("<p><i data-a=1></i><i data-a=2></i></p><div><i data-a=3></i><b><i data-a=4></i></b></div>");
  const find = (root: any, value: number) => root.querySelector(`[data-a="${value}"]`)?.parentNode.localName;
  expect([1, 2, 3, 4, 1, 5].map(it => find(page.document, it))).toEqual(["p", "p", "div", "b", "p", undefined]);
  expect([find(page.$("div"), 2), find(page.document, 4), find(page.$("p"), 4), find(page.$("b"), 4)]).toEqual([
    undefined,
    "b",
    undefined,
    "b",
  ]);
  page.$("p").append(page.$("b i").cloneNode());
  expect(find(page.document, 4)).toBe("p");
  page.$("p").lastChild.remove();
  page.$("b").remove();
  expect(find(page.document, 4)).toBe(undefined);
});

test("what was selected before does not slow down changes", () => {
  using page = open("<input>");
  page.$("input").focus();
  for (let i = 0; i < 40_000; i++) page.$("input").value = i % 2 ? "a" : "";
  expect(page.$("input").selectionStart).toBe(1);
});

test("a click that no pointer has caused has no offset", () => {
  using page = open("<p style=margin:20px>a");
  const seen: number[] = [];
  page.$("p").onclick = (event: any) => seen.push(event.offsetX, event.offsetY);
  page.$("p").click();
  page.$("p").dispatchEvent(new page.window.MouseEvent("click"));
  expect(seen).toEqual([0, 0, -28, -20]);
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

  test("a very large group of radio buttons", () => {
    using page = open("<form></form>");
    const count = (selector: string) => page.document.querySelectorAll(selector).length;
    const states = () => [count(":checked"), count(":indeterminate"), count("input:invalid")];
    const form = page.$("form");
    form.innerHTML =
      "<input type=radio name=a>".repeat(5000) + "<input type=radio name=a required><input type=radio name=b>";
    expect(states()).toEqual([0, 5002, 5001]);
    form.firstChild.click();
    expect(states()).toEqual([1, 1, 0]);
    form.children[4000].checked = true;
    expect([states(), form.firstChild.checked]).toEqual([[1, 1, 0], false]);
    form.children[4000].checked = false;
    expect(states()).toEqual([0, 5002, 5001]);
    form.innerHTML = "<input type=radio name=a checked>".repeat(5000);
    expect([states(), form.lastChild.checked]).toEqual([[1, 0, 0], true]);
  });

  test("a pattern with very many properties is ignored", () => {
    const input = (count: number) => `<input value=x pattern="${"\\p{RGI_Emoji}".repeat(count)}">`;
    using page = open(input(2) + input(40));
    expect([...page.document.querySelectorAll("input")].map(it => it.validity.patternMismatch)).toEqual([true, false]);
  });

  test.each(["a*a*a*a*a*a*a*a*b", "(a*)*b", "a*a{150}a*a*a*a*b", "(a*)a*a*a*\\1b"])(
    "matching against %s ends",
    pattern => {
      using page = open(`<input value=${"a".repeat(300)} pattern="${pattern}">`);
      expect(page.$("input").validity.patternMismatch).toBe(true);
    },
  );

  test.each([true, false])("a select knows its options however they get there (connected: %p)", isConnected => {
    using page = open("<select></select><select></select>");
    const all: any[] = Array.from(page.document.querySelectorAll("select"));
    if (!isConnected) all.forEach(it => it.remove());
    const parse = (html: string) => Object.assign(page.document.createElement("template"), { innerHTML: html }).content;
    const [a, b] = all;
    const show = () =>
      all.map(it => `${it.length} ${Array.from(it.options, (it: any) => it.text + (it.selected ? "*" : "")).join("")}`);
    const steps: [() => void, string[]][] = [
      [() => a.append(parse("<option>1<option>2")), ["2 1*2", "0 "]],
      [() => a.append(parse("<optgroup><option>3<option selected>4</optgroup>")), ["4 1234*", "0 "]],
      [() => a.append(parse("<div><option selected>5</option></div>")), ["5 12345*", "0 "]],
      [() => a.lastChild.append(parse("<span><option>6</option></span>")), ["6 12345*6", "0 "]],
      [() => b.append(a.lastChild), ["4 1*234", "2 5*6"]],
      [() => a.lastChild.append(b.lastChild), ["6 12345*6", "0 "]],
      [() => b.append(a.lastChild), ["2 1*2", "4 345*6"]],
      [() => a.firstChild.append(b.firstChild), ["2 13456*2", "0 "]],
      [() => a.firstChild.remove(), ["1 2*", "0 "]],
      [() => (a.length = 3), ["3 2*", "0 "]],
      [() => (a.innerHTML = ""), ["0 ", "0 "]],
      [() => a.append(parse("<div><option selected>1</option></div><option selected>2")), ["2 12*", "0 "]],
    ];
    expect(steps.map(([step]) => (step(), show()))).toEqual(steps.map(it => it[1]));
  });

  test.each([true, false])("the choice of a select follows its options (connected: %p)", isConnected => {
    using page = open("<select><option>a<option>b<option>c</select>");
    const select: any = page.$("select");
    if (!isConnected) select.remove();
    const wrapper = select.appendChild(page.document.createElement("div"));
    const inner = wrapper.appendChild(page.document.createElement("div"));
    const show = () => [select.selectedIndex, select.value, select.selectedOptions.length];
    const steps: [() => void, unknown[]][] = [
      [() => (inner.innerHTML = "<p><option selected>d</option></p>"), [3, "d", 1]],
      [() => (select.selectedIndex = 1), [1, "b", 1]],
      [() => inner.firstChild.append(select.options[1]), [3, "b", 1]],
      [() => (select.value = "b"), [3, "b", 1]],
      [() => inner.remove(), [0, "a", 1]],
      [() => (select.selectedIndex = -1), [-1, "", 0]],
      [() => ((select.multiple = true), select.append(inner), (select.options[0].selected = true)), [0, "a", 2]],
      [() => (select.options[0].selected = false), [3, "b", 1]],
      [() => (select.options[1].selected = true), [1, "c", 2]],
      [() => (select.options[1].selected = false), [3, "b", 1]],
      [() => (select.multiple = false), [3, "b", 1]],
    ];
    expect(steps.map(([step]) => (step(), show()))).toEqual(steps.map(it => it[1]));
  });

  test("a select is as wide as its options, wherever their text is", () => {
    using page = open("<select><option><span>a</span></option></select>");
    const before = page.$("select").offsetWidth;
    (page.$("span").firstChild as any).data = "a long text";
    expect(page.$("select").offsetWidth).toBeGreaterThan(before);
  });

  test("only the first legend is exempt from a disabled fieldset", () => {
    using page = open("<form><fieldset disabled><legend><input required></legend><input required></fieldset></form>");
    const [first, other] = [page.$("legend"), page.document.createElement("legend")];
    const show = () =>
      Array.from(
        page.$("form").elements,
        (it: any) => [":disabled", ":invalid"].map(state => +it.matches(state)).join("") + +it.willValidate,
      ).join();
    const steps: [() => void, string][] = [
      [() => {}, "110,011,100"],
      [() => first.before(other), "100,100,100"],
      [() => other.remove(), "110,011,100"],
      [() => first.after(other), "110,011,100"],
      [() => other.after(first), "100,100,100"],
      [() => (page.$("fieldset").disabled = false), "011,011,011".replace("011", "010")],
    ];
    expect(steps.map(([step]) => (step(), show()))).toEqual(steps.map(it => it[1]));
  });

  test("a big disabled fieldset takes time in proportion to its size", () => {
    using page = open(`<form><fieldset>${"<output></output>".repeat(30_000)}<button></button></fieldset></form>`);
    page.$("fieldset").insertAdjacentHTML("beforeend", "<fieldset></fieldset>".repeat(10_000));
    page.$("fieldset").disabled = true;
    expect(page.document.querySelectorAll(":disabled").length).toBe(10_002);
  });

  test("selecting in many controls takes time in proportion to their number", async () => {
    using page = open("<textarea hidden>ab</textarea>".repeat(25_000));
    const [all, seen] = [page.document.querySelectorAll("textarea"), Promise.withResolvers<number>()];
    let count = 0;
    page.document.addEventListener(
      "select",
      (event: any) => (count++, event.target === all[all.length - 1] && seen.resolve(count)),
    );
    for (const it of all) (it.setSelectionRange(0, 1), it.setSelectionRange(0, 2));
    expect(await seen.promise).toBe(25_000);
  });

  test("hiding and showing one of many blocks takes no time in proportion to their number", () => {
    using page = open(
      `<div style="height: 100px; overflow: hidden; display: flex">${"<p hidden>a</p>".repeat(30_000)}</div>`,
    );
    let width = 0;
    for (const it of page.$("div").children) {
      it.style.color = "red";
      width += page.$("div").offsetHeight;
    }
    for (const it of Array.from<any>(page.$("div").children)) {
      it.remove();
      width -= page.$("div").offsetHeight;
    }
    expect(width).toBe(0);
  });

  test("selectedOptions is live, and is read in time in proportion to its length", () => {
    using page = open(`<select multiple>${"<option selected>a".repeat(40_000)}</select>`);
    const { selectedOptions, options } = page.$("select");
    expect(Array.from(selectedOptions).length).toBe(40_000);
    const steps = [
      () => (options[1].selected = false),
      () => options[0].remove(),
      () => (options[0].selected = true),
      () => (page.$("select").multiple = false),
      () => (page.$("select").selectedIndex = -1),
    ];
    expect(steps.map(step => (step(), [selectedOptions.length, selectedOptions[0]?.index]))).toEqual([
      [39_999, 0],
      [39_998, 1],
      [39_999, 0],
      [1, 0],
      [0, undefined],
    ]);
  });

  test.each([
    ["<input>", (form: any) => (form[0].required = true)],
    ["<input>", (form: any) => form[0].setCustomValidity("a")],
    ["<input type=radio name=r><input type=radio name=r checked required>", (form: any) => (form[1].checked = false)],
    [
      "<input type=radio name=r><input type=radio name=r checked required>",
      (form: any) => ((form[0].required = true), form[1].remove()),
    ],
    ["<fieldset disabled><input required></fieldset>", (form: any) => (form[0].disabled = false)],
    ["<datalist><input required></datalist>", (form: any) => form.append(form.querySelector("input"))],
    ["<select required><option>a</select>", (form: any) => (form[0].selectedIndex = -1)],
    ["<select required><option>a</select>", (form: any) => (form[0][0].value = "")],
    ["</form><input required>", (form: any) => form.append(form.nextSibling)],
    ["</form><input required form=b>", (form: any) => (form.id = "b")],
    ["</form><input required form=b><form id=b>", (form: any) => form.nextSibling.setAttribute("form", "a")],
    ["</form><input required form=a>", (form: any) => form.previousSibling.remove(), "<form id=a></form>"],
  ])("a valid form becomes invalid: %s", (html, spoil, before = "") => {
    for (const ask of [(it: any) => it.checkValidity(), (it: any) => it.matches(":valid")]) {
      using page = open(`${before}<form id=a class=it>${html}</form>`);
      const form = page.$(".it");
      expect([form.matches(":valid"), form.checkValidity()]).toEqual([true, true]);
      spoil(form);
      expect(ask(form)).toBe(false);
    }
  });

  test("showing many popovers takes no time in proportion to the cube of their number", () => {
    using page = open("<p popover=manual></p>".repeat(3_000));
    for (const it of page.document.body.children) it.showPopover();
    expect(page.document.querySelectorAll(":popover-open").length).toBe(3_000);
  });

  test("slots by name", async () => {
    using page = open("<div><a slot=x></a><b></b><i slot=x></i><u slot=y></u></div>");
    const [host, log] = [page.$("div"), [] as string[]];
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      "<slot name=z></slot>".repeat(9) + "<slot id=x name=x></slot><slot id=none></slot><slot id=other name=x></slot>";
    shadow.addEventListener("slotchange", (event: any) => log.push(event.target.id));
    const slot = (id: string, name: string) => Object.assign(page.document.createElement("slot"), { id, name });
    const steps: [() => void, string, string][] = [
      [() => {}, "x,none,x,", "x,none"],
      [() => (page.$("b").slot = "x"), "x,x,x,", "none,x"],
      [() => (page.$("a").slot = "q"), ",x,x,", "x"],
      [() => (page.$("a").slot = "x"), "x,x,x,", "x"],
      [() => shadow.append(slot("late", "x")), "x,x,x,", ""],
      [() => shadow.prepend(slot("early", "x")), "early,early,early,", "early,x"],
      [() => shadow.getElementById("x").remove(), "early,early,early,", ""],
      [() => shadow.getElementById("early").remove(), "other,other,other,", "other"],
      [() => (shadow.getElementById("late").name = "y"), "other,other,other,late", "late"],
      [() => page.$("u").removeAttribute("slot"), "other,other,other,none", "late,none"],
    ];
    for (const [step, assigned, changed] of steps) {
      step();
      await Promise.resolve();
      expect([Array.from(host.children, (it: any) => it.assignedSlot?.id).join(), log.splice(0).join()]).toEqual([
        assigned,
        changed,
      ]);
    }
    expect(
      shadow
        .getElementById("other")
        .assignedNodes()
        .map((it: any) => it.localName),
    ).toEqual(["a", "b", "i"]);
  });

  test("many color schemes take time in proportion to their number", () => {
    using page = open("<meta name=color-scheme content=no>".repeat(30_000));
    const color = () => page.window.getComputedStyle(page.document.documentElement).color;
    const before = color();
    page.document.head.lastChild.content = "dark";
    expect([before, color()]).toEqual(["rgb(0, 0, 0)", "rgb(255, 255, 255)"]);
  });

  test("many container queries take no time in proportion to the square of their number", () => {
    const rules = Array.from({ length: 20_000 }, (_, i) => `@container (width > ${i}px) { p { order: ${i} } }`);
    using page = open(
      `<style>${rules.join("")}</style><div style="container-type: inline-size; width: 9px">${"<p></p><p id=a></p>".repeat(100)}</div>`,
    );
    expect(page.window.getComputedStyle(page.$("p")).order).toBe("8");
  });

  test("many slots take time in proportion to their number", () => {
    using page = open("<div></div>");
    const host = page.$("div");
    host.attachShadow({ mode: "open" }).innerHTML = Array.from(
      { length: 5_000 },
      (_, i) => `<slot name=${i}></slot>`,
    ).join("");
    for (let i = 0; i < 5_000; i++) host.appendChild(page.document.createElement("i")).slot = i;
    expect(host.lastChild.assignedSlot.name).toBe("4999");
  });

  test("a placeholder comes and goes", () => {
    using page = open("<style>* { field-sizing: content }</style><input><textarea></textarea>");
    for (const it of [page.$("input"), page.$("textarea")]) {
      const [empty, widths] = [it.offsetWidth, [] as number[]];
      for (const step of [
        () => (it.placeholder = "a long hint"),
        () => (it.value = "a"),
        () => (it.value = ""),
        () => it.removeAttribute("placeholder"),
        () => (it.placeholder = "a much longer hint"),
      ]) {
        step();
        widths.push(it.offsetWidth - empty);
      }
      expect([widths[0] > 40, widths[1] < 20, widths[2] === widths[0], widths[3], widths[4] > widths[0]]).toEqual([
        true,
        true,
        true,
        0,
        true,
      ]);
    }
  });

  test("reset() brings back the defaults", () => {
    using page = open(
      "<form><input value=a required><input type=checkbox checked required><input type=number value=x><input type=date value=2020-01-02></form>",
    );
    const [text, box, number, date] = page.$("form").elements;
    const show = () => [text.value, text.matches(":invalid"), box.matches(":checked"), number.value, date.value];
    [text.value, box.checked, number.type, date.value] = ["", false, "text", ""];
    expect(show()).toEqual(["", true, false, "x", ""]);
    page.$("form").reset();
    expect(show()).toEqual(["a", false, true, "x", "2020-01-02"]);
    text.setSelectionRange(1, 1);
    page.$("form").reset();
    text.defaultValue = "bc";
    expect([text.value, text.selectionStart]).toEqual(["bc", 1]);
  });

  test("a select that drops down has no line-height", () => {
    using page = open(
      "<style>select { line-height: 100px }</style><select></select><select style='color: red; border: 0'></select><select size=2></select><select style='appearance: none'></select>",
    );
    expect(
      Array.from(page.document.querySelectorAll("select"), it => page.window.getComputedStyle(it).lineHeight),
    ).toEqual(["normal", "normal", "100px", "100px"]);
  });

  test("a fieldset and an object can belong to a form that they are not in", () => {
    using page = open("<form id=f></form><fieldset form=f></fieldset><object form=f></object>");
    expect((page.$("form") as any).length).toBe(2);
  });

  test.each([1, 2, 3, 4])("live collections follow all kinds of changes (seed %d)", seed => {
    using page = open("<div id=root></div>");
    using other = open("");
    const document: any = page.document;
    const random = (below: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % 9973) % below;
    const pick = (all: any[]) => all[random(all.length)];
    const root = page.$("div") as any;
    const make = (tag: string, parent?: any) =>
      parent ? parent.appendChild(document.createElement(tag)) : document.createElement(tag);
    const [form, select, table, box] = ["form", "select", "table", "section"].map(it => make(it, root));
    const row = make("tr", make("tbody", table));
    const fixed = [root, form, select, table, box, row, row.parentNode];
    const tags = [
      "input",
      "input",
      "option",
      "option",
      "optgroup",
      "tr",
      "tr",
      "td",
      "td",
      "tbody",
      "i",
      "i",
      "a",
      "img",
      "label",
      "div",
      ...(seed > 2 ? ["thead", "tfoot", "form"] : []),
    ];
    const pool = Array.from({ length: 160 }, (_, it) =>
      it % 10 ? make(pick(tags)) : it % 20 ? document.createTextNode("") : document.createComment(""),
    );
    const below = (node: any): any[] => {
      const all = [];
      for (let it = node.firstChild; it; it = it.nextSibling) all.push(it, ...below(it));
      return all;
    };
    const elements = (node: any, test: (it: any) => unknown) => below(node).filter(it => it.nodeType === 1 && test(it));
    const children = (node: any, ...names: string[]) =>
      below(node).filter(it => it.parentNode === node && names.includes(it.localName));
    const rows = (...names: string[]) =>
      children(table, ...names).flatMap(it => (it.localName === "tr" ? [it] : children(it, "tr")));
    const isListed = (option: any) => {
      let groups = 0;
      for (let it = option.parentNode; it !== select; it = it.parentNode)
        if (it.localName === "option" || (it.localName === "optgroup" && groups++)) return false;
      return true;
    };
    const controls = () =>
      elements(form, it => it.localName === "input" && it.type !== "image" && it.parentNode.closest("form") === form);
    const lists: [string, any, () => any[]][] = [
      ["childNodes", box.childNodes, () => below(box).filter(it => it.parentNode === box)],
      ["children", box.children, () => elements(box, it => it.parentNode === box)],
      ["tag", root.getElementsByTagName("i"), () => elements(root, it => it.localName === "i")],
      ["all", box.getElementsByTagName("*"), () => elements(box, () => true)],
      ["class", document.getElementsByClassName("x"), () => elements(root, it => it.className === "x")],
      ["name", document.getElementsByName("n1"), () => elements(root, it => it.getAttribute("name") === "n1")],
      ["links", document.links, () => elements(root, it => it.localName === "a" && it.hasAttribute("href"))],
      ["elements", form.elements, controls],
      ["options", select.options, () => elements(select, it => it.localName === "option" && isListed(it))],
      ["rows", table.rows, () => [...rows("thead"), ...rows("tbody", "tr"), ...rows("tfoot")]],
      ["cells", row.cells, () => children(row, "td")],
      ["tBodies", table.tBodies, () => children(table, "tbody")],
    ];
    const homes: Record<string, any> = {
      input: form,
      img: form,
      option: select,
      optgroup: select,
      tr: table,
      tbody: table,
      thead: table,
      tfoot: table,
      td: row,
    };
    const changes = [
      (it: any, parent = homes[it.localName] ?? box) => parent.append(it),
      (it: any, parent = homes[it.localName] ?? box) => parent.insertBefore(it, pick([...parent.childNodes, null])),
      (it: any, parent = pick(pool)) => parent.nodeType === 1 && !it.contains(parent) && parent.prepend(it),
      (it: any) => it.remove(),
      (it: any) => (other.document.body.append(it), it.classList?.toggle("x"), it.firstChild?.remove()),
      (it: any) => it.classList?.toggle("x"),
      (it: any) => it.setAttribute?.(pick(["name", "id", "for"]), "n" + random(4)),
      (it: any) => it.toggleAttribute?.("href"),
      (it: any) => it.setAttribute?.("type", pick(["image", "text"])),
    ];
    const wrong = new Set<string>();
    for (let step = 0; step < 1500; step++) {
      for (let count = random(4); count >= 0; count--) pick(changes)(pick(pool));
      if (step % 300 === 299) Bun.gc(true);
      for (const [name, list, expected] of lists) {
        if (random(3) === 0) continue;
        const all = expected();
        const at = random(all.length + 1);
        if ((list[at] ?? undefined) !== all[at]) wrong.add(name + " at");
        if (random(3) === 0) continue;
        if (list.length !== all.length || all.some((it, index) => list[index] !== it)) wrong.add(name);
        const key = "n" + random(4);
        const named = all.filter(it => it.id === key || it.getAttribute?.("name") === key);
        const found = list.namedItem?.(key);
        if (
          found !== undefined &&
          (found?.nodeType || !found
            ? (found ?? undefined) !== named[0]
            : !Bun.deepEquals(
                [...found].map(it => pool.indexOf(it)),
                named.map(it => pool.indexOf(it)),
              ))
        )
          wrong.add(name + " named");
      }
      const input = pick(controls());
      const labels = input && elements(root, it => it.localName === "label" && it.control === input);
      if (
        input &&
        (input.labels.length !== labels.length || labels.some((it: any, index: number) => input.labels[index] !== it))
      )
        wrong.add("labels");
      if (lists[8][2]().some((it, index) => it.index !== index)) wrong.add("index");
      if (lists[9][2]().some((it, index) => it.rowIndex !== index)) wrong.add("rowIndex");
      if (select.selectedIndex !== lists[8][2]().findIndex(it => it.selected)) wrong.add("selectedIndex");
    }
    expect([...wrong, fixed.every(it => it.isConnected)]).toEqual([true]);
  });

  test.each<[string, number, (root: any, document: any) => void]>([
    ["is inserted", 10, (root, document) => (document.body.append(root), root.firstChild.classList.add("z"))],
    [
      "loses two ancestors",
      10,
      (root, document) => (document.body.append(root), root.parentNode.parentNode.remove(), root.parentNode.remove()),
    ],
    ["is of a document that leaves quirks mode", 0, (root, document) => (document.open(), root.firstChild.remove())],
  ])("a live collection whose root %s", (_, length, change) => {
    using page = open("");
    const document = page.document.implementation.createHTMLDocument();
    document.write("<p>");
    document.close();
    const root = document.createElement("div");
    const list = root.getElementsByClassName("k");
    for (let i = 1; i <= 10; i++) {
      root.append(Object.assign(document.createElement("p"), { className: "K" }));
      expect(list.length).toBe(i);
    }
    change(root, document);
    expect(list.length).toBe(length);
  });

  test("slots follow the children of the host one by one", async () => {
    using page = open("<div></div>");
    const host = page.$("div") as any;
    host.attachShadow({ mode: "open" }).innerHTML = "<slot name=a>fallback</slot><p><slot></slot></p>";
    const slots = [...host.shadowRoot.querySelectorAll("slot")];
    const make = (text: string, slot = "") =>
      Object.assign(page.document.createElement("b"), { textContent: text, slot });
    const [a, b, c, d] = [make("a"), make("b", "a"), make("c"), make("d", "none")];
    const show = () => [
      ...slots.map(it =>
        it
          .assignedNodes()
          .map((it: any) => it.textContent)
          .join(""),
      ),
      [a, b, c, d].map(it => +!!it.offsetWidth).join(""),
    ];
    const steps: [() => void, string[]][] = [
      [() => host.append(a, b, d), ["b", "a", "1100"]],
      [() => host.prepend(c), ["b", "ca", "1110"]],
      [() => host.append(c), ["b", "ac", "1110"]],
      [() => host.insertBefore(c, a), ["b", "ca", "1110"]],
      [() => b.remove(), ["", "ca", "1010"]],
      [() => (a.slot = "a"), ["a", "c", "1010"]],
      [() => page.document.body.append(a), ["", "c", "1010"]],
      [() => c.replaceWith(b), ["b", "", "1100"]],
    ];
    expect(steps.map(([step]) => (step(), show()))).toEqual(steps.map(it => it[1]));
  });

  test("the first summary of a details has a place of its own", () => {
    using page = open("<details><p></p></details>");
    const details = page.$("details") as any;
    const [a, b] = ["a", "b"].map(textContent =>
      Object.assign(page.document.createElement("summary"), { textContent }),
    );
    const show = () => [a, b].map(it => it.checkVisibility());
    const steps: [() => void, boolean[]][] = [
      [() => details.append(a), [true, false]],
      [() => details.append(b), [true, false]],
      [() => details.prepend(b), [false, true]],
      [() => b.remove(), [true, false]],
    ];
    expect(steps.map(([step]) => (step(), show()))).toEqual(steps.map(it => it[1]));
  });

  test.each([
    [
      "a shadow host",
      (it: any) => (it.attachShadow({ mode: "open" }).innerHTML = "<slot></slot>"),
      "div",
      "p",
      (it: any) => it.childNodes.length,
    ],
    ["a select", () => {}, "select", "option", (it: any) => it.length + it.selectedIndex],
    ["a form", () => {}, "form", "output", (it: any) => it.length],
    ["a table", () => {}, "table", "tr", (it: any) => it.rows.length],
    ["a table with a head", (it: any) => it.createTHead().remove(), "table", "tr", (it: any) => it.rows.length],
  ])("filling and emptying %s takes time in proportion to its size", (_, prepare, tag, child, count) => {
    using page = open(`<${tag}></${tag}>`);
    const parent = page.$(tag) as any;
    prepare(parent);
    let sum = 0;
    for (let i = 0; i < 30_000; i++) (parent.appendChild(page.document.createElement(child)), (sum += count(parent)));
    while (parent.lastChild) (parent.lastChild.remove(), (sum -= count(parent) + 1));
    expect(Math.abs(sum)).toBeLessThan(2);
  });

  test("the rows of a table are in the order of its parts, wherever those move", () => {
    using page = open(
      `<table><thead><tr id=h></thead><tbody>${"<tr>".repeat(10)}</tbody><tfoot><tr id=f></tfoot></table>`,
    );
    const table = page.$("table") as any;
    const { tHead, tFoot } = table;
    const row = (id: string) => Object.assign(page.document.createElement("tr"), { id });
    const steps = [
      () => {},
      () => table.append(row("a")),
      () => table.append(tFoot),
      () => table.prepend(row("b")),
      () => table.prepend(tHead),
      () => table.prepend(tFoot),
      () => (table.append(tFoot), table.append(tHead), tHead.after(row("c"))),
    ];
    const ids = () => [...table.rows].map(it => it.id || ".").join("");
    expect(steps.map(step => (step(), ids()))).toEqual([
      "h..........f",
      "h..........af",
      "h..........af",
      "hb..........af",
      "hb..........af",
      "hb..........af",
      "hb..........acf",
    ]);
  });

  test("what controls have been given outlives a collection", () => {
    using page = open(
      "<form id=f></form><input form=f><textarea></textarea><select><option>a<option>b</select><output for=x>c</output>",
    );
    page.$("input").value = "value";
    page.$("input").setSelectionRange(1, 3, "backward");
    page.$("input").setCustomValidity("message");
    page.$("input").validity.custom = page.$("form").elements.custom = page.$("select").options.custom = 1;
    page.$("textarea").value = "a\r\nb";
    page.$("select").selectedIndex = 1;
    page.$("output").value = "d";
    Bun.gc(true);
    const { value, selectionStart, selectionEnd, selectionDirection, validationMessage, form } = page.$("input");
    expect([value, selectionStart, selectionEnd, selectionDirection, validationMessage, form.id]).toEqual([
      "value",
      1,
      3,
      "backward",
      "message",
      "f",
    ]);
    expect([page.$("input").validity.custom, page.$("form").elements.custom, page.$("select").options.custom]).toEqual([
      1, 1, 1,
    ]);
    expect([page.$("textarea").value, page.$("select").value, page.$("output").defaultValue]).toEqual([
      "a\nb",
      "b",
      "c",
    ]);
  });

  test("custom elements take part in forms", () => {
    using page = open("<form><fieldset><x-a name=a></x-a></fieldset></form>");
    const log: unknown[] = [];
    class A extends page.window.HTMLElement {
      static formAssociated = true;
      internals = this.attachInternals();
      formAssociatedCallback = undefined;
      formDisabledCallback(disabled: boolean) {
        log.push(disabled);
      }
      formResetCallback() {
        log.push("reset");
      }
    }
    page.window.customElements.define("x-a", A);
    const { internals } = page.$("x-a");
    internals.setFormValue("1");
    internals.setValidity({ tooLong: true }, "long");
    const form = page.$("form");
    expect([[...new page.window.FormData(form)], form.checkValidity(), form.elements.a === page.$("x-a")]).toEqual([
      [["a", "1"]],
      false,
      true,
    ]);
    page.$("fieldset").disabled = true;
    form.reset();
    expect([log, form.checkValidity(), page.$("x-a").matches(":disabled")]).toEqual([[true, "reset"], true, true]);
  });

  test.each([
    ["number", "min=1 step=2", "2", 1, "3"],
    ["number", "step=0.1", "0.2", 1, "0.3"],
    ["range", "max=10 step=3", "9", 1, "9"],
    ["date", "", "2024-02-28", 2, "2024-03-01"],
    ["month", "", "2023-12", 1, "2024-01"],
    ["time", "step=0.5", "10:00", 3, "10:00:01.500"],
  ])("<input type=%s %s> steps from %j", (type, attributes, value, steps, expected) => {
    using page = open(`<input type=${type} ${attributes}>`);
    page.$("input").value = value;
    page.$("input").stepUp(steps);
    expect(page.$("input").value).toBe(expected);
  });

  test("an empty attribute is not a number", () => {
    using page = open(`<input maxlength="" size="" tabindex=""><textarea rows="" cols="-"></textarea>`);
    const [input, textarea] = [page.$("input"), page.$("textarea")];
    expect([input.maxLength, input.size, input.tabIndex, textarea.rows, textarea.cols]).toEqual([-1, 20, 0, 2, 20]);
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

describe("top layer", () => {
  test("a popover closes those that it is not nested in, and leaves with its element", () => {
    using page = open(
      "<div id=a popover><div id=b popover></div></div><div id=c popover></div><div id=d popover=manual></div>",
    );
    const shown = () => Array.from(page.document.querySelectorAll(":popover-open"), (it: any) => it.id).join("");
    for (const id of "dab") page.$("#" + id).showPopover();
    expect(shown()).toBe("abd");
    page.$("#c").showPopover();
    expect(shown()).toBe("cd");
    const removed = page.$("#c");
    removed.remove();
    page.document.body.append(removed);
    expect(shown()).toBe("d");
  });

  test("a modal dialog takes the focus, and gives it back", () => {
    using page = open("<button id=a></button><dialog><input id=b><input id=c autofocus></dialog>");
    page.$("#a").focus();
    page.$("dialog").showModal();
    page.$("#a").focus();
    expect(page.document.activeElement.id).toBe("c");
    page.$("dialog").close("done");
    expect([page.document.activeElement.id, page.$("dialog").returnValue]).toEqual(["a", "done"]);
  });

  test("what has the focus is not scrolled into view again, unless it is invalid", () => {
    using page = open(
      `<input id=a required><label id=b for=a></label><div id=c tabindex=0></div><div style="height: 5000px"></div>`,
    );
    page.resize(200, 100, 1);
    const after = (first: string, action: () => void) => {
      page.$(first).focus();
      page.window.scrollTo(0, 2000);
      action();
      return page.window.scrollY;
    };
    expect(after("#a", () => page.$("#a").focus())).toBe(2000);
    expect(after("#a", () => page.$("#b").focus())).toBe(2000);
    expect(after("#c", () => page.$("#c").focus())).toBe(2000);
    expect(after("#c", () => page.$("#a").focus())).toBe(0);
    expect(after("#a", () => page.$("#a").reportValidity())).toBe(0);
  });

  test.each([
    ["display: none", false],
    ["display: table-column", false],
    ["display: table-column-group", false],
    ["content-visibility: hidden", false],
    ["visibility: hidden", false],
    ["content: url(data:,)", false],
    ["display: contents", true],
    ["display: inline", true],
    ["float: left", true],
  ])("what is in an element that has just been given %s takes the focus: %p", (declarations, expected) => {
    using page = open("<div><p><button></button></p></div>");
    page.$("button").getBoundingClientRect();
    page.$("div").style.cssText = declarations;
    page.$("button").focus();
    expect(page.document.activeElement === page.$("button")).toBe(expected);
    page.$("button").blur();
    page.$("div").style.cssText = "";
    page.$("button").focus();
    expect(page.document.activeElement).toBe(page.$("button"));
  });

  test("selectors see the state of controls at once", () => {
    using page = open("<form><input required placeholder=a></form>");
    const seen = () => [":invalid", ":placeholder-shown", "form:has(:valid) *"].map(it => page.$("input").matches(it));
    expect(seen()).toEqual([true, true, false]);
    page.$("input").value = "a";
    expect(page.$("input").matches("input")).toBe(true);
    expect(seen()).toEqual([false, false, true]);
  });

  test("an image button is as wide as its style has just become", () => {
    using page = open('<input type=image style="width: 10px">');
    expect(page.$("input").width).toBe(10);
    page.$("input").style.width = "20px";
    expect(page.$("input").width).toBe(20);
  });

  test("only one of the details of a name is open", () => {
    using page = open("<details name=n open id=a></details><details name=n id=b><summary></summary></details>");
    page.$("summary").click();
    expect([page.$("#a").open, page.$("#b").open]).toEqual([false, true]);
  });
});

test("DataTransfer", () => {
  using page = open();
  const data = new page.window.DataTransfer();
  data.setData("Text", "a");
  data.setData("url", "# comment\r\nhttp://a/\r\nhttp://b/");
  data.items.add(new File(["x"], "é.txt", { type: "text/x" }));
  expect([data.types, data.getData("text/plain"), data.getData("URL")]).toEqual([
    ["text/plain", "text/uri-list", "Files"],
    "a",
    "http://a/",
  ]);
  const input = Object.assign(page.document.createElement("input"), { type: "file", files: data.files });
  expect(input.value).toBe("C:\\fakepath\\é.txt");
  const [item] = data.items;
  data.items.remove(0);
  expect([item.kind, data.items.length]).toEqual(["", 2]);
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
    ["a<ol><li>[]b</li><li>c</li></ol>", "delete", undefined, "ab<ol><li>c</li></ol>"],
    ["a<blockquote>[]b</blockquote>", "delete", undefined, "ab"],
    ["<b>a</b>[]b", "insertText", "c", "<b>ac</b>b"],
    ['<a href="x">a</a>[]b', "insertText", "c", '<a href="x">a</a>cb'],
    ['<a href="x">[a]b</a>', "insertText", "c", '<a href="x">cb</a>'],
    ['<div style="text-align: right;">[a]</div>', "justifyLeft", undefined, '<div style="text-align: left;">a</div>'],
    ["[a]", "indent", undefined, '<blockquote style="margin: 0 0 0 40px; border: none; padding: 0px;">a</blockquote>'],
    [
      '<span style="color: blue">a[b]c</span>',
      "foreColor",
      "red",
      '<span style="color: blue">a</span><font color="#ff0000">b</font><span style="color: blue">c</span>',
    ],
    ["<select><option>a[]</option></select>", "insertText", "b", "b<select><option>a</option></select>"],
    ["<div>[a]</div>", "delete", undefined, "<br>"],
    ['<p style="color: blue">a</p><p>[]b</p>', "delete", undefined, '<p style="color: blue">ab</p>'],
  ])("%s, %s", (before, command, value, after) => {
    expect(edit(before, command, value)).toBe(after);
  });

  test("undo and redo go through what was changed, also after a collection", () => {
    using page = open("<div contenteditable><p>a</p></div>");
    const host = page.$("div");
    host.focus();
    page.window.getSelection().collapse(host.firstChild.firstChild, 1);
    const run = (command: string, value?: string) => (
      page.document.execCommand(command, false, value),
      Bun.gc(true),
      host.innerHTML
    );
    expect([
      run("insertText", "b"),
      run("insertParagraph"),
      run("undo"),
      run("undo"),
      run("redo"),
      run("redo"),
    ]).toEqual(["<p>ab</p>", "<p>ab</p><p><br></p>", "<p>ab</p>", "<p>a</p>", "<p>ab</p>", "<p>ab</p><p><br></p>"]);
  });

  test("text that is nested deeply is replaced", () => {
    expect(edit("<b>".repeat(400) + "[a]", "insertText", "c").replaceAll(/<.*?>/g, "")).toBe("c");
  });

  test("text is deleted that has many empty elements on both sides", () => {
    const empty = "<i></i>".repeat(3000);
    expect(edit(`${"<b>".repeat(400)}a${empty}[b]${empty}c`, "delete").replaceAll(/<.*?>/g, "")).toBe("ac");
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

describe("markup that repeats", () => {
  const rows = (count: number, row: string) => Buffer.alloc(count * row.length, row).toString();

  test("changing one element leaves those with the same start tag alone", () => {
    using page = open("<style>.a{color:rgb(1,2,3)}.b{color:rgb(4,5,6)}</style><div></div>");
    const list = page.$("div");
    list.innerHTML = rows(40, '<p class="a" data-k="1">x</p>');
    const copy = list.cloneNode(true);
    list.children[20].className = "b";
    list.children[21].removeAttribute("data-k");
    list.children[22].setAttribute("title", "t");
    list.children[23].style.width = "1px";
    expect(Array.from(list.children, (it: any) => it.outerHTML).slice(19, 25)).toEqual([
      '<p class="a" data-k="1">x</p>',
      '<p class="b" data-k="1">x</p>',
      '<p class="a">x</p>',
      '<p class="a" data-k="1" title="t">x</p>',
      '<p class="a" data-k="1" style="width: 1px;">x</p>',
      '<p class="a" data-k="1">x</p>',
    ]);
    expect(list.innerHTML).toBe(Array.from(list.children, (it: any) => it.outerHTML).join(""));
    expect(copy.innerHTML).toBe(rows(40, '<p class="a" data-k="1">x</p>'));
    const colors = [19, 20, 21].map(it => page.window.getComputedStyle(list.children[it]).color);
    expect(colors).toEqual(["rgb(1, 2, 3)", "rgb(4, 5, 6)", "rgb(1, 2, 3)"]);
  });

  test.each([
    ['<a title="x>y" href="#">1</a>', '<a title="x&gt;y" href="#">1</a>'],
    ['<image class="i">', '<img class="i">'],
    ['<svg><a class="i">1</a></svg><a class="i">2</a>', '<svg><a class="i">1</a></svg><a class="i">2</a>'],
    ['<p><b class="i">1</p>2</b>', '<p><b class="i">1</b></p><b class="i">2</b>'],
    ['<i title="\u03b1">1</i><i title="\u03b2">2</i>', '<i title="\u03b1">1</i><i title="\u03b2">2</i>'],
    ['<i title="\xff">\u03b1</i><i title="\u03b2">2</i>', '<i title="\xff">\u03b1</i><i title="\u03b2">2</i>'],
    ['<style class="i">a>b{}</style><br class="i">&amp;', '<style class="i">a>b{}</style><br class="i">&amp;'],
  ])("%j", (row, expected) => {
    using page = open();
    page.document.body.innerHTML = row.repeat(20);
    expect(page.document.body.innerHTML).toBe(expected.repeat(20));
  });

  test("ids, handlers and quirks", () => {
    using page = open();
    const row = '<i id="x" class="Up">1</i><b onclick="1">2</b>';
    page.document.body.innerHTML = rows(5, row);
    page.$("i").remove();
    expect(page.document.getElementById("x")).toBe(page.$("i"));
    const quirky = new page.window.DOMParser().parseFromString(rows(5, row), "text/html");
    expect([page.document, quirky].map(it => it.querySelectorAll(".up").length)).toEqual([0, 5]);
  });
});

describe("markup that is parsed in bulk", () => {
  test.each(["write", "innerHTML"])("has the states and hints that depend on what is around it: %s", how => {
    using page = open();
    const { document, window } = page;
    const markup = `<div><div dir=rtl><p><a href=a>1</a><a>2</a></p></div><div contenteditable><b title=t>3</b></div>
      <table><tr><td id=plain>4</table><table border=1 cellpadding=7><tr><td id=styled>5<table><tr><td id=inner>6</table></table></div>`;
    if (how === "write") (document.open(), document.write(markup), document.close());
    else document.body.innerHTML = markup;
    const count = (selector: string) => document.querySelectorAll(selector).length;
    const cell = (id: string) =>
      (it => [it.paddingTop, it.borderTopWidth])(window.getComputedStyle(document.getElementById(id)));
    expect([count(":any-link"), count(":dir(rtl)"), count(":read-write"), count("[title]")]).toEqual([1, 4, 2, 1]);
    expect(["plain", "styled", "inner"].map(cell)).toEqual([
      ["1px", "0px"],
      ["7px", "1px"],
      ["1px", "0px"],
    ]);
  });

  test("goes on where a long piece ends", () => {
    using page = open();
    const { document } = page;
    const rows = Buffer.alloc(9 * 1000, "<p>ab</p>").toString();
    document.open();
    for (const piece of [rows + "<i cla", "ss=c>x</i>" + rows + "&am", "p;" + rows + "\r", "\n" + rows + "</", "body>"])
      document.write(piece);
    document.close();
    expect(document.body.innerHTML).toBe(`${rows}<i class="c">x</i>${rows}&amp;${rows}\n${rows}`);
  });

  test("is found by searches that follow other searches", () => {
    using page = open();
    const { document } = page;
    document.open();
    document.write(Buffer.alloc(14 * 300, "<p><u></u></p>").toString() + "<div><span>");
    for (let i = 0; i < 20; i++) expect(document.querySelectorAll(`p > u:not(.a${i})`).length).toBe(300);
    document.write("<b><u></u></b>");
    expect(document.querySelectorAll("b > u").length).toBe(1);
  });

  test("XML elements that look alike do not share changes or namespaces", () => {
    using page = open();
    const source = `<r xmlns:x="urn:1"><a b="1"/><a b="1"/><a b="2"/><x:a/><s xmlns:x="urn:2" xmlns="urn:3"><x:a/><a b="2">t<![CDATA[u]]>v</a></s><a b="2"/></r>`;
    const xml = new page.window.DOMParser().parseFromString(source, "text/xml");
    const all = [...xml.getElementsByTagNameNS("*", "a")];
    expect(all.map(it => it.namespaceURI)).toEqual([null, null, null, "urn:1", "urn:2", "urn:3", null]);
    all[0].setAttribute("b", "3");
    expect(new page.window.XMLSerializer().serializeToString(xml)).toBe(source.replace('b="1"', 'b="3"'));
  });

  test("an XML element has a limited number of attributes", () => {
    using page = open();
    const parse = (count: number, prefix: string) => {
      const source = `<r xmlns:x="urn:1"><a ${Array.from({ length: count }, (_, i) => `${prefix}a${i}=""`).join(" ")}/></r>`;
      return new page.window.DOMParser().parseFromString(source, "text/xml").querySelector("a, parsererror").localName;
    };
    expect([parse(4096, ""), parse(4096, "x:"), parse(4097, ""), parse(4097, "x:")]).toEqual([
      "a",
      "a",
      "parsererror",
      "parsererror",
    ]);
  });
});

test("a page that is gone is freed before the last of its nodes is swept", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { createPage, countEngines } = require("bun:internal-for-testing").desktopInternals;
      const open = fontScope => {
        const page = createPage({ native: null, surface: 0, fontScope });
        page.parseHTML("<!doctype html>");
        return page;
      };
      const other = open(1);
      (() => {
        const page = open(2);
        for (let i = 0; i < 50_000; i++) page.document.createElement("p");
        page.dispose();
      })();
      console.log(countEngines());
      require("bun:jsc").fullGC();
      // A block is swept when the room in it is needed. Documents have blocks of their own.
      const kept = [];
      while (countEngines() > 1 && kept.length < 5_000) kept.push(new other.window.Document());
      console.log(countEngines());`,
    ],
    // A compilation that is under way holds the variables of its loop.
    env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
    stderr: "inherit",
  });
  expect(await proc.stdout.text()).toBe("2\n1\n");
  expect(await proc.exited).toBe(0);
});

test("a node keeps what it needs of a page that is gone", () => {
  const kept = (() => {
    using page = open();
    page.document.body.innerHTML = "<p><b>1</b></p><template><i>2</i></template>";
    const parsed = new page.window.DOMParser().parseFromString("<u>3</u>", "text/html");
    return [page.document.querySelector("b"), page.document.querySelector("template").content.firstChild, parsed.body];
  })();
  const seen = [];
  while (kept.length) {
    Bun.gc(true);
    const node = kept.shift();
    node.append(node.ownerDocument.createElement("s"));
    seen.push(node.outerHTML);
  }
  expect(seen).toEqual(["<b>1<s></s></b>", "<i>2<s></s></i>", "<body><u>3</u><s></s></body>"]);
});

test.each(["&", "<", ">", '"', "\u00a0", "\n"])("%j is escaped wherever it is", special => {
  using page = open();
  const element = page.document.createElement("p");
  const escape = (text: string, set: RegExp) =>
    text.replace(
      set,
      it => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\u00a0": "&nbsp;", "\n": "&#10;" })[it]!,
    );
  for (let length = 1; length < 70; length++) {
    for (let at = 0; at < length; at++) {
      const text = Buffer.alloc(at, "=").toString() + special + Buffer.alloc(length - at - 1, "'").toString();
      element.title = element.textContent = text;
      expect(element.outerHTML).toBe(`<p title="${escape(text, /[&<>"\u00a0]/g)}">${escape(text, /[&<>\u00a0]/g)}</p>`);
      expect(new page.window.XMLSerializer().serializeToString(element)).toEndWith(
        ` title="${escape(text, /[&<>"\n]/g)}">${escape(text, /[&<>]/g)}</p>`,
      );
    }
  }
});

describe("nodes that no script has asked for", () => {
  const source = `<!--a-->t<p id=x class=c>1<!--b--><!--c--><b>2</b><!--d--></p><svg><g><title>3</title></g></svg><table>4<tr><td id=y>5</table><i>6<u>7</i>8</u>`;
  const shape = (node: any): unknown => {
    const children: any[] = [];
    for (let it = node.firstChild; it; it = it.nextSibling) {
      expect([it.parentNode, it.previousSibling, it.ownerDocument, it.isConnected]).toEqual([
        node,
        children.at(-1) ?? null,
        node.ownerDocument,
        node.isConnected,
      ]);
      children.push(it);
    }
    expect(node.lastChild).toBe(children.at(-1) ?? null);
    return [node.constructor.name, node.nodeValue, ...children.map(shape)];
  };

  test.each<[string, (page: any, markup: string) => any]>([
    ["innerHTML", (page, markup) => Object.assign(page.document.body, { innerHTML: markup })],
    ["DOMParser", (page, markup) => new page.window.DOMParser().parseFromString(markup, "text/html").body],
    [
      "document.write",
      (page, markup) => (page.document.open(), page.document.write(markup), page.document.close(), page.document.body),
    ],
    [
      "cloneNode",
      (page, markup) => Object.assign(page.document.createElement("p"), { innerHTML: markup }).cloneNode(true),
    ],
    [
      "XML",
      (page, markup) => {
        const xml = new page.window.DOMParser().parseFromString(
          `<p xmlns="http://www.w3.org/1999/xhtml">${markup}</p>`,
          "application/xhtml+xml",
        );
        return page.document.adoptNode(xml.documentElement);
      },
    ],
  ])("have no object: %s", (_, make) => {
    using page = open();
    const count = () => (Bun.gc(true), heapStats().objectTypeCounts.HTMLModElement ?? 0);
    const before = count();
    const root = make(page, `<div>${Buffer.alloc(12 * 1000, "<ins>a</ins>")}</div>`);
    expect([count() - before, root.textContent.length, root.innerHTML.length]).toEqual([0, 1000, 12011]);
    expect(root.querySelector("ins").parentNode.childNodes.length).toBe(1000);
    expect(count() - before).toBe(1000);
  });

  test("have no object after they have left a document with quirks", () => {
    using page = open();
    const count = () => (Bun.gc(true), heapStats().objectTypeCounts.HTMLModElement ?? 0);
    const before = count();
    const parsed = new page.window.DOMParser().parseFromString(
      "<p><b><ins class=a></ins><ins class=B></ins></b>",
      "text/html",
    );
    const found = (root: any) => ["A", "a", "B", "b"].map(it => root.matches(`:has(.${it})`));
    expect(found(parsed.body)).toEqual([true, true, true, true]);
    page.document.body.replaceChildren(...parsed.body.childNodes);
    expect([found(page.document.body), count() - before]).toEqual([[false, true, true, false], 0]);
  });

  describe("and that are controls", () => {
    const counts = (...names: string[]) => (Bun.gc(true), names.map(it => heapStats().objectTypeCounts[it] ?? 0));
    const more = (before: number[], after: number[]) => after.map((it, index) => it - before[index]);

    test("have no object, even if they are shown", () => {
      using page = open("<style>p { display: none }</style><div></div>");
      const count = () => counts("HTMLInputElement", "HTMLButtonElement", "ShadowRoot");
      const [div, before] = [page.$("div"), count()];
      div.innerHTML =
        `<i><input type=checkbox checked><button>a</button><input value=b><p><input value=c></p></i>`.repeat(100);
      expect([div.offsetHeight > 0, more(before, count())]).toEqual([true, [0, 0, 0]]);
      expect(div.cloneNode(true).querySelectorAll(":checked:default, :valid:enabled").length).toBe(400);
    });

    test("get their parts when they are displayed, as they do if a script has made them", () => {
      using page = open(
        "<style>input { field-sizing: content; padding: 0; border: 0 } .no { display: none }</style><div class=no></div>",
      );
      const [div, before] = [page.$("div"), counts("ShadowRoot")];
      const made = Array.from({ length: 50 }, () =>
        div.appendChild(Object.assign(page.document.createElement("input"), { value: "aaaa" })),
      );
      div.insertAdjacentHTML(
        "beforeend",
        "<p><input value=aaaa><input placeholder=aaaa><input type=button value=aaaa><input>",
      );
      expect([div.offsetWidth, more(before, counts("ShadowRoot"))]).toEqual([0, [0]]);
      const widths = () => [made[0], ...div.lastChild.children].map(it => it.offsetWidth);
      div.className = "";
      const [width] = widths();
      expect([width > 10, widths().map(it => it === width)]).toEqual([true, [true, true, true, true, false]]);
      div.className = "no";
      expect(widths()).toEqual([0, 0, 0, 0, 0]);
      made[0].value = "";
      div.lastChild.lastChild.value = "aaaa";
      div.className = "";
      expect(widths().map(it => it === width)).toEqual([false, true, true, true, true]);
      div.lastChild.firstChild.focus();
      page.document.execCommand("insertText", false, "b");
      expect([div.lastChild.firstChild.value, widths()[1] > width]).toEqual(["baaaa", true]);
    });

    test.each([
      ["form", "form"],
      ["fieldset", "fieldset disabled"],
      ["datalist", "datalist"],
      ["label", "label"],
    ])("hear of the %s that they are put in", (name, tag) => {
      using page = open(`<${tag} id=a></${name}><${tag} id=b></${name}>`);
      const markup = "<p><b><input type=checkbox name=n checked><button>a</button><input type=submit></b></p>";
      const [lazy, eager] = ["#a", "#b"].map(id => {
        const [group, from] = [page.$(id), page.document.createElement("div")];
        from.innerHTML = markup;
        if (id === "#b") from.querySelectorAll("input, button").forEach((it: any) => it.toggleAttribute("x"));
        group.append(from);
        const states = [":valid", ":default", ":disabled"].map(it => group.querySelectorAll(it).length);
        return [states, group.elements?.length, group.control?.type];
      });
      expect(lazy).toEqual(eager);
      expect(lazy).toEqual(
        {
          form: [[3, 2, 0], 3, undefined],
          fieldset: [[0, 1, 3], 3, undefined],
          datalist: [[0, 1, 0], undefined, undefined],
          label: [[3, 1, 0], undefined, "checkbox"],
        }[name]!,
      );
    });

    test("start from their attributes", () => {
      using page = open("<input type=checkbox checked value=a><input value=b><input type=checkbox>");
      const [box, field, parent] = page.document.body.children;
      box.type = "text";
      field.removeAttribute("value");
      expect([box.value, box.checked, box.matches(":checked"), field.value]).toEqual(["a", true, false, ""]);
      parent.append(Object.assign(page.document.createElement("p"), { textContent: "a" }));
      expect(parent.firstChild.offsetHeight).toBe(0);
    });
  });

  test.each<[string, (page: any, root: any) => any]>([
    ["stay where they are", (_, root) => root],
    ["are inserted with their parent", (page, root) => page.document.body.appendChild(root)],
    ["are cloned", (_, root) => root.cloneNode(true)],
    ["are cloned in part", (_, root) => (root.querySelector("b"), root.cloneNode(true))],
    ["are imported", (page, root) => page.document.implementation.createHTMLDocument().importNode(root, true)],
    ["are adopted", (page, root) => page.document.implementation.createHTMLDocument().adoptNode(root)],
    ["are adopted by another page", (_, root) => open().document.adoptNode(root)],
    ["get a shadow host", (_, root) => (root.attachShadow({ mode: "open" }), root)],
    ["survive a collection", (_, root) => (Bun.gc(true), root)],
  ])("%s", (_, change) => {
    using page = open();
    const [lazy, eager] = [false, true].map(isObserved => {
      const root = page.document.createElement("div");
      root.innerHTML = source;
      if (isObserved) shape(root);
      const result = change(page, root);
      return [result.innerHTML, result.textContent, result.childElementCount, shape(result)];
    });
    expect(lazy).toEqual(eager);
    expect(lazy[0]).toBe(
      `<!--a-->t<p id="x" class="c">1<!--b--><!--c--><b>2</b><!--d--></p><svg><g><title>3</title></g></svg>4<table><tbody><tr><td id="y">5</td></tr></tbody></table><i>6<u>7</u></i><u>8</u>`,
    );
  });

  test("an element takes its children along", () => {
    using page = open("<div></div>");
    const element = page.document.createElement("p");
    element.textContent = "a";
    page.$("div").append(element);
    expect(page.document.body.innerHTML).toBe("<div><p>a</p></div>");
  });

  test("are found by their ids for as long as they are there", () => {
    using page = open("<div></div><section></section>");
    const find = () => [page.document.getElementById("y")?.textContent, page.window.y?.textContent];
    const [div, section] = [page.$("div"), page.$("section")];
    div.innerHTML = source;
    div.innerHTML = "<p><b id=z>";
    const found = [find()];
    div.innerHTML = source;
    div.remove();
    found.push(find());
    section.append(div);
    found.push(find());
    const template = page.document.createElement("template");
    template.innerHTML = source;
    expect([...found, template.content.getElementById("x").localName]).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      ["5", "5"],
      "p",
    ]);
  });

  test("are reported to observers", () => {
    using page = open("<div><p>a</p>b</div>");
    const observer = new page.window.MutationObserver(() => {});
    observer.observe(page.document.body, { childList: true, subtree: true });
    page.$("div").innerHTML = "<i>c</i>";
    page.$("i").textContent = "d";
    const names = (nodes: any) => Array.from(nodes, (it: any) => it.outerHTML ?? it.data);
    expect(observer.takeRecords().map((it: any) => [names(it.removedNodes), names(it.addedNodes)])).toEqual([
      [["<p>a</p>", "b"], ["<i>d</i>"]],
      [["c"], ["d"]],
    ]);
  });

  test("are styled and laid out again when they are replaced", () => {
    using page = open(
      "<style>p { margin: 0; height: 10px } p:last-child { height: 20px } div:empty { height: 5px } div:has(b) { padding-top: 1px }</style><div></div>",
    );
    const div = page.$("div");
    const heights = ["<p></p><p></p>", "<p></p>", "", "<p><b></b></p>", "<!---->"].map(
      it => ((div.innerHTML = it), div.offsetHeight),
    );
    div.insertAdjacentHTML("beforeend", "<p></p>");
    heights.push(div.offsetHeight);
    div.insertAdjacentHTML("beforeend", "<p></p>");
    expect([...heights, div.offsetHeight]).toEqual([30, 20, 5, 21, 5, 20, 30]);
  });

  test("a table that a script has removed does not take what follows", () => {
    using page = open();
    page.document.open();
    page.document.write("<div><table id=t>");
    const table = page.document.getElementById("t");
    table.remove();
    page.document.write("<tr><b id=a>1</b><td id=b>2");
    page.document.close();
    expect([page.document.body.innerHTML, table.innerHTML, page.document.getElementById("b")]).toEqual([
      '<div><b id="a">1</b></div>',
      '<tbody><tr><td id="b">2</td></tr></tbody>',
      null,
    ]);
  });

  test.each(["div", "table", "tr", "select", "textarea", "colgroup", "frameset", "html", "template", "script"])(
    "innerHTML of <%s> is only text",
    tag => {
      using page = open();
      const [plain, escaped] = ["a b", "&#97; b"].map(
        it => Object.assign(page.document.createElement(tag), { innerHTML: it }).outerHTML,
      );
      expect(plain).toBe(tag === "script" ? "<script>a b</script>" : escaped);
    },
  );

  test("character references", () => {
    using page = open();
    const text = (markup: string) => Object.assign(page.document.createElement("p"), { innerHTML: markup }).textContent;
    const source = "&amp;&lt;&amp&ampx;&notin;&notit;&NotEqualTilde;&nGt;&;&a;&lt\u013b&l\u0174;&Afr;&gt;";
    const expected = "&<&&x;\u2209\xacit;\u2242\u0338\u226b\u20d2&;&a;<\u013b&l\u0174;\u{1d504}>";
    expect([text(source), text(source)]).toEqual([expected, expected]);
  });
});

test("XML, XPath, ranges and the sanitizer", () => {
  using page = open("<p>ab<b>cd</b>ef</p>");
  const { DOMParser, XMLSerializer, XPathResult } = page.window;
  const source = '<a xmlns="u:a" xmlns:b="u:b"><b:c b:d="1"/>\ud83c<![CDATA[<]]><!--e--><?f g?></a>';
  const xml = new DOMParser().parseFromString(source, "text/xml");
  expect(new XMLSerializer().serializeToString(xml)).toBe(source.toWellFormed());
  expect(xml.evaluate("count(//x:c/@x:d)", xml, () => "u:b", XPathResult.NUMBER_TYPE).numberValue).toBe(1);
  const range = page.document.createRange();
  range.setStart(page.$("p").firstChild, 1);
  range.setEnd(page.$("b").firstChild, 1);
  page.$("p").firstChild.insertData(0, "z");
  expect([range.startOffset, `${range}`]).toEqual([2, "bc"]);
  expect(new XMLSerializer().serializeToString(range.extractContents().lastChild)).toBe(
    '<b xmlns="http://www.w3.org/1999/xhtml">c</b>',
  );
  page.$("p").setHTML("<i onclick=x>1</i><script>2</script>");
  expect(page.$("p").innerHTML).toBe("<i>1</i>");
});

test("window.find ignores case, accents and what is hidden, and stops at blocks", () => {
  using page = open("<p>Cr\xe8me <b>br\xfb</b>l\xe9e</p><p hidden>secret</p><p>a</p><p>b</p>");
  const found = ["creme  brulee", "secret", "ab"].map(it => page.window.find(it) && `${page.window.getSelection()}`);
  expect(found).toEqual(["Cr\xe8me br\xfbl\xe9e", false, false]);
});

describe("messages between a page and its host", () => {
  const { decodesMessage } = desktopInternals;
  const u32 = (value: number) => [...new Uint8Array(new Uint32Array([value]).buffer)];
  const text = (value: string) => [...u32(value.length), ...Buffer.from(value)];
  const kindsOf = (family: string, rest: number[]) =>
    Array.from({ length: 300 }, (_, kind) => kind).filter(kind =>
      decodesMessage(family, new Uint8Array([kind & 255, kind >> 8, ...rest])),
    );
  const console = (level: number, message: number[], more: number[] = []) =>
    decodesMessage("notice", new Uint8Array([0, 0, level, ...message, ...u32(1), ...text("u"), ...more]));

  test("only what is well formed is decoded", () => {
    expect({
      whole: console(3, text("m")),
      keyword: console(4, text("m")),
      utf8: console(3, [...u32(1), 0xff]),
      length: console(3, [...u32(0xffffffff), 109]),
      trailing: console(3, text("m"), [0]),
      empty: decodesMessage("notice", new Uint8Array()),
      kind: decodesMessage("notice", new Uint8Array([255, 255])),
    }).toEqual({ whole: true, keyword: false, utf8: false, length: false, trailing: false, empty: false, kind: false });
    const [zero, one, two] = [0, 1, 2].map(byte => kindsOf("answer", [byte]));
    expect(one.filter(kind => zero.includes(kind) && !two.includes(kind)).length).toBeGreaterThan(5);
  });

  test("lengths are limited", () => {
    const one = kindsOf("notice", text("ab"));
    const lists = kindsOf("notice", [...u32(1), ...text("a")]).filter(kind => !one.includes(kind));
    const sized = (kind: number, count: number, size: number) => {
      const bytes = new Uint8Array(6 + size);
      bytes.set([kind, 0, ...u32(count)]);
      return decodesMessage("notice", bytes);
    };
    expect([one.length > 0, lists.length > 0]).toEqual([true, true]);
    for (const kind of one)
      expect([sized(kind, 1 << 21, 1 << 21), sized(kind, 1 << 22, 1 << 22)]).toEqual([true, false]);
    expect([sized(lists[0], 1000, 4000), sized(lists[0], 0xffffffff, 4000)]).toEqual([true, false]);
  });

  test("every prefix of a message is refused", () => {
    const whole = [0, 0, 1, ...text("message"), ...u32(7), ...text("url")];
    expect(whole.map((_, end) => decodesMessage("notice", new Uint8Array(whole.slice(0, end))))).not.toContain(true);
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

  test("decode() fails if the href of an SVG image changes", async () => {
    using page = open();
    const image = page.document.createElementNS("http://www.w3.org/2000/svg", "image");
    const url = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>";
    image.setAttribute("href", url);
    const first = image.decode().catch((error: Error) => error.name);
    image.setAttribute("href", url + " ");
    expect([await first, await image.decode()]).toEqual(["EncodingError", undefined]);
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

test("a program that preloads bun:desktop/dom starts in a window", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--preload=bun:desktop/dom",
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
      "--preload=bun:desktop/dom",
      "-e",
      `document.body.innerHTML = '<p style="color: red"></p><b style="color: blue"></b>';
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

describe("text that is appended to", () => {
  const long = Buffer.alloc(300, "a").toString();

  test.each([
    ["ASCII", long, ["b", "c"]],
    ["Latin-1", long, ["b", "é", "c"]],
    ["UTF-16", long, ["b", "é", "一", "c", "é"]],
    ["a pair of surrogates in two steps", long + "一", ["\ud83d", "\ude00", "\ud83d", "b", "\ude00"]],
    ["more than there is room for", long, Array(40).fill("0123456789一")],
  ])("%s", (_, start, parts) => {
    using page = open(
      "<p style='white-space: nowrap; width: max-content'></p><p style='white-space: nowrap; width: max-content'></p>",
    );
    const [shown, expected] = page.document.querySelectorAll("p");
    const text = shown.appendChild(page.document.createTextNode(start));
    const seen: [string, string][] = [];
    let all = start;
    for (const part of parts) {
      text.appendData(part);
      expected.textContent = all += part;
      seen.push([text.data, all]);
      expect([text.length, shown.offsetWidth, shown.innerText]).toEqual([
        all.length,
        expected.offsetWidth,
        expected.innerText,
      ]);
    }
    for (const [data, was] of seen) expect(data).toBe(was);
  });

  test("goes another way than its clones", () => {
    using page = open();
    const text = page.document.createTextNode(long);
    text.appendData("b");
    const [first, second] = [text.cloneNode(), text.cloneNode()];
    text.appendData("c");
    first.appendData("d");
    second.appendData("e");
    second.appendData("f");
    expect([text, first, second].map(it => it.data.slice(long.length))).toEqual(["bc", "bd", "bef"]);
  });

  test("takes time that is linear in its length", () => {
    using page = open();
    const text = page.document.createTextNode("");
    const part = Buffer.alloc(300, "一").toString();
    for (let i = 0; i < 40_000; i++) text.appendData(part);
    expect(text.length).toBe(4_000_000);
  });
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
  using page =
    open(`<style>::-webkit-scrollbar { width: 15px }</style><div style="overflow-y: auto; height: 0; width: 200px">
    <div id="outer" style="height: 0"><div id="inner" style="height: 0"><p style="margin: 0; height: 100px"></p></div></div>
  </div>`);
  expect(page.$("#outer").offsetWidth).toBe(185);
  page.$("#inner").style.contain = "paint";
  expect(page.$("#outer").offsetWidth).toBe(200);
  page.$("#inner").style.contain = "";
  expect(page.$("#outer").offsetWidth).toBe(185);
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

test("a shadow host that moveBefore takes into another shadow tree keeps its style sheets", () => {
  using page = open(`<div id=outer></div><div id=inner></div>`);
  const [outer, inner] = ["#outer", "#inner"].map(id => page.$(id).attachShadow({ mode: "open" }));
  const sheet = new page.window.CSSStyleSheet();
  sheet.replaceSync("p { order: 3 }");
  inner.adoptedStyleSheets = [sheet];
  inner.innerHTML = "<p></p>";
  const order = () => page.window.getComputedStyle(inner.firstChild).order;
  expect(order()).toBe("3");
  outer.moveBefore(inner.host, null);
  expect(order()).toBe("3");
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

  test("the caret stays in hidden contents whose text has changed", () => {
    using page = open(
      "<div id=kept style='height: 20px; overflow: auto'><p style='height: 90px'></div><div contenteditable>a<p>bcdefg</p>h</div>",
    );
    page.$("#kept").scrollTop = 30;
    const [hidden, selection] = [page.$("[contenteditable] p"), page.window.getSelection()];
    hidden.style.contentVisibility = "hidden";
    expect(hidden.offsetHeight).toBe(0);
    hidden.firstChild.data = "b";
    for (const direction of ["forward", "backward"]) {
      for (const unit of ["character", "word", "line", "lineboundary", "paragraphboundary"]) {
        selection.collapse(hidden.firstChild, 1);
        selection.modify("move", direction, unit);
        expect([selection.anchorNode.data, selection.anchorOffset]).toEqual(["b", 1]);
      }
    }
    expect([page.$("#kept").offsetHeight, page.$("#kept").scrollTop]).toEqual([20, 30]);
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
      `const { createPage, panicInEngine } = require("bun:internal-for-testing").desktopInternals;
       const page = createPage({ surface: 0, fontScope: 1 });
       page.parseHTML("<!doctype html><html style='width:30px;height:20px'>");
       const root = page.document.documentElement;
       const state = () => console.log(root.offsetWidth, root.offsetHeight, root.appendChild(page.document.createElement("p")).isConnected);
       state();
       for (let i = 0; i < 3; i++) panicInEngine(page.document), state();
       page.dispose();`,
    ],
    // What a panic interrupts is leaked on purpose (src/dom/recovery.rs).
    env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("30 20 true\n".repeat(3) + "0 0 true\n");
  expect(stderr.split("for testing")).toHaveLength(4);
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows).concurrent.each(["block", "flex", "inline-block", "grid; grid: subgrid / subgrid"])(
  "a deep tree that is laid out with little stack left does not end the process: %s",
  async display => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const page = require("bun:internal-for-testing").desktopInternals.createPage({ surface: 0, fontScope: 1 });
         page.parseHTML("<!doctype html>" + "<div style='display: ${display}'>".repeat(50) + "<p style='height: 20px'>");
         const height = () => page.document.querySelector("p").offsetHeight;
         let first;
         (function deeper() {
           try { deeper(); } catch {}
           first ??= height();
         })();
         console.log(first, height());
         page.dispose();`,
      ],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
        BUN_JSC_maxPerThreadStackUsage: String(2 ** 30),
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("0 20\n");
    expect(stderr).toContain("out of stack");
    expect(exitCode).toBe(0);
  },
);

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
  const page = desktopInternals.createPage({ native: null, surface: 0, fontScope: nextFontScope++ });
  using _ = { [Symbol.dispose]: page.dispose };
  page.parseHTML("<!doctype html><div contenteditable></div>");
  const editor = page.document.querySelector("div");
  editor.oncopy = (event: ClipboardEvent) => {
    event.clipboardData!.setData("text/plain", "a");
    event.clipboardData!.setData("text/html", html);
    event.preventDefault();
  };
  editor.focus();
  page.edit("copy");
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

describe("SVG", () => {
  test("values follow their attributes, and outlive a collection", () => {
    using page = open(
      `<svg><text x="1 2em 3" transform="translate(1 2) scale(3)"></text><rect width="var(--a)" /></svg>`,
    );
    const [text, rect] = [page.$("text"), page.$("rect")];
    Object.assign(text.x.baseVal, { mark: 1 })[1].mark = 2;
    const { matrix } = text.transform.baseVal[1];
    Bun.gc(true);
    expect([text.x.baseVal.mark, text.x.baseVal[1].mark, Object.keys(text.x.baseVal)]).toEqual([
      1,
      2,
      ["0", "1", "2", "mark"],
    ]);
    const removed = text.x.baseVal.removeItem(0);
    removed.value = 9;
    matrix.a = 5;
    expect([text.getAttribute("x"), text.getAttribute("transform")]).toEqual([
      "2em 3",
      "translate(1 2) matrix(5 0 0 3 0 0)",
    ]);
    text.setAttribute("x", "4 5 6 7");
    expect(Array.from(text.x.animVal, (it: any) => it.value)).toEqual([4, 5, 6, 7]);
    expect(() => (text.x.animVal[0].value = 1)).toThrow(
      expect.objectContaining({ name: "NoModificationAllowedError" }),
    );
    expect([rect.width.baseVal.unitType, rect.width.baseVal.valueAsString]).toEqual([0, "var(--a)"]);
  });

  test("interfaces are native, and check their receivers", () => {
    using page = open(`<svg><circle r=1 /></svg>`);
    const { SVGLength, SVGRectElement } = page.window;
    const getter = (of: any, name: string) => Object.getOwnPropertyDescriptor(of.prototype, name)!.get!;
    expect(String(getter(SVGLength, "value"))).toContain("[native code]");
    expect(() => getter(SVGRectElement, "x").call(page.$("circle"))).toThrow(TypeError);
    expect(Reflect.ownKeys(page.$("circle").r.baseVal)).toEqual([]);
  });
});

test("querySelector follows changes, also if the selector starts with an id", () => {
  using page = open(`<main id=a class=x><p id=b><i></i></p></main><nav><p id=c><i id=d></i></p></nav>`);
  const { document } = page;
  const [main, nav] = [page.$("main"), page.$("nav")];
  const selectors = ["#a", "#a.x", "#a i", "#b > i", "#c #d", "#none", "#none i", "i", "#b + nav", "#a, #d"];
  const name = (it: any) => (it ? it.localName + it.id : "-");
  const read = (root: any) =>
    selectors.map(it => name(root.querySelector(it)) + root.querySelectorAll(it).length).join(" ");
  const changes = [
    () => {},
    () => (main.className = ""),
    () => (page.$("#c").id = "b"),
    () => main.replaceChildren(),
    () => (nav.id = "none"),
    () => nav.remove(),
  ];
  expect(changes.map(change => (change(), [document, main, nav].map(read)))).toMatchInlineSnapshot(`
    [
      [
        "maina1 maina1 i1 i1 id1 -0 -0 i2 -0 maina2",
        "-0 -0 i1 i1 -0 -0 -0 i1 -0 -0",
        "-0 -0 -0 -0 id1 -0 -0 id1 -0 id1",
      ],
      [
        "maina1 -0 i1 i1 id1 -0 -0 i2 -0 maina2",
        "-0 -0 i1 i1 -0 -0 -0 i1 -0 -0",
        "-0 -0 -0 -0 id1 -0 -0 id1 -0 id1",
      ],
      [
        "maina1 -0 i1 i2 -0 -0 -0 i2 -0 maina2",
        "-0 -0 i1 i1 -0 -0 -0 i1 -0 -0",
        "-0 -0 -0 id1 -0 -0 -0 id1 -0 id1",
      ],
      [
        "maina1 -0 -0 id1 -0 -0 -0 id1 -0 maina2",
        "-0 -0 -0 -0 -0 -0 -0 -0 -0 -0",
        "-0 -0 -0 id1 -0 -0 -0 id1 -0 id1",
      ],
      [
        "maina1 -0 -0 id1 -0 navnone1 id1 id1 -0 maina2",
        "-0 -0 -0 -0 -0 -0 -0 -0 -0 -0",
        "-0 -0 -0 id1 -0 -0 id1 id1 -0 id1",
      ],
      [
        "maina1 -0 -0 -0 -0 -0 -0 -0 -0 maina1",
        "-0 -0 -0 -0 -0 -0 -0 -0 -0 -0",
        "-0 -0 -0 id1 -0 -0 id1 id1 -0 id1",
      ],
    ]
  `);
  expect(() => document.querySelector("#none > > i")).toThrow("not a valid selector");
  expect(() => document.querySelector("#1")).toThrow("not a valid selector");
});

describe("changes that few can notice", () => {
  test("ids are found by their text, whatever kind of string has it", () => {
    using page = open();
    const { document } = page;
    const ids = [
      "a",
      "abcdefg",
      "abcdefgh",
      "class",
      "aria-describedby",
      Buffer.alloc(200, "x").toString(),
      "é",
      "日本語",
      "\ud800",
      "\udc00",
      "\ufffd",
    ];
    const elements = ids.map(id => document.body.appendChild(Object.assign(document.createElement("p"), { id })));
    const wide = (it: string) => (it + "日").slice(0, -1);
    const rope = (it: string) => [it.slice(0, 1), it.slice(1)].reduce((a, b) => a + b);
    for (const spell of [String, wide, rope]) {
      expect(ids.map(it => elements.indexOf(document.getElementById(spell(it))))).toEqual(ids.map((_, i) => i));
      expect(ids.map(it => document.getElementById(spell(it + "-")))).toEqual(ids.map(() => null));
    }
    const fragment = document.createDocumentFragment();
    fragment.append(...elements);
    expect(ids.map(it => document.getElementById(it))).toEqual(ids.map(() => null));
    expect(ids.map(it => elements.indexOf(fragment.getElementById(it)))).toEqual(ids.map((_, i) => i));
  });

  test.each([2, 3, 8, 9, 12])("the first of %d elements with an id is found wherever they move", count => {
    using page = open(
      Array.from(
        { length: count },
        (_, i) => `<div>${i % 3 ? "<b><i id=x></i></b>" : "<i id=x><u id=x></u></i>"}</div>`,
      ).join(""),
    );
    const { body } = page.document;
    for (let i = 0; i < 40; i++) {
      const moved = body.children[(i * 7) % count];
      const target = body.children[(i * 5 + 1) % count];
      if (i % 4 === 3 && !moved.contains(target))
        (target.prepend(moved), body.append(page.document.createElement("div")));
      else body.insertBefore(moved, target);
      expect(page.document.getElementById("x")).toBe([...body.getElementsByTagName("*")].find(it => it.id === "x"));
    }
    body.textContent = "";
    expect(page.document.getElementById("x")).toBe(null);
  });

  test("what is set outside of the document counts once it is inside", () => {
    using page = open(
      "<style>#b { color: rgb(1, 0, 0) } .d { width: 2px } [title=f] { height: 3px } [lang=h] { order: 4 }</style>",
    );
    const { document } = page;
    const element = document.createElement("div");
    for (const [name, values] of Object.entries({
      id: "ab",
      className: "cd",
      title: "ef",
      lang: "gh",
      dir: ["ltr", "rtl"],
      align: ["left", "right"],
    }))
      for (const value of values) element[name] = value;
    const parent = document.createElement("p");
    parent.append(element);
    expect(["#a", "#b", ".c", ".d", "[title=e]", "[title=f]"].map(it => parent.querySelector(it) === element)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    document.body.append(parent);
    const { color, width, height, order, direction, textAlign } = page.window.getComputedStyle(element);
    expect([color, width, height, order, direction, textAlign]).toEqual([
      "rgb(1, 0, 0)",
      "2px",
      "3px",
      "4",
      "rtl",
      "-webkit-right",
    ]);
    expect([document.getElementById("a"), document.getElementById("b")]).toEqual([null, element]);
    parent.remove();
    element.id = "";
    document.body.append(parent);
    expect([document.getElementById("b"), element.outerHTML]).toEqual([
      null,
      '<div id="" class="d" title="f" lang="h" dir="rtl" align="right"></div>',
    ]);
  });

  test("elements that share a class do not share its change", () => {
    using page = open();
    const [a, b] = [0, 0].map(() => Object.assign(page.document.createElement("i"), { className: "x" }));
    const copy = a.cloneNode();
    const list = page.document.body.getElementsByClassName("y");
    a.className = "y";
    b.title = "t";
    b.className = "z  y";
    page.document.body.append(a, b, copy);
    expect([page.document.body.innerHTML, list.length]).toEqual([
      '<i class="y"></i><i class="z  y" title="t"></i><i class="x"></i>',
      2,
    ]);
    b.className = "z y";
    a.className = "y";
    expect([b.getAttribute("class"), list.length]).toEqual(["z y", 2]);
  });

  test("a value that a selector or attr() reads restyles", () => {
    using page = open(
      "<style>[rel=b] { order: 1 } i::after { content: attr(title) }</style><b rel=a title=a></b><i title=a></i>",
    );
    const style = (selector: string, pseudo?: string) => page.window.getComputedStyle(page.$(selector), pseudo);
    expect([style("b").order, style("i", "::after").content]).toEqual(["0", '"a"']);
    page.$("b").title = "b";
    page.$("b").setAttribute("rel", "b");
    page.$("i").title = "b";
    expect([style("b").order, style("i", "::after").content, page.$("b").title]).toEqual(["1", '"b"', "b"]);
  });

  test("moves between parents outside of the document", () => {
    using page = open();
    const make = (name: string) => page.document.createElement(name);
    const [from, to, a, b, c] = ["div", "div", "a", "b", "i"].map(make);
    const lists = [from.childNodes, to.children, to.getElementsByTagName("b")];
    const state = () => [from.innerHTML, to.innerHTML, ...lists.map(it => it.length), to.querySelector("b") === b];
    from.append(a, "t", b, new page.window.Comment("c"), c);
    to.appendChild(b);
    expect(state()).toEqual(["<a></a>t<!--c--><i></i>", "<b></b>", 4, 1, 1, true]);
    to.insertBefore(c, b);
    to.insertBefore(b, b);
    to.appendChild(b);
    to.insertBefore(c, b);
    from.insertBefore(a, from.lastChild);
    expect(state()).toEqual(["t<a></a><!--c-->", "<i></i><b></b>", 3, 2, 1, true]);
    expect(() => b.appendChild(to)).toThrow(expect.objectContaining({ name: "HierarchyRequestError" }));
    expect(() => b.appendChild(b)).toThrow(expect.objectContaining({ name: "HierarchyRequestError" }));
    expect(() => to.insertBefore(a, a)).toThrow(expect.objectContaining({ name: "NotFoundError" }));
    to.removeChild(b);
    expect(state()).toEqual(["t<a></a><!--c-->", "<i></i>", 3, 1, 0, false]);
  });

  test("observers, ranges and iterators see a node that is put where it was", () => {
    using page = open();
    const parent = page.document.createElement("div");
    parent.innerHTML = "<a></a><b>t</b>";
    const observer = new page.window.MutationObserver(() => {});
    observer.observe(parent, { childList: true });
    parent.appendChild(parent.lastChild);
    expect(observer.takeRecords().map((it: any) => [it.removedNodes.length, it.addedNodes.length])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    observer.disconnect();
    const range = page.document.createRange();
    range.selectNodeContents(parent.lastChild);
    const iterator = page.document.createNodeIterator(parent);
    for (let i = 0; i < 3; i++) iterator.nextNode();
    parent.appendChild(parent.lastChild);
    expect([range.startContainer === parent, range.startOffset, iterator.referenceNode.localName]).toEqual([
      true,
      1,
      "a",
    ]);
  });

  test("what moves within the document keeps its ids, and takes the state of its new place", () => {
    using page = open(
      "<div dir=rtl></div><fieldset disabled><legend id=first><b id=b></b></legend><legend><input></legend></fieldset><p id=p><i id=i></i></p>",
    );
    const { document } = page;
    const [div, p, fieldset] = ["div", "p", "fieldset"].map(page.$);
    div.append(p);
    expect([
      document.getElementById("p") === p,
      document.getElementById("i").matches(":dir(rtl)"),
      p.isConnected,
    ]).toEqual([true, true, true]);
    document.body.append(p);
    expect(document.getElementById("i").matches(":dir(rtl)")).toBe(false);
    expect(page.$("input").matches(":disabled")).toBe(true);
    fieldset.prepend(fieldset.lastChild);
    expect(page.$("input").matches(":disabled")).toBe(false);
    p.remove();
    expect([document.getElementById("p"), document.getElementById("i")]).toEqual([null, null]);
  });

  test.each(["removes the parent", "removes the next sibling"])(
    "a frame that goes %s of what is being moved",
    action => {
      using page = open("<p id=moved><b id=inner>x</b><iframe></iframe></p><div><i></i></div>");
      const [moved, parent, next] = ["p", "div", "i"].map(page.$);
      moved.lastChild.contentWindow.addEventListener("pagehide", () =>
        (action === "removes the parent" ? parent : next).remove(),
      );
      parent.insertBefore(moved, next);
      expect([
        moved.isConnected,
        moved.firstChild.isConnected,
        page.document.getElementById("moved"),
        page.document.getElementById("inner"),
      ]).toEqual([false, false, null, null]);
      page.document.body.append(moved);
      expect([
        page.document.getElementById("inner") === moved.firstChild,
        moved.getBoundingClientRect().width > 0,
      ]).toEqual([true, true]);
    },
  );

  test("a list of elements outlasts changes of text, and not those of elements between them", () => {
    using page = open("<table><tr><td>a<tr><td>b</table>");
    const [{ rows }, cell] = [page.$("table"), page.$("td")];
    expect(rows.length).toBe(2);
    cell.removeChild(cell.firstChild);
    cell.append("c");
    expect(rows.length).toBe(2);
    cell.append("d");
    page.$("tbody").insertAdjacentHTML("beforeend", "<tr>");
    cell.append("e");
    expect(rows.length).toBe(3);
    cell.append("f");
    page.$("tbody").innerHTML = "<tr>";
    page.document.body.append("g");
    expect(rows.length).toBe(1);
  });

  test("a deep copy is searched like the original", () => {
    using page = open(
      '<div><p><b id=x class=y data-z=1 style="width: 1px"></b><svg><a:b/><foreignObject/></svg></p></div>',
    );
    page.$("b").style.width = "2px";
    const copy = page.$("div").cloneNode(true);
    expect(["#x", ".y", "[data-z='1']", "p > b"].map(it => copy.querySelector(it)?.tagName)).toEqual([
      "B",
      "B",
      "B",
      "B",
    ]);
    expect([...copy.querySelector("svg").children].map(it => it.tagName + it.constructor.name)).toEqual([
      "a:bSVGElement",
      "foreignObjectSVGForeignObjectElement",
    ]);
    page.$("div").replaceWith(copy);
    expect([
      page.document.getElementById("x") === copy.querySelector("b"),
      page.window.getComputedStyle(page.$("b")).width,
    ]).toEqual([true, "2px"]);
  });
});

describe.concurrent("optimized code", () => {
  async function run(body: string, env = {}) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--preload=bun:desktop/dom",
        "-e",
        `const { noInline, numberOfDFGCompiles } = require("bun:jsc");
        const same = (actual, expected) => { if (actual !== expected) throw new Error(actual + " is not " + expected); };
        const make = html => Object.assign(document.createElement("div"), { innerHTML: html });
        const hot = (run, rounds = 2000) => { noInline(run); for (let i = 0; i < rounds; i++) run(i); console.log(numberOfDFGCompiles(run) > 0); };
        ${body}`,
      ],
      env: {
        ...bunEnv,
        BUN_JSC_useConcurrentJIT: "0",
        BUN_JSC_thresholdForJITAfterWarmUp: "10",
        BUN_JSC_thresholdForOptimizeAfterWarmUp: "50",
        BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "500",
        BUN_JSC_validateDFGClobberize: "1",
        BUN_JSC_scribbleFreeCells: "1",
        ...env,
      },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("true\n");
    expect(exitCode).toBe(0);
  }

  test("reads links again after each change", () =>
    run(`const [parent, a, b] = [make(""), make(""), make("")];
      const names = (...nodes) => nodes.map(it => (it === a ? "a" : it === b ? "b" : it === parent ? "p" : it)).join();
      hot(() => {
        same(names(parent.firstChild, parent.lastChild, a.parentNode, a.nextSibling, parent.hasChildNodes()), ",,,,false");
        parent.appendChild(a);
        same(names(parent.firstChild, parent.lastChild, a.parentNode, a.nextSibling, parent.hasChildNodes()), "a,a,p,,true");
        parent.append(b);
        same(names(parent.lastChild, a.nextSibling, b.previousSibling, a.nextElementSibling, parent.lastElementChild), "b,b,a,b,b");
        a.remove();
        same(names(parent.firstChild, b.previousSibling, a.parentElement, parent.firstElementChild), "b,,,b");
        parent.textContent = "";
      });`));

  test("makes the objects of nodes that it is the first to ask for", () =>
    run(
      `hot(i => {
        const parent = make("a<b id=x>" + i + "</b><!--c-->");
        const [first, last] = i & 1 ? [parent.firstChild, parent.lastChild] : [parent.lastChild, parent.firstChild].reverse();
        same([first.nodeType, first.nextSibling.nodeType, last.nodeType, parent.nodeType].join(), "3,1,8,1");
        same(first.nextSibling.firstChild.data, "" + i);
        same(first.nextSibling.firstChild, last.previousSibling.lastChild);
        same(first.parentNode, parent);
      });`,
      { BUN_JSC_gcMaxHeapSize: "100000", BUN_JSC_sweepSynchronously: "1" },
    ));

  test("reads attributes and names again after each change", () =>
    run(
      `const element = document.body.appendChild(make(""));
      const xml = document.implementation.createDocument(null, "x");
      hot(i => {
        const id = "i" + i;
        same(document.getElementById(id), null);
        element.id = id;
        same(element.id + element.getAttribute("id") + element.hasAttribute("title"), id + id + false);
        same(document.getElementById(id), element);
        element.setAttribute("title", id);
        element.className = id;
        element.style.width = i + "px";
        same(element.getAttribute("TITLE") + element.className + element.getAttribute("style"), id + id + "width: " + i + "px;");
        element.removeAttribute("title");
        same(element.getAttribute("title"), null);
        same(element.tagName + element.localName + element.isConnected, "DIVdivtrue");
        xml.adoptNode(element);
        same(element.tagName + element.nodeName + element.isConnected + (element.ownerDocument === xml), "divdivfalsetrue");
        document.body.appendChild(element);
      });`,
      { BUN_JSC_gcMaxHeapSize: "100000", BUN_JSC_sweepSynchronously: "1" },
    ));

  test("finds elements among siblings, and names in the case of the document", () =>
    run(`const xml = document.implementation.createDocument(null, "x");
      hot(i => {
        const parent = make("a<!--b--><p></p>c<svg></svg><x-y></x-y>d");
        const names = (...nodes) => nodes.map(it => it && it.nodeName + " " + it.localName).join();
        const [p, last] = [parent.firstElementChild, parent.lastElementChild];
        same(names(p, p.nextElementSibling, last, last.previousElementSibling, parent.firstChild), "P p,svg svg,X-Y x-y,svg svg,#text undefined");
        same(names(p.previousElementSibling, last.nextElementSibling, parent.firstChild.nextElementSibling, p.firstElementChild), ",,P p,");
        same(names(p.parentElement, parent.parentElement, document.documentElement, document.documentElement.parentElement), "DIV div,,HTML html,");
        same(names(document.ownerDocument, p.ownerDocument, parent.firstChild.nextSibling), ",#document undefined,#comment undefined");
        (i & 1 ? xml.documentElement : document.body).append(parent);
        same(p.tagName + last.tagName + p.isConnected, i & 1 ? "px-ytrue" : "PX-Ytrue");
        parent.remove();
      });`));

  test("answers with the same object, however many others the node has", () =>
    run(
      `const names = ["childNodes", "children", "classList", "attributes", "style", "dataset", "cells"];
      const read = row => [row.childNodes, row.children, row.classList, row.attributes, row.style, row.dataset, row.cells];
      const types = "NodeList,HTMLCollection,DOMTokenList,NamedNodeMap,CSSStyleProperties,DOMStringMap,HTMLCollection";
      const { implementation } = document;
      hot(i => {
        const row = document.createElement("tr");
        const first = names.map((_, k) => names[(i + k) % names.length]).slice(0, i % 4).map(it => [it, row[it]]);
        for (const [name, object] of first) same(row[name], object);
        const all = read(row);
        for (const [name, object] of first) same(all[names.indexOf(name)], object);
        same(all.map(it => it.constructor.name).join(), types);
        same(all[1] === all[6], false);
        read(row).forEach((it, k) => same(it, all[k]));
        same(document.implementation, implementation);
      });`,
      { BUN_JSC_gcMaxHeapSize: "100000", BUN_JSC_sweepSynchronously: "1" },
    ));

  test("reads text again after each change", () =>
    run(`const parent = make("a");
      hot(i => {
        parent.textContent = i;
        same(parent.textContent + parent.firstChild.data + parent.firstChild.nodeValue + parent.nodeValue, "" + i + i + i + null);
        parent.firstChild.data = "b";
        same(parent.textContent + parent.firstChild.data + parent.firstChild.nodeValue, "bbb");
        parent.append(make("c"), new Comment("d"));
        same(parent.textContent + parent.lastChild.textContent + parent.lastChild.data + document.textContent, "bcddnull");
      });`));

  test("converts arguments of other types, and refuses other receivers", () =>
    run(`const element = make("<b></b>");
      element.setAttribute("1", "one");
      const { getAttribute } = element;
      hot(i => {
        let calls = 0;
        same(element.getAttribute(i < 1500 ? "1" : i & 1 ? 1 : { toString: () => (calls++, "1") }), "one");
        same(calls, +(i >= 1500 && !(i & 1)));
        let error;
        try { getAttribute.call(i < 1800 ? element : document, "1"); } catch (it) { error = it; }
        same(error instanceof TypeError, i >= 1800);
        const below = i < 1900 ? element : Object.create(element);
        try { error = below.firstChild; } catch (it) { error = it; }
        same(error instanceof TypeError, i >= 1900);
      });`));

  test("sees a member that is replaced", () =>
    run(`const element = make("<b></b>");
      hot(i => {
        if (i === 1500) Object.defineProperty(Node.prototype, "firstChild", { get: () => "other" });
        if (i === 1600) Element.prototype.getAttribute = () => "other";
        if (i === 1700) Object.defineProperty(element, "nodeType", { value: "other" });
        same(element.firstChild === "other", i >= 1500);
        same(element.getAttribute("a") === "other", i >= 1600);
        same(element.nodeType === "other", i >= 1700);
      });`));

  test.each([
    {},
    { BUN_JSC_collectContinuously: "1" },
    { BUN_JSC_gcMaxHeapSize: "100000", BUN_JSC_sweepSynchronously: "1" },
  ])("indexes lists that change %j", env =>
    run(
      `const root = document.body.appendChild(make("<form id=f></form><select></select>"));
      const parent = root.appendChild(make(""));
      const select = root.querySelector("select");
      const all = selector => Array.prototype.slice.call(root.querySelectorAll(selector));
      const lists = [
        [parent.childNodes, () => { const all = []; for (let it = parent.firstChild; it; it = it.nextSibling) all.push(it); return all; }],
        [parent.children, () => all(":scope > div > *")],
        [root.getElementsByTagName("input"), () => all("input")],
        [root.getElementsByClassName("a"), () => all(".a")],
        [document.getElementsByName("n"), () => all("[name=n]")],
        [root.firstChild.elements, () => all("input[form=f]")],
        [select.options, () => all("option")],
        [select.selectedOptions, () => all("option:checked")],
      ];
      let seed = 1;
      const random = below => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) % below;
      const any = () => parent.children[random(parent.children.length)] ?? document.createElement("input");
      const changes = [
        () => parent.append(document.createElement("input"), "text"),
        () => parent.prepend(document.createElement("input")),
        () => any().remove(),
        () => any().classList.toggle("a"),
        () => any().setAttribute("name", "mn"[random(2)]),
        () => any().setAttribute("form", "fg"[random(2)]),
        () => random(8) || (parent.innerHTML = "<input class=a name=n form=f>".repeat(random(20))),
        () => random(8) || new Document().adoptNode(parent).ownerDocument.append(root.appendChild(parent).cloneNode()),
        () => (select.length = random(6)),
        () => (select.selectedIndex = random(6)),
        () => {},
      ];
      hot(() => {
        const fixed = root.querySelectorAll("input"), copy = [...fixed];
        changes[random(changes.length)]();
        for (const [list, expected] of [...lists.map(it => [it[0], it[1]()]), [fixed, copy]]) {
          for (let pass = random(3); pass >= 0; pass--) {
            same(list.length, expected.length);
            for (let i = 0; i <= expected.length; i++) same(list[i], expected[i]), same(list.item(i), expected[i] ?? null);
          }
        }
      }, 600);`,
      env,
    ),
  );

  test("calls methods that can do anything", () =>
    run(`const parent = document.body.appendChild(make("")), log = [];
      customElements.define("x-a", class extends HTMLElement {
        static observedAttributes = ["a"];
        connectedCallback() { log.push("connected"); }
        attributeChangedCallback() { log.push("changed"); }
        disconnectedCallback() { log.push("disconnected"); }
      });
      customElements.define("x-b", class extends HTMLParagraphElement {}, { extends: "p" });
      const wrong = [
        () => parent.appendChild(1),
        () => parent.appendChild(parent),
        () => parent.removeChild(parent),
        () => parent.insertBefore(parent.cloneNode()),
        () => parent.setAttribute("", ""),
        () => parent.matches("!"),
        () => parent.querySelector({ toString() { throw new RangeError(); } }),
        () => parent.appendChild.call({}, parent),
      ];
      hot(i => {
        const child = document.createElement(i % 2 ? "x-a" : { toString: () => "X-A" });
        same(parent.appendChild(child), child);
        same(child.setAttribute("a", i), undefined);
        same(parent.insertBefore(document.createTextNode(i), child).data, child.getAttribute("a"));
        same(parent.insertBefore(document.createDocumentFragment(), null).nodeType, 11);
        same(parent.contains(child) && !parent.contains(null) && child.matches("[a]"), true);
        same(child.closest("div"), parent);
        same(parent.querySelector("[a]"), parent.querySelectorAll("[a]")[0]);
        same(parent.getElementsByTagName("x-a")[0], child);
        same(parent.getElementsByClassName("a").length, 0);
        child.removeAttribute("a");
        same(parent.replaceChild(document.createElement("p", { is: "x-b" }), child), child);
        same(parent.removeChild(parent.lastChild).constructor, customElements.get("x-b"));
        parent.firstChild.remove();
        same(parent.firstChild, null);
        same(log.splice(0).join(), "connected,changed,changed,disconnected");
        same(wrong.map(it => { try { it(); } catch (error) { return error.name; } }).join(), "TypeError,HierarchyRequestError,NotFoundError,TypeError,InvalidCharacterError,SyntaxError,RangeError,TypeError");
      });`));

  test("a list does not keep the nodes that have left it", () =>
    run(`const parent = make("<i></i>".repeat(500)), list = parent.childNodes;
      hot(i => list.length + list[i % 500].nodeType);
      const refs = Array.from(list, it => new WeakRef(it));
      parent.textContent = "";
      await Bun.sleep(0);
      Bun.gc(true);
      same(refs.filter(it => it.deref()).length < 50, true);`));

  test("walks a tree of many kinds of nodes while it is collected", () =>
    run(
      `const html = "<p>a<b>b</b><i>c</i></p><ul><li><a>d</a><li><span>e</span></ul><!--f--><svg><g/></svg>";
      const walk = node => { let text = node.nodeName; for (let it = node.firstChild; it; it = it.nextSibling) text += walk(it); return text; };
      hot(() => same(walk(make(html).cloneNode(true)), "DIVP#textB#textI#textULLIA#textLISPAN#text#commentsvgg"), 600);`,
      { BUN_JSC_collectContinuously: "1" },
    ));

  test.each([
    { BUN_JSC_collectContinuously: "1" },
    { BUN_JSC_gcMaxHeapSize: "100000", BUN_JSC_sweepSynchronously: "1" },
    {
      BUN_JSC_slowPathAllocsBetweenGCs: "20",
      BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1",
      BUN_JSC_sweepSynchronously: "1",
    },
  ])("new nodes among old ones stay, from either end %j", env =>
    run(
      `const parents = [make(""), document.body.appendChild(make(""))].map(node => ({ node, marks: [] }));
      let seed = 1;
      const random = below => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) % below;
      const child = (parent, index) => { let it = parent.firstChild; while (index--) it = it.nextSibling; return it; };
      const read = (it, next) => { const all = []; for (; it; it = it[next]) all.push(it.mark.value); return all; };
      const change = ({ node, marks }, value) => {
        const at = random(3) ? random(marks.length + 1) : random(2) * marks.length;
        if (marks.length > random(40)) return marks.splice(at % marks.length, 1), child(node, at % (marks.length + 1)).remove();
        const added = random(2) ? document.createElement("p") : document.createTextNode("a");
        node.insertBefore(Object.assign(added, { mark: { value } }), child(node, at));
        marks.splice(at, 0, value);
      };
      noInline(change);
      hot(i => {
        const parent = parents[i & 1];
        for (let k = random(4); k >= 0; k--) change(parent, i * 4 + k);
        same(read(parent.node.lastChild, "previousSibling").reverse().join(), parent.marks.join());
        same(read(parent.node.firstChild, "nextSibling").join(), parent.marks.join());
        const parsed = make("<!--a--><!--b-->c<i></i><!--d-->" + "<b></b>".repeat(i % 40) + "<!--e-->");
        let count = 0;
        for (let it = parsed.lastChild; it; it = it.previousSibling) count += it.parentNode === parsed;
        same(count, 6 + (i % 40));
      });`,
      env,
    ),
  );
});

test.each([1, 2, 3])("a target with many listeners calls those that are left, in order (seed %d)", seed => {
  using page = open("<p></p>");
  const { AbortController, Event } = page.window;
  const target = page.$("p");
  const random = (below: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) % below;
  let calls: string[] = [];
  const callbacks = Array.from({ length: 60 }, (_, index) => () => void calls.push("" + index));
  let controllers = Array.from({ length: 4 }, () => new AbortController());
  let model: { type: string; capture: boolean; index: number | string; once?: boolean; signal?: AbortSignal }[] = [];
  for (let step = 0; step < 4000; step++) {
    const [type, capture, index] = [
      ["click", "custom"][random(2)],
      random(2) === 1,
      random(step % 1000 < 100 ? 6 : 60),
    ];
    const isIt = (it: (typeof model)[0]) => it.type === type && it.capture === capture && it.index === index;
    const action = random(40);
    if (action < 22) {
      const [once, signal] = [random(6) === 0, random(3) === 0 ? controllers[random(4)].signal : undefined];
      target.addEventListener(type, callbacks[index], { capture, once, signal });
      if (!model.some(isIt)) model.push({ type, capture, index, once, signal });
    } else if (action < 34) {
      target.removeEventListener(type, callbacks[index], capture);
      model = model.filter(it => !isIt(it));
    } else if (action < 35) {
      const which = random(4);
      controllers[which].abort();
      model = model.filter(it => it.signal !== controllers[which].signal);
      controllers[which] = new AbortController();
    } else if (action < 36) {
      target.onclick = target.onclick ? null : callbacks[0];
      if (target.onclick) model.push({ type: "click", capture: false, index: "0" });
      else model = model.filter(it => it.index !== "0");
    } else {
      calls = [];
      target.dispatchEvent(new Event(type));
      const called = [true, false].flatMap(capture => model.filter(it => it.type === type && it.capture === capture));
      expect(calls.join()).toBe(called.map(it => it.index).join());
      model = model.filter(it => it.type !== type || !it.once);
    }
  }
});

test("listeners that are changed by one of many others", () => {
  using page = open("<p></p>");
  const target = page.$("p");
  const calls: number[] = [];
  const callbacks = Array.from({ length: 40 }, (_, index) => () => {
    calls.push(index);
    if (index !== 3) return;
    target.removeEventListener("a", callbacks[3]);
    target.removeEventListener("a", callbacks[20]);
    target.removeEventListener("a", callbacks[21]);
    target.addEventListener("a", callbacks[21]);
    target.addEventListener("a", callbacks[39]);
  });
  callbacks.slice(0, 30).forEach(it => target.addEventListener("a", it));
  target.dispatchEvent(new page.window.Event("a"));
  target.dispatchEvent(new page.window.Event("a"));
  const upTo = (end: number, ...unless: number[]) =>
    Array.from({ length: end }, (_, it) => it).filter(it => !unless.includes(it));
  expect(calls).toEqual([...upTo(30, 20, 21), ...upTo(30, 3, 20, 21), 21, 39]);
});

test("observers see what they have asked for, in and out of the document", () => {
  using page = open(
    "<main><section><p data-a=1 data-b=1 style=color:red>text</p></section></main><nav><i data-a=1></i></nav>",
  );
  const { document } = page;
  const [main, section, p, i] = ["main", "section", "p", "i"].map(page.$);
  const observe = (target: any, options: object) => {
    const observer = new page.window.MutationObserver(() => {});
    observer.observe(target, options);
    return observer;
  };
  const take = (observer: any) =>
    observer
      .takeRecords()
      .map((it: any) => [it.target.nodeName, it.attributeName ?? it.type, it.oldValue].join(" "))
      .join();
  const change = (value: string) => {
    for (const it of [p, i]) {
      it.setAttribute("data-a", value);
      it.setAttribute("data-b", value);
      it.setAttribute("aria-label", value);
      it.style.width = value + "px";
    }
  };

  const filtered = observe(main, { subtree: true, attributeFilter: ["data-b"], attributeOldValue: true });
  const own = observe(i, { attributes: true });
  const ofStyle = observe(section, { subtree: true, attributeFilter: ["style"] });
  change("2");
  expect([filtered, own, ofStyle].map(take)).toEqual([
    "P data-b 1",
    "I data-a ,I data-b ,I aria-label ,I style ",
    "P style ",
  ]);

  const ofOldStyle = observe(p, { attributeFilter: ["style"], attributeOldValue: true });
  change("3");
  expect([ofStyle, ofOldStyle].map(take)).toEqual(["P style ", "P style color: red; width: 2px;"]);
  [filtered, own, ofStyle, ofOldStyle].forEach(it => it.disconnect());

  const all = observe(main, {
    subtree: true,
    attributes: true,
    childList: true,
    characterData: true,
    characterDataOldValue: true,
  });
  const children = observe(main, { subtree: true, childList: true });
  const text = p.firstChild;
  section.remove();
  text.remove();
  text.data = "other";
  change("4");
  p.appendChild(document.createElement("b"));
  p.textContent = "";
  expect(take(all)).toBe(
    "MAIN childList ,P childList ,#text characterData text,P data-a ,P data-b ,P aria-label ,P style ,P childList ,P childList ",
  );
  expect(take(children)).toBe("MAIN childList ,P childList ,P childList ,P childList ");
  [all, children].forEach(it => it.disconnect());

  const detached = observe(section, { subtree: true, attributes: true, childList: true });
  p.setAttribute("data-new", "");
  p.appendChild(document.createElement("b"));
  document.createElement("b").appendChild(document.createElement("b")).setAttribute("data-new", "");
  expect(take(detached)).toBe("P data-new ,P childList ");
});

test("data, aria and role attributes of an element that is not rendered yet", () => {
  using page = open(
    `<style>[data-a="1"] { width: 1px } [data-b] { height: 2px } [role=tab] { top: 3px } [aria-label="é"] { left: 4px }</style>`,
  );
  const { document } = page;
  const original = document.createElement("button");
  original.className = "x";
  original.setAttribute("DATA-A", "0");
  const copy = original.cloneNode();
  for (const [name, value] of [
    ["data-a", "1"],
    ["data-b", "long ".repeat(30)],
    ["role", "tab"],
    ["aria-label", "é"],
    ["data-é", ""],
  ]) {
    copy.setAttribute(name, value);
  }
  expect(() => copy.setAttribute("data-a=", "")).toThrow(expect.objectContaining({ name: "InvalidCharacterError" }));
  expect(original.outerHTML).toBe(`<button class="x" data-a="0"></button>`);
  expect(copy.getAttributeNames()).toEqual(["class", "data-a", "data-b", "role", "aria-label", "data-é"]);
  const parent = document.createElement("div");
  parent.append(original, copy);
  const selectors = ['[data-a="0"]', '[data-a="1"]', "[data-b]", "[role=tab]", ".x[data-a]", "[data-c]"];
  const count = () => selectors.map(it => parent.querySelectorAll(it).length);
  expect(count()).toEqual([1, 1, 1, 1, 2, 0]);
  document.body.append(parent);
  expect(count()).toEqual([1, 1, 1, 1, 2, 0]);
  const { width, height, top, left } = page.window.getComputedStyle(Object.assign(copy, { hidden: true }));
  expect([width, height, top, left]).toEqual(["1px", "2px", "3px", "4px"]);
  copy.dataset.camelCase = copy.dataset.a + copy.dataset.a;
  expect([copy.getAttribute("data-camel-case"), "camel-case" in copy.dataset, copy.dataset.camelCase]).toEqual([
    "11",
    false,
    "11",
  ]);
});

test("a node cannot be put into what is below it, connected or not", () => {
  using page = open("<main><p></p></main>");
  const [main, p] = ["main", "p"].map(page.$);
  const inner = p.attachShadow({ mode: "open" }).appendChild(page.document.createElement("b"));
  const template = page.document.createElement("template");
  const error = expect.objectContaining({ name: "HierarchyRequestError" });
  for (const prepare of [() => {}, () => main.remove()]) {
    prepare();
    expect(() => p.appendChild(main)).toThrow(error);
    expect(() => inner.appendChild(main)).toThrow(error);
  }
  page.document.body.append(template);
  expect(() => template.content.appendChild(page.document.createElement("b")).appendChild(template)).toThrow(error);
  expect(() => template.content.firstChild.appendChild(page.document.body)).toThrow(error);
});

test.each([1, 2, 3])("directions and skipped contents follow nodes that move (seed %d)", seed => {
  using page = open("<div></div><div dir=auto></div><div style=content-visibility:hidden></div><div></div>");
  const { document } = page;
  const random = (below: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) % below;
  const make = () => {
    const made = document.createElement("section");
    made.append("1");
    return made;
  };
  page.$("div:last-child").attachShadow({ mode: "open" }).innerHTML =
    "<p dir=auto><slot name=a></slot></p><p style=content-visibility:hidden><slot name=b></slot></p><slot></slot>";
  const made = Array.from({ length: 12 }, make);
  const read = (roots: any[]) =>
    roots
      .flatMap(root => [root, ...root.querySelectorAll("*"), ...(root.shadowRoot?.children ?? [])])
      .map(it => +it.matches(":dir(rtl)") + "" + +it.checkVisibility())
      .join();
  for (let step = 0; step < 400; step++) {
    const index = random(12);
    const [it, other, root] = [made[index], made[random(12)], document.body.children[random(4)]];
    const changes = [
      () => root.append(it),
      () => root.prepend(it),
      () => it.contains(other) || other.prepend(it),
      () => it.remove(),
      () => (it.remove(), (made[index] = make()), root.append(made[index])),
      () => (it.lastChild.data = ["1", "a", "א"][random(3)]),
      () => (it.lastChild.data = ["1", "a", "א"][random(3)]),
      () => it.lastChild.replaceWith(["1", "a", "א"][random(3)]),
      () => (it.dir = ["auto", "ltr", "rtl", ""][random(4)]),
      () => (it.slot = ["a", "b", ""][random(3)]),
      () => (it.style.contentVisibility = ["hidden", "visible"][random(2)]),
      () => root.replaceChildren(),
    ];
    changes[random(changes.length)]();
    if (step % 4) continue;
    using fresh = open();
    fresh.document.body.setHTMLUnsafe(document.body.getHTML({ shadowRoots: [document.body.lastChild.shadowRoot] }));
    expect(read([...document.body.children])).toBe(read([...fresh.document.body.children]));
  }
});

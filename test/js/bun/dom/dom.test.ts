import { DOMParser, Document, Element, HTMLElement, Node, Window } from "bun:dom";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";
import selectors from "./selector-validity.json";

const parse = (html: string) => new DOMParser().parseFromString("<!doctype html>" + html, "text/html");

describe("DOMParser", () => {
  test("builds the tree the HTML standard asks for", () => {
    const document = parse(`<title>t</title><p id=a class="x y">one<p>two<table><tr><td>cell`);
    expect(document).toBeInstanceOf(Document);
    expect(document.documentElement.outerHTML).toBe(
      `<html><head><title>t</title></head><body><p id="a" class="x y">one</p><p>two</p><table><tbody><tr><td>cell</td></tr></tbody></table></body></html>`,
    );
    expect(document.title).toBe("t");
    expect(document.body.textContent).toBe("onetwocell");
  });

  test("an element is the same object every time it is reached", () => {
    const document = parse(`<div id=a><span></span></div>`);
    const div = document.getElementById("a");
    expect(div).toBeInstanceOf(HTMLElement);
    expect(div).toBeInstanceOf(Element);
    expect(div).toBeInstanceOf(Node);
    expect(document.querySelector("#a")).toBe(div);
    expect(div.firstChild.parentNode).toBe(div);
    expect(div.classList).toBe(div.classList);
  });

  test("without a doctype the document is in quirks mode", () => {
    const document = new DOMParser().parseFromString(`<p class=a>one<table>`, "text/html");
    expect(document.compatMode).toBe("BackCompat");
    expect(document.body.innerHTML).toBe(`<p class="a">one<table></table></p>`);
    expect(document.querySelector("p.A")).toBe(document.body.firstChild);
  });

  // Simple markup takes a faster parser. It has to give the same answers.
  test.each(["<div class=a></div>", "<div class=a></div><table>", "", "x"])("%j has no doctype either", html => {
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.compatMode).toBe("BackCompat");
    expect(document.querySelectorAll("div.A").length).toBe(document.querySelectorAll("div.a").length);
    expect(new DOMParser().parseFromString("<!doctype html>" + html, "text/html").compatMode).toBe("CSS1Compat");
  });

  // As in WebKit, a text node from the parser has at most 65,536 code units.
  test.each([
    ["8-bit text", "a".repeat(70000), [65536, 4464]],
    ["16-bit text", "\u0100" + "a".repeat(70000), [65536, 4465]],
    ["a combining mark would start the next node", "a".repeat(65535) + "e\u0301" + "b".repeat(10), [65535, 12]],
    ["a combining mark ends the node", "a".repeat(65534) + "e\u0301" + "b".repeat(10), [65536, 10]],
    ["an emoji made of several", "a".repeat(65533) + "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}b", [65533, 9]],
  ])("long text is split between characters: %s", (_, text, lengths) => {
    const { body } = new DOMParser().parseFromString("<body>" + text, "text/html");
    expect(Array.from(body.childNodes, node => (node as Text).data.length)).toEqual(lengths);
    expect(body.textContent).toBe(text);
  });

  // xml.test.ts has the rest.
  test("the type decides between HTML and XML", () => {
    const parser = new DOMParser();
    expect(parser.parseFromString("<P>x<br>", "text/html").body.innerHTML).toBe("<p>x<br></p>");
    expect(parser.parseFromString("<P>x<br/></P>", "text/xml").documentElement.outerHTML).toBe("<P>x<br/></P>");
  });
});

describe("selectors", () => {
  const document = parse(`
    <main><article class="card first" data-id="1"><a href="/post/1">one</a></article>
    <article class="card" data-id="2"><a href="/post/2">two</a><a href="https://example.com/">out</a></article>
    <section><input type=checkbox checked><input disabled><p lang="en-US">text</p></section></main>`);
  const matches = (selector: string) =>
    Array.from(document.querySelectorAll(selector), e => e.textContent || e.localName);

  test.each([
    ["article.card a[href^='/post/']", ["one", "two"]],
    ["article:first-child a", ["one"]],
    ["article:nth-child(2) > a:last-child", ["out"]],
    ["article:not(.first) a", ["two", "out"]],
    ["article:has(a[href^=https])", ["twoout"]],
    [":is(article, section) > :checked", ["input"]],
    ["input:disabled", ["input"]],
    ["p:lang(en)", ["text"]],
    ["[data-id='2' i] a:first-of-type", ["two"]],
    ["ARTICLE.first", ["one"]],
    ["article.FIRST", []],
  ])("%s", (selector, expected) => {
    expect(matches(selector)).toEqual(expected);
  });

  test("matches() and closest()", () => {
    const link = document.querySelector("a");
    expect(link.matches("article > a")).toBe(true);
    expect(link.matches("section a")).toBe(false);
    expect(link.closest("[data-id]").getAttribute("data-id")).toBe("1");
    expect(link.closest("section")).toBeNull();
  });

  // Chrome, Firefox and Safari agree on every one of these.
  test("accepts what the browsers accept", () => {
    const rejected = selectors.valid.filter(selector => {
      try {
        document.querySelector(selector);
      } catch {
        return true;
      }
    });
    expect(rejected).toEqual([]);
  });

  test("throws a SyntaxError for what the browsers reject", () => {
    const accepted = selectors.invalid.filter(selector => {
      try {
        document.querySelector(selector);
        return true;
      } catch (error) {
        return error.name !== "SyntaxError";
      }
    });
    expect(accepted).toEqual([]);
  });

  test(":heading counts headingoffset in", () => {
    const document = parse(`<h1>a</h1><section headingoffset=1><h1>b</h1><h2>c</h2></section><p>d</p>`);
    const matches = (selector: string) => Array.from(document.querySelectorAll(selector), e => e.textContent);
    expect(matches(":heading")).toEqual(["a", "b", "c"]);
    expect(matches(":heading(1)")).toEqual(["a"]);
    expect(matches(":heading( 3 , 2 )")).toEqual(["b", "c"]);
    expect(matches(":heading(-1, 0)")).toEqual([]);
    expect(matches("section:has(:heading(3))").length).toBe(1);
    for (const selector of [":heading()", ":heading(1.0)", ":heading(2n)", ":heading(1 2)", ":heading(1,)"]) {
      expect(() => document.querySelector(selector)).toThrow(expect.objectContaining({ name: "SyntaxError" }));
    }
  });

  test("::part() can be followed by :is(), :where() and :not() of states", () => {
    for (const selector of ["::part(a):is(:focus)", "::part(a):where(:hover, b)", "::part(a):not(:hover)"]) {
      expect(document.querySelector(selector)).toBeNull();
    }
    for (const selector of ["::part(a):not(b)", "::part(a):has(b)", "::part(a):not(:first-child)"]) {
      expect(() => document.querySelector(selector)).toThrow(expect.objectContaining({ name: "SyntaxError" }));
    }
  });

  test("CSS.supports('selector()') takes what querySelector takes, and forgives nothing", () => {
    const { CSS } = new Window();
    const supports = (selector: string) => CSS.supports(`selector(${selector})`);
    const supported = [":is(a) b", "[a]:hover", ".a:has(.b) .c", ":not(a):not(:hover)", "&", "::part(a):is(:focus)"];
    expect(supported.filter(selector => !supports(selector))).toEqual([]);
    const unsupported = [":bogus", ":closed", "a, b", ":is(:bogus, a)", ":is()", ":has(:is(:has(a)))", "::-webkit-x"];
    expect(unsupported.filter(supports)).toEqual([]);
  });

  test("selectorText has no space in front of a leading combinator", () => {
    const { document } = new Window();
    const style = document.head.appendChild(document.createElement("style"));
    style.sheet.insertRule(".a:has(> .b, + .c, :scope > .d) {}");
    expect(style.sheet.cssRules[0].selectorText).toBe(".a:has(> .b, + .c, :scope > .d)");
  });
});

describe("mutation", () => {
  test("innerHTML, attributes and tree edits", () => {
    const document = parse(`<ul id=list></ul>`);
    const list = document.getElementById("list");
    list.innerHTML = `<li>a<li>b`;
    const item = document.createElement("li");
    item.textContent = "<c>";
    item.setAttribute("data-x", `"1"`);
    list.insertBefore(item, list.lastChild);
    list.firstChild.remove();
    expect(list.outerHTML).toBe(`<ul id="list"><li data-x="&quot;1&quot;">&lt;c&gt;</li><li>b</li></ul>`);
    expect(list.children.length).toBe(2);
  });

  test("events bubble and can be cancelled", () => {
    const document = parse(`<div><button>b</button></div>`);
    const seen: string[] = [];
    document.querySelector("div").addEventListener("click", event => seen.push(`div ${event.target.localName}`));
    document.querySelector("button").addEventListener("click", event => {
      seen.push("button");
      event.preventDefault();
    });
    expect(
      document.querySelector("button").dispatchEvent(new Event("click", { bubbles: true, cancelable: true })),
    ).toBe(false);
    expect(seen).toEqual(["button", "div button"]);
  });

  test("a task that queues another task does not keep a timer waiting", async () => {
    const window = new Window({ url: "https://example.com/" });
    let turns = 0;
    let hasFired = false;
    const fired = new Promise<void>(resolve =>
      setTimeout(() => {
        hasFired = true;
        resolve();
      }, 0),
    );
    const budget = 100_000;
    window.addEventListener("hashchange", () => {
      if (!hasFired && ++turns < budget) window.location.hash = String(turns);
    });
    window.location.hash = "start";
    await fired;
    // How many turns fit in before the timer depends on the machine. Without a yield, all of them do.
    expect(turns).toBeLessThan(budget);
  });

  test("neither does one that queues it from a microtask", async () => {
    const window = new Window({ url: "https://example.com/" });
    let turns = 0;
    let hasFired = false;
    const fired = new Promise<void>(resolve =>
      setTimeout(() => {
        hasFired = true;
        resolve();
      }, 0),
    );
    const budget = 100_000;
    window.addEventListener("hashchange", async () => {
      await null;
      if (!hasFired && ++turns < budget) window.location.hash = String(turns);
    });
    window.location.hash = "start";
    await fired;
    expect(turns).toBeLessThan(budget);
  });

  test("a task runs before a timer that is set after it, and tasks run in the order they were queued", async () => {
    const window = new Window({ url: "https://example.com/" });
    const order: string[] = [];
    window.addEventListener("hashchange", event => {
      const hash = new URL(event.newURL).hash;
      order.push(hash);
      if (hash === "#a") window.location.hash = "c";
    });
    window.location.hash = "a";
    window.location.hash = "b";
    const timer = new Promise<void>(resolve =>
      setTimeout(() => {
        order.push("timer");
        resolve();
      }, 0),
    );
    // The timer is due by the time the script ends.
    for (const end = performance.now() + 3; performance.now() < end;);
    await timer;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(order.slice(0, 2)).toEqual(["#a", "#b"]);
    expect(order.toSorted()).toEqual(["#a", "#b", "#c", "timer"]);
  });

  test("tasks that wait for the next turn of the loop stay in order", async () => {
    const window = new Window({ url: "https://example.com/" });
    const order: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    window.addEventListener("hashchange", event => {
      const hash = new URL(event.newURL).hash;
      order.push(hash);
      const next = Number(hash.slice(2)) + 1;
      if (next < 1500) window.location.hash = hash[1] + next;
      else if (hash[1] === "b") resolve();
    });
    window.location.hash = "a0";
    window.location.hash = "b0";
    await promise;
    expect(order).toEqual(Array.from({ length: 3000 }, (_, i) => "#" + "ab"[i % 2] + (i >> 1)));
  });

  test("microtasks run between the listeners of an event that a task fires", async () => {
    const window = new Window({ url: "https://example.com/" });
    const order: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    window.addEventListener("hashchange", () => {
      order.push("listener 1");
      queueMicrotask(() => order.push("microtask of 1"));
    });
    window.addEventListener("hashchange", () => {
      order.push("listener 2");
      resolve();
    });
    window.location.hash = "a";
    await promise;
    expect(order).toEqual(["listener 1", "microtask of 1", "listener 2"]);
  });

  test("so a script that waited for one event of a task is in time for the next one", async () => {
    const window = new Window({ url: "https://example.com/" });
    window.location.hash = "a";
    await new Promise(resolve => window.addEventListener("popstate", resolve, { once: true }));
    await new Promise(resolve => window.addEventListener("hashchange", resolve, { once: true }));
  });

  test("microtasks wait for the script that fires an event", async () => {
    const window = new Window();
    const order: string[] = [];
    window.addEventListener("x", () => {
      order.push("listener 1");
      queueMicrotask(() => order.push("microtask of 1"));
    });
    window.addEventListener("x", () => void order.push("listener 2"));
    window.dispatchEvent(new Event("x"));
    expect(order).toEqual(["listener 1", "listener 2"]);
    await null;
    expect(order).toEqual(["listener 1", "listener 2", "microtask of 1"]);
  });

  test("MutationObserver delivers in a microtask", async () => {
    const window = new Window();
    const records: string[] = [];
    const { MutationObserver } = await import("bun:dom");
    new MutationObserver(list => records.push(...list.map(record => record.type))).observe(window.document.body, {
      childList: true,
      attributes: true,
    });
    window.document.body.append("x");
    window.document.body.setAttribute("a", "b");
    expect(records).toEqual([]);
    await Promise.resolve();
    expect(records).toEqual(["childList", "attributes"]);
  });
});

describe("Window", () => {
  test("has an empty document of its own", () => {
    const a = new Window();
    const b = new Window();
    expect(a.document).not.toBe(b.document);
    expect(a.document.defaultView).toBe(a);
    expect(a.window).toBe(a);
    expect(a.document.documentElement.outerHTML).toBe("<html><head></head><body></body></html>");
    expect(a.document.doctype.name).toBe("html");
  });
});

test("works in a Worker at the same time as on the main thread", async () => {
  const source = `
    import { DOMParser } from "bun:dom";
    let total = 0;
    for (let i = 0; i < 200; i++) total += new DOMParser().parseFromString("<div class=a><p>x</p></div>".repeat(50), "text/html").querySelectorAll("div.a > p").length;
    postMessage(total);
  `;
  const url = URL.createObjectURL(new Blob([source], { type: "application/typescript" }));
  const workers = Array.from({ length: 4 }, () => new Worker(url));
  const results = workers.map(worker => new Promise(resolve => (worker.onmessage = event => resolve(event.data))));
  let total = 0;
  for (let i = 0; i < 200; i++)
    total += parse("<div class=a><p>x</p></div>".repeat(50)).querySelectorAll("div.a > p").length;
  expect(total).toBe(10_000);
  expect(await Promise.all(results)).toEqual([10_000, 10_000, 10_000, 10_000]);
  for (const worker of workers) worker.terminate();
});

describe("the interfaces of a window", () => {
  test("are own properties that are made when they are first read", () => {
    const window = new Window();
    const names = Object.getOwnPropertyNames(window);
    expect(names).toContain("Node");
    expect(names).toContain("HTMLElement");
    expect(names).toContain("MutationObserver");
    expect(Object.keys(window)).not.toContain("Node");
    expect(window.Node).toBe(Node);
    expect(window.Event).toBe(Event);
    expect(window.AbortSignal).toBe(AbortSignal);
    for (const name of ["DataTransfer", "TextEvent", "Touch", "TouchList", "MutationEvent"])
      expect(name in window).toBe(false);
  });

  test("the ones that make nodes belong to their window", () => {
    const a = new Window();
    const b = new Window();
    expect(a.Text).toBe(a.Text);
    expect(a.Text).not.toBe(b.Text);
    expect(new a.Text("x").ownerDocument).toBe(a.document);
    expect(new b.Comment("x").ownerDocument).toBe(b.document);
    expect(new a.DocumentFragment().ownerDocument).toBe(a.document);
    expect(new a.Text("x")).toBeInstanceOf(b.Text);
    expect(new a.Image().ownerDocument).toBe(a.document);
  });

  test("methods keep working when they are read off their window", () => {
    const a = new Window();
    const b = new Window();
    const { getComputedStyle, addEventListener, dispatchEvent } = a;
    expect(getComputedStyle(a.document.body).display).toBe("block");
    expect(getComputedStyle.name).toBe("getComputedStyle");
    expect(getComputedStyle.length).toBe(1);
    expect(a.getComputedStyle).toBe(getComputedStyle);
    const seen: string[] = [];
    addEventListener("x", () => seen.push("a"));
    b.addEventListener("x", () => seen.push("b"));
    dispatchEvent(new Event("x"));
    expect(seen).toEqual(["a"]);
  });

  test("can be replaced and deleted", () => {
    const window = new Window();
    window.MutationObserver = 1;
    expect(window.MutationObserver).toBe(1);
    expect(delete window.Node).toBe(true);
    expect("Node" in window).toBe(false);
    expect(new Window().Node).toBe(Node);
  });

  test("custom elements", () => {
    const window = new Window();
    const log: string[] = [];
    class Hello extends window.HTMLElement {
      static observedAttributes = ["name"];
      connectedCallback() {
        log.push("connected");
      }
      attributeChangedCallback(name: string, before: string | null, after: string | null) {
        log.push(`${name} ${before} ${after}`);
      }
    }
    window.customElements.define("x-hello", Hello);
    window.document.body.innerHTML = `<x-hello name="a"></x-hello>`;
    const element = window.document.body.firstChild;
    expect(element).toBeInstanceOf(Hello);
    element.setAttribute("name", "b");
    expect(log).toEqual(["name null a", "connected", "name a b"]);
    expect(new Hello().localName).toBe("x-hello");
  });
});

describe("event handler attributes", () => {
  const prototypes = (window: any) =>
    [
      ["HTMLElement", window.HTMLElement.prototype, window.document.createElement("div")],
      ["SVGElement", window.SVGElement.prototype, window.document.createElementNS("http://www.w3.org/2000/svg", "g")],
      ["Document", window.Document.prototype, window.document],
    ] as const;

  test("are accessors on the prototype", () => {
    for (const [name, prototype, object] of prototypes(new Window())) {
      expect("onclick" in object).toBe(true);
      expect(Object.hasOwn(object, "onclick")).toBe(false);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "onclick")!;
      expect({ name, ...descriptor }).toEqual({
        name,
        get: expect.any(Function),
        set: expect.any(Function),
        enumerable: true,
        configurable: true,
      });
      expect(descriptor.get!.name).toBe("get onclick");
      expect(descriptor.set!.name).toBe("set onclick");
      expect(Object.getOwnPropertyDescriptor(prototype, "onkeydown")!.get).not.toBe(descriptor.get);
    }
  });

  test("hold a function or an object, and null for anything else", () => {
    for (const [, , object] of prototypes(new Window())) {
      expect(object.onclick).toBe(null);
      const listener = () => {};
      object.onclick = listener;
      expect(object.onclick).toBe(listener);
      expect(object.onkeydown).toBe(null);
      const handler = { handleEvent() {} };
      object.onclick = handler;
      expect(object.onclick).toBe(handler);
      for (const value of [1, "x", true, undefined, Symbol(), null]) {
        object.onclick = listener;
        object.onclick = value;
        expect(object.onclick).toBe(null);
      }
    }
  });

  test("each one listens to its own event", () => {
    const { document, Event } = new Window() as any;
    const div = document.body.appendChild(document.createElement("div"));
    const seen: string[] = [];
    const names = Object.keys(
      Object.getOwnPropertyDescriptors(Object.getPrototypeOf(Object.getPrototypeOf(div))),
    ).filter(name => name.startsWith("on"));
    expect(names.length).toBeGreaterThan(90);
    for (const name of names) div[name] = (event: Event) => seen.push("on" + event.type.toLowerCase());
    for (const name of names) {
      // The four legacy events with capitals in their type.
      const type =
        {
          onwebkitanimationend: "webkitAnimationEnd",
          onwebkitanimationiteration: "webkitAnimationIteration",
          onwebkitanimationstart: "webkitAnimationStart",
          onwebkittransitionend: "webkitTransitionEnd",
        }[name] ?? name.slice(2);
      div.dispatchEvent(new Event(type));
    }
    expect(seen).toEqual(names);
  });

  test("the listener is called with the element as this, and replaced in place", () => {
    const { document, Event } = new Window() as any;
    const div = document.createElement("div");
    const calls: unknown[] = [];
    div.onclick = function (this: unknown) {
      calls.push(["first", this === div]);
    };
    div.addEventListener("click", () => calls.push("listener"));
    div.onclick = function (this: unknown) {
      calls.push(["second", this === div]);
    };
    div.dispatchEvent(new Event("click"));
    expect(calls).toEqual([["second", true], "listener"]);
    div.onclick = null;
    div.dispatchEvent(new Event("click"));
    expect(calls).toEqual([["second", true], "listener", "listener"]);
  });

  test("the accessors throw a TypeError for another kind of object", () => {
    const window = new Window() as any;
    for (const [, prototype, object] of prototypes(window)) {
      const { get, set } = Object.getOwnPropertyDescriptor(prototype, "onclick")!;
      expect(get!.call(object)).toBe(null);
      for (const receiver of [
        {},
        null,
        undefined,
        1,
        new EventTarget(),
        window.document.createTextNode(""),
        prototype,
      ]) {
        expect(() => get!.call(receiver)).toThrow(TypeError);
        expect(() => set!.call(receiver, () => {})).toThrow(TypeError);
      }
      expect(() => prototype.onclick).toThrow(TypeError);
      expect(() => Object.create(object).onclick).toThrow(TypeError);
    }
  });

  test("onmouseenter and onmouseleave ignore another kind of object", () => {
    const { HTMLElement } = new Window() as any;
    const { get, set } = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "onmouseenter")!;
    expect(get!.call({})).toBe(undefined);
    expect(set!.call({}, () => {})).toBe(undefined);
  });

  test("body forwards the window's handlers to the window", () => {
    const window = new Window() as any;
    const { body } = window.document;
    const calls: string[] = [];
    body.onload = () => calls.push("load");
    body.onclick = () => calls.push("click");
    body.onerror = () => calls.push("error");
    expect(Object.hasOwn(window.HTMLBodyElement.prototype, "onload")).toBe(true);
    expect(Object.hasOwn(window.HTMLBodyElement.prototype, "onclick")).toBe(false);
    body.dispatchEvent(new window.Event("load"));
    body.dispatchEvent(new window.Event("error"));
    expect(calls).toEqual([]);
    window.dispatchEvent(new window.Event("load"));
    window.dispatchEvent(new window.Event("error"));
    window.dispatchEvent(new window.Event("click"));
    expect(calls).toEqual(["load", "error"]);
    body.dispatchEvent(new window.Event("click"));
    expect(calls).toEqual(["load", "error", "click"]);
  });

  test("a hot loop reads and writes the right one", () => {
    const { document } = new Window() as any;
    const div = document.createElement("div");
    const a = () => {};
    const b = () => {};
    for (let i = 0; i < 20000; i++) {
      div.onclick = i & 1 ? a : b;
      div.onkeydown = i & 1 ? b : a;
      if (div.onclick !== (i & 1 ? a : b) || div.onkeydown !== (i & 1 ? b : a)) throw new Error("mixed up at " + i);
    }
    expect(div.onclick).toBe(a);
    expect(div.onkeydown).toBe(b);
  });
});

// Testing Library's fireEvent.submit(button) counts on this. The browsers stop these two events at the form.
test.each(["submit", "reset"])("a %s event that is dispatched at a control bubbles through its form", type => {
  const { document, Event } = new Window() as any;
  document.body.innerHTML = `<form><input></form>`;
  const seen: string[] = [];
  const form = document.querySelector("form");
  form.addEventListener(type, (event: any) => seen.push("form, from " + event.target.nodeName));
  document.addEventListener(type, () => seen.push("document"));
  document.querySelector("input").dispatchEvent(new Event(type, { bubbles: true }));
  expect(seen).toEqual(["form, from INPUT", "document"]);
});

test("an SVG link takes focus", () => {
  const { document } = new Window() as any;
  document.body.innerHTML = `<svg><a id="link" href="/x"></a><a id="old" xlink:href="/x"></a><a id="plain"></a><g id="group"></g></svg>`;
  const focused = ["link", "old", "plain", "group"].map(id => {
    document.getElementById(id).focus();
    return document.activeElement.id;
  });
  expect(focused).toEqual(["link", "old", "old", "old"]);
  expect(document.getElementById("link").tabIndex).toBe(0);
  expect(document.getElementById("group").tabIndex).toBe(-1);
});

test("XMLSerializer", () => {
  const window = new Window() as any;
  const { document } = window;
  document.body.innerHTML = `<p class="a">one<br>two &amp; three</p><input disabled>`;
  const serializer = new window.XMLSerializer();
  expect(serializer.serializeToString(document.body)).toBe(
    `<body xmlns="http://www.w3.org/1999/xhtml"><p class="a">one<br />two &amp; three</p><input disabled="" /></body>`,
  );
  expect(serializer.serializeToString(document.createTextNode("<&>"))).toBe("&lt;&amp;&gt;");
  expect(serializer.serializeToString(document.createComment(" c "))).toBe("<!-- c -->");
  expect(() => serializer.serializeToString({})).toThrow(TypeError);
});

test("only HTMLElement can be called with new, and only for a custom element", () => {
  const window = new Window() as any;
  for (const name of ["HTMLDivElement", "HTMLOutputElement", "HTMLInputElement", "HTMLElement"])
    expect(() => new window[name]()).toThrow(TypeError);
  expect(window.HTMLOutputElement.prototype.constructor).toBe(window.HTMLOutputElement);
});

describe("attributes that reflect a content attribute", () => {
  test("strings", () => {
    const { document } = new Window() as any;
    const a = document.createElement("a");
    expect([a.id, a.className, a.title, a.lang, a.rel, a.target]).toEqual(["", "", "", "", "", ""]);
    a.id = "i";
    a.className = "c d";
    a.title = "t";
    a.rel = 1;
    a.target = null;
    a.lang = undefined;
    expect(a.outerHTML).toBe(`<a id="i" class="c d" title="t" rel="1" target="null" lang="undefined"></a>`);
    expect([a.id, a.className, a.title, a.lang, a.rel, a.target]).toEqual(["i", "c d", "t", "undefined", "1", "null"]);
    a.setAttribute("title", "u");
    expect(a.title).toBe("u");
    a.removeAttribute("title");
    expect(a.title).toBe("");
    expect(() => (a.title = Symbol())).toThrow(TypeError);
    expect(() => {
      a.title = {
        toString() {
          throw new RangeError("mine");
        },
      };
    }).toThrow(RangeError);
    expect(a.hasAttribute("title")).toBe(false);
  });

  test("null is the empty string where the standard says so", () => {
    const { document } = new Window() as any;
    document.body.bgColor = null;
    expect(document.body.getAttribute("bgcolor")).toBe("");
    expect(document.body.bgColor).toBe("");
  });

  test("nullable strings", () => {
    const { document } = new Window() as any;
    const div = document.createElement("div");
    expect([div.ariaLabel, div.role]).toEqual([null, null]);
    div.ariaLabel = "l";
    div.role = "button";
    expect(div.outerHTML).toBe(`<div aria-label="l" role="button"></div>`);
    expect([div.ariaLabel, div.role]).toEqual(["l", "button"]);
    div.ariaLabel = null;
    div.role = undefined;
    expect(div.outerHTML).toBe(`<div></div>`);
  });

  test("booleans and numbers", () => {
    const { document } = new Window() as any;
    const input = document.createElement("input");
    expect([input.disabled, input.required, input.readOnly]).toEqual([false, false, false]);
    input.disabled = "yes";
    input.required = 0;
    input.readOnly = true;
    expect(input.outerHTML).toBe(`<input disabled="" readonly="">`);
    expect([input.disabled, input.required, input.readOnly]).toEqual([true, false, true]);
    input.disabled = false;
    expect(input.hasAttribute("disabled")).toBe(false);
    const img = document.createElement("img");
    img.hspace = 7;
    img.vspace = -1;
    expect(img.outerHTML).toBe(`<img hspace="7" vspace="0">`);
    expect([img.hspace, img.vspace]).toEqual([7, 0]);
  });

  test("URLs are resolved when they are read", () => {
    const { document } = new Window({ url: "https://example.com/a/b" } as any) as any;
    const a = document.createElement("a");
    a.href = "c?d";
    expect(a.getAttribute("href")).toBe("c?d");
    const img = document.createElement("img");
    expect(img.src).toBe("");
    img.src = "\ud800";
    expect(img.getAttribute("src")).toBe("\ufffd");
  });

  test("the accessors throw a TypeError for another kind of object", () => {
    const window = new Window() as any;
    const anchor = window.document.createElement("a");
    const div = window.document.createElement("div");
    for (const [prototype, name, right, wrong] of [
      [window.HTMLElement.prototype, "title", div, window.document.createTextNode("")],
      [window.Element.prototype, "id", div, window.document],
      [window.HTMLAnchorElement.prototype, "rel", anchor, div],
      [window.HTMLInputElement.prototype, "disabled", window.document.createElement("input"), anchor],
    ]) {
      const { get, set } = Object.getOwnPropertyDescriptor(prototype, name)!;
      expect(get!.name).toBe("get " + name);
      expect(() => get!.call(right)).not.toThrow();
      expect(() => set!.call(right, "x")).not.toThrow();
      for (const receiver of [wrong, {}, null, undefined, 1, prototype]) {
        expect(() => get!.call(receiver)).toThrow(TypeError);
        expect(() => set!.call(receiver, "x")).toThrow(TypeError);
      }
    }
    expect(() =>
      Object.getOwnPropertyDescriptor(window.HTMLAnchorElement.prototype, "rel")!.set!.call(div, "x"),
    ).toThrow("The HTMLAnchorElement.rel setter can only be used on instances of HTMLAnchorElement");
  });

  test("a custom element hears of the change before the assignment returns", () => {
    const window = new Window() as any;
    const log: string[] = [];
    class Watcher extends window.HTMLElement {
      static observedAttributes = ["title", "id", "aria-label", "hidden"];
      attributeChangedCallback(name: string, before: string | null, after: string | null) {
        log.push(`${name} ${before} ${after}`);
      }
    }
    window.customElements.define("x-watcher", Watcher);
    const element = new Watcher() as any;
    element.title = "a";
    log.push("after title");
    element.id = "b";
    log.push("after id");
    element.ariaLabel = "c";
    log.push("after ariaLabel");
    element.ariaLabel = null;
    expect(log).toEqual([
      "title null a",
      "after title",
      "id null b",
      "after id",
      "aria-label null c",
      "after ariaLabel",
      "aria-label c null",
    ]);
  });

  test("ElementInternals keeps its own values", () => {
    const window = new Window() as any;
    class Host extends window.HTMLElement {
      internals = (this as any).attachInternals();
    }
    window.customElements.define("x-host", Host);
    const host = new Host() as any;
    expect(host.internals.ariaLabel).toBe(null);
    host.internals.ariaLabel = "l";
    expect(host.internals.ariaLabel).toBe("l");
    expect(host.hasAttribute("aria-label")).toBe(false);
    host.internals.ariaLabel = null;
    expect(host.internals.ariaLabel).toBe(null);
    const { set } = Object.getOwnPropertyDescriptor(window.ElementInternals.prototype, "ariaLabel")!;
    expect(() => set!.call(host, "x")).toThrow(TypeError);
  });

  test("a hot loop reads and writes the right one", () => {
    const { document } = new Window() as any;
    const a = document.createElement("a");
    for (let i = 0; i < 20000; i++) {
      a.title = "t" + (i & 3);
      a.rel = "r" + (i & 3);
      a.id = "i" + (i & 3);
      if (a.title !== "t" + (i & 3) || a.rel !== "r" + (i & 3) || a.id !== "i" + (i & 3))
        throw new Error("mixed up at " + i);
    }
    expect(a.outerHTML).toBe(`<a title="t3" rel="r3" id="i3"></a>`);
  });
});

describe("the constructor and the prototype of an interface", () => {
  const chain = [
    ["HTMLDivElement", "HTMLElement"],
    ["HTMLElement", "Element"],
    ["Element", "Node"],
    ["Node", "EventTarget"],
    ["Text", "CharacterData"],
    ["MouseEvent", "UIEvent"],
    ["UIEvent", "Event"],
    ["HTMLOptionsCollection", "HTMLCollection"],
    ["DOMRect", "DOMRectReadOnly"],
  ];

  test.each(chain)("%s extends %s", (name, base) => {
    const window = new Window() as any;
    const constructor = window[name];
    const prototype = constructor.prototype;
    expect(Object.getOwnPropertyDescriptors(constructor)).toMatchObject({
      name: { value: name, writable: false, enumerable: false, configurable: true },
      length: { value: expect.any(Number), writable: false, enumerable: false, configurable: true },
      prototype: { value: prototype, writable: false, enumerable: false, configurable: false },
    });
    expect(Object.keys(Object.getOwnPropertyDescriptors(constructor)).slice(0, 3)).toEqual([
      "length",
      "name",
      "prototype",
    ]);
    expect(Object.getPrototypeOf(prototype)).toBe(window[base].prototype);
    expect(Object.getPrototypeOf(constructor).prototype).toBe(window[base].prototype);
    expect(Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)).toEqual({
      value: name,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    expect(Object.prototype.toString.call(prototype)).toBe(`[object ${name}]`);
    expect(Reflect.ownKeys(prototype)[0]).toBe("constructor");
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor")!;
    expect(descriptor).toEqual({ value: expect.any(Function), writable: true, enumerable: false, configurable: true });
    expect(descriptor.value.prototype).toBe(prototype);
    expect(descriptor.value.name).toBe(name);
    expect(Object.create(prototype).constructor).toBe(descriptor.value);
  });

  test("the constants of Node are on both", () => {
    const { Node } = new Window() as any;
    for (const object of [Node, Node.prototype])
      expect(Object.getOwnPropertyDescriptor(object, "ELEMENT_NODE")).toEqual({
        value: 1,
        writable: false,
        enumerable: true,
        configurable: false,
      });
  });

  test("constructor can be replaced", () => {
    const { HTMLDivElement, document } = new Window() as any;
    const original = HTMLDivElement.prototype.constructor;
    try {
      HTMLDivElement.prototype.constructor = 1;
      expect(document.createElement("div").constructor).toBe(1);
    } finally {
      HTMLDivElement.prototype.constructor = original;
    }
    expect(document.createElement("div").constructor).toBe(original);
  });

  test("a wrapper says in a heap snapshot what it wraps", () => {
    const { document } = new Window() as any;
    const kept = [
      document.createElement("div"),
      document.createTextNode("x"),
      new (new Window() as any).MouseEvent("click"),
    ];
    const snapshot = require("bun:jsc").generateHeapSnapshotForDebugging();
    const names = new Set(snapshot.nodeClassNames);
    for (const name of ["HTMLDivElement", "Text", "MouseEvent", "HTMLDocument"]) expect(names.has(name)).toBe(true);
    expect(snapshot.labels.some((label: string) => label.startsWith("url "))).toBe(true);
    expect(kept.length).toBe(3);
  });
});

test("what a window's DOMParser parses has the URL of the window's document", () => {
  const window = new Window({ url: "https://example.com/a/b" } as any) as any;
  const parsed = new window.DOMParser().parseFromString(`<a href="c">`, "text/html");
  expect(parsed.URL).toBe("https://example.com/a/b");
  expect(parsed.querySelector("a").href).toBe("https://example.com/a/c");
  expect(parsed.defaultView).toBe(null);
  expect(window.DOMParser).toBe(window.DOMParser);
  expect(window.DOMParser.prototype).toBe(DOMParser.prototype);
  expect(new DOMParser().parseFromString("", "text/html").URL).toBe("about:blank");
});

test("a known name is known when it first arrives as a 16-bit string", async () => {
  // In a process of its own: here the names are 8-bit atoms already.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { Window } from "bun:dom";
      const wide = s => ("\\u0100" + s).slice(1);
      const { document } = new Window();
      const img = document.createElement(wide("img"));
      img.setAttribute(wide("longdesc"), "https://example.com/d");
      const div = document.createElement("div");
      div.setAttribute(wide("aria-braillelabel"), "b");
      const longest = "onwebkitcurrentplaybacktargetiswirelesschanged";
      div.setAttribute(wide(longest), "1");
      div.setAttribute(wide("x".repeat(47)), "long");
      div.setAttribute("titl\\u0113", "wide");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", wide("foreignObject"));
      svg.setAttributeNS(null, wide("viewBox"), "0 0 1 1");
      const math = document.createElementNS("http://www.w3.org/1998/Math/MathML", wide("mfrac"));
      const parsed = document.createElement("div");
      parsed.innerHTML = wide('<marquee scrollamount=7 \\u0101=1></marquee><svg viewbox="0 0 2 2"><foreignobject></foreignobject></svg>');
      console.log(JSON.stringify([
        img.constructor.name, img.longDesc, div.ariaBrailleLabel, div.getAttribute(longest), div.getAttribute("x".repeat(47)),
        div.getAttribute("titl\\u0113"), div.title, svg.localName, svg.getAttribute("viewBox"), math.localName,
        parsed.firstChild.scrollAmount, parsed.firstChild.constructor.name, parsed.lastChild.getAttribute("viewBox"), parsed.lastChild.firstChild.localName,
      ]));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([
    "HTMLImageElement",
    "https://example.com/d",
    "b",
    "1",
    "long",
    "wide",
    "",
    "foreignObject",
    "0 0 1 1",
    "mfrac",
    7,
    "HTMLMarqueeElement",
    "0 0 2 2",
    "foreignObject",
  ]);
  expect(exitCode).toBe(0);
});

describe("the dictionary that an event's constructor takes", () => {
  const event = "bubbles cancelable composed";
  const ui = `${event} detail view`;
  const modifiers = `${ui} altKey ctrlKey metaKey modifierAltGraph modifierCapsLock shiftKey`;
  const mouse = `${modifiers} button buttons clientX clientY movementX movementY relatedTarget screenX screenY`;

  test.each([
    ["UIEvent", ui],
    ["FocusEvent", `${ui} relatedTarget`],
    ["CompositionEvent", `${ui} data`],
    ["InputEvent", `${ui} data inputType isComposing`],
    ["KeyboardEvent", `${modifiers} charCode code isComposing key keyCode keyIdentifier location repeat which`],
    ["MouseEvent", mouse],
    ["WheelEvent", `${mouse} deltaMode deltaX deltaY deltaZ wheelDeltaX wheelDeltaY`],
    ["DragEvent", `${mouse} dataTransfer`],
    ["TouchEvent", `${modifiers} changedTouches targetTouches touches`],
    [
      "PointerEvent",
      `${mouse} altitudeAngle azimuthAngle coalescedEvents height isPrimary pointerId pointerType predictedEvents pressure tangentialPressure tiltX tiltY twist width`,
    ],
    ["ToggleEvent", `${event} newState oldState source`],
    ["SubmitEvent", `${event} submitter`],
    ["ProgressEvent", `${event} lengthComputable loaded total`],
    ["StorageEvent", `${event} key newValue oldValue storageArea url`],
    ["PopStateEvent", `${event} hasUAVisualTransition state`],
  ])("%s reads the inherited members first, each dictionary's in alphabetical order", (name, expected) => {
    const window = new Window() as any;
    const read: string[] = [];
    new window[name]("x", new Proxy({}, { get: (_, key) => void read.push(String(key)) }));
    expect(read.join(" ")).toBe(expected);
  });

  test("every level's members arrive", () => {
    const window = new Window() as any;
    const target = window.document.createElement("div");
    const wheel = new window.WheelEvent("wheel", {
      bubbles: true,
      composed: true,
      detail: 3,
      view: window,
      ctrlKey: true,
      modifierCapsLock: true,
      button: 2,
      clientX: 10,
      relatedTarget: target,
      deltaY: -4,
      deltaMode: 1,
    });
    expect([wheel.bubbles, wheel.cancelable, wheel.composed, wheel.detail, wheel.view === window]).toEqual([
      true,
      false,
      true,
      3,
      true,
    ]);
    expect([wheel.ctrlKey, wheel.shiftKey, wheel.getModifierState("CapsLock"), wheel.button, wheel.clientX]).toEqual([
      true,
      false,
      true,
      2,
      10,
    ]);
    expect([wheel.relatedTarget === target, wheel.deltaY, wheel.deltaX, wheel.deltaMode]).toEqual([true, -4, 0, 1]);
    const pointer = new window.PointerEvent("pointerdown", {
      cancelable: true,
      shiftKey: true,
      screenY: 7,
      pointerId: 5,
      pointerType: "pen",
    });
    expect([pointer.cancelable, pointer.shiftKey, pointer.screenY, pointer.pointerId, pointer.pointerType]).toEqual([
      true,
      true,
      7,
      5,
      "pen",
    ]);
  });

  test("a member that throws ends the conversion where it is", () => {
    const window = new Window() as any;
    for (const [thrower, expected] of [
      ["cancelable", "bubbles cancelable"],
      ["view", "bubbles cancelable composed detail view"],
      ["metaKey", "bubbles cancelable composed detail view altKey ctrlKey metaKey"],
      ["deltaX", `${mouse} deltaMode deltaX`],
    ]) {
      const read: string[] = [];
      const init = new Proxy(
        {},
        {
          get(_, key) {
            read.push(String(key));
            if (key === thrower) throw new RangeError(thrower);
          },
        },
      );
      expect(() => new window.WheelEvent("wheel", init)).toThrow(RangeError);
      expect(read.join(" ")).toBe(expected);
    }
  });

  test("wrong values are refused as before", () => {
    const window = new Window() as any;
    for (const name of ["UIEvent", "MouseEvent", "WheelEvent", "KeyboardEvent", "ToggleEvent"]) {
      expect(() => new window[name]("x", 1)).toThrow(TypeError);
      expect(() => new window[name]("x", "init")).toThrow(TypeError);
      expect(new window[name]("x", null).bubbles).toBe(false);
      expect(new window[name]("x", undefined).bubbles).toBe(false);
      expect(new window[name]("x", () => {}).bubbles).toBe(false);
    }
    expect(() => new window.WheelEvent("x", { view: {} })).toThrow(TypeError);
    expect(() => new window.WheelEvent("x", { relatedTarget: 1 })).toThrow(TypeError);
    expect(() => new window.WheelEvent("x", { deltaX: NaN })).toThrow(TypeError);
  });
});

describe("TouchEvent", () => {
  // `fireEvent.touchStart(node, init)` of Testing Library makes its event like this, and assigns nothing to it afterwards.
  const createEvent = (window: any, type: string, init?: object) =>
    new window.TouchEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });

  test("a listener reads the plain objects that the lists were made from", () => {
    const window = new Window() as any;
    const node = window.document.body.appendChild(window.document.createElement("div"));
    const first = { identifier: 0, clientX: 1, clientY: 2, target: node };
    const second = { identifier: 1, clientX: 3, clientY: 4 };
    const seen: unknown[] = [];
    window.document.addEventListener("touchstart", (event: any) => {
      seen.push(event.touches.length, event.touches[0].clientX, event.touches[1].clientY);
      seen.push(event.changedTouches[0] === second, event.targetTouches[0] === first, event.targetTouches.length);
    });
    const event = createEvent(window, "touchstart", {
      touches: [first, second],
      changedTouches: [second],
      targetTouches: [first],
      ctrlKey: true,
      detail: 2,
    });
    expect(node.dispatchEvent(event)).toBe(true);
    expect(seen).toEqual([2, 1, 4, true, true, 1]);
    expect(event).toBeInstanceOf(window.UIEvent);
    expect(Object.getPrototypeOf(window.TouchEvent.prototype)).toBe(window.UIEvent.prototype);
    expect(String(event)).toBe("[object TouchEvent]");
    expect([event.type, event.bubbles, event.cancelable, event.composed, event.detail]).toEqual([
      "touchstart",
      true,
      true,
      true,
      2,
    ]);
    expect([event.ctrlKey, event.shiftKey, event.altKey, event.metaKey]).toEqual([true, false, false, false]);
  });

  test("each list is an array of its own, made once", () => {
    const window = new Window() as any;
    const touches = [{ clientX: 1 }];
    const event = createEvent(window, "touchmove", { touches });
    expect(Array.isArray(event.touches)).toBe(true);
    expect(event.touches).not.toBe(touches);
    expect(event.touches).toBe(event.touches);
    expect(event.touches[0]).toBe(touches[0]);
    touches.push({ clientX: 2 });
    expect(event.touches).toHaveLength(1);
    expect(Object.isFrozen(event.touches)).toBe(false);
    expect(() => {
      event.touches = [];
    }).toThrow(TypeError);
  });

  test("a list that nobody gave is an empty array", () => {
    const window = new Window() as any;
    for (const event of [
      new window.TouchEvent("touchend"),
      createEvent(window, "touchend", { touches: undefined }),
      window.document.createEvent("TouchEvent"),
    ]) {
      expect(event).toBeInstanceOf(window.TouchEvent);
      for (const name of ["touches", "targetTouches", "changedTouches"]) {
        expect(event[name]).toEqual([]);
        expect(event[name]).toBe(event[name]);
      }
      expect(event.touches).not.toBe(event.changedTouches);
    }
  });

  test("a list can come from anything that can be iterated, and hold anything", () => {
    const window = new Window() as any;
    const touch = { clientX: 3 };
    expect(createEvent(window, "touchstart", { touches: new Set([touch]) }).touches).toEqual([touch]);
    expect(createEvent(window, "touchstart", { touches: [touch, touch].values() }).touches).toEqual([touch, touch]);
    expect(createEvent(window, "touchstart", { touches: [1, "x", null] }).touches).toEqual([1, "x", null]);
    for (const touches of [null, 1, "ab", true, {}, { length: 1, 0: touch }])
      expect(() => createEvent(window, "touchstart", { touches })).toThrow(TypeError);
    const failing = {
      *[Symbol.iterator]() {
        yield touch;
        throw new RangeError("stop");
      },
    };
    expect(() => createEvent(window, "touchstart", { changedTouches: failing })).toThrow(RangeError);
  });

  test("the lists outlive a collection", () => {
    const window = new Window() as any;
    const events = Array.from({ length: 200 }, (_, i) =>
      createEvent(window, "touchmove", { touches: new Set([{ clientX: i }]), changedTouches: [{ clientX: -i }] }),
    );
    Bun.gc(true);
    expect(events.map(event => event.touches[0].clientX)).toEqual(events.map((_, i) => i));
    expect(events.map(event => event.changedTouches[0].clientX)).toEqual(events.map((_, i) => -i));
  });

  test("ontouchstart, ontouchmove, ontouchend and ontouchcancel", () => {
    const window = new Window() as any;
    const { document } = window;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      for (const target of [window, document, document.body, svg]) {
        expect(target["on" + type]).toBe(null);
        let heard: unknown;
        target["on" + type] = (event: Event) => (heard = event);
        const event = createEvent(window, type);
        target.dispatchEvent(event);
        expect(heard).toBe(event);
      }
      const div = document.createElement("div");
      div.setAttribute("on" + type, "this.heard = event.type");
      div.dispatchEvent(createEvent(window, type));
      expect(div.heard).toBe(type);
    }
    expect("ontouchforcechange" in window).toBe(false);
  });
});

describe("SVG", () => {
  const namespace = "http://www.w3.org/2000/svg";
  const classes = {
    svg: "SVGSVGElement",
    g: "SVGGElement",
    defs: "SVGDefsElement",
    desc: "SVGDescElement",
    metadata: "SVGMetadataElement",
    switch: "SVGSwitchElement",
    symbol: "SVGSymbolElement",
    title: "SVGTitleElement",
  };
  const create = (window: any, tag: string) => window.document.createElementNS(namespace, tag);

  test("eight tags have a class of their own, from createElementNS(), the parser and cloneNode()", () => {
    const window = new Window() as any;
    const div = window.document.createElement("div");
    div.innerHTML = `<svg><g></g><defs></defs><desc></desc><metadata></metadata><switch></switch><symbol></symbol><title></title></svg>`;
    for (const [tag, name] of Object.entries(classes)) {
      const parsed = div.querySelector(tag);
      for (const element of [create(window, tag), create(window, "x:" + tag), parsed, parsed.cloneNode()]) {
        expect([tag, Object.getPrototypeOf(element) === window[name].prototype]).toEqual([tag, true]);
        expect(String(element)).toBe(`[object ${name}]`);
        expect(element).toBeInstanceOf(window.SVGElement);
        expect(element instanceof window.SVGGraphicsElement).toBe(!["desc", "metadata", "title"].includes(tag));
      }
      expect(() => new window[name]()).toThrow(TypeError);
    }
    expect(Object.getPrototypeOf(window.SVGSVGElement.prototype)).toBe(window.SVGGraphicsElement.prototype);
    expect(Object.getPrototypeOf(window.SVGGraphicsElement.prototype)).toBe(window.SVGElement.prototype);
    expect(Object.getPrototypeOf(window.SVGTitleElement.prototype)).toBe(window.SVGElement.prototype);
  });

  test("every other tag is a plain SVGElement", () => {
    const window = new Window() as any;
    const div = window.document.createElement("div");
    div.innerHTML = `<svg><path></path><a></a><foreignObject></foreignObject><nothing></nothing></svg>`;
    for (const element of [
      ...div.firstChild.children,
      ...["path", "circle", "use", "text", "image", "style", "script", "SVG", "nothing"].map(tag =>
        create(window, tag),
      ),
    ])
      expect([element.localName, Object.getPrototypeOf(element) === window.SVGElement.prototype]).toEqual([
        element.localName,
        true,
      ]);
    expect(window.document.createElement("svg")).toBeInstanceOf(window.HTMLUnknownElement);
    expect(window.document.createElementNS("http://www.w3.org/1998/Math/MathML", "svg")).not.toBeInstanceOf(
      window.SVGElement,
    );
  });

  test("className is an SVGAnimatedString that reflects the class attribute", () => {
    const window = new Window() as any;
    for (const tag of ["g", "path"]) {
      const element = create(window, tag);
      const { className } = element;
      expect(className).toBeInstanceOf(window.SVGAnimatedString);
      expect(element.className).toBe(className);
      expect([className.baseVal, className.animVal]).toEqual(["", ""]);
      element.setAttribute("class", "a b");
      expect([className.baseVal, className.animVal]).toEqual(["a b", "a b"]);
      className.baseVal = "c";
      expect(element.getAttribute("class")).toBe("c");
      expect([...element.classList]).toEqual(["c"]);
      expect(() => {
        className.animVal = "d";
      }).toThrow(TypeError);
      expect(() => {
        element.className = "d";
      }).toThrow(TypeError);
      expect(element.getAttribute("class")).toBe("c");
    }
    expect(window.document.createElement("div").className).toBe("");
    expect(() => new window.SVGAnimatedString()).toThrow(TypeError);
  });

  test("viewBox reflects the attribute as four numbers", () => {
    const window = new Window() as any;
    const read = ({ x, y, width, height }: any) => [x, y, width, height];
    for (const tag of ["svg", "symbol"]) {
      const element = create(window, tag);
      const { viewBox } = element;
      expect(viewBox).toBeInstanceOf(window.SVGAnimatedRect);
      expect(element.viewBox).toBe(viewBox);
      expect(viewBox.baseVal).toBeInstanceOf(window.SVGRect);
      expect(viewBox.animVal).toBeInstanceOf(window.SVGRect);
      expect(read(viewBox.baseVal)).toEqual([0, 0, 0, 0]);
      for (const [value, expected] of [
        ["0 1 20.5 30", [0, 1, 20.5, 30]],
        ["-1,-2,3,4", [-1, -2, 3, 4]],
        [" 1 , 2 , 3e1 , .5 ", [1, 2, 30, 0.5]],
        ["0 0 -1 1", [0, 0, 0, 0]],
        ["0 0 1 -1", [0, 0, 0, 0]],
        ["1 2 3", [0, 0, 0, 0]],
        ["1 2 3 4 5", [0, 0, 0, 0]],
        ["1 2 3 4px", [0, 0, 0, 0]],
        ["a", [0, 0, 0, 0]],
        ["", [0, 0, 0, 0]],
      ] as const) {
        element.setAttribute("viewBox", value);
        expect([value, read(viewBox.baseVal), read(viewBox.animVal)]).toEqual([value, expected, expected]);
      }
      element.setAttribute("viewBox", "0 1 20 30");
      viewBox.baseVal.width = 5;
      expect(element.getAttribute("viewBox")).toBe("0 1 5 30");
      viewBox.baseVal.x = -2.5;
      expect(element.getAttribute("viewBox")).toBe("-2.5 1 5 30");
      expect(read(viewBox.animVal)).toEqual([-2.5, 1, 5, 30]);
      expect(() => {
        viewBox.animVal.x = 1;
      }).toThrow(expect.objectContaining({ name: "NoModificationAllowedError" }));
      expect(element.getAttribute("viewBox")).toBe("-2.5 1 5 30");
    }
    expect("viewBox" in create(window, "g")).toBe(false);
  });

  test("preserveAspectRatio reflects the attribute as two enumerations", () => {
    const window = new Window() as any;
    const { SVGPreserveAspectRatio } = window;
    const element = create(window, "svg");
    const { preserveAspectRatio } = element;
    expect(preserveAspectRatio).toBeInstanceOf(window.SVGAnimatedPreserveAspectRatio);
    expect(element.preserveAspectRatio).toBe(preserveAspectRatio);
    const { baseVal, animVal } = preserveAspectRatio;
    expect(baseVal).toBeInstanceOf(SVGPreserveAspectRatio);
    expect([SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMIDYMID, baseVal.SVG_MEETORSLICE_SLICE]).toEqual([6, 2]);
    for (const [value, align, meetOrSlice] of [
      [null, 6, 1],
      ["xMinYMax slice", 8, 2],
      ["xMaxYMin", 4, 1],
      ["xMaxYMax meet", 10, 1],
      ["none", 1, 1],
      ["xminymin", 6, 1],
      ["xMinYMin nothing", 6, 1],
      ["", 6, 1],
    ] as const) {
      if (value === null) element.removeAttribute("preserveAspectRatio");
      else element.setAttribute("preserveAspectRatio", value);
      expect([value, baseVal.align, baseVal.meetOrSlice, animVal.align, animVal.meetOrSlice]).toEqual([
        value,
        align,
        meetOrSlice,
        align,
        meetOrSlice,
      ]);
    }
    baseVal.align = SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_XMINYMIN;
    expect(element.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
    baseVal.meetOrSlice = SVGPreserveAspectRatio.SVG_MEETORSLICE_SLICE;
    expect(element.getAttribute("preserveAspectRatio")).toBe("xMinYMin slice");
    for (const value of [0, 11]) expect(() => (baseVal.align = value)).toThrow();
    for (const value of [0, 3]) expect(() => (baseVal.meetOrSlice = value)).toThrow();
    expect(element.getAttribute("preserveAspectRatio")).toBe("xMinYMin slice");
  });

  test("requiredExtensions and systemLanguage are lists of the attribute's tokens", () => {
    const window = new Window() as any;
    const element = create(window, "g");
    for (const [name, value, separator] of [
      ["requiredExtensions", "  a \t b\nc ", " "],
      ["systemLanguage", " a , b,c ", ", "],
    ]) {
      const list = element[name];
      expect(list).toBeInstanceOf(window.SVGStringList);
      expect(element[name]).toBe(list);
      expect([list.length, list.numberOfItems, list[0]]).toEqual([0, 0, undefined]);
      element.setAttribute(name, value);
      expect([list.length, list.numberOfItems, list[0], list.getItem(1), list[2], list[3]]).toEqual([
        3,
        3,
        "a",
        "b",
        "c",
        undefined,
      ]);
      expect(Object.keys(list)).toEqual(["0", "1", "2"]);
      expect(list.appendItem("d")).toBe("d");
      expect(element.getAttribute(name)).toBe(["a", "b", "c", "d"].join(separator));
      expect(list.insertItemBefore("e", 1)).toBe("e");
      expect(list.insertItemBefore("f", 100)).toBe("f");
      expect(element.getAttribute(name)).toBe(["a", "e", "b", "c", "d", "f"].join(separator));
      expect(list.replaceItem("g", 0)).toBe("g");
      expect(list.removeItem(1)).toBe("e");
      list[1] = "h";
      expect(element.getAttribute(name)).toBe(["g", "h", "c", "d", "f"].join(separator));
      for (const attempt of [() => list.getItem(5), () => list.replaceItem("x", 5), () => list.removeItem(5)])
        expect(attempt).toThrow(expect.objectContaining({ name: "IndexSizeError" }));
      list.initialize("i");
      expect([element.getAttribute(name), list.length]).toEqual(["i", 1]);
      list.clear();
      expect([element.getAttribute(name), list.length]).toEqual(["", 0]);
    }
    expect("systemLanguage" in create(window, "title")).toBe(false);
    expect("systemLanguage" in create(window, "path")).toBe(false);
  });

  test("createSVGNumber() and createSVGRect() make values that belong to nothing", () => {
    const window = new Window() as any;
    const svg = create(window, "svg");
    const number = svg.createSVGNumber();
    expect(number).toBeInstanceOf(window.SVGNumber);
    expect(number.value).toBe(0);
    number.value = 1.5;
    expect(number.value).toBe(1.5);
    expect(() => (number.value = NaN)).toThrow(TypeError);
    expect(svg.createSVGNumber()).not.toBe(number);
    const rect = svg.createSVGRect();
    expect(rect).toBeInstanceOf(window.SVGRect);
    Object.assign(rect, { x: 1, y: 2, width: -3, height: 4.5 });
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([1, 2, -3, 4.5]);
    expect(svg.hasAttribute("viewBox")).toBe(false);
    for (const name of ["SVGNumber", "SVGRect", "SVGStringList", "SVGPreserveAspectRatio", "SVGAnimatedRect"])
      expect(() => new window[name]()).toThrow(TypeError);
  });

  test("getElementById() looks inside the <svg>, connected or not", () => {
    const window = new Window() as any;
    const div = window.document.createElement("div");
    div.innerHTML = `<p id="a"></p><svg><g id="a"><path id="b"></path></g></svg><svg><g id="c"></g></svg>`;
    const [first, second] = div.querySelectorAll("svg");
    for (const connected of [false, true]) {
      if (connected) window.document.body.append(div);
      expect(first.getElementById("a")).toBe(first.firstChild);
      expect(first.getElementById("b")).toBe(first.firstChild.firstChild);
      expect(first.getElementById("c")).toBe(null);
      expect(second.getElementById("c")).toBe(second.firstChild);
      expect(first.getElementById("")).toBe(null);
    }
  });

  test("the methods about redrawing do nothing", () => {
    const svg = create(new Window(), "svg");
    expect(svg.suspendRedraw(100)).toBe(1);
    expect([svg.unsuspendRedraw(1), svg.unsuspendRedrawAll(), svg.forceRedraw()]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(() => svg.suspendRedraw()).toThrow(TypeError);
  });

  test("what needs geometry is left out, as in jsdom", () => {
    const window = new Window() as any;
    const svg = create(window, "svg");
    for (const name of [
      "getBBox",
      "getCTM",
      "getScreenCTM",
      "transform",
      "width",
      "height",
      "createSVGPoint",
      "createSVGMatrix",
    ])
      expect([name, name in svg]).toEqual([name, false]);
    for (const name of ["SVGPathElement", "SVGRectElement", "SVGLength", "SVGPoint", "SVGMatrix", "SVGTransform"])
      expect([name, name in window]).toEqual([name, false]);
  });

  test("the values outlive a collection with what a script put on them", () => {
    const window = new Window() as any;
    const svg = window.document.body.appendChild(create(window, "svg"));
    svg.className.mine = 1;
    svg.viewBox.mine = 2;
    svg.systemLanguage.mine = 3;
    Bun.gc(true);
    expect([svg.className.mine, svg.viewBox.mine, svg.systemLanguage.mine]).toEqual([1, 2, 3]);
    const { className } = create(window, "g");
    Bun.gc(true);
    className.baseVal = "kept";
    expect(className.baseVal).toBe("kept");
  });
});

describe("HTMLCollection.namedItem", () => {
  function page() {
    const { document } = new Window() as any;
    document.body.innerHTML = `
      <form id="f1" name="first"><input id="i1" name="n1"><img id="g1" name="pic"></form>
      <form name="second"><a id="a1" name="anchor" href="#x">x</a><a name="plain">y</a></form>
      <div id="outer"><p id="inner" name="para"><span id="deep" name="s"></span></p><p id="twice"></p><p id="twice" title="2"></p></div>
      <table id="t"><tbody id="tb"><tr id="r1"><td id="c1"></td></tr><tr name="r2"></tr></tbody></table>
      <select id="sel"><option id="o1" name="on1">1</option><optgroup><option name="on2" selected>2</option></optgroup></select>
      <svg id="svg" name="vector"></svg>`;
    return document;
  }
  const id = (element: any) => (element ? element.id || element.getAttribute("name") : element);

  test("finds an element by id, then by name", () => {
    const document = page();
    expect(id(document.forms.namedItem("f1"))).toBe("f1");
    expect(id(document.forms.namedItem("first"))).toBe("f1");
    expect(id(document.forms.namedItem("second"))).toBe("second");
    expect(id(document.forms.second)).toBe("second");
    expect(id(document.images.namedItem("pic"))).toBe("g1");
    expect(id(document.links.namedItem("anchor"))).toBe("a1");
    expect(id(document.anchors.namedItem("plain"))).toBe("plain");
    expect(id(document.getElementsByTagName("*").namedItem("deep"))).toBe("deep");
    expect(id(document.getElementsByTagName("span").namedItem("s"))).toBe("deep");
    expect(id(document.getElementById("t").rows.namedItem("r1"))).toBe("r1");
    expect(id(document.getElementById("t").rows.namedItem("r2"))).toBe("r2");
    expect(id(document.getElementById("t").tBodies.namedItem("tb"))).toBe("tb");
    expect(id(document.getElementById("r1").cells.namedItem("c1"))).toBe("c1");
    expect(id(document.getElementById("sel").options.namedItem("on2"))).toBe("on2");
    expect(id(document.getElementById("sel").selectedOptions.namedItem("on2"))).toBe("on2");
    expect(id(document.getElementById("f1").elements.namedItem("n1"))).toBe("i1");
  });

  test("an element with that id or name that is not in the collection is not found", () => {
    const document = page();
    expect(document.forms.namedItem("i1")).toBe(null);
    expect(document.forms.namedItem("")).toBe(null);
    expect(document.forms.namedItem("nothing")).toBe(null);
    expect(document.links.namedItem("plain")).toBe(null);
    expect(document.getElementById("sel").selectedOptions.namedItem("o1")).toBe(null);
    expect(document.getElementsByTagName("p").namedItem("deep")).toBe(null);
    expect(document.getElementById("f1").getElementsByTagName("*").namedItem("a1")).toBe(null);
  });

  test("children looks at children only", () => {
    const outer = page().getElementById("outer");
    expect(id(outer.children.namedItem("inner"))).toBe("inner");
    expect(id(outer.children.namedItem("para"))).toBe("inner");
    expect(outer.children.namedItem("deep")).toBe(null);
    expect(outer.children.namedItem("s")).toBe(null);
    expect(outer.children.namedItem("outer")).toBe(null);
  });

  test("of two elements with one id, the first in tree order", () => {
    const document = page();
    const found = document.getElementById("outer").children.namedItem("twice");
    expect(found.title).toBe("");
    found.remove();
    expect(document.getElementById("outer").children.namedItem("twice").title).toBe("2");
  });

  test("a name counts on HTML elements only", () => {
    const document = page();
    expect(id(document.body.children.namedItem("svg"))).toBe("svg");
    expect(document.body.children.namedItem("vector")).toBe(null);
  });

  test("document.all shows the names of some elements only", () => {
    const document = page();
    expect(id(document.all.namedItem("first"))).toBe("f1");
    expect(id(document.all.namedItem("pic"))).toBe("g1");
    expect(document.all.namedItem("para")).toBe(null);
    expect(id(document.all.namedItem("inner"))).toBe("inner");
  });

  test("works in a tree that is not in a document", () => {
    const document = page();
    const outer = document.getElementById("outer");
    outer.remove();
    expect(id(outer.children.namedItem("para"))).toBe("inner");
    expect(id(outer.getElementsByTagName("span").namedItem("s"))).toBe("deep");
    expect(outer.children.namedItem("deep")).toBe(null);
    expect(document.getElementsByTagName("*").namedItem("deep")).toBe(null);
  });

  test("follows changes", () => {
    const document = page();
    const forms = document.forms;
    expect(forms.namedItem("later")).toBe(null);
    forms[1].id = "later";
    expect(forms.namedItem("later")).toBe(forms[1]);
    forms[1].removeAttribute("id");
    expect(forms.namedItem("later")).toBe(null);
    expect(Object.getOwnPropertyNames(forms)).toEqual(["0", "1", "f1", "first", "second"]);
  });
});

describe("what each kind of HTMLCollection holds", () => {
  function page() {
    const { document } = new Window() as any;
    document.body.innerHTML = `
      <form id="form1"><fieldset id="set"><input id="in1"><div><select id="sel" multiple><option id="o1" selected>1</option><optgroup><option id="o2">2</option><option id="o3" selected>3</option></optgroup></select></div><img id="img1"><object id="obj1"></object></fieldset></form>
      <form id="form2"><a id="link1" href="#1">1</a><a id="anchor1" name="n1">2</a><a id="both" href="#2" name="n2">3</a></form>
      <map id="map"><area id="area1" href="#3"><div><area id="area2"></div></map>
      <embed id="embed1"><script id="script1"></script><img id="img2">
      <input list="list"><datalist id="list"><option id="d1"></option><div><option id="d2"></option></div></datalist>
      <table id="table"><thead id="head"><tr id="r0"><th id="h1"></th><td id="c0"><table><tbody id="nested"><tr id="rn"><td id="cn"></td></tr></tbody></table></td></tr></thead><tbody id="body1"><tr id="r1"><td id="c1"></td><th id="h2"></th><td id="c2"></td></tr><tr id="r2"></tr></tbody><tbody id="body2"></tbody></table>`;
    return document;
  }
  const ids = (collection: any) => Array.from(collection, (element: any) => element.id).join(" ");
  const byIndex = (collection: any) => {
    const found: string[] = [];
    for (let i = 0; i < collection.length; i++) found.push(collection[i].id);
    return found.join(" ");
  };

  const kinds: [string, (document: any) => any, string][] = [
    ["document.images", d => d.images, "img1 img2"],
    ["document.forms", d => d.forms, "form1 form2"],
    ["document.links", d => d.links, "link1 both area1"],
    ["document.anchors", d => d.anchors, "anchor1 both"],
    ["document.scripts", d => d.scripts, "script1"],
    ["document.embeds", d => d.embeds, "embed1"],
    ["document.plugins", d => d.plugins, "embed1"],
    ["map.areas", d => d.getElementById("map").areas, "area1 area2"],
    ["select.selectedOptions", d => d.getElementById("sel").selectedOptions, "o1 o3"],
    ["datalist.options", d => d.getElementById("list").options, "d1 d2"],
    ["fieldset.elements", d => d.getElementById("set").elements, "in1 sel obj1"],
    ["table.tBodies", d => d.getElementById("table").tBodies, "body1 body2"],
    ["tbody.rows", d => d.getElementById("body1").rows, "r1 r2"],
    ["thead.rows", d => d.getElementById("head").rows, "r0"],
    ["tr.cells", d => d.getElementById("r1").cells, "c1 h2 c2"],
    ["tr.cells with a nested table", d => d.getElementById("r0").cells, "h1 c0"],
    ["table.rows", d => d.getElementById("table").rows, "r0 r1 r2"],
    ["children", d => d.getElementById("body1").children, "r1 r2"],
    ["select.options", d => d.getElementById("sel").options, "o1 o2 o3"],
    ["form.elements", d => d.getElementById("form1").elements, "set in1 sel obj1"],
  ];

  test.each(kinds)("%s", (_, get, expected) => {
    const document = page();
    const collection = get(document);
    expect(ids(collection)).toBe(expected);
    expect(byIndex(collection)).toBe(expected);
    expect(collection.length).toBe(expected.split(" ").length);
    expect(collection.item(collection.length)).toBe(null);
    expect(collection[collection.length - 1].id).toBe(expected.split(" ").at(-1));
    expect(collection[0].id).toBe(expected.split(" ")[0]);
    expect(get(document)).toBe(collection);
    expect(Object.prototype.toString.call(collection)).toMatch(
      /^\[object HTML(Collection|OptionsCollection|FormControlsCollection)\]$/,
    );
  });

  test("they are live", () => {
    const document = page();
    const { forms, links, images } = document;
    const rows = document.getElementById("body1").rows;
    const cells = document.getElementById("r1").cells;
    const selected = document.getElementById("sel").selectedOptions;
    expect([forms.length, links.length, images.length, rows.length, cells.length, selected.length]).toEqual([
      2, 3, 2, 2, 3, 2,
    ]);
    document.getElementById("form2").remove();
    document.getElementById("area2").setAttribute("href", "#4");
    document.body.appendChild(document.createElement("img")).id = "img3";
    rows[0].after(document.createElement("tr"));
    cells[1].remove();
    document.getElementById("o2").selected = true;
    expect([ids(forms), ids(links), ids(images), rows.length, ids(cells), ids(selected)]).toEqual([
      "form1",
      "area1 area2",
      "img1 img2 img3",
      3,
      "c1 c2",
      "o1 o2 o3",
    ]);
  });
});

describe("members that take markup, script or a URL take any value as a string", () => {
  const stringable = (text: string) => ({ toString: () => text });

  test("markup", () => {
    const window = new Window() as any;
    const { document } = window;
    const div = document.body.appendChild(document.createElement("div"));
    div.innerHTML = stringable("<b>1</b>");
    expect(div.innerHTML).toBe("<b>1</b>");
    div.innerHTML = null;
    expect(div.innerHTML).toBe("");
    div.innerHTML = undefined;
    expect(div.innerHTML).toBe("undefined");
    div.innerHTML = 5;
    expect(div.innerHTML).toBe("5");
    div.insertAdjacentHTML("beforeend", stringable("<i>2</i>"));
    expect(div.innerHTML).toBe("5<i>2</i>");
    div.insertAdjacentHTML("beforeend", null);
    expect(div.innerHTML).toBe("5<i>2</i>null");
    div.setHTMLUnsafe(stringable("<u>3</u>"));
    expect(div.innerHTML).toBe("<u>3</u>");
    div.firstChild.outerHTML = stringable("<s>4</s>");
    expect(div.innerHTML).toBe("<s>4</s>");
    div.firstChild.outerHTML = null;
    expect(div.innerHTML).toBe("");
    const root = div.attachShadow({ mode: "open" });
    root.innerHTML = stringable("<p>5</p>");
    expect(root.innerHTML).toBe("<p>5</p>");
    root.innerHTML = null;
    expect(root.innerHTML).toBe("");
    root.setHTMLUnsafe(6);
    expect(root.innerHTML).toBe("6");
    const range = document.createRange();
    range.selectNodeContents(document.body);
    expect(range.createContextualFragment(stringable("<em>7</em>")).firstChild.localName).toBe("em");
    expect(new window.DOMParser().parseFromString(stringable("<h1>8</h1>"), "text/html").body.innerHTML).toBe(
      "<h1>8</h1>",
    );
    expect(window.Document.parseHTMLUnsafe(stringable("<h2>9</h2>")).body.innerHTML).toBe("<h2>9</h2>");
    expect(() => (div.innerHTML = Symbol())).toThrow(TypeError);
    expect(
      () =>
        (div.innerHTML = {
          toString: () => {
            throw new RangeError("no");
          },
        }),
    ).toThrow(RangeError);
  });

  test("attributes", () => {
    const { document } = new Window() as any;
    const div = document.createElement("div");
    div.setAttribute("a", stringable("1"));
    div.setAttribute("b", null);
    div.setAttribute("c", undefined);
    div.setAttribute("d", 4);
    div.setAttributeNS(null, "e", stringable("5"));
    div.setAttributeNS("urn:x", "x:f", null);
    expect(div.outerHTML).toBe(`<div a="1" b="null" c="undefined" d="4" e="5" x:f="null"></div>`);
    expect(() => div.setAttribute("g")).toThrow(TypeError);
    expect(() => div.setAttribute("g", Symbol())).toThrow(TypeError);
    expect(() => div.setAttribute("", "x")).toThrow("Invalid attribute name");
  });

  test("script", () => {
    const { document } = new Window({ url: "https://example.com/a/" } as any) as any;
    const script = document.createElement("script");
    script.text = stringable("1");
    expect([script.text, script.textContent, script.childNodes.length]).toEqual(["1", "1", 1]);
    script.text = null;
    expect(script.text).toBe("null");
    script.textContent = stringable("2");
    expect(script.text).toBe("2");
    script.textContent = null;
    expect([script.text, script.childNodes.length]).toEqual(["", 0]);
    script.innerText = stringable("3\n4");
    expect([script.text, script.innerHTML]).toEqual(["34", "3<br>4"]);
    script.innerText = null;
    expect(script.text).toBe("");
    script.src = stringable("b.js");
    expect([script.src, script.getAttribute("src")]).toEqual(["https://example.com/a/b.js", "b.js"]);
    script.src = null;
    expect(script.getAttribute("src")).toBe("null");
  });

  test("document.write", () => {
    const { document } = new Window() as any;
    document.open();
    document.write("<p>", stringable("1"), 2, null);
    document.writeln("</p>", stringable("<i>3</i>"));
    document.close();
    expect(document.body.innerHTML).toBe("<p>12null</p><i>3</i>\n");
  });
});

test("members that cannot answer without layout, and that jsdom does not have either", () => {
  const { document } = new Window() as any;
  const shadowRoot = document.body.attachShadow({ mode: "open" });
  for (const name of ["elementFromPoint", "elementsFromPoint", "caretRangeFromPoint", "caretPositionFromPoint"]) {
    expect(name in document).toBe(false);
    expect(name in shadowRoot).toBe(false);
  }
  // A helper written for jsdom brings its own.
  document.elementFromPoint = () => document.body;
  expect(document.elementFromPoint(0, 0)).toBe(document.body);
});

test("interfaces that bun:dom leaves out", async () => {
  const window = new Window() as any;
  const module = (await import("bun:dom")) as any;
  for (const name of [
    "TrustedHTML",
    "TrustedScript",
    "TrustedScriptURL",
    "trustedTypes",
    "CloseWatcher",
    "DOMPoint",
    "DOMPointReadOnly",
    "Touch",
    "TouchList",
    "Plugin",
    "MimeType",
    "SVGPathElement",
    "CSSKeyframesRule",
  ]) {
    expect(name in window).toBe(false);
    expect(name in module).toBe(false);
  }
  for (const name of [
    "DOMRect",
    "DOMRectReadOnly",
    "DOMRectList",
    "CommandEvent",
    "ToggleEvent",
    "HTMLSelectedContentElement",
    "TouchEvent",
    "Navigator",
    "PluginArray",
    "MimeTypeArray",
    "SVGSVGElement",
    "SVGAnimatedString",
    "CSSLayerBlockRule",
    "CSSLayerStatementRule",
  ]) {
    expect([name, typeof window[name]]).toEqual([name, "function"]);
    expect(module[name]).toBe(window[name]);
  }
});

test("five threads parse, change, style, query and drop documents at the same time", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "threads-fixture.mjs"), isDebug || isASAN ? "40" : "250"],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

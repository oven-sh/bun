// Bugs that Web Platform Tests found in bun:dom, each in its smallest form. The harness is in ./wpt.
import { MouseEvent, Window } from "bun:dom";
import { describe, expect, test } from "bun:test";
import vm from "node:vm";

describe("a syntax error of the DOM is a DOMException", () => {
  const window = new Window();
  const { document } = window;
  const element = document.createElement("div");

  test.each([
    ["querySelector", () => document.querySelector("!!")],
    ["matches", () => element.matches("")],
    ["classList.add", () => element.classList.add("")],
    ["insertAdjacentElement", () => element.insertAdjacentElement("nowhere", document.createElement("p"))],
    ["insertAdjacentHTML", () => element.insertAdjacentHTML("nowhere", "")],
    ["customElements.define", () => window.customElements.define("nohyphen", class extends window.HTMLElement {})],
    ["dataset", () => (element.dataset["a-b"] = "")],
  ])("%s", (_, run) => {
    let error: any;
    try {
      run();
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(DOMException);
    expect(error.name).toBe("SyntaxError");
    expect(error.code).toBe(DOMException.SYNTAX_ERR);
  });

  test("WebSocket, WebCrypto and performance.measure() still throw a JavaScript SyntaxError", async () => {
    expect(() => new WebSocket("not a url")).toThrow(SyntaxError);
    expect(() => performance.measure("m", "no such mark")).toThrow(SyntaxError);
    expect(crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, [])).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe("listeners that are passive by default", () => {
  const isCanceled = (target: EventTarget, type: string, options?: AddEventListenerOptions) => {
    target.addEventListener(type, event => event.preventDefault(), { once: true, ...options });
    return !target.dispatchEvent(new Event(type, { cancelable: true }));
  };

  test.each(["touchstart", "touchmove", "wheel", "mousewheel"])(
    "%s on the window, the document, <html> and <body>",
    type => {
      const window = new Window();
      const { document } = window;
      for (const target of [window, document, document.documentElement, document.body]) {
        expect(isCanceled(target, type)).toBe(false);
        expect(isCanceled(target, type, { passive: false })).toBe(true);
      }
      expect(isCanceled(document.body.appendChild(document.createElement("div")), type)).toBe(true);
      expect(isCanceled(new EventTarget(), type)).toBe(true);
    },
  );

  test("no other event", () => {
    const window = new Window();
    for (const type of ["touchend", "click", "scroll"]) expect(isCanceled(window, type)).toBe(true);
  });
});

test("a custom element whose class comes from a node:vm context", () => {
  const window = new Window();
  vm.createContext(window);
  vm.runInContext(
    `customElements.define("x-a", class extends HTMLElement { connectedCallback() { this.textContent = "connected"; } })`,
    window,
  );
  window.document.body.innerHTML = "<x-a></x-a>";
  expect(window.document.body.innerHTML).toBe("<x-a>connected</x-a>");
  expect(window.document.createElement("x-a")).toBeInstanceOf(window.HTMLElement);
});

describe("new FormData(form, submitter)", () => {
  const window = new Window();
  const { document } = window;
  document.body.innerHTML = `
    <form id=form>
      <input name=text value=1><input name=off type=checkbox><input name=on type=checkbox checked>
      <textarea name=area>two</textarea><select name=choice><option>a<option selected>b</select>
      <input name=disabled value=3 disabled><button name=button value=pressed id=button></button>
    </form>
    <button id=stranger></button><p id=paragraph></p>`;
  const form = document.getElementById("form");

  test("has the entries a submission would send", () => {
    const entries = [
      ["text", "1"],
      ["on", "on"],
      ["area", "two"],
      ["choice", "b"],
    ];
    expect([...new FormData(form)]).toEqual(entries);
    expect([...new window.FormData(form, null)]).toEqual(entries);
    expect([...new FormData(form, document.getElementById("button"))]).toEqual([...entries, ["button", "pressed"]]);
  });

  test("fires formdata at the form", () => {
    form.addEventListener("formdata", (event: any) => event.formData.append("added", "4"), { once: true });
    expect(new FormData(form).get("added")).toBe("4");
  });

  test("rejects a submitter that is not a submit button of the form", () => {
    expect(() => new FormData(form, document.getElementById("paragraph"))).toThrow(TypeError);
    expect(() => new FormData(form, {} as any)).toThrow(TypeError);
    expect(() => new FormData(form, document.getElementById("stranger"))).toThrow(
      expect.objectContaining({ name: "NotFoundError" }),
    );
  });

  test("still ignores an argument that is not a form", () => {
    expect([...new FormData("a=b" as any)]).toEqual([]);
    expect([...new FormData({} as any, {} as any)]).toEqual([]);
  });
});

describe("Event.timeStamp", () => {
  test("is on performance.now()'s clock", () => {
    const before = performance.now();
    const event = new Event("x");
    const after = performance.now();
    // The two clocks are matched once, to within the time it takes to read one.
    expect(event.timeStamp).toBeGreaterThan(before - 0.01);
    expect(event.timeStamp).toBeLessThan(after + 0.01);
  });

  test("does not change, and grows from one event to the next", () => {
    const first = new Event("x");
    const timeStamp = first.timeStamp;
    let second = new MouseEvent("click");
    while (second.timeStamp === timeStamp) second = new MouseEvent("click");
    expect(second.timeStamp).toBeGreaterThan(timeStamp);
    expect(first.timeStamp).toBe(timeStamp);
  });
});

test("a hidden input cannot be focused", () => {
  const { document } = new Window();
  document.body.innerHTML = `<input id=text><input id=hidden type=hidden>`;
  document.getElementById("text").focus();
  document.getElementById("hidden").focus();
  expect(document.activeElement.id).toBe("text");
});

describe("inert", () => {
  test("nothing in an inert subtree can be focused", () => {
    const { document } = new Window();
    document.body.innerHTML = `<button id=outside></button><div inert><button id=inside></button></div><button id=self inert></button>`;
    const tryFocus = (id: string) => {
      document.getElementById("outside")!.focus();
      document.getElementById(id)!.focus();
      return document.activeElement!.id;
    };
    expect(tryFocus("inside")).toBe("outside");
    expect(tryFocus("self")).toBe("outside");
    document.querySelector("div")!.inert = false;
    expect(tryFocus("inside")).toBe("inside");
  });

  test("it follows the flat tree: a shadow host's content, and what is slotted into an inert part", () => {
    const { document } = new Window();
    document.body.innerHTML = `<div id=host inert></div><div id=other><button id=slotted></button></div>`;
    const inShadow = document
      .getElementById("host")!
      .attachShadow({ mode: "open" })
      .appendChild(document.createElement("button"));
    document.getElementById("other")!.attachShadow({ mode: "open" }).innerHTML = `<div inert><slot></slot></div>`;
    inShadow.focus();
    expect(document.activeElement).toBe(document.body);
    document.getElementById("slotted")!.focus();
    expect(document.activeElement).toBe(document.body);
  });

  test("a modal dialog blocks the rest of the document until it closes", () => {
    const { document } = new Window();
    document.body.innerHTML = `<button id=outside></button><dialog><button id=inside></button><p inert><button id=blocked></button></p></dialog>`;
    const [outside, inside, blocked] = ["outside", "inside", "blocked"].map(id => document.getElementById(id)!);
    const dialog = document.querySelector("dialog")!;

    dialog.showModal();
    expect(document.activeElement).toBe(inside);
    outside.focus();
    expect(document.activeElement).toBe(inside);
    blocked.focus();
    expect(document.activeElement).toBe(inside);

    dialog.close();
    outside.focus();
    expect(document.activeElement).toBe(outside);

    dialog.show();
    outside.focus();
    expect(document.activeElement).toBe(outside);
  });
});

describe("ResizeObserver", () => {
  const window = new Window();
  const { ResizeObserver, document } = window;

  test("is on the window and not on the global object", () => {
    expect(ResizeObserver.name).toBe("ResizeObserver");
    expect("ResizeObserver" in globalThis).toBe(false);
  });

  test("observes, and has nothing to report where every box is 0 by 0", async () => {
    let calls = 0;
    const observer = new ResizeObserver(() => calls++);
    const element = document.body.appendChild(document.createElement("div"));
    expect(observer.observe(element)).toBeUndefined();
    expect(observer.observe(element, { box: "border-box" })).toBeUndefined();
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    expect(observer.unobserve(element)).toBeUndefined();
    expect(observer.disconnect()).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("checks its arguments", () => {
    // @ts-expect-error
    expect(() => new ResizeObserver()).toThrow(TypeError);
    // @ts-expect-error
    expect(() => new ResizeObserver({})).toThrow(TypeError);
    // @ts-expect-error
    expect(() => ResizeObserver(() => {})).toThrow(TypeError);
    const observer = new ResizeObserver(() => {});
    // @ts-expect-error
    expect(() => observer.observe(document)).toThrow(TypeError);
    // @ts-expect-error
    expect(() => observer.observe(document.body, { box: "no-such-box" })).toThrow(TypeError);
    // @ts-expect-error
    expect(() => observer.unobserve(null)).toThrow(TypeError);
  });
});

test("a listener in a document nobody holds is still there when the queued event is fired", async () => {
  const window = new Window();
  const { promise, resolve } = Promise.withResolvers<string>();
  (() => {
    const document = new window.DOMParser().parseFromString("<details open>", "text/html");
    document.querySelector("details")!.ontoggle = event => resolve(event.type);
  })();
  Bun.gc(true);
  expect(await Promise.race([promise, new Promise(resolve => setTimeout(resolve, 200, "never fired"))])).toBe("toggle");
});

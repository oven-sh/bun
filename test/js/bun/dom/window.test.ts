import { DOMParser, Window } from "bun:dom";
import { heapStats } from "bun:jsc";
import { describe, expect, jest, spyOn, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

const once = (target: any, type: string): Promise<any> =>
  new Promise(resolve => target.addEventListener(type, resolve, { once: true }));

const at = (url: string) => new Window({ url });

describe("the names of the runtime", () => {
  test("a window has what the global object has", () => {
    const window = new Window();
    for (const name of [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "queueMicrotask",
      "structuredClone",
      "fetch",
      "URL",
      "console",
      "performance",
      "crypto",
      "atob",
      "TextEncoder",
      "Array",
      "Promise",
    ]) {
      expect([name, window[name]]).toEqual([name, globalThis[name]]);
      expect(window[name]).toBe(globalThis[name]);
      expect(name in window).toBe(true);
    }
  });

  test("they are not properties of the window, and nothing lists them", () => {
    const window = new Window();
    expect(window.setTimeout).toBe(setTimeout);
    expect(Object.hasOwn(window, "setTimeout")).toBe(false);
    expect(Object.getOwnPropertyNames(window)).not.toContain("setTimeout");
    const listed: string[] = [];
    for (const name in window) listed.push(name);
    expect(listed).not.toContain("setTimeout");
  });

  test("they come from an object between Window.prototype and EventTarget.prototype", () => {
    const properties = Object.getPrototypeOf(Window.prototype);
    expect(Object.prototype.toString.call(properties)).toBe("[object WindowProperties]");
    expect(Object.getPrototypeOf(properties)).toBe(EventTarget.prototype);
    expect(Object.getOwnPropertyNames(properties)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(properties, "Array")).toEqual({
      value: Array,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    expect(() => Object.setPrototypeOf(properties, null)).toThrow(TypeError);
  });

  test("only names are looked up, and only ones that the prototype chain does not have", () => {
    const window = new Window();
    const symbol = Symbol();
    globalThis[symbol] = 1;
    globalThis[7] = 1;
    Object.defineProperty(globalThis, "isPrototypeOf", { configurable: true, value: 1 });
    globalThis.onlyOnTheGlobalObject = 1;
    try {
      expect(window.onlyOnTheGlobalObject).toBe(1);
      expect(window[symbol]).toBeUndefined();
      expect(window[7]).toBeUndefined();
      expect(window.isPrototypeOf).toBe(Object.prototype.isPrototypeOf);
    } finally {
      delete globalThis[symbol];
      delete globalThis[7];
      delete globalThis.isPrototypeOf;
      delete globalThis.onlyOnTheGlobalObject;
    }
  });

  test("hot code sees a name appear, change and go away", () => {
    const window = new Window();
    const read = (object: any) => object.appearsLater;
    for (let i = 0; i < 100_000; i++) if (read(window) !== undefined) throw new Error("it is not there yet");
    try {
      globalThis.appearsLater = 1;
      for (let i = 0; i < 100_000; i++) if (read(window) !== 1) throw new Error("it is 1 now");
      globalThis.appearsLater = 2;
      expect(read(window)).toBe(2);
    } finally {
      delete globalThis.appearsLater;
    }
    expect(read(window)).toBeUndefined();
  });

  test("a write stays on the window", () => {
    const window = new Window();
    const fake = () => {};
    window.setTimeout = fake;
    expect(window.setTimeout).toBe(fake);
    expect(Object.hasOwn(window, "setTimeout")).toBe(true);
    expect(globalThis.setTimeout).not.toBe(fake);
    expect(new Window().setTimeout).toBe(globalThis.setTimeout);
    delete window.setTimeout;
    expect(window.setTimeout).toBe(globalThis.setTimeout);
  });

  test("a getter of the global object gets the global object as `this`", () => {
    Object.defineProperty(globalThis, "whoIsThis", {
      configurable: true,
      get() {
        return this;
      },
    });
    try {
      expect(new Window().whoIsThis).toBe(globalThis);
    } finally {
      delete globalThis.whoIsThis;
    }
  });

  test("`in` does not run a getter of the global object", () => {
    let calls = 0;
    Object.defineProperty(globalThis, "countsReads", { configurable: true, get: () => ++calls });
    try {
      expect("countsReads" in new Window()).toBe(true);
      expect(calls).toBe(0);
    } finally {
      delete globalThis.countsReads;
    }
  });

  test("a getter of the global object that reads the window again finds nothing there", () => {
    // What vitest's populateGlobal() does for every name it knows, also for the ones the window does not have.
    const window = new Window();
    Object.defineProperty(globalThis, "forwardedToTheWindow", {
      configurable: true,
      get: () => window.forwardedToTheWindow,
    });
    Object.defineProperty(globalThis, "readsAnotherName", { configurable: true, get: () => window.Array });
    try {
      expect(window.forwardedToTheWindow).toBeUndefined();
      expect(globalThis.forwardedToTheWindow).toBeUndefined();
      expect(window.readsAnotherName).toBe(Array);
    } finally {
      delete globalThis.forwardedToTheWindow;
      delete globalThis.readsAnotherName;
    }
  });
});

describe("location", () => {
  test("is about:blank unless the window is given a URL", () => {
    const { location, document } = new Window();
    expect(location.href).toBe("about:blank");
    expect(location.origin).toBe("null");
    expect(location.protocol).toBe("about:");
    expect(location.pathname).toBe("blank");
    expect(document.URL).toBe("about:blank");
  });

  test("shows the parts of the URL the window was made with", () => {
    const { location, document } = at("https://user:secret@example.com:8080/a/b?c=d#e");
    expect({ ...location }).toMatchObject({
      href: "https://user:secret@example.com:8080/a/b?c=d#e",
      origin: "https://example.com:8080",
      protocol: "https:",
      host: "example.com:8080",
      hostname: "example.com",
      port: "8080",
      pathname: "/a/b",
      search: "?c=d",
      hash: "#e",
    });
    expect(String(location)).toBe(location.href);
    expect(document.URL).toBe(location.href);
    expect(document.baseURI).toBe(location.href);
  });

  test("a URL that cannot be parsed is a TypeError", () => {
    expect(() => at("not a url")).toThrow(TypeError);
  });

  test("is the document's location too", () => {
    const window = new Window();
    expect(window.location).toBeInstanceOf(window.Location);
    expect(window.document.location).toBe(window.location);
    expect(new DOMParser().parseFromString("", "text/html").location).toBeNull();
  });

  test("is the same object after a collection", () => {
    const window = new Window();
    window.location.mark = 1;
    Bun.gc(true);
    expect(window.location.mark).toBe(1);
  });

  test("keeps its window alive", () => {
    const location = (() => at("https://example.com/a").location)();
    Bun.gc(true);
    expect(location.href).toBe("https://example.com/a");
  });

  test("setting the hash changes the URL at once", () => {
    const { location, document, history } = at("https://example.com/a");
    location.hash = "b";
    expect(location.href).toBe("https://example.com/a#b");
    expect(document.URL).toBe("https://example.com/a#b");
    expect(history.length).toBe(2);
  });

  test("setting the hash fires popstate and then hashchange, as a task", async () => {
    const window = at("https://example.com/a#b");
    const seen: string[] = [];
    window.addEventListener("popstate", event => seen.push(`popstate ${event.state}`));
    const hashchange = once(window, "hashchange");
    window.location.hash = "#c";
    expect(seen).toEqual([]);
    const event = await hashchange;
    expect(event).toBeInstanceOf(window.HashChangeEvent);
    expect([event.oldURL, event.newURL]).toEqual(["https://example.com/a#b", "https://example.com/a#c"]);
    expect(seen).toEqual(["popstate null"]);
  });

  test("setting the hash it already has does nothing", () => {
    const { location, history } = at("https://example.com/a#b");
    location.hash = "#b";
    expect(history.length).toBe(1);
  });

  test("an empty hash leaves the number sign", () => {
    const { location } = at("https://example.com/a#b");
    location.hash = "";
    expect(location.href).toBe("https://example.com/a#");
    expect(location.hash).toBe("");
  });

  test("an empty hash changes nothing when there is no fragment", () => {
    const { location, history } = at("https://example.com/a");
    location.hash = "";
    expect(location.href).toBe("https://example.com/a");
    expect(history.length).toBe(1);
  });

  test("a protocol that is not a scheme is a SyntaxError", () => {
    const { location } = at("https://example.com/a");
    expect(() => (location.protocol = "no scheme")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
  });

  test("its prototype cannot be changed", () => {
    const { location } = new Window();
    expect(() => Object.setPrototypeOf(location, {})).toThrow(TypeError);
  });

  test("works on about:blank", () => {
    const { location } = new Window();
    location.hash = "x";
    expect(location.href).toBe("about:blank#x");
  });

  test("href, assign() and `window.location = ` follow a URL that differs only in the fragment", () => {
    const window = at("https://example.com/a");
    window.location.href = "#b";
    expect(window.location.hash).toBe("#b");
    window.location.assign("https://example.com/a#c");
    expect(window.location.hash).toBe("#c");
    window.location = "#d";
    expect(window.location.hash).toBe("#d");
    window.document.location = "#e";
    expect(window.location.hash).toBe("#e");
    expect(window.history.length).toBe(5);
  });

  test("replace() does not add to the history", () => {
    const { location, history } = at("https://example.com/a");
    location.replace("#b");
    expect(location.hash).toBe("#b");
    expect(history.length).toBe(1);
  });

  test("any other navigation does nothing", () => {
    const { location, history } = at("https://example.com/a?b#c");
    location.href = "/other";
    location.assign("https://elsewhere.example/");
    location.replace("?d");
    location.reload();
    location.protocol = "http:";
    location.host = "elsewhere.example:1";
    location.hostname = "elsewhere.example";
    location.port = "1";
    location.pathname = "/other";
    location.search = "?d";
    expect(location.href).toBe("https://example.com/a?b#c");
    expect(history.length).toBe(1);
  });

  test("a URL that cannot be parsed is a SyntaxError", () => {
    const { location } = at("https://example.com/");
    for (const navigate of [
      () => (location.href = "https://:x"),
      () => location.assign("https://:x"),
      () => location.replace("https://:x"),
    ])
      expect(navigate).toThrow(expect.objectContaining({ name: "SyntaxError" }));
  });

  test("the element the fragment names matches :target", () => {
    const { location, document } = at("https://example.com/");
    document.body.innerHTML = `<p id="a"></p><p id="b c"></p>`;
    expect(document.querySelector(":target")).toBeNull();
    location.hash = "a";
    expect(document.querySelector(":target")).toBe(document.getElementById("a"));
    location.hash = "b%20c";
    expect(document.querySelector(":target")).toBe(document.getElementById("b c"));
    location.hash = "nothing";
    expect(document.querySelector(":target")).toBeNull();
  });

  test("the fragment the window starts with counts when a document has been written", () => {
    const window = at("https://example.com/#a");
    let atLoad: unknown;
    window.document.open();
    window.onload = () => (atLoad = window.document.querySelector(":target"));
    window.document.write(`<p id="a"></p>`);
    window.document.close();
    expect(window.document.querySelector(":target")).toBe(window.document.getElementById("a"));
    expect(atLoad).toBe(window.document.getElementById("a"));
  });

  test("a test can replace its methods, and the whole object", () => {
    const window = at("https://example.com/");
    const calls: string[] = [];
    window.location.assign = (url: string) => calls.push(url);
    window.location.assign("/login");
    expect(calls).toEqual(["/login"]);
    Object.defineProperty(window, "location", { configurable: true, value: { href: "https://fake.example/" } });
    expect(window.location.href).toBe("https://fake.example/");
  });
});

describe("history", () => {
  test("starts with one entry and no state", () => {
    const { history, History } = new Window();
    expect(history).toBeInstanceOf(History);
    expect(history.length).toBe(1);
    expect(history.state).toBeNull();
  });

  test("is the same object after a collection", () => {
    const window = new Window();
    window.history.mark = 1;
    Bun.gc(true);
    expect(window.history.mark).toBe(1);
  });

  test("pushState() adds an entry and changes the URL and the state at once, without an event", () => {
    const window = at("https://example.com/a");
    const seen: string[] = [];
    window.addEventListener("popstate", () => seen.push("popstate"));
    window.history.pushState({ page: 1 }, "", "/b?c#d");
    expect(window.location.href).toBe("https://example.com/b?c#d");
    expect(window.document.URL).toBe("https://example.com/b?c#d");
    expect(window.history.length).toBe(2);
    expect(window.history.state).toEqual({ page: 1 });
    expect(seen).toEqual([]);
  });

  test("replaceState() changes the current entry", () => {
    const { history, location } = at("https://example.com/a");
    history.replaceState("x", "", "b");
    expect(location.href).toBe("https://example.com/b");
    expect(history.length).toBe(1);
    expect(history.state).toBe("x");
  });

  test("without a URL the URL stays", () => {
    const { history, location } = at("https://example.com/a");
    history.pushState(1, "");
    history.pushState(2, "", null);
    history.pushState(3, "", "");
    expect(location.href).toBe("https://example.com/a");
    expect(history.length).toBe(4);
  });

  test("the state is a copy, and the same copy every time it is read", () => {
    const { history } = new Window();
    const state = { list: [1, new Date(0)] };
    history.pushState(state, "");
    expect(history.state).toEqual(state);
    expect(history.state).not.toBe(state);
    expect(history.state).toBe(history.state);
    Bun.gc(true);
    expect(history.state).toEqual(state);
  });

  test("a state that cannot be cloned is a DataCloneError", () => {
    const { history } = new Window();
    expect(() => history.pushState(() => {}, "")).toThrow(expect.objectContaining({ name: "DataCloneError" }));
    expect(history.length).toBe(1);
  });

  test("the URL has to be one the document may take", () => {
    const securityError = expect.objectContaining({ name: "SecurityError" });
    expect(() => at("https://example.com/").history.pushState(null, "", "https://elsewhere.example/")).toThrow(
      securityError,
    );
    expect(() => at("https://example.com/").history.replaceState(null, "", "http://example.com/")).toThrow(
      securityError,
    );
    expect(() => new Window().history.pushState(null, "", "/a")).toThrow(securityError);
    const blank = new Window();
    blank.history.pushState(null, "", "#a");
    expect(blank.location.href).toBe("about:blank#a");
  });

  test("back() fires popstate as a task, with the entry's URL and state in place", async () => {
    const window = at("https://example.com/a");
    window.history.replaceState({ page: "a" }, "");
    window.history.pushState({ page: "b" }, "", "/b");
    const popstate = once(window, "popstate");
    window.history.back();
    expect(window.location.pathname).toBe("/b");
    const event = await popstate;
    expect(event).toBeInstanceOf(window.PopStateEvent);
    expect(event.isTrusted).toBe(true);
    expect(event.state).toEqual({ page: "a" });
    expect(event.state).toBe(window.history.state);
    expect(window.location.pathname).toBe("/a");
    expect(window.history.length).toBe(2);
  });

  test("forward() and go()", async () => {
    const window = at("https://example.com/0");
    for (const page of [1, 2, 3]) window.history.pushState(page, "", `/${page}`);
    const visit = async (move: () => void) => {
      const popstate = once(window, "popstate");
      move();
      return [(await popstate).state, window.location.pathname];
    };
    expect(await visit(() => window.history.go(-3))).toEqual([null, "/0"]);
    expect(await visit(() => window.history.forward())).toEqual([1, "/1"]);
    expect(await visit(() => window.history.go(2))).toEqual([3, "/3"]);
  });

  test("a step past either end is ignored", async () => {
    const window = at("https://example.com/0");
    window.history.pushState(1, "", "/1");
    const states: unknown[] = [];
    window.addEventListener("popstate", event => states.push(event.state));
    const popstate = once(window, "popstate");
    window.history.forward();
    window.history.go(-2);
    window.history.back();
    await popstate;
    expect(states).toEqual([null]);
    expect(window.location.pathname).toBe("/0");
  });

  test("pushState() drops the entries after the current one", async () => {
    const window = at("https://example.com/0");
    window.history.pushState(1, "", "/1");
    window.history.pushState(2, "", "/2");
    const popstate = once(window, "popstate");
    window.history.go(-2);
    await popstate;
    window.history.pushState(3, "", "/3");
    expect(window.history.length).toBe(2);
  });

  test("hashchange follows popstate when the fragment differs", async () => {
    const window = at("https://example.com/a");
    window.history.pushState(null, "", "#b");
    const seen: string[] = [];
    window.addEventListener("popstate", () => seen.push("popstate"));
    const hashchange = once(window, "hashchange");
    window.history.back();
    const event = await hashchange;
    expect([event.oldURL, event.newURL]).toEqual(["https://example.com/a#b", "https://example.com/a"]);
    expect(seen).toEqual(["popstate"]);
  });
});

describe("localStorage and sessionStorage", () => {
  test("a document with an opaque origin has none", () => {
    const window = new Window();
    const securityError = expect.objectContaining({ name: "SecurityError" });
    expect(() => window.localStorage).toThrow(securityError);
    expect(() => window.sessionStorage).toThrow(securityError);
  });

  test("setItem(), getItem(), removeItem(), clear(), length and key()", () => {
    const { localStorage, Storage } = at("https://example.com/");
    expect(localStorage).toBeInstanceOf(Storage);
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem("a")).toBeNull();
    localStorage.setItem("b", "2");
    localStorage.setItem("a", "1");
    localStorage.setItem("b", "3");
    expect(localStorage.length).toBe(2);
    expect([localStorage.key(0), localStorage.key(1), localStorage.key(2)]).toEqual(["b", "a", null]);
    expect(localStorage.getItem("b")).toBe("3");
    localStorage.removeItem("b");
    localStorage.removeItem("never there");
    expect([localStorage.length, localStorage.key(0)]).toEqual([1, "a"]);
    localStorage.clear();
    expect(localStorage.length).toBe(0);
  });

  test("keys and values become strings", () => {
    const { localStorage } = at("https://example.com/");
    localStorage.setItem(1, { toString: () => "object" });
    localStorage.setItem("", null);
    expect(localStorage.getItem("1")).toBe("object");
    expect(localStorage.getItem("")).toBe("null");
  });

  test("an item is a property", () => {
    const { localStorage } = at("https://example.com/");
    localStorage.a = 1;
    localStorage["b c"] = "2";
    expect(localStorage.getItem("a")).toBe("1");
    expect(localStorage.a).toBe("1");
    expect("a" in localStorage).toBe(true);
    expect(Object.keys(localStorage)).toEqual(["a", "b c"]);
    expect({ ...localStorage }).toEqual({ a: "1", "b c": "2" });
    expect(delete localStorage.a).toBe(true);
    expect(localStorage.getItem("a")).toBeNull();
    expect(localStorage.a).toBeUndefined();
  });

  test("an item does not hide a method", () => {
    const { localStorage, Storage } = at("https://example.com/");
    localStorage.setItem("getItem", "x");
    expect(localStorage.getItem).toBe(Storage.prototype.getItem);
    expect(localStorage.getItem("getItem")).toBe("x");
  });

  test("the two areas, and two windows, do not share items", () => {
    const a = at("https://example.com/");
    const b = at("https://example.com/");
    a.localStorage.setItem("x", "1");
    expect(a.sessionStorage.getItem("x")).toBeNull();
    expect(b.localStorage.getItem("x")).toBeNull();
  });

  test("are the same objects after a collection", () => {
    const window = at("https://example.com/");
    // A name would become an item, which is not kept in the wrapper.
    const mark = Symbol();
    window.localStorage[mark] = 1;
    window.sessionStorage[mark] = 2;
    Bun.gc(true);
    expect([window.localStorage[mark], window.sessionStorage[mark]]).toEqual([1, 2]);
  });

  test("more than five million characters is a QuotaExceededError", () => {
    const { localStorage } = at("https://example.com/");
    localStorage.setItem("a", Buffer.alloc(4_999_999, "x").toString());
    expect(() => localStorage.setItem("b", "")).toThrow(expect.objectContaining({ name: "QuotaExceededError" }));
    expect(localStorage.length).toBe(1);
    localStorage.setItem("a", "");
    localStorage.setItem("b", "");
    expect(localStorage.length).toBe(2);
  });
});

describe("StorageEvent", () => {
  test("carries what it is made with", () => {
    const window = at("https://example.com/");
    const event = new window.StorageEvent("storage", {
      key: "a",
      oldValue: null,
      newValue: "1",
      url: "https://example.com/",
      storageArea: window.localStorage,
    });
    expect(event).toBeInstanceOf(Event);
    expect([event.type, event.key, event.oldValue, event.newValue, event.url]).toEqual([
      "storage",
      "a",
      null,
      "1",
      "https://example.com/",
    ]);
    expect(event.storageArea).toBe(window.localStorage);
  });

  test("reaches a listener on the window", () => {
    const window = new Window();
    const keys: string[] = [];
    window.addEventListener("storage", event => keys.push(event.key));
    window.dispatchEvent(new window.StorageEvent("storage", { key: "a" }));
    expect(keys).toEqual(["a"]);
  });

  test("storageArea has to be a Storage", () => {
    const window = new Window();
    expect(new window.StorageEvent("storage", { storageArea: null }).storageArea).toBeNull();
    expect(() => new window.StorageEvent("storage", { storageArea: {} })).toThrow(TypeError);
  });

  test("document.createEvent() makes one", () => {
    const window = new Window();
    expect(window.document.createEvent("StorageEvent")).toBeInstanceOf(window.StorageEvent);
  });
});

describe("the window as a browsing context", () => {
  test("it is its own self, frames, top and parent, and nobody opened or embeds it", () => {
    const window = new Window();
    for (const name of ["window", "self", "frames", "top", "parent"]) expect(window[name]).toBe(window);
    expect(window.opener).toBeNull();
    expect(window.frameElement).toBeNull();
    expect(window.length).toBe(0);
  });

  test("name and status are strings that can be set", () => {
    const window = new Window();
    expect([window.name, window.status]).toEqual(["", ""]);
    window.name = 1;
    window.status = "busy";
    expect([window.name, window.status]).toEqual(["1", "busy"]);
  });

  test("origin and isSecureContext", () => {
    expect(new Window().origin).toBe("null");
    expect(at("https://example.com:8080/a").origin).toBe("https://example.com:8080");
    expect(new Window().isSecureContext).toBe(true);
  });

  test("close() sets closed and takes the listeners away", () => {
    const window = new Window();
    const seen: string[] = [];
    window.addEventListener("x", () => seen.push("window"));
    window.document.addEventListener("x", () => seen.push("document"));
    expect(window.closed).toBe(false);
    window.close();
    expect(window.closed).toBe(true);
    window.document.dispatchEvent(new Event("x", { bubbles: true }));
    expect(seen).toEqual([]);
  });
});

describe("the window as a viewport", () => {
  test("is 1024 by 768 at the top left of a screen of that size, and not scrolled", () => {
    const window = new Window();
    const read = (...names: string[]) => names.map(name => window[name]);
    expect(read("innerWidth", "innerHeight", "outerWidth", "outerHeight")).toEqual([1024, 768, 1024, 768]);
    expect(read("screenX", "screenY", "screenLeft", "screenTop")).toEqual([0, 0, 0, 0]);
    expect(read("scrollX", "scrollY", "pageXOffset", "pageYOffset")).toEqual([0, 0, 0, 0]);
    expect(window.devicePixelRatio).toBe(1);
  });

  test("screen", () => {
    const { screen, Screen } = new Window();
    expect(screen).toBeInstanceOf(Screen);
    expect([screen.width, screen.height, screen.availWidth, screen.availHeight]).toEqual([1024, 768, 1024, 768]);
    expect([screen.colorDepth, screen.pixelDepth]).toEqual([24, 24]);
  });

  test("screen is the same object after a collection", () => {
    const window = new Window();
    Object.defineProperty(window.screen, "width", { configurable: true, value: 320 });
    Bun.gc(true);
    expect(window.screen.width).toBe(320);
  });

  test("a test can set the sizes of one window", () => {
    const window = new Window();
    window.innerWidth = 320;
    window.devicePixelRatio = 2;
    window.scrollY = 100;
    expect([window.innerWidth, window.devicePixelRatio, window.scrollY]).toEqual([320, 2, 100]);
    expect(new Window().innerWidth).toBe(1024);
  });
});

describe("navigator", () => {
  test("each window has its own, and its class is not the runtime's", () => {
    const a = new Window();
    const b = new Window();
    expect(a.navigator).toBe(a.navigator);
    expect(a.navigator).not.toBe(b.navigator);
    expect(a.navigator).not.toBe(navigator);
    expect(a.navigator).toBeInstanceOf(a.Navigator);
    expect(a.Navigator).toBe(b.Navigator);
    expect(a.Navigator).not.toBe(Navigator);
    expect(a.navigator).not.toBeInstanceOf(Navigator);
    expect(String(a.navigator)).toBe("[object Navigator]");
    expect(Reflect.ownKeys(a.navigator)).toEqual([]);
    expect(() => new a.Navigator()).toThrow(TypeError);
    expect(() => a.Navigator.prototype.userAgent).toThrow(TypeError);
  });

  test("says about the machine what the runtime's says", () => {
    const window = new Window();
    for (const name of ["userAgent", "platform", "hardwareConcurrency", "language", "languages"])
      expect([name, window.navigator[name]]).toEqual([name, navigator[name]]);
    expect(window.navigator.languages).toBe(window.navigator.languages);
    expect(Object.isFrozen(window.navigator.languages)).toBe(true);
  });

  test("says about the browser what jsdom's says", () => {
    const { navigator, PluginArray, MimeTypeArray } = new Window();
    const { appCodeName, appName, appVersion, product, productSub, vendor, vendorSub, cookieEnabled, onLine } =
      navigator;
    expect({ appCodeName, appName, appVersion, product, productSub, vendor, vendorSub, cookieEnabled, onLine }).toEqual(
      {
        appCodeName: "Mozilla",
        appName: "Netscape",
        appVersion: "4.0",
        product: "Gecko",
        productSub: "20030107",
        vendor: "Apple Computer, Inc.",
        vendorSub: "",
        cookieEnabled: true,
        onLine: true,
      },
    );
    expect(navigator.javaEnabled()).toBe(false);
    for (const [list, Class] of [
      [navigator.plugins, PluginArray],
      [navigator.mimeTypes, MimeTypeArray],
    ]) {
      expect(list).toBeInstanceOf(Class);
      expect([list.length, list.item(0), list.namedItem("x"), list[0]]).toEqual([0, null, null, undefined]);
      expect(() => new Class()).toThrow(TypeError);
    }
    expect(navigator.plugins).toBe(navigator.plugins);
    expect(navigator.mimeTypes).toBe(navigator.mimeTypes);
    expect(navigator.plugins.refresh()).toBe(undefined);
  });

  test("the members are accessors on the prototype, which a test can replace", () => {
    const window = new Window();
    const { prototype } = window.Navigator;
    for (const name of [
      "userAgent",
      "platform",
      "language",
      "languages",
      "onLine",
      "vendor",
      "cookieEnabled",
      "plugins",
    ])
      expect({ name, ...Object.getOwnPropertyDescriptor(prototype, name) }).toEqual({
        name,
        get: expect.any(Function),
        set: undefined,
        enumerable: true,
        configurable: true,
      });
    const spy = spyOn(prototype, "userAgent", "get").mockReturnValue("a phone");
    expect(window.navigator.userAgent).toBe("a phone");
    expect(new Window().navigator.userAgent).toBe("a phone");
    spy.mockRestore();
    expect(window.navigator.userAgent).toBe(navigator.userAgent);
    Object.defineProperty(window.navigator, "userAgent", { value: "a tablet", configurable: true });
    expect(window.navigator.userAgent).toBe("a tablet");
    expect(new Window().navigator.userAgent).toBe(navigator.userAgent);
    expect(navigator.userAgent).not.toBe("a tablet");
  });

  test("what a test puts on it is there after a collection", () => {
    const window = new Window();
    window.navigator.clipboard = { text: "copied" };
    window.navigator.plugins.mine = 1;
    Bun.gc(true);
    expect(window.navigator.clipboard).toEqual({ text: "copied" });
    expect(window.navigator.plugins.mine).toBe(1);
  });
});

describe("what needs a user or a screen", () => {
  const names = [
    "alert",
    "blur",
    "confirm",
    "focus",
    "moveBy",
    "moveTo",
    "print",
    "prompt",
    "resizeBy",
    "resizeTo",
    "scroll",
    "scrollBy",
    "scrollTo",
    "stop",
  ];

  test("does nothing and returns undefined", () => {
    const window = new Window();
    for (const name of names) expect([name, window[name]("1", "2")]).toEqual([name, undefined]);
  });

  test("works when it is read off the window and called bare", () => {
    const window = new Window();
    for (const name of names) {
      const method = window[name];
      expect(Object.hasOwn(window, name)).toBe(true);
      expect([name, method()]).toEqual([name, undefined]);
    }
  });
});

describe("elements by name", () => {
  test("an element is a property of the window under its id or name", () => {
    const window = new Window();
    window.document.body.innerHTML = `<div id="host"></div><form name="login"></form>`;
    expect(window.host).toBe(window.document.getElementById("host"));
    expect(window.login).toBe(window.document.forms[0]);
    expect("host" in window).toBe(true);
    expect(Object.hasOwn(window, "host")).toBe(false);
    window.host.remove();
    expect(window.host).toBeUndefined();
    expect("host" in window).toBe(false);
  });

  test("several elements with one name are a collection", () => {
    const window = new Window();
    window.document.body.innerHTML = `<div id="twice"></div><p id="twice"></p>`;
    expect(window.twice).toBeInstanceOf(window.HTMLCollection);
    expect([...window.twice].map(element => element.localName)).toEqual(["div", "p"]);
  });

  test("belongs to one window, and does not hide anything", () => {
    const window = new Window();
    window.document.body.innerHTML = `<div id="host"></div><div id="document"></div><div id="Array"></div><div id="toString"></div>`;
    expect(window.host.id).toBe("host");
    expect(new Window().host).toBeUndefined();
    expect(window.document).toBeInstanceOf(window.Document);
    expect(window.Array).toBe(Array);
    expect(window.toString).toBe(Object.prototype.toString);
  });
});

describe("a click on a link", () => {
  const linkIn = (window: any, html: string) => {
    window.document.body.innerHTML = html;
    return window.document.body.firstChild;
  };

  test("to a fragment of the document changes the hash", async () => {
    const window = at("https://example.com/a");
    const hashchange = once(window, "hashchange");
    linkIn(window, `<a href="#b">b</a>`).click();
    expect(window.location.href).toBe("https://example.com/a#b");
    expect((await hashchange).newURL).toBe("https://example.com/a#b");
  });

  test.each(["_self", "_parent", "_TOP"])("a target of %s is this window", target => {
    const window = at("https://example.com/a");
    linkIn(window, `<a href="#b" target="${target}">b</a>`).click();
    expect(window.location.href).toBe("https://example.com/a#b");
  });

  test("does nothing when the event is cancelled, the link opens another window or leads elsewhere", () => {
    const window = at("https://example.com/a");
    linkIn(window, `<a href="#start">start</a>`).click();
    const cancelled = linkIn(window, `<a href="#b">b</a>`);
    cancelled.addEventListener("click", (event: Event) => event.preventDefault());
    cancelled.click();
    linkIn(window, `<a href="#b" target="_blank">b</a>`).click();
    linkIn(window, `<a href="/other">b</a>`).click();
    expect(window.location.href).toBe("https://example.com/a#start");
  });
});

describe("getSelection()", () => {
  const page = () => {
    const window = new Window();
    window.document.body.innerHTML = `<p id="a">one</p><p id="b">two</p><p id="c">three</p>`;
    const text = (id: string) => window.document.getElementById(id).firstChild;
    return { window, document: window.document, selection: window.getSelection(), text };
  };
  const named = (name: string) => expect.objectContaining({ name });

  test("is one object for the window and its document", () => {
    const window = new Window();
    expect(window.getSelection()).toBeInstanceOf(window.Selection);
    expect(window.document.getSelection()).toBe(window.getSelection());
    expect(new DOMParser().parseFromString("", "text/html").getSelection()).toBeNull();
  });

  test("is the same object after a collection", () => {
    const window = new Window();
    window.getSelection().mark = 1;
    Bun.gc(true);
    expect(window.getSelection().mark).toBe(1);
  });

  test("starts empty", () => {
    const { selection } = page();
    expect([selection.rangeCount, selection.type, selection.isCollapsed, String(selection)]).toEqual([
      0,
      "None",
      true,
      "",
    ]);
    expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([
      null,
      0,
      null,
      0,
    ]);
    expect(() => selection.getRangeAt(0)).toThrow(named("IndexSizeError"));
  });

  test("collapse() puts a caret somewhere", () => {
    const { selection, text } = page();
    selection.collapse(text("a"), 2);
    expect([selection.rangeCount, selection.type, selection.isCollapsed]).toEqual([1, "Caret", true]);
    expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([
      text("a"),
      2,
      text("a"),
      2,
    ]);
    selection.setPosition(text("b"));
    expect([selection.anchorNode, selection.anchorOffset]).toEqual([text("b"), 0]);
    selection.collapse(null);
    expect(selection.rangeCount).toBe(0);
  });

  test("setBaseAndExtent() selects forwards", () => {
    const { selection, text } = page();
    selection.setBaseAndExtent(text("a"), 1, text("b"), 2);
    expect([selection.type, String(selection)]).toEqual(["Range", "netw"]);
    expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([
      text("a"),
      1,
      text("b"),
      2,
    ]);
  });

  test("setBaseAndExtent() selects backwards", () => {
    const { selection, text } = page();
    selection.setBaseAndExtent(text("b"), 2, text("a"), 1);
    expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([
      text("b"),
      2,
      text("a"),
      1,
    ]);
    const range = selection.getRangeAt(0);
    expect([range.startContainer, range.startOffset, range.endContainer, range.endOffset]).toEqual([
      text("a"),
      1,
      text("b"),
      2,
    ]);
  });

  test("direction", () => {
    const { selection, text } = page();
    expect(selection.direction).toBe("none");
    selection.setBaseAndExtent(text("a"), 1, text("b"), 2);
    expect(selection.direction).toBe("forward");
    selection.setBaseAndExtent(text("b"), 2, text("a"), 1);
    expect(selection.direction).toBe("backward");
    selection.collapseToStart();
    expect(selection.direction).toBe("none");
  });

  test("addRange() takes the range itself, and only the first one", () => {
    const { selection, document, text } = page();
    const range = document.createRange();
    range.selectNodeContents(text("a"));
    selection.addRange(range);
    expect(selection.getRangeAt(0)).toBe(range);
    range.setEnd(text("b"), 1);
    expect(String(selection)).toBe("onet");
    selection.addRange(document.createRange());
    expect(selection.getRangeAt(0)).toBe(range);
  });

  test("removeRange(), removeAllRanges() and empty()", () => {
    const { selection, document, text } = page();
    selection.collapse(text("a"));
    expect(() => selection.removeRange(document.createRange())).toThrow(named("NotFoundError"));
    selection.removeRange(selection.getRangeAt(0));
    expect(selection.rangeCount).toBe(0);
    selection.collapse(text("a"));
    selection.removeAllRanges();
    expect(selection.rangeCount).toBe(0);
    selection.collapse(text("a"));
    selection.empty();
    expect(selection.rangeCount).toBe(0);
  });

  test("extend() moves the focus and keeps the anchor", () => {
    const { selection, text } = page();
    expect(() => selection.extend(text("a"), 0)).toThrow(named("InvalidStateError"));
    selection.collapse(text("b"), 1);
    selection.extend(text("c"), 2);
    expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([
      text("b"),
      1,
      text("c"),
      2,
    ]);
    selection.extend(text("a"), 1);
    expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([
      text("b"),
      1,
      text("a"),
      1,
    ]);
    expect(String(selection)).toBe("net");
  });

  test("selectAllChildren(), collapseToStart() and collapseToEnd()", () => {
    const { selection, document } = page();
    expect(() => selection.collapseToStart()).toThrow(named("InvalidStateError"));
    expect(() => selection.collapseToEnd()).toThrow(named("InvalidStateError"));
    selection.selectAllChildren(document.body);
    expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([
      document.body,
      0,
      document.body,
      3,
    ]);
    selection.collapseToEnd();
    expect([selection.anchorNode, selection.anchorOffset, selection.isCollapsed]).toEqual([document.body, 3, true]);
    selection.selectAllChildren(document.body);
    selection.collapseToStart();
    expect([selection.anchorNode, selection.anchorOffset, selection.isCollapsed]).toEqual([document.body, 0, true]);
  });

  test("deleteFromDocument()", () => {
    const { selection, document, text } = page();
    selection.setBaseAndExtent(text("a"), 1, text("c"), 2);
    selection.deleteFromDocument();
    expect(document.body.innerHTML).toBe(`<p id="a">o</p><p id="c">ree</p>`);
    expect(selection.isCollapsed).toBe(true);
  });

  test("containsNode()", () => {
    const { selection, document, text } = page();
    selection.setBaseAndExtent(text("a"), 1, text("c"), 1);
    const [a, b] = document.body.children;
    expect([selection.containsNode(b), selection.containsNode(a), selection.containsNode(a, true)]).toEqual([
      true,
      false,
      true,
    ]);
    expect(selection.containsNode(document.createElement("p"), true)).toBe(false);
  });

  test("follows the tree when it changes", () => {
    const { selection, document, text } = page();
    selection.setBaseAndExtent(text("b"), 1, text("b"), 2);
    document.getElementById("b").remove();
    expect([selection.anchorNode, selection.anchorOffset, selection.isCollapsed]).toEqual([document.body, 1, true]);
  });

  test("refuses offsets past the end and doctypes", () => {
    const { selection, document, text } = page();
    expect(() => selection.collapse(text("a"), 4)).toThrow(named("IndexSizeError"));
    expect(() => selection.setBaseAndExtent(text("a"), 4, text("a"), 0)).toThrow(named("IndexSizeError"));
    expect(() => selection.collapse(document.doctype)).toThrow(named("InvalidNodeTypeError"));
    expect(() => selection.selectAllChildren(document.doctype)).toThrow(named("InvalidNodeTypeError"));
  });

  test("ignores nodes that are not in its document", () => {
    const { selection, document } = page();
    const loose = document.createElement("p");
    const range = document.createRange();
    range.selectNodeContents(loose);
    selection.collapse(loose);
    selection.selectAllChildren(loose);
    selection.setBaseAndExtent(loose, 0, document.body, 0);
    selection.addRange(range);
    expect(selection.rangeCount).toBe(0);
  });

  test("the document hears one selectionchange, as a task, for the changes of one turn", async () => {
    const { selection, document, text } = page();
    let count = 0;
    document.addEventListener("selectionchange", () => count++);
    const first = once(document, "selectionchange");
    selection.collapse(text("a"));
    selection.collapse(text("b"));
    expect(count).toBe(0);
    await first;
    const second = once(document, "selectionchange");
    selection.collapse(text("b"));
    selection.removeAllRanges();
    await second;
    expect(count).toBe(2);
  });
});

// Measured in Chrome 143. jsdom has no named properties on any document.
describe("an element's name as a property of the document", () => {
  const html = `<img name="getElementById"><img name="body"><img name="plain"><form name="aForm"></form>`;
  const names = ["getElementById", "body", "plain", "aForm"];
  const classes = (document: any) => names.map(name => Object.prototype.toString.call(document[name]).slice(8, -1));

  test("with a window", () => {
    const { document } = new Window();
    const frame = document.body.appendChild(document.createElement("iframe")).contentDocument;
    for (const withWindow of [document, frame]) {
      withWindow.body.innerHTML = html;
      expect(classes(withWindow)).toEqual([
        "HTMLImageElement",
        "HTMLImageElement",
        "HTMLImageElement",
        "HTMLFormElement",
      ]);
      expect("plain" in withWindow).toBe(true);
      expect(Object.getOwnPropertyNames(withWindow)).toEqual(expect.arrayContaining(names));
    }
  });

  test("without a window", () => {
    const made = new Window().document.implementation.createHTMLDocument();
    made.body.innerHTML = html;
    for (const withoutWindow of [new DOMParser().parseFromString(html, "text/html"), made]) {
      expect(withoutWindow.defaultView).toBeNull();
      expect(classes(withoutWindow)).toEqual(["Function", "HTMLBodyElement", "Undefined", "Undefined"]);
      expect("plain" in withoutWindow).toBe(false);
      expect(Object.getOwnPropertyNames(withoutWindow)).not.toContain("plain");
      for (const name of names) {
        Object.defineProperty(withoutWindow, name, { value: 1, configurable: true });
        expect(withoutWindow[name]).toBe(1);
      }
    }
  });
});

// As in Chrome 143. jsdom does it for one level of frames, and only if the document above has no focus of its own.
test("with the focus inside a frame, the frame is the active element of the documents above", () => {
  const { document } = new Window();
  const add = (parent: any, name: string) => parent.appendChild(parent.ownerDocument.createElement(name));
  const button = add(document.body, "button");
  const outer = add(document.body, "iframe");
  const inner = add(outer.contentDocument.body, "iframe");
  const input = add(inner.contentDocument.body, "input");
  const seen: string[] = [];
  for (const type of ["blur", "focusout"]) button.addEventListener(type, () => seen.push(type));

  button.focus();
  expect(document.activeElement).toBe(button);
  input.focus();
  expect(seen).toEqual(["blur", "focusout"]);
  expect(inner.contentDocument.activeElement).toBe(input);
  expect(outer.contentDocument.activeElement).toBe(inner);
  expect(document.activeElement).toBe(outer);

  button.focus();
  expect(document.activeElement).toBe(button);
  expect(outer.contentDocument.activeElement).toBe(outer.contentDocument.body);
  expect(inner.contentDocument.activeElement).toBe(inner.contentDocument.body);
  input.focus();
  expect(document.activeElement).toBe(outer);
  outer.remove();
  expect(document.activeElement).toBe(document.body);
});

test("spyOn() wraps a function that a window has from the runtime", () => {
  for (const window of [new Window(), frameWindow()]) {
    const spy = spyOn(window, "setTimeout").mockImplementation(() => 7);
    try {
      expect(Object.hasOwn(window, "setTimeout")).toBe(true);
      expect(window.setTimeout(() => {}, 1)).toBe(7);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(setTimeout).not.toBe(spy);
    } finally {
      spy.mockRestore();
    }
    expect(Object.hasOwn(window, "setTimeout")).toBe(false);
    expect(window.setTimeout).toBe(setTimeout);
  }

  function frameWindow() {
    const { document } = new Window();
    return document.body.appendChild(document.createElement("iframe")).contentDocument.defaultView;
  }
});

describe("requestAnimationFrame()", () => {
  test("calls back with the time performance.now() shows", async () => {
    const window = new Window();
    const before = performance.now();
    const time = await new Promise<number>(resolve => window.requestAnimationFrame(resolve));
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(performance.now());
  });

  // The pace of 60 a second was kept by performance.now(). With the last frame an hour ahead of it, the next one came an hour later.
  test("does not go by the clock that fake timers move", async () => {
    const window = new Window();
    const frame = () => new Promise<number>(resolve => window.requestAnimationFrame(resolve));
    jest.useFakeTimers({ toFake: ["performance"] });
    try {
      jest.advanceTimersByTime(3_600_000);
      expect(await frame()).toBe(performance.now());
    } finally {
      jest.useRealTimers();
    }
    expect(await frame()).toBeLessThan(3_600_000);
  });

  test("the callbacks of a frame run in order and get the same time", async () => {
    const window = new Window();
    const seen: [string, number][] = [];
    const first = window.requestAnimationFrame((time: number) => seen.push(["first", time]));
    const second = window.requestAnimationFrame((time: number) => seen.push(["second", time]));
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first + 1);
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    expect(seen.map(([name]) => name)).toEqual(["first", "second"]);
    expect(seen[0][1]).toBe(seen[1][1]);
  });

  test("cancelAnimationFrame() takes a callback out, also from a callback of the same frame", async () => {
    const window = new Window();
    const seen: string[] = [];
    window.cancelAnimationFrame(window.requestAnimationFrame(() => seen.push("cancelled at once")));
    window.requestAnimationFrame(() => window.cancelAnimationFrame(later));
    const later = window.requestAnimationFrame(() => seen.push("cancelled in the frame"));
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    expect(seen).toEqual([]);
  });

  test("a request from a callback is for the next frame", async () => {
    const window = new Window();
    const [first, second] = await new Promise<number[]>(resolve =>
      window.requestAnimationFrame((first: number) =>
        window.requestAnimationFrame((second: number) => resolve([first, second])),
      ),
    );
    expect(second).toBeGreaterThan(first);
  });

  test("the first frame after a pause comes before a timer of 0 ms that is set after it", async () => {
    const window = new Window();
    const seen: string[] = [];
    window.requestAnimationFrame(() => seen.push("frame"));
    await new Promise<void>(resolve =>
      setTimeout(() => {
        seen.push("timer");
        resolve();
      }, 0),
    );
    expect(seen).toEqual(["frame", "timer"]);
  });

  test("there are at most 60 frames a second", async () => {
    const window = new Window();
    const times: number[] = [];
    await new Promise<void>(resolve => {
      const frame = (time: number) => (times.push(time) < 4 ? window.requestAnimationFrame(frame) : resolve());
      window.requestAnimationFrame(frame);
    });
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(15);
  });

  test("works when it is called bare", async () => {
    const { requestAnimationFrame, cancelAnimationFrame } = new Window();
    cancelAnimationFrame(requestAnimationFrame(() => {}));
    expect(await new Promise(requestAnimationFrame)).toBeNumber();
  });

  test("wants a function", () => {
    expect(() => new Window().requestAnimationFrame(1)).toThrow("must be a function");
  });

  test("close() drops what is pending", async () => {
    const closed = new Window();
    let ran = false;
    closed.requestAnimationFrame(() => (ran = true));
    closed.close();
    expect(closed.requestAnimationFrame(() => (ran = true))).toBe(0);
    const open = new Window();
    await new Promise(resolve => open.requestAnimationFrame(resolve));
    expect(ran).toBe(false);
  });

  test("an exception from a callback fires error at the window, and the next callback runs", async () => {
    const window = new Window();
    const error = new Error("x");
    const seen: unknown[] = [];
    window.addEventListener("error", (event: ErrorEvent) => {
      seen.push(event.error);
      event.preventDefault();
    });
    window.requestAnimationFrame(() => {
      throw error;
    });
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    expect(seen).toEqual([error]);
  });

  test("stays on the real clock under the fake timers of bun:test, like a window of jsdom", async () => {
    const window = new Window();
    const times: number[] = [];
    jest.useFakeTimers();
    try {
      window.requestAnimationFrame((time: number) => times.push(time));
      jest.advanceTimersByTime(1000);
      expect(times).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    expect(times).toEqual([expect.any(Number)]);
  });
});

describe("postMessage()", () => {
  test("fires a message event at the window, as a task", async () => {
    const window = at("https://example.com/a");
    const message = once(window, "message");
    const data = { list: [1, 2] };
    let seen = false;
    window.addEventListener("message", () => (seen = true));
    window.postMessage(data, "*");
    expect(seen).toBe(false);
    const event = await message;
    expect(event).toBeInstanceOf(MessageEvent);
    expect(event.data).toEqual(data);
    expect(event.data).not.toBe(data);
    expect(event.origin).toBe("https://example.com");
    expect(event.source).toBe(window);
    expect(event.isTrusted).toBe(true);
  });

  test("delivers to its own origin only", async () => {
    const window = at("https://example.com/a");
    const seen: string[] = [];
    window.addEventListener("message", (event: MessageEvent) => seen.push(event.data));
    window.postMessage("elsewhere", "https://elsewhere.example");
    window.postMessage("other port", { targetOrigin: "https://example.com:8080" });
    window.postMessage("no origin given");
    window.postMessage("slash", "/");
    window.postMessage("same origin", "https://example.com/any/path");
    window.postMessage("in the options", { targetOrigin: "https://example.com" });
    const last = new Promise<void>(resolve =>
      window.addEventListener("message", (event: MessageEvent) => event.data === "star" && resolve()),
    );
    window.postMessage("star", "*");
    await last;
    expect(seen).toEqual(["no origin given", "slash", "same origin", "in the options", "star"]);
  });

  test("a handler that posts again does not keep a timer waiting", async () => {
    const window = new Window();
    const budget = 100_000;
    let messages = 0;
    let timerFired = false;
    setTimeout(() => (timerFired = true), 0);
    await new Promise<void>(resolve => {
      window.onmessage = () => {
        if (timerFired || ++messages === budget) return resolve();
        window.postMessage(1, "*");
      };
      window.postMessage(1, "*");
    });
    expect(messages).toBeLessThan(budget);
  });

  test("an origin that cannot be parsed is a SyntaxError, a message that cannot be cloned a DataCloneError", () => {
    const window = new Window();
    expect(() => window.postMessage(1, "nowhere")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
    expect(() => window.postMessage(() => {}, "*")).toThrow(expect.objectContaining({ name: "DataCloneError" }));
  });

  test("transfers buffers and ports", async () => {
    const window = new Window();
    const buffer = new ArrayBuffer(8);
    const { port1, port2 } = new MessageChannel();
    const message = once(window, "message");
    window.postMessage({ buffer }, "*", [buffer, port2]);
    expect(buffer.byteLength).toBe(0);
    const event = await message;
    expect(event.data.buffer.byteLength).toBe(8);
    expect(event.ports).toHaveLength(1);
    expect(event.ports[0]).toBeInstanceOf(MessagePort);
    port1.close();
    event.ports[0].close();
  });

  test("a MessageEvent can be made with a window as its source", () => {
    const window = new Window();
    expect(new MessageEvent("message", { source: window }).source).toBe(window);
  });
});

describe("a window with a task in the queue", () => {
  // Tasks run in the order they were queued, so when this one has run, the ones before it have too.
  const laterTask = () => {
    const window = new Window();
    return new Promise(resolve => {
      window.onmessage = resolve;
      window.postMessage(1, "*");
    });
  };
  const windows = () => {
    Bun.gc(true);
    return heapStats().objectTypeCounts.Window ?? 0;
  };

  test("hears its message when nothing else holds it", async () => {
    let heard: unknown;
    (() => {
      const window = new Window();
      window.onmessage = (event: MessageEvent) => (heard = event.data);
      window.postMessage("x", "*");
    })();
    Bun.gc(true);
    await laterTask();
    expect(heard).toBe("x");
  });

  test("hears hashchange when nothing else holds it", async () => {
    let heard: unknown;
    (() => {
      const window = at("https://example.com/");
      window.addEventListener("hashchange", (event: HashChangeEvent) => (heard = event.newURL));
      window.location.hash = "x";
    })();
    Bun.gc(true);
    await laterTask();
    expect(heard).toBe("https://example.com/#x");
  });

  test("keeps the listeners of its nodes too", async () => {
    let heard = false;
    (() => {
      const { document, getSelection } = new Window();
      document.addEventListener("selectionchange", () => (heard = true));
      getSelection().collapse(document.body);
    })();
    Bun.gc(true);
    await laterTask();
    expect(heard).toBe(true);
  });

  test("is collected once the task has run", async () => {
    const before = windows();
    (() => {
      for (let i = 0; i < 100; i++) {
        const window = new Window();
        window.onmessage = () => window;
        window.postMessage(1, "*");
      }
    })();
    expect(windows() - before).toBeGreaterThanOrEqual(100);
    await laterTask();
    expect(windows() - before).toBeLessThan(10);
  });

  test("is let go by close()", () => {
    const before = windows();
    (() => {
      for (let i = 0; i < 100; i++) {
        const window = new Window();
        window.postMessage(1, "*");
        window.close();
      }
    })();
    expect(windows() - before).toBeLessThan(10);
  });
});

describe("window.event", () => {
  test("is the event whose listener is running, and undefined otherwise", () => {
    const window = new Window();
    const seen: unknown[] = [];
    const outer = new Event("outer", { bubbles: true });
    const inner = new Event("inner");
    expect("event" in window).toBe(true);
    expect(window.event).toBeUndefined();
    window.addEventListener("inner", () => seen.push(window.event));
    window.document.body.addEventListener("outer", () => {
      seen.push(window.event);
      window.dispatchEvent(inner);
      seen.push(window.event);
    });
    window.document.body.dispatchEvent(outer);
    expect(seen).toEqual([outer, inner, outer]);
    expect(seen[0]).toBe(outer);
    expect(window.event).toBeUndefined();
  });

  test("is set before the handleEvent of a listener object is looked up", () => {
    const window = new Window();
    const event = new Event("x");
    let seen: unknown;
    window.addEventListener("x", {
      get handleEvent() {
        seen = window.event;
        return () => {};
      },
    });
    window.dispatchEvent(event);
    expect(seen).toBe(event);
  });

  test("is the ErrorEvent inside window.onerror", () => {
    const window = new Window();
    const event = new ErrorEvent("error");
    let seen: unknown[] = [];
    window.onerror = function (this: unknown) {
      seen = [window.event, this];
    };
    window.dispatchEvent(event);
    expect(seen[0]).toBe(event);
    expect(seen[1]).toBe(window);
  });

  test("is not set for a listener in a shadow tree", () => {
    const window = new Window();
    const root = window.document.body.attachShadow({ mode: "open" });
    const inside = root.appendChild(window.document.createElement("p"));
    const seen: unknown[] = [];
    const event = new Event("x", { bubbles: true, composed: true });
    inside.addEventListener("x", () => seen.push(window.event));
    window.document.body.addEventListener("x", () => seen.push(window.event));
    inside.dispatchEvent(event);
    expect(seen).toEqual([undefined, event]);
  });

  test("belongs to the window of the target", () => {
    const a = new Window();
    const b = new Window();
    let seen: unknown[] = [];
    a.addEventListener("x", () => (seen = [a.event?.type, b.event]));
    a.dispatchEvent(new Event("x"));
    expect(seen).toEqual(["x", undefined]);
  });
});

describe("event handlers", () => {
  test("every handler of GlobalEventHandlers and WindowEventHandlers is null until it is set", () => {
    const window = new Window();
    for (const name of [
      "onabort onblur onchange onclick onclose oncontextmenu ondblclick ondrop onerror onfocus oninput onkeydown onkeyup onload",
      "onmousedown onmouseenter onmouseleave onmousemove onmouseup onpaste onreset onresize onscroll onselect onsubmit onwheel",
      "onpointerdown onpointermove onpointerup onanimationend ontransitionend onselectionchange onwebkitanimationend",
      "onafterprint onbeforeprint onbeforeunload onhashchange onlanguagechange onmessage onmessageerror onoffline ononline",
      "onpagehide onpageshow onpopstate onrejectionhandled onstorage onunhandledrejection onunload",
    ]
      .join(" ")
      .split(" "))
      expect([name, window[name]]).toEqual([name, null]);
  });

  test("a handler hears its event, with the window as `this`", () => {
    const window = new Window();
    const seen: unknown[] = [];
    const handler = function (this: unknown, event: Event) {
      seen.push(this, event.type);
    };
    window.onresize = handler;
    expect(window.onresize).toBe(handler);
    window.dispatchEvent(new Event("resize"));
    expect(seen).toEqual([window, "resize"]);
  });

  test("setting another one replaces it, and anything that is not an object removes it", () => {
    const window = new Window();
    const seen: string[] = [];
    window.onload = () => seen.push("first");
    window.onload = () => seen.push("second");
    window.dispatchEvent(new Event("load"));
    window.onload = 1;
    expect(window.onload).toBeNull();
    window.dispatchEvent(new Event("load"));
    expect(seen).toEqual(["second"]);
  });

  test("survives a collection", () => {
    const window = new Window();
    let calls = 0;
    window.onload = () => calls++;
    Bun.gc(true);
    window.dispatchEvent(new Event("load"));
    expect(calls).toBe(1);
  });

  test("returning false cancels the event", () => {
    const window = new Window();
    window.onclick = () => false;
    expect(window.dispatchEvent(new Event("click", { cancelable: true }))).toBe(false);
  });

  test("onerror gets the five parts of an ErrorEvent, and cancels it by returning true", () => {
    const window = new Window();
    let seen: unknown[] = [];
    const error = new Error("x");
    window.onerror = (...parts: unknown[]) => {
      seen = parts;
      return true;
    };
    const event = new ErrorEvent("error", {
      message: "x",
      filename: "a.js",
      lineno: 1,
      colno: 2,
      error,
      cancelable: true,
    });
    expect(window.dispatchEvent(event)).toBe(false);
    expect(seen).toEqual(["x", "a.js", 1, 2, error]);
  });

  test("onpopstate, onhashchange and onmessage hear what the window fires itself", async () => {
    const window = at("https://example.com/");
    const seen: string[] = [];
    window.onpopstate = window.onhashchange = (event: Event) => seen.push(event.type);
    const message = new Promise(resolve => (window.onmessage = resolve));
    window.location.hash = "a";
    window.postMessage(1, "*");
    await message;
    expect(seen).toEqual(["popstate", "hashchange"]);
  });

  test("the body's onload, onresize and the like are the window's", () => {
    const window = new Window();
    const handler = () => {};
    window.document.body.onresize = handler;
    expect(window.onresize).toBe(handler);
    window.onload = handler;
    expect(window.document.body.onload).toBe(handler);
  });
});

describe("a global object that stands for a window", () => {
  test.concurrent("is accepted where a Window is expected", async () => {
    const script = `
      import { Window } from "bun:dom";
      import { setGlobalObjectWindow } from "bun:internal-for-testing";
      const window = new Window();
      const attempt = () => { try { return new window.MouseEvent("click", { view: globalThis }).view === window; } catch (error) { return error.name; } };
      const results = [attempt()];
      setGlobalObjectWindow(window);
      results.push(attempt(), new MessageEvent("message", { source: globalThis }).source === window);
      Bun.gc(true);
      results.push(attempt());
      window.document.body.innerHTML = "<p id=named></p>";
      results.push(Window.prototype.named === window.named);
      const other = new Window();
      other.postMessage(1, "*");
      results.push((await new Promise(resolve => (other.onmessage = resolve))).source === window);
      setGlobalObjectWindow(null);
      results.push(attempt(), Window.prototype.named);
      console.log(JSON.stringify(results));
    `;
    await using process = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      process.stdout.text(),
      process.stderr.text(),
      process.exited,
    ]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["TypeError", true, true, true, true, true, "TypeError", null]);
    expect(exitCode).toBe(0);
  });

  // Tests written for jsdom pass a plain object, a mock or a function where a page would have another window.
  test.concurrent("lets a MessageEvent have any object as its source", async () => {
    const script = `
      import { Window } from "bun:dom";
      import { setGlobalObjectWindow } from "bun:internal-for-testing";
      const constructed = source => new MessageEvent("message", { source });
      const initialized = source => {
        const event = new MessageEvent("x", { source: port1 });
        event.initMessageEvent("message", false, false, "data", "", "", source);
        return event;
      };
      const attempt = (make, source, expected = source) => { try { return make(source).source === expected; } catch (error) { return error.name; } };
      const { port1 } = new MessageChannel();
      const window = new Window();
      const results = { before: [attempt(constructed, {}), attempt(initialized, {})] };
      setGlobalObjectWindow(window);
      for (const make of [constructed, initialized]) {
        results[make.name] = {
          objects: [{}, () => {}, class {}, [], new EventTarget(), new Window().document, port1, window].map(source => attempt(make, source)),
          globalThis: attempt(make, globalThis, window),
          missing: [null, undefined].map(source => attempt(make, source, null)),
          primitives: [1, "x", true, 1n, Symbol()].map(source => attempt(make, source)),
        };
        const events = Array.from({ length: 100 }, (_, i) => make({ i }));
        Bun.gc(true);
        results[make.name].afterCollection = events.every((event, i) => event.source.i === i);
      }
      setGlobalObjectWindow(null);
      results.after = [attempt(constructed, {}), attempt(initialized, {})];
      port1.close();
      console.log(JSON.stringify(results));
    `;
    await using process = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      process.stdout.text(),
      process.stderr.text(),
      process.exited,
    ]);
    expect(stderr).toBe("");
    const expected = {
      objects: [true, true, true, true, true, true, true, true],
      globalThis: true,
      missing: [true, true],
      primitives: ["TypeError", "TypeError", "TypeError", "TypeError", "TypeError"],
      afterCollection: true,
    };
    expect(JSON.parse(stdout)).toEqual({
      before: ["TypeError", "TypeError"],
      constructed: expected,
      initialized: expected,
      after: ["TypeError", "TypeError"],
    });
    expect(exitCode).toBe(0);
  });
});

describe("reportError()", () => {
  test("fires a cancelable error event at the window, whatever the value", () => {
    const window = new Window();
    const seen: ErrorEvent[] = [];
    window.addEventListener("error", (event: ErrorEvent) => {
      seen.push(event);
      event.preventDefault();
    });
    const values = [new Error("x"), "text", 1, null, undefined, { message: 2 }];
    for (const value of values) window.reportError(value);
    expect(seen).toHaveLength(values.length);
    for (let i = 0; i < values.length; i++) expect(seen[i].error).toBe(values[i]);
    expect(seen[0]).toBeInstanceOf(ErrorEvent);
    expect(seen[0].target).toBe(window);
    expect(seen[0].cancelable).toBe(true);
    expect(seen[0].message).toBe("Error: x");
  });

  test("goes to console.error() when nobody cancels the event", () => {
    const window = new Window();
    const error = new Error("x");
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      window.reportError(error);
      expect(consoleError.mock.calls).toEqual([[error]]);
      expect(consoleError.mock.calls[0][0]).toBe(error);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("needs an argument", () => {
    expect(() => new Window().reportError()).toThrow(TypeError);
  });
});

describe("an exception from a listener", () => {
  test("fires a cancelable error event at the window of the target", () => {
    const window = new Window();
    const error = new Error("x");
    const seen: any[] = [];
    window.addEventListener("error", (event: ErrorEvent) => {
      seen.push(event);
      event.preventDefault();
    });
    window.document.body.addEventListener("click", () => {
      throw error;
    });
    window.document.body.addEventListener("click", () => seen.push("the next listener"));
    window.document.body.click();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(ErrorEvent);
    expect(seen[0].error).toBe(error);
    expect(seen[0].message).toBe("Error: x");
    expect(seen[0].filename).toEndWith("window.test.ts");
    expect(seen[0].lineno).toBeGreaterThan(0);
    expect(seen[1]).toBe("the next listener");
  });

  test("goes to console.error() when nobody cancels the event, and no further", () => {
    const window = new Window();
    const error = new Error("x");
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      window.addEventListener("x", () => {
        throw error;
      });
      window.dispatchEvent(new Event("x"));
      expect(consoleError.mock.calls).toEqual([[error]]);
      expect(consoleError.mock.calls[0][0]).toBe(error);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("from an error listener goes to console.error() and does not fire error again", () => {
    const window = new Window();
    const first = new Error("first");
    const second = new Error("second");
    let events = 0;
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      window.addEventListener("error", () => {
        events++;
        throw second;
      });
      window.addEventListener("x", () => {
        throw first;
      });
      window.dispatchEvent(new Event("x"));
      expect(events).toBe(1);
      expect(consoleError.mock.calls.map(([error]) => error.message)).toEqual(["second", "first"]);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("from window.onerror itself goes to console.error()", () => {
    const window = new Window();
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      let calls = 0;
      window.onerror = () => {
        calls++;
        throw new Error("second");
      };
      window.addEventListener("x", () => {
        throw new Error("first");
      });
      window.dispatchEvent(new Event("x"));
      expect(calls).toBe(1);
      expect(consoleError.mock.calls.map(([error]) => error.message)).toEqual(["second", "first"]);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("so does a listener object without a handleEvent function", () => {
    const window = new Window();
    let error: unknown;
    window.addEventListener("error", (event: ErrorEvent) => {
      error = event.error;
      event.preventDefault();
    });
    window.addEventListener("x", {} as EventListenerObject);
    window.dispatchEvent(new Event("x"));
    expect(error).toBeInstanceOf(TypeError);
  });

  test("is dealt with when window.onerror returns true", () => {
    const window = new Window();
    let message: unknown;
    window.onerror = (text: unknown) => {
      message = text;
      return true;
    };
    window.addEventListener("x", () => {
      throw new TypeError("y");
    });
    window.dispatchEvent(new Event("x"));
    expect(message).toBe("TypeError: y");
  });
});

test("a global object that is its own `window` changes nothing for a real one", () => {
  const window = new Window();
  globalThis.window = globalThis;
  try {
    expect(window.window).toBe(window);
    expect(window.setTimeout).toBe(setTimeout);
    expect(window.event).toBeUndefined();
    expect(window.nothingOfThatName).toBeUndefined();
  } finally {
    delete globalThis.window;
  }
});

test("what is written into a window's document can have declarative shadow roots", () => {
  const { document } = new Window();
  document.open();
  document.write(`<div id="host"><template shadowrootmode="open"><p>x</p></template></div>`);
  document.close();
  expect(document.getElementById("host").shadowRoot.innerHTML).toBe("<p>x</p>");
});

test(`document.createEvent("MessageEvent") makes a MessageEvent`, () => {
  const event = new Window().document.createEvent("MessageEvent");
  expect(event).toBeInstanceOf(MessageEvent);
  event.initMessageEvent("message", false, false, "data");
  expect(event.data).toBe("data");
});

test("works in Workers at the same time as on the main thread", async () => {
  const run = async (Window: any) => {
    let passed = 0;
    for (let i = 0; i < 50; i++) {
      const window = new Window({ url: "https://example.com/" + i });
      window.history.pushState({ i }, "", "/x");
      window.localStorage.setItem("a", "b");
      window.document.body.innerHTML = "<div id=host>text</div>";
      window.getSelection().selectAllChildren(window.host);
      await new Promise(resolve => {
        window.onmessage = resolve;
        window.postMessage(1, "*");
      });
      if (window.setTimeout === setTimeout && String(window.getSelection()) === "text" && window.history.state.i === i)
        passed++;
    }
    return passed;
  };
  const source = `import { Window } from "bun:dom"; postMessage(await (${run})(Window));`;
  const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
  const workers = Array.from({ length: 4 }, () => new Worker(url));
  const results = workers.map(worker => new Promise(resolve => (worker.onmessage = event => resolve(event.data))));
  expect(await run(Window)).toBe(50);
  expect(await Promise.all(results)).toEqual([50, 50, 50, 50]);
  for (const worker of workers) worker.terminate();
});

describe("frames", () => {
  const blank = "<html><head></head><body></body></html>";

  const frameIn = (window: any, attributes: Record<string, string> = {}, tagName = "iframe") => {
    const frame = window.document.createElement(tagName);
    for (const name in attributes) frame.setAttribute(name, attributes[name]);
    window.document.body.append(frame);
    return frame;
  };

  // Tasks run in the order they were queued, and microtasks before any of them.
  const laterTask = (window: any) => {
    const message = once(window, "message");
    window.postMessage(1, "*");
    return message;
  };

  const windows = () => {
    Bun.gc(true);
    return heapStats().objectTypeCounts.Window ?? 0;
  };

  describe("the window and the document of a frame", () => {
    test("an iframe has them from the moment it is connected", () => {
      const window = new Window();
      const iframe = window.document.createElement("iframe");
      expect([iframe.contentWindow, iframe.contentDocument]).toEqual([null, null]);
      window.document.createElement("div").append(iframe);
      expect([iframe.contentWindow, iframe.contentDocument]).toEqual([null, null]);

      window.document.body.append(iframe);
      const { contentWindow, contentDocument } = iframe;
      expect(contentWindow).toBeInstanceOf(Window);
      expect(contentWindow).not.toBe(window);
      expect(contentDocument).toBeInstanceOf(window.Document);
      expect(contentWindow.document).toBe(contentDocument);
      expect(contentDocument.defaultView).toBe(contentWindow);
      expect(iframe.contentWindow).toBe(contentWindow);
      expect(iframe.contentDocument).toBe(contentDocument);
      expect(contentDocument.documentElement.outerHTML).toBe(blank);
      expect([contentDocument.URL, contentWindow.location.href]).toEqual(["about:blank", "about:blank"]);
      expect([contentDocument.doctype, contentDocument.compatMode]).toEqual([null, "BackCompat"]);
      expect(contentWindow.closed).toBe(false);
    });

    test("the document can be used at once", () => {
      const { contentDocument } = frameIn(new Window());
      const button = contentDocument.body.appendChild(contentDocument.createElement("button"));
      let clicks = 0;
      contentDocument.addEventListener("click", () => clicks++);
      button.click();
      expect(clicks).toBe(1);
      expect(contentDocument.querySelector("button")).toBe(button);
    });

    test("a <frame> has them too, <object> and <embed> do not", () => {
      const window = new Window();
      const frame = frameIn(window, {}, "frame");
      expect(frame.contentWindow.parent).toBe(window);
      expect(frame.contentDocument.documentElement.outerHTML).toBe(blank);
      const object = frameIn(window, { data: "about:blank" }, "object");
      expect([object.contentWindow, object.contentDocument]).toEqual([null, null]);
      expect("contentWindow" in frameIn(window, { src: "about:blank" }, "embed")).toBe(false);
      expect(window.length).toBe(1);
    });

    test("an iframe that the parser makes has them", () => {
      const window = new Window();
      window.document.body.innerHTML = `<div><iframe></iframe></div>`;
      expect(window.document.querySelector("iframe").contentDocument.documentElement.outerHTML).toBe(blank);
      window.document.open();
      window.document.write(`<iframe id="written"></iframe>`);
      expect(window.document.getElementById("written").contentWindow.parent).toBe(window);
      window.document.close();
    });

    test("a document without a window has no frames", () => {
      const window = new Window();
      expect(frameIn(window).contentWindow).not.toBeNull();
      const markup = `<iframe></iframe>`;
      const template = window.document.createElement("template");
      template.innerHTML = markup;
      const created = window.document.implementation.createHTMLDocument();
      created.body.innerHTML = markup;
      for (const root of [
        new DOMParser().parseFromString(markup, "text/html"),
        new window.DOMParser().parseFromString(markup, "text/html"),
        created,
        template.content,
      ]) {
        const iframe = root.querySelector("iframe");
        expect([iframe.contentWindow, iframe.contentDocument]).toEqual([null, null]);
      }
    });

    test("an iframe in a shadow tree has them, and is not one of window.frames", () => {
      const window = new Window();
      const host = window.document.body.appendChild(window.document.createElement("div"));
      const iframe = host.attachShadow({ mode: "open" }).appendChild(window.document.createElement("iframe"));
      expect(iframe.contentWindow.parent).toBe(window);
      expect(iframe.contentWindow.frameElement).toBe(iframe);
      expect([window.length, window[0]]).toEqual([0, undefined]);
      host.remove();
      expect(iframe.contentWindow).toBeNull();
    });

    test("has the origin and the base URL of its parent, and the parent's URL as its referrer", () => {
      const { contentWindow, contentDocument } = frameIn(at("https://example.com/a/b.html?c"));
      expect(contentWindow.origin).toBe("https://example.com");
      expect(contentDocument.baseURI).toBe("https://example.com/a/b.html?c");
      expect(contentDocument.referrer).toBe("https://example.com/a/b.html?c");
      const link = contentDocument.createElement("a");
      link.href = "d.html";
      expect(link.href).toBe("https://example.com/a/d.html");
      contentWindow.localStorage.setItem("a", "b");
      expect(contentWindow.localStorage.getItem("a")).toBe("b");
      expect(frameIn(new Window()).contentWindow.origin).toBe("null");
    });

    test("an event in the frame's document does not reach the parent's", () => {
      const window = new Window();
      const { contentWindow, contentDocument } = frameIn(window);
      const seen: string[] = [];
      window.addEventListener("click", () => seen.push("parent"), true);
      contentWindow.addEventListener("click", () => seen.push("frame"));
      contentDocument.body.click();
      expect(seen).toEqual(["frame"]);
    });

    test("a node of the parent's document can be moved into the frame's", () => {
      const window = new Window();
      const { contentDocument } = frameIn(window);
      const paragraph = window.document.createElement("p");
      contentDocument.body.append(paragraph);
      expect(paragraph.ownerDocument).toBe(contentDocument);
      expect(paragraph.isConnected).toBe(true);
    });
  });

  describe("classes", () => {
    test("a frame's window has its parent's classes", () => {
      const window = new Window();
      const { contentWindow, contentDocument } = frameIn(window);
      for (const name of ["Node", "Element", "HTMLDivElement", "Event", "MessageEvent", "Window", "MutationObserver"])
        expect([name, contentWindow[name] === window[name]]).toEqual([name, true]);
      expect(contentDocument.body).toBeInstanceOf(window.HTMLElement);
      expect(window.document.body).toBeInstanceOf(contentWindow.HTMLElement);
    });

    test("a class that makes nodes makes them for its own window's document", () => {
      const window = new Window();
      const { contentWindow, contentDocument } = frameIn(window);
      expect(contentWindow.Text).not.toBe(window.Text);
      expect(contentWindow.Text.prototype).toBe(window.Text.prototype);
      expect(contentWindow.HTMLElement.prototype).toBe(window.HTMLElement.prototype);
      expect(new contentWindow.Text("x").ownerDocument).toBe(contentDocument);
      expect(new contentWindow.Image().ownerDocument).toBe(contentDocument);
    });

    test("custom elements are defined for one window", () => {
      const window = new Window();
      const { contentWindow, contentDocument } = frameIn(window);
      expect(contentWindow.customElements).not.toBe(window.customElements);
      class InFrame extends contentWindow.HTMLElement {}
      contentWindow.customElements.define("in-frame", InFrame);
      expect(contentDocument.createElement("in-frame")).toBeInstanceOf(InFrame);
      expect(window.document.createElement("in-frame")).not.toBeInstanceOf(InFrame);
    });
  });

  describe("parent, top, frameElement and window.frames", () => {
    test("a frame's window knows where it is", () => {
      const window = new Window();
      const iframe = frameIn(window);
      const { contentWindow } = iframe;
      expect(contentWindow.parent).toBe(window);
      expect(contentWindow.top).toBe(window);
      expect(contentWindow.frameElement).toBe(iframe);
      expect(contentWindow.opener).toBeNull();
      for (const name of ["window", "self", "frames"]) expect(contentWindow[name]).toBe(contentWindow);
      expect([window.parent, window.top, window.frameElement]).toEqual([window, window, null]);
    });

    test("window[index] and window.length go by the order of the frame elements in the tree", () => {
      const window = new Window();
      const last = frameIn(window);
      expect([window.length, window[0]]).toEqual([1, last.contentWindow]);
      const first = window.document.createElement("frame");
      window.document.body.prepend(first);
      expect(window.length).toBe(2);
      expect([window[0], window[1], window[2]]).toEqual([first.contentWindow, last.contentWindow, undefined]);
      expect(window.frames[1]).toBe(last.contentWindow);
      expect(window["0"]).toBe(first.contentWindow);
      expect([0 in window, 1 in window, 2 in window]).toEqual([true, true, false]);
      expect(Object.keys(window).slice(0, 2)).toEqual(["0", "1"]);
      expect(Object.getOwnPropertyDescriptor(window, 0)).toEqual({
        value: first.contentWindow,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      first.remove();
      expect([window.length, window[0], window[1]]).toEqual([1, last.contentWindow, undefined]);
    });

    test("a window is not iterable", () => {
      const window = new Window();
      expect(frameIn(window).contentWindow).toBe(window[0]);
      expect(window[Symbol.iterator]).toBeUndefined();
    });

    test("hot code sees a frame come and go", () => {
      const window = new Window();
      const read = (target: any) => target[0];
      for (let i = 0; i < 20_000; i++) if (read(window) !== undefined) throw new Error("there is no frame yet");
      const iframe = frameIn(window);
      for (let i = 0; i < 20_000; i++)
        if (read(window) !== iframe.contentWindow) throw new Error("there is a frame now");
      iframe.remove();
      expect(read(window)).toBeUndefined();
    });

    test("a frame's window is a property of its parent under the name of the frame element", () => {
      const window = new Window();
      const iframe = frameIn(window, { name: "preview", id: "box" });
      expect(window.preview).toBe(iframe.contentWindow);
      expect(window.frames.preview).toBe(iframe.contentWindow);
      expect(window.box).toBe(iframe);
      expect(iframe.contentWindow.name).toBe("preview");
      iframe.remove();
      expect(window.preview).toBeUndefined();
    });

    test("an iframe in an iframe", () => {
      const window = new Window();
      const outer = frameIn(window);
      const inner = frameIn(outer.contentWindow);
      expect(inner.contentWindow.parent).toBe(outer.contentWindow);
      expect(inner.contentWindow.top).toBe(window);
      expect(inner.contentWindow.frameElement).toBe(inner);
      expect([window.length, outer.contentWindow.length, inner.contentWindow.length]).toEqual([1, 1, 0]);
      expect(window[0][0]).toBe(inner.contentWindow);
    });
  });

  describe("removing the frame element", () => {
    test("closes the window and takes it from the element", async () => {
      const window = new Window();
      const iframe = frameIn(window);
      const { contentWindow, contentDocument } = iframe;
      let heard = 0;
      contentWindow.addEventListener("message", () => heard++);
      contentWindow.postMessage(1, "*");

      iframe.remove();
      expect([iframe.contentWindow, iframe.contentDocument]).toEqual([null, null]);
      expect(contentWindow.closed).toBe(true);
      expect([contentWindow.parent, contentWindow.top, contentWindow.frameElement]).toEqual([null, null, null]);
      expect([window.length, window[0]]).toEqual([0, undefined]);
      expect(contentWindow.document).toBe(contentDocument);
      contentWindow.postMessage(2, "*");
      await laterTask(window);
      expect(heard).toBe(0);
    });

    test("inserting it again makes a new window and a new document", () => {
      const window = new Window();
      const iframe = frameIn(window);
      const { contentWindow, contentDocument } = iframe;
      contentDocument.body.append("text");
      iframe.remove();
      window.document.body.append(iframe);
      expect(iframe.contentWindow).toBeInstanceOf(Window);
      expect(iframe.contentWindow).not.toBe(contentWindow);
      expect(iframe.contentDocument).not.toBe(contentDocument);
      expect(iframe.contentDocument.documentElement.outerHTML).toBe(blank);
      expect([iframe.contentWindow.closed, contentWindow.closed]).toEqual([false, true]);
      expect(iframe.contentWindow.parent).toBe(window);
    });

    test("so does moving it", () => {
      const window = new Window();
      const iframe = frameIn(window);
      const { contentWindow } = iframe;
      window.document.body.appendChild(window.document.createElement("div")).append(iframe);
      expect(iframe.contentWindow).not.toBe(contentWindow);
      expect([iframe.contentWindow.closed, contentWindow.closed]).toEqual([false, true]);
      expect(window.length).toBe(1);
    });

    test.each([
      ["removing an ancestor", (section: any) => section.remove()],
      ["innerHTML", (section: any) => (section.innerHTML = "")],
      ["replaceChildren()", (section: any) => section.replaceChildren()],
      ["textContent", (section: any) => (section.parentNode.textContent = "")],
      ["document.open()", (section: any) => section.ownerDocument.open()],
      ["adopting it", (section: any) => new Window().document.adoptNode(section)],
    ])("%s counts", (_, remove) => {
      const window = new Window();
      window.document.body.innerHTML = `<section><div><iframe></iframe></div></section>`;
      const iframe = window.document.querySelector("iframe");
      const { contentWindow } = iframe;
      expect(contentWindow.closed).toBe(false);
      remove(window.document.querySelector("section"));
      expect(contentWindow.closed).toBe(true);
      expect([iframe.contentWindow, window.length]).toEqual([null, 0]);
    });

    test("closes the windows of the frames inside", () => {
      const window = new Window();
      const outer = frameIn(window);
      const inner = frameIn(outer.contentWindow);
      const innerWindow = inner.contentWindow;
      outer.remove();
      expect(innerWindow.closed).toBe(true);
      expect([innerWindow.parent, innerWindow.top]).toEqual([null, null]);
      expect(inner.contentWindow).toBeNull();
      expect(inner.isConnected).toBe(true);
    });
  });

  describe("close()", () => {
    test("of the parent closes the frames' windows", () => {
      const window = new Window();
      const outer = frameIn(window);
      const outerWindow = outer.contentWindow;
      const innerWindow = frameIn(outerWindow).contentWindow;
      window.close();
      expect([outerWindow.closed, innerWindow.closed]).toEqual([true, true]);
      expect([outer.contentWindow, window.length]).toEqual([null, 0]);
    });

    test("a closed window gets no new frames", () => {
      const window = new Window();
      expect(frameIn(window).contentWindow).not.toBeNull();
      window.close();
      expect(frameIn(window).contentWindow).toBeNull();
    });
  });

  describe("src and srcdoc", () => {
    test("nothing is loaded: the document of another page has that page's URL and stays empty", async () => {
      const window = at("https://example.com/a/b.html");
      const iframe = window.document.createElement("iframe");
      let events = 0;
      iframe.onload = iframe.onerror = () => events++;
      iframe.src = "https://elsewhere.example/page?x=1#y";
      window.document.body.append(iframe);
      expect(iframe.contentWindow.location.href).toBe("https://elsewhere.example/page?x=1#y");
      expect(iframe.contentDocument.URL).toBe("https://elsewhere.example/page?x=1#y");
      expect(iframe.contentWindow.origin).toBe("https://elsewhere.example");
      expect([iframe.contentDocument.documentElement, iframe.contentDocument.body]).toEqual([null, null]);
      await laterTask(window);
      expect(iframe.contentDocument.readyState).toBe("loading");
      expect(events).toBe(0);
    });

    test("src is resolved against the parent's base URL", () => {
      const window = at("https://example.com/a/b.html");
      expect(frameIn(window, { src: "../c.html" }).contentDocument.URL).toBe("https://example.com/c.html");
      expect(frameIn(window, { src: " about:blank " }).contentDocument.documentElement.outerHTML).toBe(blank);
      expect(frameIn(window, { src: "" }).contentDocument.URL).toBe("about:blank");
      expect(frameIn(window, { src: "https://[" }).contentDocument.URL).toBe("about:blank");
    });

    test("the script of a javascript: URL is not run", () => {
      const { contentDocument } = frameIn(at("https://example.com/a"), {
        src: "javascript:globalThis.ranInAFrame = 1",
      });
      expect(contentDocument.documentElement.outerHTML).toBe(blank);
      expect(contentDocument.URL).toBe("https://example.com/a");
      expect(globalThis.ranInAFrame).toBeUndefined();
    });

    test("setting src on a connected iframe makes a new window", async () => {
      const window = at("https://example.com/");
      const iframe = frameIn(window);
      const { contentWindow } = iframe;
      iframe.src = "/page";
      expect(contentWindow.closed).toBe(true);
      expect(iframe.contentWindow.location.href).toBe("https://example.com/page");
      expect(window[0]).toBe(iframe.contentWindow);
      iframe.src = "about:blank";
      expect(iframe.contentDocument.documentElement.outerHTML).toBe(blank);
      await once(iframe, "load");
      expect(iframe.contentDocument.readyState).toBe("complete");
    });

    test("srcdoc is parsed, and wins over src", () => {
      const window = at("https://example.com/a/b.html");
      const iframe = frameIn(window, {
        src: "https://elsewhere.example/",
        srcdoc: `<p id="one">1</p><script>globalThis.ranInAFrame = 1</script><iframe></iframe>`,
      });
      const { contentWindow, contentDocument } = iframe;
      expect(contentDocument.getElementById("one").textContent).toBe("1");
      expect(contentDocument.body.children).toHaveLength(3);
      expect([contentDocument.URL, contentDocument.compatMode]).toEqual(["about:srcdoc", "CSS1Compat"]);
      expect([contentDocument.baseURI, contentWindow.origin]).toEqual([
        "https://example.com/a/b.html",
        "https://example.com",
      ]);
      expect(contentWindow[0].top).toBe(window);
      expect(globalThis.ranInAFrame).toBeUndefined();

      iframe.srcdoc = "<b>2</b>";
      expect(iframe.contentDocument.body.innerHTML).toBe("<b>2</b>");
      expect(contentWindow.closed).toBe(true);
      iframe.removeAttribute("srcdoc");
      expect(iframe.contentDocument.URL).toBe("https://elsewhere.example/");
    });
  });

  describe("load", () => {
    test("a frame element with a listener hears it after the insertion, when its document has finished loading", async () => {
      const window = new Window();
      const iframe = window.document.createElement("iframe");
      const seen: string[] = [];
      iframe.addEventListener("load", () => seen.push("load at the element"));
      window.document.body.append(iframe);
      const { contentWindow, contentDocument } = iframe;
      expect(contentDocument.readyState).toBe("loading");
      expect(contentDocument.documentElement.outerHTML).toBe(blank);
      contentDocument.addEventListener("readystatechange", () => seen.push(contentDocument.readyState));
      contentWindow.addEventListener("DOMContentLoaded", () => seen.push("DOMContentLoaded"));
      contentWindow.addEventListener("load", (event: Event) => {
        expect(event.target).toBe(contentDocument);
        seen.push("load at the window");
      });
      expect(seen).toEqual([]);
      const event = await once(iframe, "load");
      expect([event.target, event.bubbles, event.isTrusted]).toEqual([iframe, false, true]);
      expect(seen).toEqual([
        "interactive",
        "DOMContentLoaded",
        "complete",
        "load at the window",
        "load at the element",
      ]);
    });

    test("it comes before any task or timer", async () => {
      const window = new Window();
      const iframe = window.document.createElement("iframe");
      let loaded = false;
      iframe.onload = () => (loaded = true);
      window.document.body.append(iframe);
      expect(loaded).toBe(false);
      for (let i = 0; i < 3 && !loaded; i++) await Promise.resolve();
      expect(loaded).toBe(true);
    });

    test("any listener will do, and an onload attribute too", async () => {
      const window = new Window();
      const iframe = window.document.createElement("iframe");
      iframe.addEventListener("click", () => {});
      window.document.body.append(iframe);
      expect(iframe.contentDocument.readyState).toBe("loading");
      await once(iframe, "load");

      window.document.body.innerHTML = `<iframe onload="document.title = 'loaded ' + this.localName"></iframe>`;
      expect(window.document.title).toBe("");
      await once(window.document.querySelector("iframe"), "load");
      expect(window.document.title).toBe("loaded iframe");
    });

    test("a frame element without a listener is told during the insertion, and its window again afterwards", async () => {
      const window = new Window();
      const seen: string[] = [];
      window.document.addEventListener("load", (event: Event) => seen.push((event.target as Element).localName), true);
      const iframe = frameIn(window);
      expect(seen).toEqual(["iframe"]);
      expect(iframe.contentDocument.readyState).toBe("complete");
      iframe.addEventListener("load", () => seen.push("too late"));
      await once(iframe.contentWindow, "load");
      await laterTask(window);
      expect(seen).toEqual(["iframe"]);
    });

    test("a frame element that is removed first does not hear it", async () => {
      const window = new Window();
      const iframe = window.document.createElement("iframe");
      let loads = 0;
      iframe.onload = () => loads++;
      window.document.body.append(iframe);
      expect(iframe.contentWindow).not.toBeNull();
      iframe.remove();
      await laterTask(window);
      expect(loads).toBe(0);
      window.document.body.append(iframe);
      await once(iframe, "load");
      await laterTask(window);
      expect(loads).toBe(1);
    });

    test("a listener that removes and inserts the frame element again does not recurse", async () => {
      const window = new Window();
      let loads = 0;
      window.document.addEventListener(
        "load",
        (event: Event) => {
          if (++loads > 3) return;
          const iframe = event.target as Element;
          iframe.remove();
          window.document.body.append(iframe);
        },
        true,
      );
      const iframe = frameIn(window);
      while (loads <= 3) await laterTask(window);
      expect(iframe.contentWindow.parent).toBe(window);
    });

    test("document.close() in the frame fires it again", async () => {
      const window = new Window();
      const iframe = window.document.createElement("iframe");
      let loads = 0;
      iframe.onload = () => loads++;
      window.document.body.append(iframe);
      await once(iframe, "load");
      const { contentWindow, contentDocument } = iframe;
      contentDocument.open();
      contentDocument.write("<p>written</p>");
      contentDocument.close();
      expect(loads).toBe(2);
      expect([iframe.contentWindow, iframe.contentDocument]).toEqual([contentWindow, contentDocument]);
      expect(contentDocument.body.innerHTML).toBe("<p>written</p>");
    });

    test("writing the document before it has loaded fires it once", async () => {
      const window = new Window();
      const iframe = window.document.createElement("iframe");
      let loads = 0;
      iframe.onload = () => loads++;
      window.document.body.append(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write("<p>written</p>");
      iframe.contentDocument.close();
      expect(loads).toBe(1);
      await laterTask(window);
      expect(loads).toBe(1);
      expect(iframe.contentDocument.body.innerHTML).toBe("<p>written</p>");
    });
  });

  describe("postMessage()", () => {
    test("reaches the frame's window", async () => {
      const { contentWindow } = frameIn(at("https://example.com/a"));
      const message = once(contentWindow, "message");
      contentWindow.postMessage({ list: [1, 2] }, "*");
      const event = await message;
      expect(event.data).toEqual({ list: [1, 2] });
      expect(event.target).toBe(contentWindow);
      expect(event.origin).toBe("https://example.com");
    });

    test("reaches the parent from the frame's window", async () => {
      const window = at("https://example.com/a");
      const { contentWindow } = frameIn(window);
      const message = once(window, "message");
      contentWindow.parent.postMessage("up", "https://example.com");
      expect((await message).data).toBe("up");
    });

    test("goes by the origin that about:blank has from its parent", async () => {
      const { contentWindow } = frameIn(at("https://example.com/a"));
      const seen: string[] = [];
      contentWindow.addEventListener("message", (event: MessageEvent) => seen.push(event.data));
      contentWindow.postMessage("elsewhere", "https://elsewhere.example");
      contentWindow.postMessage("the parent's origin", "https://example.com");
      contentWindow.postMessage("no origin given");
      contentWindow.postMessage("last", "*");
      while (seen.at(-1) !== "last") await once(contentWindow, "message");
      expect(seen).toEqual(["the parent's origin", "no origin given", "last"]);
    });

    test("a MessageEvent can be made with a frame's window as its source", () => {
      const { contentWindow } = frameIn(new Window());
      expect(contentWindow).toBeInstanceOf(Window);
      expect(new MessageEvent("message", { source: contentWindow }).source).toBe(contentWindow);
    });

    test("can be spied on, and so can open()", () => {
      const iframe = frameIn(new Window());
      const postMessage = spyOn(iframe.contentWindow, "postMessage");
      iframe.contentWindow.postMessage("hello", "*");
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith("hello", "*");
      const open = spyOn(iframe.contentWindow, "open").mockReturnValue(null);
      expect(iframe.contentWindow.open("https://example.com/", "_blank")).toBeNull();
      expect(open).toHaveBeenCalledWith("https://example.com/", "_blank");
      open.mockRestore();
      expect(iframe.contentWindow.open()).toBeInstanceOf(Window);
    });
  });

  describe("garbage collection", () => {
    test("a frame's window and document stay what they are while only the frame element is held", () => {
      const iframe = frameIn(new Window());
      let heard = 0;
      (() => {
        iframe.contentWindow.marker = 1;
        iframe.contentDocument.marker = 2;
        iframe.contentDocument.body.marker = 3;
        iframe.contentWindow.addEventListener("x", () => heard++);
      })();
      Bun.gc(true);
      expect(iframe.contentWindow.marker).toBe(1);
      expect(iframe.contentDocument.marker).toBe(2);
      expect(iframe.contentDocument.body.marker).toBe(3);
      iframe.contentDocument.dispatchEvent(new Event("x", { bubbles: true }));
      expect(heard).toBe(1);
    });

    test("also when script has never seen the frame elements", () => {
      const window = new Window();
      window.document.body.innerHTML = `<iframe srcdoc="<iframe></iframe>"></iframe>`;
      let heard = 0;
      (() => {
        window[0][0].marker = 1;
        window[0][0].addEventListener("x", () => heard++);
      })();
      Bun.gc(true);
      expect(window[0][0].marker).toBe(1);
      window[0][0].dispatchEvent(new Event("x"));
      expect(heard).toBe(1);
    });

    test("a frame's window keeps its parent", () => {
      const contentWindow = (() => {
        const window = new Window();
        window.marker = 1;
        const iframe = frameIn(window);
        iframe.marker = 2;
        return iframe.contentWindow;
      })();
      Bun.gc(true);
      expect(contentWindow.closed).toBe(false);
      expect(contentWindow.parent.marker).toBe(1);
      expect(contentWindow.frameElement.marker).toBe(2);
    });

    test("a node in a frame in a frame keeps the top window", () => {
      const body = (() => {
        const window = new Window();
        window.marker = 1;
        return frameIn(frameIn(window).contentWindow).contentDocument.body;
      })();
      Bun.gc(true);
      expect(body.ownerDocument.defaultView.top.marker).toBe(1);
    });

    test("a frame element hears load when nothing else holds it", async () => {
      let loaded = false;
      (() => {
        const window = new Window();
        const iframe = window.document.createElement("iframe");
        iframe.onload = () => (loaded = true);
        window.document.body.append(iframe);
      })();
      Bun.gc(true);
      expect(loaded).toBe(false);
      await laterTask(new Window());
      expect(loaded).toBe(true);
    });

    test("windows with frames are collected", async () => {
      const before = windows();
      (() => {
        for (let i = 0; i < 100; i++) {
          const window = new Window();
          const { contentWindow } = frameIn(window);
          contentWindow.addEventListener("x", () => window);
          frameIn(contentWindow).contentWindow.onmessage = () => contentWindow;
        }
      })();
      // A window whose frames have yet to hear `load` is kept until they have.
      await Promise.resolve();
      expect(windows() - before).toBeLessThan(10);
    });

    test("the window of a frame element that was removed is collected", () => {
      const window = new Window();
      const before = windows();
      (() => {
        for (let i = 0; i < 100; i++) {
          const iframe = frameIn(window);
          iframe.contentWindow.addEventListener("x", () => iframe);
          iframe.remove();
        }
      })();
      expect(window.length).toBe(0);
      expect(windows() - before).toBeLessThan(10);
      expect(frameIn(window).contentWindow.parent).toBe(window);
    });

    test.concurrent(
      "making and removing many iframes does not grow",
      async () => {
        const count = isDebug || isASAN ? 5_000 : 100_000;
        const script = `
          import { Window } from "bun:dom";
          import { heapStats } from "bun:jsc";
          const { document } = new Window();
          const run = count => {
            for (let i = 0; i < count; i++) {
              const iframe = document.createElement("iframe");
              document.body.append(iframe);
              iframe.contentDocument.body.append("text");
              iframe.remove();
            }
            Bun.gc(true);
          };
          run(${count / 10});
          const before = process.memoryUsage.rss();
          run(${count});
          const megabytes = (process.memoryUsage.rss() - before) / 1024 / 1024;
          console.log(JSON.stringify({ windows: heapStats().objectTypeCounts.Window, megabytes }));
        `;
        await using process = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([
          process.stdout.text(),
          process.stderr.text(),
          process.exited,
        ]);
        expect(stderr).toBe("");
        const { windows, megabytes } = JSON.parse(stdout);
        expect(windows).toBeLessThan(20);
        // A window with its document is about 4 KB, so all of them together would be about 400 MB.
        if (!isDebug && !isASAN) expect(megabytes).toBeLessThan(100);
        expect(exitCode).toBe(0);
      },
      60_000,
    );
  });

  describe("window.open()", () => {
    test("returns a new window at about:blank, whatever the URL", () => {
      const window = at("https://example.com/a/b.html");
      const opened = window.open("https://elsewhere.example/page", "popup", "width=400,height=300");
      expect(opened).toBeInstanceOf(Window);
      expect(opened).not.toBe(window);
      expect(opened.opener).toBe(window);
      expect(opened.document.documentElement.outerHTML).toBe(blank);
      expect([opened.location.href, opened.document.readyState]).toEqual(["about:blank", "complete"]);
      expect([opened.origin, opened.document.baseURI]).toEqual(["https://example.com", "https://example.com/a/b.html"]);
      expect(opened.name).toBe("popup");
      expect([opened.parent, opened.top, opened.frameElement]).toEqual([opened, opened, null]);
      expect([window.length, window.opener]).toEqual([0, null]);
      opened.document.body.append(opened.document.createElement("p"));
      expect(opened.document.body.innerHTML).toBe("<p></p>");
    });

    test("every call makes a window", () => {
      const window = new Window();
      expect(window.open()).not.toBe(window.open());
      expect(window.open("", "popup")).not.toBe(window.open("", "popup"));
      expect([window.open().name, window.open("", "_blank").name, window.open("", "").name]).toEqual(["", "", ""]);
    });

    test("works when it is read off the window and called bare", () => {
      const window = new Window();
      const { open } = window;
      expect(open().opener).toBe(window);
    });

    test("close() and closed", async () => {
      const opened = new Window().open();
      let heard = 0;
      opened.addEventListener("message", () => heard++);
      opened.postMessage(1, "*");
      expect(opened.closed).toBe(false);
      opened.close();
      expect(opened.closed).toBe(true);
      await laterTask(opened.opener);
      expect(heard).toBe(0);
    });

    test("messages go both ways", async () => {
      const window = at("https://example.com/");
      const opened = window.open();
      const down = once(opened, "message");
      opened.postMessage("down", "https://example.com");
      expect((await down).data).toBe("down");
      const up = once(window, "message");
      opened.opener.postMessage("up", "*");
      expect((await up).data).toBe("up");
    });

    test("_self, _parent and _top name windows that are there", () => {
      const window = new Window();
      const { contentWindow } = frameIn(frameIn(window).contentWindow);
      expect(window.open("", "_self")).toBe(window);
      expect(window.open("", "_PARENT")).toBe(window);
      expect(window.open("", "_top")).toBe(window);
      expect(contentWindow.open("", "_self")).toBe(contentWindow);
      expect(contentWindow.open("", "_parent")).toBe(window[0]);
      expect(contentWindow.open("", "_top")).toBe(window);
    });

    test("returns null with noopener or noreferrer", () => {
      const window = new Window();
      for (const features of ["noopener", "width=1, NoOpener", "noopener=yes", "noopener=1", "noreferrer", "noopener="])
        expect([features, window.open("", "", features)]).toEqual([features, null]);
      for (const features of ["noopener=0", "noopener=no", "opener", null, undefined])
        expect(window.open("", "", features)).toBeInstanceOf(Window);
    });

    test("a URL that cannot be parsed is a SyntaxError", () => {
      const window = new Window();
      expect(() => window.open("https://[")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
      expect(at("https://example.com/").open("/relative")).toBeInstanceOf(Window);
    });

    test("a closed window opens nothing, and takes the windows it has opened with it", () => {
      const window = new Window();
      const opened = window.open();
      const openedByThat = opened.open();
      window.close();
      expect([opened.closed, openedByThat.closed]).toEqual([true, true]);
      expect(window.open()).toBeNull();
    });

    test("the opened window keeps its opener, and nothing keeps the opened window", () => {
      const opened = (() => {
        const window = new Window();
        window.marker = 1;
        return window.open();
      })();
      Bun.gc(true);
      expect(opened.opener.marker).toBe(1);

      const before = windows();
      (() => {
        for (let i = 0; i < 100; i++) opened.open().onmessage = () => {};
      })();
      expect(windows() - before).toBeLessThan(10);
    });
  });

  describe("where `window` is `globalThis`", () => {
    test.concurrent("native code hands out globalThis for the window that it stands for", async () => {
      const script = `
        import { Window } from "bun:dom";
        import { setGlobalObjectWindow } from "bun:internal-for-testing";
        const window = new Window({ url: "https://example.com/" });
        const iframe = window.document.body.appendChild(window.document.createElement("iframe"));
        const read = () => [
          window.window,
          window.self,
          window.parent,
          window.top,
          window.document.defaultView,
          iframe.contentWindow.parent,
          iframe.contentWindow.top,
          window.open().opener,
          new window.MouseEvent("click", { view: window }).view,
          new MessageEvent("message", { source: window }).source,
        ].map(value => (value === globalThis ? "globalThis" : value === window ? "window" : String(value))).join();
        const results = [read()];
        setGlobalObjectWindow(window, true);
        results.push(read());
        results.push(window.frames === window, window.frames[0] === iframe.contentWindow, iframe.contentWindow.window === iframe.contentWindow);
        iframe.contentWindow.postMessage(1);
        results.push((await new Promise(resolve => (iframe.contentWindow.onmessage = resolve))).source === globalThis);
        window.addEventListener("x", function (event) { results.push(this === globalThis, event.target === globalThis, event.currentTarget === globalThis); });
        window.dispatchEvent(new Event("x"));
        window.onload = function () { results.push(this === globalThis); };
        window.dispatchEvent(new Event("load"));
        await new Promise(resolve => window.requestAnimationFrame(resolve));
        setGlobalObjectWindow(window);
        results.push(read());
        setGlobalObjectWindow(window, true);
        setGlobalObjectWindow(null);
        results.push(read());
        console.log(JSON.stringify(results));
      `;
      await using process = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        process.stdout.text(),
        process.stderr.text(),
        process.exited,
      ]);
      expect(stderr).toBe("");
      const all = (name: string) => Array(10).fill(name).join();
      expect(JSON.parse(stdout)).toEqual([
        all("window"),
        all("globalThis"),
        ...Array(8).fill(true),
        all("window"),
        all("window"),
      ]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("bun test --environment=bun:dom", async () => {
      using dir = tempDir("bun-dom-frames", {
        "frames.test.ts": `
          import { expect, spyOn, test } from "bun:test";

          const once = (target, type) => new Promise(resolve => target.addEventListener(type, resolve, { once: true }));

          test("frames", async () => {
            expect(window).toBe(globalThis);
            const iframe = document.createElement("iframe");
            const loaded = once(iframe, "load");
            document.body.append(iframe);
            const { contentWindow, contentDocument } = iframe;
            expect(contentWindow.parent).toBe(window);
            expect(contentWindow.top).toBe(window);
            expect(contentWindow.frameElement).toBe(iframe);
            expect(contentWindow.document).toBe(contentDocument);
            expect(contentDocument).not.toBe(document);
            expect(contentDocument.defaultView).toBe(contentWindow);
            expect(document.defaultView).toBe(window);
            expect(contentWindow.origin).toBe(window.origin);
            expect(contentWindow.location.href).toBe("about:blank");
            expect(window.length).toBe(1);
            expect(window.frames[0]).toBe(contentWindow);
            expect(contentDocument.body.appendChild(contentDocument.createElement("p"))).toBeInstanceOf(HTMLElement);
            expect((await loaded).target).toBe(iframe);

            const down = once(contentWindow, "message");
            contentWindow.postMessage("down", "*");
            const downEvent = await down;
            expect(downEvent.data).toBe("down");
            expect(downEvent.source).toBe(window);
            expect(downEvent.origin).toBe(window.origin);

            const up = once(window, "message");
            contentWindow.parent.postMessage("up", window.origin);
            const upEvent = await up;
            expect(upEvent.data).toBe("up");
            expect(upEvent.source).toBe(window);
            expect(upEvent.target).toBe(window);

            const postMessage = spyOn(contentWindow, "postMessage");
            iframe.contentWindow.postMessage("spied on", "*");
            expect(postMessage).toHaveBeenCalledWith("spied on", "*");

            iframe.remove();
            expect(iframe.contentWindow).toBeNull();
            expect(contentWindow.closed).toBe(true);
            expect(window.length).toBe(0);
          });

          test("window.open()", () => {
            const opened = window.open("https://example.com/", "_blank");
            expect(opened.opener).toBe(window);
            expect(opened.document.body.innerHTML).toBe("");
            expect(opened.closed).toBe(false);
            opened.close();
            expect(opened.closed).toBe(true);
            const open = spyOn(window, "open").mockReturnValue(null);
            expect(window.open("/")).toBeNull();
            open.mockRestore();
          });

          test("an event's view is the window", () => {
            expect(new MouseEvent("click", { view: window }).view).toBe(window);
          });
        `,
      });
      await using process = Bun.spawn({
        cmd: [bunExe(), "test", "--environment=bun:dom", "./frames.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        process.stdout.text(),
        process.stderr.text(),
        process.exited,
      ]);
      expect(stdout + stderr).toContain("3 pass");
      expect(stdout + stderr).toContain("0 fail");
      expect(exitCode).toBe(0);
    });
  });

  test("work in Workers at the same time as on the main thread", async () => {
    const run = async (Window: any) => {
      let passed = 0;
      for (let i = 0; i < 30; i++) {
        const window = new Window({ url: "https://example.com/" + i });
        window.document.body.innerHTML = `<iframe name="outer" srcdoc="<iframe></iframe>"></iframe>`;
        const inner = window.outer[0];
        const message = new Promise<any>(resolve => (inner.onmessage = resolve));
        inner.postMessage(i, "https://example.com");
        const { data } = await message;
        const opened = inner.open();
        window.document.body.replaceChildren();
        if (data === i && inner.closed && opened.closed && window.length === 0) passed++;
      }
      return passed;
    };
    const source = `import { Window } from "bun:dom"; postMessage(await (${run})(Window));`;
    const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
    const workers = Array.from({ length: 4 }, () => new Worker(url));
    const results = workers.map(worker => new Promise(resolve => (worker.onmessage = event => resolve(event.data))));
    expect(await run(Window)).toBe(30);
    expect(await Promise.all(results)).toEqual([30, 30, 30, 30]);
    for (const worker of workers) worker.terminate();
  });
});

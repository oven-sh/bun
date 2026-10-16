// Runs one Web Platform Test in a `bun:dom` window and prints its results as one line of JSON.
//
//   bun --expose-internals run-test-file.js <wpt directory> <url path of the test> [--timeout-multiplier=<number>]
//
// `bun:dom` runs no scripts and loads nothing into a frame, so this file does both. See `Page`.
import { Document, HTMLIFrameElement, MutationObserver, NodeList, Window } from "bun:dom";
import { setGlobalObjectWindow } from "bun:internal-for-testing";
import { drainMicrotasks } from "bun:jsc";
import { resolveObjectURL } from "node:buffer";
import { readFileSync, writeSync } from "node:fs";
import vm from "node:vm";
import {
  findFile,
  markupForScriptTest,
  resultPrefix,
  scriptPathForGeneratedPage,
  substituteServerVariables,
  testOrigin,
} from "./test-files.js";

// Tests delete and replace globals.
const { Event, EventTarget, Response, URL } = globalThis;

const [wptDirectory, testPath, ...flags] = process.argv.slice(2);
const timeoutMultiplier = Number(flags.find(flag => flag.startsWith("--timeout-multiplier="))?.split("=")[1] ?? 1);

const testURL = new URL(testPath, testOrigin(testPath));
const startTime = performance.now();
const { exit } = process;
const collectGarbage = Bun.gc;
const runtimeGlobalNames = Object.getOwnPropertyNames(globalThis);
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

const result = {
  test: testPath,
  status: null,
  message: null,
  subtests: [],
  filesRead: [],
  // What the harness could not do.
  missingFiles: [],
  skippedScripts: [],
  unsupportedFrames: [],
  uncaughtExceptions: [],
};

function finish(status, message) {
  result.status = status;
  result.message = message ?? null;
  result.duration = Math.round(performance.now() - startTime);
  // `process.stdout.write` does not finish a long line before `exit`.
  const bytes = Buffer.from(resultPrefix + JSON.stringify(result) + "\n");
  for (let written = 0; written < bytes.length;) {
    try {
      written += writeSync(1, bytes, written);
    } catch (error) {
      if (error.code !== "EAGAIN") throw error;
    }
  }
  exit(0);
}

function readFromWPT(url) {
  // A `.py` file is a program for WPT's server.
  const file = url.origin === testURL.origin && !url.pathname.endsWith(".py") ? findFile(wptDirectory, url.pathname) : null;
  if (file === null) return null;
  if (!result.filesRead.includes(url.pathname)) result.filesRead.push(url.pathname);
  const text = readFileSync(file, "utf8");
  return /\.sub\./.test(url.pathname) ? substituteServerVariables(text, url) : text;
}

// Some tests replace members of `NodeList.prototype`.
const querySelectorAll = Function.prototype.call.bind(Document.prototype.querySelectorAll);
const lengthOf = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(NodeList.prototype, "length").get);
const itemOf = Function.prototype.call.bind(NodeList.prototype.item);
const closeDocument = Function.prototype.call.bind(Document.prototype.close);
const createElement = Function.prototype.call.bind(Document.prototype.createElement);
const addEventListener = Function.prototype.call.bind(EventTarget.prototype.addEventListener);
const dispatchEvent = Function.prototype.call.bind(EventTarget.prototype.dispatchEvent);

function elementsMatching(document, selector) {
  const list = querySelectorAll(document, selector);
  return Array.from({ length: lengthOf(list) }, (_, index) => itemOf(list, index));
}

function countLines(text, end) {
  let lines = 0;
  for (let index = text.indexOf("\n"); index !== -1 && index < end; index = text.indexOf("\n", index + 1)) lines++;
  return lines;
}

const define = (object, name, descriptor) =>
  Object.defineProperty(object, name, { configurable: true, enumerable: true, ...descriptor });

const javaScriptTypes =
  /^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))?$/i;

// `import("wpt:/dom/x.js")` is the module that WPT's server has at that path, or an inline `<script type=module>`.
const inlineModules = new Map();
Bun.plugin({
  name: "modules of the WPT directory",
  setup(build) {
    build.onResolve({ filter: /.*/ }, ({ path, importer }) =>
      importer.startsWith("wpt:") ? { path: new URL(path, new URL(importer.slice(4), testURL)).pathname, namespace: "wpt" } : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: "wpt" }, ({ path }) => ({
      contents: inlineModules.get(path) ?? readFromWPT(new URL(path, testURL)) ?? `throw new TypeError("no such module: ${path}")`,
      loader: "js",
    }));
  },
});

const pagesByDocument = new WeakMap();
let ecmaScriptGlobalNames = null;

// What a browser's "browsing context" does around a window: it runs the scripts the parser reaches, loads the frames,
// and supplies the members of Window that have to do with either.
class Page {
  frames = new Map();
  navigations = new WeakMap();
  pendingFrameLoads = 0;
  deferredScripts = [];
  isFinishingParsing = false;
  currentScript = null;

  constructor(url, container) {
    this.url = url;
    this.container = container;
    this.window = new Window({ url: url.href });
    this.document = this.window.document;
    pagesByDocument.set(this.document, this);
    this.installWindowMembers();
    new MutationObserver(records => this.updateFrames(records)).observe(this.document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcdoc"],
    });
  }

  installWindowMembers() {
    const { window, document, container } = this;
    define(document, "currentScript", { get: () => this.currentScript });
    define(document, "close", { enumerable: false, writable: true, value: () => this.closeDocument() });

    if (container) {
      define(window, "parent", { get: () => container.page.window });
      define(window, "top", { get: () => container.page.window.top });
      define(window, "frameElement", { get: () => container.element });
    }
    const frameWindows = () => elementsMatching(document, "iframe").map(element => this.frameFor(element)?.window);
    define(window, "length", { get: () => frameWindows().length });
    for (let index = 0; index < 8; index++)
      define(window, index, { enumerable: false, get: () => frameWindows()[index] });
  }

  // `bun:dom` gives a frame a window with an empty document and fires `load` at the frame's element. The harness has frames of
  // its own, which run scripts, and says itself when one has loaded. `document.open()` removes the listener.
  ignoreLoadOfNativeFrames() {
    addEventListener(
      this.window,
      "load",
      event => event.isTrusted && event.target !== this.document && event.stopImmediatePropagation(),
      true,
    );
  }

  // A frame's scripts get a realm of their own, with the frame's window as its global object.
  runGlobalCode(code, options) {
    const { window } = this;
    if (!vm.isContext(window)) this.createRealm();
    vm.runInContext(code, window, options);
  }

  createRealm() {
    const { window } = this;
    vm.createContext(window);
    ecmaScriptGlobalNames ??= vm.runInNewContext("Object.getOwnPropertyNames(globalThis)").filter(name => !/^(?:undefined|NaN|Infinity|globalThis)$/.test(name));
    // A window hands out the names of the realm it was made in, `eval` and `Array` too, and a context asks its window
    // first. The new realm's own have to win, or `eval` is an indirect one of the wrong realm. They show without the prototype.
    const prototype = Object.getPrototypeOf(window);
    Object.setPrototypeOf(window, null);
    const intrinsics = vm.runInContext(`({ ${ecmaScriptGlobalNames.join(", ")} })`, window);
    Object.setPrototypeOf(window, prototype);
    for (const name of ecmaScriptGlobalNames) define(window, name, { enumerable: false, writable: true, value: intrinsics[name] });
    for (const name of runtimeGlobalNames) {
      if (!(name in window)) define(window, name, { enumerable: false, writable: true, value: globalThis[name] });
    }
  }

  // "Report an exception". bun:dom does that itself for what a listener throws, so a listener throws it.
  reportException(error) {
    if (result.uncaughtExceptions.length < 5) result.uncaughtExceptions.push(`${error} ${error?.stack?.split("\n").slice(1, 4).join(" ") ?? ""}`);
    // It takes the position from where the exception is thrown, so that is where the first throw was.
    const rethrow = vm.runInThisContext("(function (error) { throw error; })", {
      filename: error?.sourceURL ?? this.url.href,
      lineOffset: (error?.line ?? 1) - 1,
    });
    const target = createElement(this.document, "div");
    addEventListener(target, "report", () => rethrow(error));
    dispatchEvent(target, new Event("report"));
  }

  evaluate(code, filename, lineOffset, element) {
    // The parser performs a microtask checkpoint at `</script>`, before the script runs, and the script's end is another.
    drainMicrotasks();
    this.currentScript = element;
    try {
      this.runGlobalCode(code, { filename, lineOffset });
    } catch (error) {
      this.reportException(error);
    } finally {
      this.currentScript = null;
    }
    drainMicrotasks();
  }

  runScript(element, lineOffset) {
    const type = element.hasAttribute("type")
      ? element.getAttribute("type").trim()
      : (element.getAttribute("language") ?? "") && `text/${element.getAttribute("language")}`;
    if (!javaScriptTypes.test(type)) return;
    if (!element.hasAttribute("src")) {
      this.evaluate(element.textContent, this.url.href, lineOffset, element);
      return;
    }
    const url = URL.parse(element.getAttribute("src"), this.url.protocol === "about:" ? testURL : this.url);
    if (url?.pathname === "/resources/testharnessreport.js") return;
    const code = url && readFromWPT(url);
    if (code === null) {
      result.missingFiles.push(url?.origin === testURL.origin ? url.pathname : element.getAttribute("src").slice(0, 100));
      element.dispatchEvent(new Event("error"));
      return;
    }
    this.evaluate(code, url.href, 0, element);
    if (url.pathname === "/resources/testharness.js") this.didLoadTestharness();
    element.dispatchEvent(new Event("load"));
  }

  // A frame's own tests reach the top window only through messages, which the harness does not carry.
  didLoadTestharness() {
    this.window.setup({ output: false, explicit_timeout: true });
  }

  // Feeds the parser up to each `</script>` and runs the script, so that it sees the document as far as it is parsed.
  parseAndRunScripts(markup) {
    const { document, window } = this;
    const seenScripts = new WeakSet();
    const endOfScript = /<\/script[\t\n\f\r />]/gi;
    let written = 0;

    document.open();
    // The first listeners, so that they can hold the events back. See `load`.
    for (const type of ["readystatechange", "DOMContentLoaded", "load"]) {
      window.addEventListener(type, event => this.isFinishingParsing && event.stopImmediatePropagation(), true);
    }
    this.ignoreLoadOfNativeFrames();
    while (written < markup.length) {
      const match = endOfScript.exec(markup);
      const end = match ? markup.indexOf(">", match.index) + 1 || markup.length : markup.length;
      document.write(markup.slice(written, end));
      written = end;
      endOfScript.lastIndex = end;
      for (const element of elementsMatching(document, "script")) {
        if (seenScripts.has(element)) continue;
        seenScripts.add(element);
        const isDeferred = element.hasAttribute("src") && element.hasAttribute("defer") && !element.hasAttribute("async");
        if (isDeferred || element.getAttribute("type")?.trim().toLowerCase() === "module") this.deferredScripts.push(element);
        else this.runScript(element, match ? countLines(markup, match.index - element.textContent.length) : 0);
      }
    }
  }

  async load(markup) {
    const { document, window } = this;
    this.parseAndRunScripts(markup);
    do await nextTask();
    while (this.pendingFrameLoads > 0);
    if (!this.deferredScripts.length) return this.closeDocument();

    // `defer` and module scripts run when the parser is done (there is a <body> by then) and before DOMContentLoaded.
    // `close()` does both at once, so its events are held back and fired again afterwards.
    this.isFinishingParsing = true;
    this.closeDocument();
    this.isFinishingParsing = false;
    define(document, "readyState", { get: () => "interactive" });
    document.dispatchEvent(new Event("readystatechange"));
    for (const element of this.deferredScripts) {
      if (element.hasAttribute("defer") && element.getAttribute("type") === null) this.runScript(element, 0);
      else await this.runModuleScript(element);
    }
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    delete document.readyState;
    document.dispatchEvent(new Event("readystatechange"));
    window.dispatchEvent(new Event("load"));
  }

  // Bun's module loader belongs to the top realm, so a frame's modules do not run.
  async runModuleScript() {
    result.skippedScripts.push("type=module in a frame");
  }

  // `close()` fires `load` at the window. A frame's element hears of it too.
  closeDocument() {
    const wasLoading = this.document.readyState === "loading";
    closeDocument(this.document);
    if (wasLoading && this.container) this.container.page.fireLoadAtFrame(this.container.element, this);
  }

  async fireLoadAtFrame(element, frame) {
    this.pendingFrameLoads++;
    await nextTask();
    this.pendingFrameLoads--;
    if (element.isConnected && this.frames.get(element) === frame) element.dispatchEvent(new Event("load"));
  }

  frameFor(element) {
    if (!element.isConnected) {
      this.frames.delete(element);
      return null;
    }
    return this.frames.getOrInsertComputed(element, () => {
      const frame = new Page(new URL("about:blank"), { page: this, element });
      const name = element.getAttribute("name");
      if (name) define(this.window, name, { enumerable: false, get: () => this.frameFor(element)?.window });
      frame.document.open();
      closeDocument(frame.document);
      frame.ignoreLoadOfNativeFrames();
      this.navigateFrame(element);
      return frame;
    });
  }

  updateFrames(records) {
    for (const record of records) {
      if (record.type === "attributes" && this.frames.has(record.target)) this.navigateFrame(record.target);
    }
    for (const element of this.frames.keys()) if (!element.isConnected) this.frames.delete(element);
    for (const element of elementsMatching(this.document, "iframe")) this.frameFor(element);
  }

  // Replaces the frame's page with the one that `srcdoc` or `src` names. A later navigation of the same frame wins.
  async navigateFrame(element) {
    const navigation = Symbol();
    this.navigations.set(element, navigation);
    this.pendingFrameLoads++;
    try {
      await nextTask();
      const source = await this.readFrameSource(element);
      if (source === undefined || !element.isConnected || this.navigations.get(element) !== navigation) return;
      if (source === null) return this.fireLoadAtFrame(element, this.frames.get(element));
      const frame = new Page(source.url, { page: this, element });
      this.frames.set(element, frame);
      await frame.load(source.markup);
    } finally {
      this.pendingFrameLoads--;
    }
  }

  // Returns null for about:blank, and undefined for what the harness cannot load.
  async readFrameSource(element) {
    if (element.hasAttribute("srcdoc")) return { url: new URL("about:srcdoc"), markup: element.getAttribute("srcdoc") };
    const src = element.getAttribute("src");
    if (!src || src === "about:blank") return null;
    const url = URL.parse(src, this.url.protocol === "about:" ? testURL : this.url);
    if (url?.protocol === "blob:") {
      const blob = resolveObjectURL(url.href);
      if (blob?.type.startsWith("text/html")) return { url, markup: await blob.text() };
    } else if (url && /\.html?$/.test(url.pathname)) {
      const markup = readFromWPT(url);
      if (markup !== null) return { url, markup };
    }
    result.unsupportedFrames.push(src.slice(0, 100));
    return undefined;
  }
}

for (const [name, member] of [
  ["contentWindow", "window"],
  ["contentDocument", "document"],
]) {
  define(HTMLIFrameElement.prototype, name, {
    get() {
      return pagesByDocument.get(this.ownerDocument)?.frameFor(this)?.[member] ?? null;
    },
  });
}

// The page of the test itself. Its scripts run in the realm that the DOM's own prototypes and exceptions belong to, so
// `assert_throws_js(TypeError, ...)` and `instanceof Array` hold. That realm's global object is Bun's, not the window.
// Script sees `window` and `self` as the real window. Three links make the two look like one:
//   1. the window is the global object's prototype, so `window.x = 1` makes a global `x`;
//   2. a member of the window that needs the window as `this`, or that Bun's global shadows, is forwarded;
//   3. a property of the global object (`var`, functions, `setTimeout`) is mirrored on the window after each script.
// What stays different: `this` in global code and in sloppy functions, and `globalThis`, are not `window`.
class TestPage extends Page {
  mirroredNames = new Set();
  hasTestharness = false;

  constructor(url) {
    super(url, null);
    const { window } = this;

    const boundOperations = new Map();
    for (const object of [window, Window.prototype, EventTarget.prototype]) {
      for (const name of Object.getOwnPropertyNames(object)) {
        if (name === "constructor") continue;
        if (object === window && !Object.hasOwn(globalThis, name)) continue;
        define(globalThis, name, {
          get() {
            const value = window[name];
            if (typeof value !== "function" || Object.hasOwn(window, name)) return value;
            if (boundOperations.get(name)?.target !== value)
              boundOperations.set(name, { target: value, bound: value.bind(window) });
            return boundOperations.get(name).bound;
          },
          set(value) {
            window[name] = value;
          },
        });
      }
    }
    Object.setPrototypeOf(globalThis, window);
    // `<div id=target>` is `window.target`. For a bare `target` the lookup's receiver is the global object.
    setGlobalObjectWindow(window);
    globalThis.gc = () => collectGarbage(true);
    globalThis.fetch = async resource => {
      // In a task, so that a test that polls the server in a loop does not starve its own timeout.
      await nextTask();
      const text = readFromWPT(new URL(resource, testURL));
      return text === null ? new Response("", { status: 404 }) : new Response(text);
    };
    this.mirrorGlobalsOnWindow();

    // A listener's exception goes to its window natively. One from a timer, an observer, a custom element reaction or
    // `reportError` goes to `uncaughtException`, synchronously.
    process.on("uncaughtException", error => this.reportException(error));
    process.on("unhandledRejection", (reason, promise) => {
      window.dispatchEvent(
        new window.PromiseRejectionEvent("unhandledrejection", { promise, reason, cancelable: true }),
      );
    });
  }

  mirrorGlobalsOnWindow() {
    const { window } = this;
    for (const name of Object.getOwnPropertyNames(globalThis)) {
      if (this.mirroredNames.has(name)) continue;
      if ([window, Window.prototype, EventTarget.prototype].some(object => Object.hasOwn(object, name))) continue;
      this.mirroredNames.add(name);
      define(window, name, {
        enumerable: false,
        get: () => (Object.hasOwn(globalThis, name) ? globalThis[name] : undefined),
        set: value => {
          globalThis[name] = value;
        },
      });
    }
  }

  runGlobalCode(code, options) {
    try {
      vm.runInThisContext(code, options);
    } finally {
      this.mirrorGlobalsOnWindow();
    }
  }

  async runModuleScript(element) {
    let path = `${this.url.pathname}.inline-module-${inlineModules.size}.js`;
    if (element.hasAttribute("src")) path = new URL(element.getAttribute("src"), this.url).pathname;
    else inlineModules.set(path, element.textContent);
    try {
      await import(`wpt:${path}`);
      if (element.hasAttribute("src")) element.dispatchEvent(new Event("load"));
    } catch (error) {
      this.reportException(error);
    }
    this.mirrorGlobalsOnWindow();
  }

  // What a vendor's testharnessreport.js does.
  didLoadTestharness() {
    const subtestStatuses = ["PASS", "FAIL", "TIMEOUT", "NOTRUN", "PRECONDITION_FAILED"];
    const harnessStatuses = ["OK", "ERROR", "TIMEOUT", "PRECONDITION_FAILED"];
    this.hasTestharness = true;
    this.window.setup({ output: false, timeout_multiplier: timeoutMultiplier });
    this.window.add_completion_callback((tests, status) => {
      result.subtests = tests.map(test => ({
        name: test.name,
        status: subtestStatuses[test.status],
        message: test.message ?? null,
      }));
      finish(harnessStatuses[status.status], status.message);
    });
  }
}

async function main() {
  const scriptPath = scriptPathForGeneratedPage(testURL.pathname);
  const source = readFromWPT(scriptPath ? new URL(scriptPath, testURL) : testURL);
  if (source === null) finish("HARNESS_ERROR", `${scriptPath ?? testURL.pathname} is not a file in ${wptDirectory}`);

  const page = new TestPage(testURL);
  // With `explicit_timeout` nothing keeps the process alive. `timeout()` makes testharness.js report what it has.
  process.on("beforeExit", () => (page.hasTestharness ? page.window.timeout() : finish("TIMEOUT", "nothing left to wait for")));
  await page.load(scriptPath ? markupForScriptTest(scriptPath, source) : source);

  if (!page.hasTestharness) {
    // A crash test passes when the process survives. `class=test-wait` on the root element asks for more time.
    const deadline = performance.now() + 10_000 * timeoutMultiplier;
    while (page.document.documentElement?.classList.contains("test-wait")) {
      if (performance.now() > deadline) finish("TIMEOUT", "class=test-wait was never removed");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    finish("OK", "no testharness.js");
  }
}

main().catch(error => finish("HARNESS_ERROR", error?.stack ?? String(error)));

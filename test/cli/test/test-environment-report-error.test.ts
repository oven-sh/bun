import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Bun's own reportError() knows nothing of a test file's window. In a DOM environment the global one is the window's,
// or one that dispatches the event for a window that has none. jsdom has its own from version 31.

// Split in two because `bun test` scans a test file's whole text for this name, this file's included.
const VITEST = "@vitest" + "-environment";

async function bunTest(cwd: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd,
    env: { ...bunEnv, NODE_PATH: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    // slice(1) drops the "bun test v1.2.3" banner.
    printed: stdout.split("\n").slice(1).filter(Boolean),
    stderr,
    verdicts: Object.fromEntries(
      Array.from(stderr.matchAll(/^\((pass|fail)\) (.+?)(?: \[[\d.]+ms\])?$/gm), ([, verdict, name]) => [
        name,
        verdict,
      ]),
    ),
    exitCode,
  };
}

// Loads in a debug build without the seconds that jsdom and happy-dom take. Each event says who made it.
const fakePackage = (reportError: "own" | "inherited" | "absent") => `
  class EventTarget {
    #listeners = new Set();
    addEventListener(type, listener) {
      if (type === "error") this.#listeners.add(listener);
    }
    removeEventListener(type, listener) {
      if (type === "error") this.#listeners.delete(listener);
    }
    dispatchEvent(event) {
      event.eventPhase = 2;
      for (const listener of this.#listeners) listener(event);
      return !event.defaultPrevented;
    }
  }
  class Event {
    constructor(error, reportedBy) {
      this.error = error;
      this.reportedBy = reportedBy;
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  }
  // Only Bun's reportError() makes one.
  class ErrorEvent extends Event {
    constructor(type, { error }) {
      super(error, "Bun");
    }
  }
  // Like jsdom's, it has to be called on a window, and the window prints what nothing cancels.
  function reportError(error) {
    if (!(this instanceof Window)) throw new TypeError("'reportError' called on an object that is not a Window.");
    if (this.dispatchEvent(new Event(error, "the window"))) this.printedByWindow.push(error.message);
  }
  class Window extends EventTarget {
    EventTarget = EventTarget;
    ErrorEvent = ErrorEvent;
    AbortController = class {};
    AbortSignal = class {};
    Blob = class {};
    FormData = class {};
    document = { defaultView: this };
    happyDOM = { async abort() {} };
    printedByWindow = [];
    close() {}
    ${reportError === "own" ? "reportError = reportError;" : ""}
  }
  ${reportError === "inherited" ? "Window.prototype.reportError = reportError;" : ""}
  exports.Window = Window;
  exports.JSDOM = class JSDOM {
    window = new Window();
  };`;

const withWindow = (name: string) => `// ${VITEST} ${name}
  import { test } from "bun:test";
  const atImport = reportError;

  test("${name}: a listener hears it", () => {
    const heard = [];
    const notCanceled = new Error("not canceled");
    const listener = event => {
      heard.push(event.error.message + " by " + event.reportedBy);
      if (event.error !== notCanceled) event.preventDefault();
    };
    window.addEventListener("error", listener);
    reportError(new Error("bare"));
    globalThis.reportError(new Error("globalThis"));
    window.reportError(new Error("window"));
    atImport(new Error("at import"));
    reportError(notCanceled);
    window.removeEventListener("error", listener);
    const isOneFunction = reportError === atImport && window.reportError === atImport;
    const mine = () => {};
    globalThis.reportError = mine;
    const isAssignable = reportError === mine;
    globalThis.reportError = atImport;
    const name = atImport.name;
    console.log("${name}", JSON.stringify({ heard, name, isOneFunction, isAssignable, printedByWindow }));
  });

  test("${name}: nobody listens", () => {
    reportError(new Error("unheard in ${name}"));
    console.log("${name} unheard", JSON.stringify(printedByWindow));
  });`;

const withoutWindow = `
  import { test } from "bun:test";
  test("without a window", () => {
    const { value, ...descriptor } = Object.getOwnPropertyDescriptor(globalThis, "reportError");
    const isNative = String(value).includes("[native code]");
    console.log("node", JSON.stringify({ ...descriptor, name: value.name, isNative }));
  });`;

const native = `node {"writable":true,"enumerable":true,"configurable":true,"name":"reportError","isNative":true}`;

describe.concurrent("reportError() in a DOM environment", () => {
  for (const args of [[], ["--isolate"], ["--isolate=modules"]]) {
    test.each([
      ["that has its own", "own"],
      ["that inherits one", "inherited"],
      ["that has none", "absent"],
    ] as const)(`${args.length ? `${args[0]}: ` : ""}the global one reports to a window %s`, async (_, reportError) => {
      using dir = tempDir("test-environment-report-error", {
        "node_modules/jsdom/package.json": JSON.stringify({ name: "jsdom", main: "index.js" }),
        "node_modules/jsdom/index.js": fakePackage(reportError),
        "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.js" }),
        "node_modules/happy-dom/index.js": fakePackage(reportError),
        "1.test.js": withoutWindow,
        "2.test.js": withWindow("jsdom"),
        "3.test.js": withWindow("happy-dom"),
        "4.test.js": withoutWindow,
      });
      const windowHasOne = reportError !== "absent";
      // What nothing cancels: a window with the function prints it, and Bun's own function calls console.error().
      const byWindow = (...messages: string[]) => (windowHasOne ? messages : []);
      const byBun = (...messages: string[]) => (windowHasOne ? [] : messages.map(message => `error: ${message}`));
      const withListener = JSON.stringify({
        heard: ["bare", "globalThis", "window", "at import", "not canceled"].map(
          message => `${message} by ${windowHasOne ? "the window" : "Bun"}`,
        ),
        name: windowHasOne ? "bound reportError" : "reportError",
        isOneFunction: true,
        isAssignable: true,
        printedByWindow: byWindow("not canceled"),
      });

      const { printed, stderr, verdicts, exitCode } = await bunTest(String(dir), args);
      expect(printed).toEqual([
        native,
        `jsdom ${withListener}`,
        // The runner hears what no listener of a jsdom file hears, and cancels it.
        `jsdom unheard ${JSON.stringify(byWindow("not canceled"))}`,
        `happy-dom ${withListener}`,
        `happy-dom unheard ${JSON.stringify(byWindow("not canceled", "unheard in happy-dom"))}`,
        native,
      ]);
      expect(stderr.match(/^error: .+$/gm)).toEqual([
        ...byBun("not canceled"),
        "error: unheard in jsdom",
        ...byBun("not canceled", "unheard in happy-dom"),
      ]);
      expect(verdicts).toEqual({
        "without a window": "pass",
        "jsdom: a listener hears it": "pass",
        "jsdom: nobody listens": "fail",
        "happy-dom: a listener hears it": "pass",
        "happy-dom: nobody listens": "pass",
      });
      expect(exitCode).toBe(1);
    });
  }
});

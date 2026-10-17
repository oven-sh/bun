import { spawn } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir, withoutAggressiveGC } from "harness";

test("exists", () => {
  expect(typeof URL !== "undefined").toBe(true);
  expect(typeof URLSearchParams !== "undefined").toBe(true);
  expect(typeof DOMException !== "undefined").toBe(true);
  expect(typeof Event !== "undefined").toBe(true);
  expect(typeof EventTarget !== "undefined").toBe(true);
  expect(typeof AbortController !== "undefined").toBe(true);
  expect(typeof AbortSignal !== "undefined").toBe(true);
  expect(typeof CustomEvent !== "undefined").toBe(true);
  expect(typeof Headers !== "undefined").toBe(true);
  expect(typeof ErrorEvent !== "undefined").toBe(true);
  expect(typeof CloseEvent !== "undefined").toBe(true);
  expect(typeof MessageEvent !== "undefined").toBe(true);
  expect(typeof TextEncoder !== "undefined").toBe(true);
  expect(typeof WebSocket !== "undefined").toBe(true);
  expect(typeof Blob !== "undefined").toBe(true);
  expect(typeof FormData !== "undefined").toBe(true);
  expect(typeof Worker !== "undefined").toBe(true);
  expect(typeof File !== "undefined").toBe(true);
  expect(typeof Performance !== "undefined").toBe(true);
  expect(typeof PerformanceEntry !== "undefined").toBe(true);
  expect(typeof PerformanceMark !== "undefined").toBe(true);
  expect(typeof PerformanceMeasure !== "undefined").toBe(true);
  expect(typeof PerformanceObserver !== "undefined").toBe(true);
  expect(typeof PerformanceObserverEntryList !== "undefined").toBe(true);
  expect(typeof PerformanceResourceTiming !== "undefined").toBe(true);
  expect(typeof PerformanceServerTiming !== "undefined").toBe(true);
  expect(typeof PerformanceTiming !== "undefined").toBe(true);
  expect(typeof Math.sumPrecise !== "undefined").toBe(true);
});

const globalSetters = [
  [ErrorEvent, "onerror", "error", "error"],
  [MessageEvent, "onmessage", "message", "data"],
];

for (const [Constructor, name, eventName, prop] of globalSetters) {
  test(`self.${name}`, () => {
    var called = false;
    console.log("name", name);

    const callback = ({ [prop]: data }) => {
      expect(data).toBe("hello");
      called = true;
    };

    try {
      globalThis[name] = callback;
      expect(globalThis[name]).toBe(callback);
      dispatchEvent(new Constructor(eventName, { data: "hello", error: "hello" }));
      expect(called).toBe(true);
    } finally {
      globalThis[name] = null;

      called = false;
      dispatchEvent(new Constructor(eventName, { data: "hello", error: "hello" }));
      expect(called).toBe(false);
    }
  });

  test(`self.addEventListener(${name})`, () => {
    var called = false;

    const callback = ({ [prop]: data }) => {
      expect(data).toBe("hello");
      called = true;
    };

    try {
      addEventListener(eventName, callback);
      dispatchEvent(new Constructor(eventName, { data: "hello", error: "hello" }));
      expect(called).toBe(true);
    } finally {
      globalThis[name] = null;
      removeEventListener(eventName, callback);
      called = false;
      dispatchEvent(new Constructor(eventName, { data: "hello", error: "hello" }));
      expect(called).toBe(false);
    }
  });
}

// Assigning onmessage/onerror through a receiver that is not the global object
// (e.g. a Proxy of globalThis) used to crash with a type confusion.
test.concurrent("onmessage/onerror assignment through a Proxy of globalThis", async () => {
  const script = `
    const messages = [];
    const onMessage = e => messages.push(e.data);
    new Proxy(globalThis, {}).onmessage = onMessage;
    if (globalThis.onmessage !== onMessage) throw new Error("onmessage not installed through Proxy");
    dispatchEvent(new MessageEvent("message", { data: "hello" }));
    if (messages.join() !== "hello") throw new Error("onmessage not dispatched");
    new Proxy(globalThis, {}).onmessage = null;
    if (globalThis.onmessage !== null) throw new Error("onmessage not cleared through Proxy");

    const onError = () => {};
    new Proxy(globalThis, {}).onerror = onError;
    if (globalThis.onerror !== onError) throw new Error("onerror not installed through Proxy");
    new Proxy(globalThis, {}).onerror = null;
    if (globalThis.onerror !== null) throw new Error("onerror not cleared through Proxy");

    with (new Proxy(globalThis, {})) { onmessage = function () {} }
    if (typeof globalThis.onmessage !== "function") throw new Error("onmessage not installed through with scope");
    globalThis.onmessage = null;
    console.log("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test.concurrent("worker: onmessage assignment through a Proxy of self", async () => {
  using dir = tempDir("worker-proxy-onmessage", {
    "worker.js": `
      new Proxy(self, {}).onmessage = e => postMessage("echo:" + e.data);
      postMessage("ready");
    `,
    "main.js": `
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);
      worker.onmessage = e => {
        if (e.data === "ready") {
          worker.postMessage("hi");
        } else {
          console.log(e.data);
          worker.terminate();
        }
      };
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("echo:hi\n");
  expect(exitCode).toBe(0);
});

test("CloseEvent", () => {
  var event = new CloseEvent("close", { reason: "world" });
  expect(event.type).toBe("close");
  const target = new EventTarget();
  var called = false;
  target.addEventListener("close", ({ type, reason }) => {
    expect(type).toBe("close");
    expect(reason).toBe("world");
    called = true;
  });
  target.dispatchEvent(event);
  expect(called).toBe(true);
});

test("MessageEvent", () => {
  var event = new MessageEvent("message", { data: "world" });
  expect(event.type).toBe("message");
  const target = new EventTarget();
  var called = false;
  target.addEventListener("message", ({ type, data }) => {
    expect(type).toBe("message");
    expect(data).toBe("world");
    called = true;
  });
  target.dispatchEvent(event);
  expect(called).toBe(true);
});

it("crypto.getRandomValues", () => {
  var foo = new Uint8Array(32);

  // run it once buffered and unbuffered
  {
    var array = crypto.getRandomValues(foo);
    expect(array).toBe(foo);
    expect(array.reduce((sum, a) => (sum += a === 0), 0) != foo.length).toBe(true);
  }

  // disable it for this block because it tends to get stuck here running the GC forever
  withoutAggressiveGC(() => {
    // run it again to check that the fast path works
    for (var i = 0; i < 9000; i++) {
      var array = crypto.getRandomValues(foo);
      expect(array).toBe(foo);
    }
  });

  // run it on a large input
  expect(!!crypto.getRandomValues(new Uint8Array(8192)).find(a => a > 0)).toBe(true);

  {
    // any additional input into getRandomValues() makes it unbuffered
    var array = crypto.getRandomValues(foo, "unbuffered");
    expect(array).toBe(foo);
    expect(array.reduce((sum, a) => (sum += a === 0), 0) != foo.length).toBe(true);
  }
});

// not actually a web global
it("crypto.timingSafeEqual", () => {
  const crypto = import.meta.require("node:crypto");
  var uuidStr = crypto.randomUUID();
  expect(uuidStr.length).toBe(36);
  expect(uuidStr[8]).toBe("-");
  expect(uuidStr[13]).toBe("-");
  expect(uuidStr[18]).toBe("-");
  expect(uuidStr[23]).toBe("-");
  const uuid = Buffer.from(uuidStr);

  expect(crypto.timingSafeEqual(uuid, uuid)).toBe(true);
  expect(crypto.timingSafeEqual(uuid, uuid.slice())).toBe(true);
  try {
    crypto.timingSafeEqual(uuid, uuid.slice(1));
    expect.unreachable();
  } catch (e) {}

  try {
    crypto.timingSafeEqual(uuid, uuid.slice(0, uuid.length - 2));
    expect.unreachable();
  } catch (e) {
    expect(e.message).toBe("Input buffers must have the same byte length");
  }

  try {
    expect(crypto.timingSafeEqual(uuid, crypto.randomUUID())).toBe(false);
    expect.unreachable();
  } catch (e) {
    expect(e.name).toBe("TypeError");
  }

  var shorter = uuid.slice(0, 1);
  for (let i = 0; i < 9000; i++) {
    if (!crypto.timingSafeEqual(shorter, shorter)) throw new Error("fail");
  }
});

it("crypto.randomUUID", () => {
  var uuid = crypto.randomUUID();
  expect(uuid.length).toBe(36);
  expect(uuid[8]).toBe("-");
  expect(uuid[13]).toBe("-");
  expect(uuid[18]).toBe("-");
  expect(uuid[23]).toBe("-");

  withoutAggressiveGC(() => {
    // check that the fast path works
    // (45,000 expect() calls don't fit in the test budget on debug builds, so
    // check the predicate and call expect() on the first malformed UUID only)
    let malformed;
    for (let i = 0; i < 9000 && malformed === undefined; i++) {
      var uuid2 = crypto.randomUUID();
      if (uuid2.length !== 36 || uuid2[8] !== "-" || uuid2[13] !== "-" || uuid2[18] !== "-" || uuid2[23] !== "-") {
        malformed = uuid2;
      }
    }
    expect(malformed).toBeUndefined();
  });
});

it("crypto.randomUUID version, issues#3575", () => {
  var uuid = crypto.randomUUID();

  function validate(uuid) {
    const regex =
      /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
    return typeof uuid === "string" && regex.test(uuid);
  }
  function version(uuid) {
    if (!validate(uuid)) {
      throw TypeError("Invalid UUID");
    }

    return parseInt(uuid.slice(14, 15), 16);
  }

  expect(version(uuid)).toBe(4);
});

it("URL.prototype.origin", () => {
  const url = new URL("https://html.spec.whatwg.org/");
  const { origin, host, hostname } = url;

  expect(hostname).toBe("html.spec.whatwg.org");
  expect(host).toBe("html.spec.whatwg.org");
  expect(origin).toBe("https://html.spec.whatwg.org");
});

test("navigator", () => {
  expect(globalThis.navigator !== undefined).toBe(true);
  const version = process.versions.bun;
  const userAgent = `Bun/${version}`;
  expect(navigator.hardwareConcurrency > 0).toBe(true);
  expect(navigator.userAgent).toBe(userAgent);
  if (isMacOS) {
    expect(navigator.platform).toBe("MacIntel");
  } else if (isWindows) {
    expect(navigator.platform).toBe("Win32");
  } else if (isLinux) {
    expect(navigator.platform).toBe("Linux x86_64");
  }
  expect(navigator.language).toBe(Intl.DateTimeFormat().resolvedOptions().locale);
  expect(navigator.languages).toEqual([navigator.language]);
  expect(navigator.languages).toBe(navigator.languages);
  expect(Object.isFrozen(navigator.languages)).toBe(true);
});

test("Navigator", () => {
  expect(Object.getOwnPropertyDescriptor(globalThis, "Navigator")).toEqual({
    value: Navigator,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  expect([typeof Navigator, Navigator.name, Navigator.length]).toEqual(["function", "Navigator", 0]);
  expect(navigator).toBeInstanceOf(Navigator);
  expect(Object.getPrototypeOf(navigator)).toBe(Navigator.prototype);
  expect(Object.getPrototypeOf(Navigator.prototype)).toBe(Object.prototype);
  expect(Navigator.prototype.constructor).toBe(Navigator);
  expect(Object.prototype.toString.call(navigator)).toBe("[object Navigator]");
  expect(Reflect.ownKeys(navigator)).toEqual([]);
  expect(Object.keys(Navigator.prototype).sort()).toEqual([
    "hardwareConcurrency",
    "language",
    "languages",
    "platform",
    "userAgent",
  ]);
  for (const make of [() => new Navigator(), () => Navigator(), () => new (class extends Navigator {})()])
    expect(make).toThrow(expect.objectContaining({ name: "TypeError", code: "ERR_ILLEGAL_CONSTRUCTOR" }));
  for (const key of Object.keys(Navigator.prototype)) {
    expect(() => Navigator.prototype[key]).toThrow(TypeError);
    expect(() => Object.create(navigator)[key]).toThrow(TypeError);
  }
  // Only a window's navigator describes a browser. Old copies of jsbn read `window.crypto` when `appName` is "Netscape".
  // Nor has Node's `onLine`: code that records the browser's online state finds none outside of a DOM.
  for (const key of ["appName", "appVersion", "product", "vendor", "cookieEnabled", "plugins", "javaEnabled", "onLine"])
    expect(key in navigator).toBe(false);
});

test("the members of navigator can be replaced on the object and on Navigator.prototype", async () => {
  const src = `
    const { userAgent, platform } = navigator;
    const results = [];
    Object.defineProperty(navigator, "userAgent", { value: "on the object", configurable: true });
    results.push(navigator.userAgent);
    delete navigator.userAgent;
    results.push(navigator.userAgent === userAgent);
    const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "on the prototype", configurable: true });
    results.push(navigator.platform);
    Object.defineProperty(Navigator.prototype, "platform", descriptor);
    results.push(navigator.platform === platform);
    navigator.clipboard = { readText() {} };
    results.push(typeof navigator.clipboard.readText);
    console.log(JSON.stringify(results));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(["on the object", true, "on the prototype", true, "function"]);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/21585
test.concurrent.each(["userAgent", "platform", "hardwareConcurrency", "language", "languages"])(
  "navigator.%s is a getter-only accessor",
  async key => {
    // Spawn a fresh process so we don't mutate the test runner's own navigator object.
    const k = JSON.stringify(key);
    const src = `
    const nav = globalThis.navigator;
    const before = nav[${k}];
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, ${k});
    let strictErr = null;
    try {
      (function () { "use strict"; nav[${k}] = "overwritten"; })();
    } catch (e) {
      strictErr = e.constructor.name;
    }
    // indirect eval for sloppy-mode assignment (bun -e is a module / strict by default)
    (0, eval)('globalThis.navigator[${k}] = "overwritten";');
    console.log(JSON.stringify({
      before,
      after: nav[${k}],
      desc: { get: typeof desc.get, set: typeof desc.set, enumerable: desc.enumerable, configurable: desc.configurable, hasWritable: "writable" in desc },
      strictErr,
    }));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = JSON.parse(stdout);
    expect({ ...result, stderr, exitCode }).toEqual({
      before: result.before,
      after: result.before,
      desc: { get: "function", set: "undefined", enumerable: true, configurable: true, hasWritable: false },
      strictErr: "TypeError",
      stderr: expect.any(String),
      exitCode: 0,
    });
    expect(result.after).not.toBe("overwritten");
  },
);

test("confirm (yes) unix newline", async () => {
  const proc = spawn({
    cmd: [bunExe(), require("path").join(import.meta.dir, "./confirm-fixture.js")],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write("Y");
  await proc.stdin.flush();

  proc.stdin.write("\n");
  await proc.stdin.flush();

  await proc.exited;

  expect(await proc.stderr.text()).toBe("Yes\n");
});

test("confirm (yes) windows newline", async () => {
  const proc = spawn({
    cmd: [bunExe(), require("path").join(import.meta.dir, "./confirm-fixture.js")],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write("Y");
  await proc.stdin.flush();

  proc.stdin.write("\r\n"); // Windows-style newline
  await proc.stdin.flush();

  await proc.exited;

  expect(await proc.stderr.text()).toBe("Yes\n");
});

test("confirm (no) unix newline", async () => {
  const proc = spawn({
    cmd: [bunExe(), require("path").join(import.meta.dir, "./confirm-fixture.js")],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write("poask\n");
  await proc.stdin.flush();
  await proc.exited;

  expect(await proc.stderr.text()).toBe("No\n");
});

test("confirm (no) windows newline", async () => {
  const proc = spawn({
    cmd: [bunExe(), require("path").join(import.meta.dir, "./confirm-fixture.js")],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write("poask\r\n");
  await proc.stdin.flush();
  await proc.exited;

  expect(await proc.stderr.text()).toBe("No\n");
});

test("globalThis.self = 123 works", () => {
  expect(Object.getOwnPropertyDescriptor(globalThis, "self")).toMatchObject({
    configurable: true,
    enumerable: true,
    get: expect.any(Function),
    set: expect.any(Function),
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "self");
  try {
    globalThis.self = 123;
    expect(globalThis.self).toBe(123);
  } finally {
    Object.defineProperty(globalThis, "self", original);
  }
});

// A constructor reads `new.target.prototype` for the prototype of the object it makes. The read can
// run script and throw, so it comes after the arguments convert and before the constructor steps.
describe("new.target.prototype", () => {
  function unreadableNewTarget() {
    const newTarget = function () {}.bind(null);
    Object.defineProperty(newTarget, "prototype", {
      get() {
        throw new Error("prototype getter");
      },
    });
    return newTarget;
  }

  test.each([
    ["AbortController", AbortController, []],
    ["Bun.Cookie", Bun.Cookie, ["name", "value"]],
    ["Bun.CookieMap", Bun.CookieMap, ["a=1"]],
    ["CloseEvent", CloseEvent, ["close"]],
    ["CustomEvent", CustomEvent, ["custom"]],
    ["DOMException", DOMException, ["message", "NotFoundError"]],
    ["ErrorEvent", ErrorEvent, ["error"]],
    ["Event", Event, ["event"]],
    ["EventEmitter (of process)", Object.getPrototypeOf(process).constructor, []],
    ["EventTarget", EventTarget, []],
    ["FormData", FormData, []],
    ["Headers (init)", Headers, [{ a: "1" }]],
    ["Headers (copy)", Headers, [new Headers({ a: "1" })]],
    ["MessageChannel", MessageChannel, []],
    ["MessageEvent", MessageEvent, ["message"]],
    ["PerformanceMark", PerformanceMark, ["mark"]],
    ["PerformanceObserver", PerformanceObserver, [() => {}]],
    ["TextEncoder", TextEncoder, []],
    ["URL", URL, ["http://example.com/"]],
    ["URLPattern (pattern, base)", URLPattern, ["/a", "http://example.com/"]],
    ["URLPattern (init)", URLPattern, [{ pathname: "/a" }]],
    ["URLSearchParams", URLSearchParams, ["a=1"]],
  ])("new %s reads it once and gives it to the object", (_name, Constructor, args) => {
    let reads = 0;
    const prototype = Object.create(Constructor.prototype);
    const newTarget = function () {}.bind(null);
    Object.defineProperty(newTarget, "prototype", {
      get() {
        reads++;
        return prototype;
      },
    });
    const object = Reflect.construct(Constructor, args, newTarget);
    expect({ reads, prototype: Object.getPrototypeOf(object) === prototype }).toEqual({ reads: 1, prototype: true });
  });

  test.each([
    ["URL", URL, ["not a url"]],
    ["URLPattern (pattern, base)", URLPattern, ["((", "http://example.com/"]],
    ["URLPattern (init)", URLPattern, [{ pathname: "((" }]],
    ["Headers", Headers, [{ "bad name": "1" }]],
    ["Bun.Cookie", Bun.Cookie, ["name", "value", { sameSite: "bogus" }]],
    ["WebSocket (url)", WebSocket, ["http://[bad"]],
    ["WebSocket (url, protocol)", WebSocket, ["http://[bad", "chat"]],
    ["WebSocket (url, options)", WebSocket, ["http://[bad", {}]],
  ])("new %s: a failed read wins over arguments that the constructor steps reject", (_name, Constructor, args) => {
    expect(() => new Constructor(...args)).toThrow();
    expect(() => Reflect.construct(Constructor, args, unreadableNewTarget())).toThrow("prototype getter");
  });

  test("arguments convert before the read", () => {
    expect(() => Reflect.construct(URL, [], unreadableNewTarget())).toThrow(TypeError);
    const url = {
      toString() {
        throw new RangeError("toString");
      },
    };
    expect(() => Reflect.construct(URL, [url], unreadableNewTarget())).toThrow(RangeError);
  });

  test("new PerformanceMark runs its steps before the read, as Node does", () => {
    expect(() => Reflect.construct(PerformanceMark, ["mark", { startTime: -1 }], unreadableNewTarget())).toThrow(
      TypeError,
    );
  });

  test("new Worker: a failed read leaves the transfer list alone", async () => {
    const script = "data:text/javascript,";
    const buffer = new ArrayBuffer(8);
    const options = { workerData: buffer, transferList: [buffer] };
    expect(() => Reflect.construct(Worker, [script, options], unreadableNewTarget())).toThrow("prototype getter");
    expect(buffer.byteLength).toBe(8);

    // A prototype that can be read: the worker starts, takes the buffer, and ends with its empty script.
    class Subclass extends Worker {}
    const worker = new Subclass(script, options);
    expect(Object.getPrototypeOf(worker)).toBe(Subclass.prototype);
    expect(buffer.byteLength).toBe(0);
    await new Promise(resolve => worker.addEventListener("close", resolve, { once: true }));
  });

  test("new ReadableStreamDefaultReader: a failed read leaves the stream alone", async () => {
    const response = new Response("hello");
    expect(() => Reflect.construct(ReadableStreamDefaultReader, [response.body], unreadableNewTarget())).toThrow(
      "prototype getter",
    );
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe("hello");
  });
});

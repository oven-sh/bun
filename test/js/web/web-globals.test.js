import { spawn } from "bun";
import { expect, it, test } from "bun:test";
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
});

// https://github.com/oven-sh/bun/issues/21585
test.concurrent.each(["userAgent", "platform", "hardwareConcurrency"])(
  "navigator.%s is a getter-only accessor",
  async key => {
    // Spawn a fresh process so we don't mutate the test runner's own navigator object.
    const k = JSON.stringify(key);
    const src = `
    const nav = globalThis.navigator;
    const before = nav[${k}];
    const desc = Object.getOwnPropertyDescriptor(nav, ${k});
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

// https://github.com/oven-sh/bun/issues/5267
// readline puts the TTY into raw mode (no ICANON, no ECHO, no ICRNL), so
// Enter delivers a bare CR and typed input is invisible. alert/confirm/prompt
// must temporarily restore cooked mode so the blocking line read sees LF and
// the user can see what they typed, then put raw mode back for readline.
test.skipIf(isWindows)("alert/confirm/prompt work while readline has stdin in raw mode", async () => {
  const childSrc = `
    const readline = require("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(resolve => rl.question(q, resolve));
    const say = s => process.stdout.write(s + "\\n");
    (async () => {
      say("RL1 " + JSON.stringify(await ask("rl1? ")));
      say("PROMPT " + JSON.stringify(prompt("name?")));
      say("CONFIRM " + JSON.stringify(confirm("ok?")));
      alert("bye");
      say("ALERT done");
      say("RL2 " + JSON.stringify(await ask("rl2? ")));
      rl.close();
      process.exit(0);
    })().catch(e => { say("ERR " + e.message); process.exit(1); });
  `;

  const decoder = new TextDecoder();
  let out = "";
  const waiters = [];
  const pump = () => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (out.includes(waiters[i].marker)) waiters.splice(i, 1)[0].resolve();
    }
  };
  await using terminal = new Bun.Terminal({
    data(_t, chunk) {
      out += decoder.decode(chunk, { stream: true });
      pump();
    },
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", childSrc], env: bunEnv, terminal });
  // A child that dies early must reject the pending waitFor rather than hang
  // it. A pre-constructed Bun.Terminal does not fire its exit() callback on
  // child exit, so key this off the process itself. A clean exit is left to
  // the data callback (the final PTY read can arrive after the pidfd event in
  // the same poll batch, so rejecting on code 0 would race the success path).
  let childExitError;
  proc.exited.then(code => {
    if (code === 0) return;
    childExitError = new Error("child exited (" + code + ") before expected output; out=" + JSON.stringify(out));
    for (const w of waiters.splice(0)) w.reject(childExitError);
  });
  const waitFor = marker =>
    new Promise((resolve, reject) => {
      if (childExitError) return reject(childExitError);
      waiters.push({ marker, resolve, reject });
      pump();
    });

  await waitFor("rl1? ");
  terminal.write("first\r");
  await waitFor('RL1 "first"');

  await waitFor("name?");
  terminal.write("alice\r");
  await waitFor('PROMPT "alice"');

  await waitFor("ok?");
  terminal.write("y\r");
  await waitFor("CONFIRM true");

  await waitFor("[Enter]");
  terminal.write("\r");
  await waitFor("ALERT done");

  await waitFor("rl2? ");
  terminal.write("second\r");
  await waitFor('RL2 "second"');

  await proc.exited;

  const flat = Bun.stripANSI(out).replace(/\r/g, "");
  // Echo must have been on during prompt(): the characters we typed should be
  // visible between the prompt text and the PROMPT result line.
  expect(flat).toContain("name? alice");
  // Raw mode must have been restored for readline: if the guard left stdin
  // cooked the kernel would echo "second" in addition to readline's own echo,
  // so it would appear twice between the second prompt and the result line.
  const rl2 = flat.slice(flat.indexOf("rl2? "), flat.indexOf('RL2 "second"'));
  expect(rl2.split("second").length - 1).toBe(1);
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

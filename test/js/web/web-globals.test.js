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

/**
 * Runs `script` on a pseudo-terminal. Each step waits for its text to show, then types its keys or calls
 * them with the terminal and the process. Returns what the terminal showed, without escape sequences and CR.
 */
async function typeOnTerminal(script, steps) {
  let output = "";
  let from = 0;
  let waiting;
  const decoder = new TextDecoder();
  const shown = () => Bun.stripANSI(output).replaceAll("\r", "");
  const check = () => {
    if (!waiting) return;
    const rest = shown().slice(from);
    const match =
      typeof waiting.text === "string"
        ? { index: rest.indexOf(waiting.text), 0: waiting.text }
        : waiting.text.exec(rest);
    if (!match || match.index === -1) return;
    from += match.index + match[0].length;
    waiting.resolve();
    waiting = undefined;
  };
  await using proc = spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    terminal: {
      cols: 200,
      rows: 50,
      data(_, chunk) {
        output += decoder.decode(chunk, { stream: true });
        check();
      },
    },
  });
  const exited = proc.exited.then(exitCode => {
    waiting?.reject(new Error(`exited with code ${exitCode} before ${waiting.text}:\n${output}`));
  });
  for (const [text, keys] of steps) {
    waiting = { text, ...Promise.withResolvers() };
    const shows = waiting.promise;
    check();
    await shows;
    if (typeof keys === "function") keys(proc.terminal, proc);
    else proc.terminal.write(keys);
  }
  await exited;
  return { shown: shown(), exitCode: proc.exitCode, signalCode: proc.signalCode };
}

// The script waits for one more line after its result, so the terminal is open while the result is read.
const resultThenLine = object => `console.log("RESULT:" + JSON.stringify(${object}) + "DONE"); alert("");`;
const resultOf = shown => JSON.parse(shown.match(/RESULT:(.*?)DONE/)[1]);

// Local flags of the termios of a pseudo-terminal. A ConPTY has none.
const ICANON = isLinux ? 0x2 : 0x100;
const ECHO = 0x8;
const ISIG = isLinux ? 0x1 : 0x80;
const lineFlags = terminal =>
  Object.entries({ ICANON, ECHO, ISIG })
    .filter(([, bit]) => terminal.localFlags & bit)
    .map(([name]) => name)
    .join(" ");
/** A step action that records the line flags under `flags[at]`, then types `keys`. */
const sampleThenType = (flags, at, keys) => terminal => {
  flags[at] = lineFlags(terminal);
  terminal.write(keys);
};
const lineMode = "ICANON ECHO ISIG";
const rawMode = "";

const blobWorker = source => `new Worker(URL.createObjectURL(new Blob([${JSON.stringify(source)}])))`;

// Raw mode gives Enter as a lone CR, does not echo, and does not make Ctrl+C a signal.
test.concurrent("prompt(), confirm() and alert() take a typed line on a terminal in raw mode", async () => {
  const { shown, exitCode } = await typeOnTerminal(
    `process.stdin.setRawMode(true);
     const name = prompt("name?");
     const yes = confirm("yes?");
     const no = confirm("no?");
     alert("alert!");
     const dflt = prompt("dflt?", "D");
     ${resultThenLine(`{ name, yes, no, dflt }`)}`,
    [
      ["name?", "Alice\r"],
      ["yes?", "y\r"],
      ["no?", "n\r"],
      ["alert!", "\r"],
      ["dflt?", "\r"],
      ["DONE", "\r"],
    ],
  );
  expect({ result: resultOf(shown), exitCode }).toEqual({
    result: { name: "Alice", yes: true, no: false, dflt: "D" },
    exitCode: 0,
  });
});

// A ConPTY does not turn a typed \x03 into CTRL_C_EVENT (terminal-platform-gaps.test.ts).
test.concurrent.skipIf(isWindows)("Ctrl+C ends a process that waits in a dialog on a raw-mode terminal", async () => {
  const { signalCode } = await typeOnTerminal(
    `process.stdin.setRawMode(true); prompt("name?"); console.log("the dialog returned");`,
    [["name?", "\x03"]],
  );
  expect(signalCode).toBe("SIGINT");
});

// Enter ends a read of these terminals, so a dialog leaves them as they are. Hidden input stays hidden.
test.concurrent.skipIf(isWindows).each([
  ["line mode without echo", ECHO, "ICANON ISIG"],
  ["cbreak mode without echo", ICANON | ECHO, "ISIG"],
])("a dialog does not change a terminal in %s", async (_, off, expected) => {
  const flags = {};
  const { shown, exitCode } = await typeOnTerminal(
    `alert("setup"); const secret = prompt("secret?"); ${resultThenLine(`{ secret }`)}`,
    [
      [
        "setup",
        terminal => {
          terminal.localFlags &= ~off;
          terminal.write("\r");
        },
      ],
      ["secret?", sampleThenType(flags, "prompt", "hunter2\r")],
      ["DONE", "\r"],
    ],
  );
  expect({ flags, result: resultOf(shown), exitCode }).toEqual({
    flags: { prompt: expected },
    result: { secret: "hunter2" },
    exitCode: 0,
  });
  expect(shown).not.toContain("secret? hunter2");
});

// `toString` of the default value runs script. It must not run between the mode change and the read.
test.concurrent("prompt() converts its default value before it writes the question", async () => {
  const { shown, exitCode } = await typeOnTerminal(
    `process.stdin.setRawMode(true);
     let threw;
     try {
       prompt("bad?", { toString() { throw new Error("no default"); } });
     } catch (error) {
       threw = error.message;
     }
     const next = prompt("next?");
     ${resultThenLine(`{ threw, next }`)}`,
    [
      ["next?", "x\r"],
      ["DONE", "\r"],
    ],
  );
  expect({ result: resultOf(shown), exitCode }).toEqual({
    result: { threw: "no default", next: "x" },
    exitCode: 0,
  });
  expect(shown).not.toContain("bad?");
});

// The next four tests load node:readline, start a Worker or start a second process. They are not
// concurrent: a debug build takes seconds for those when many processes start at the same time.

// https://github.com/oven-sh/bun/issues/5267
test.skipIf(isWindows)(
  "a dialog in a readline callback puts the terminal in line mode, then back in raw mode",
  async () => {
    const flags = {};
    const { shown, exitCode } = await typeOnTerminal(
      `const rl = require("node:readline").createInterface({ input: process.stdin, output: process.stdout });
       const ask = question => new Promise(resolve => rl.question(question, resolve));
       const first = await ask("first?");
       const name = prompt("name?");
       const yes = confirm("yes?");
       alert("alert!");
       const second = await ask("second?");
       rl.close();
       ${resultThenLine(`{ first, name, yes, second }`)}`,
      [
        ["first?", sampleThenType(flags, "readline", "one\r")],
        ["name?", sampleThenType(flags, "prompt", "Alice\r")],
        ["yes?", sampleThenType(flags, "confirm", "y\r")],
        ["alert!", sampleThenType(flags, "alert", "\r")],
        ["second?", sampleThenType(flags, "readlineAgain", "two\r")],
        ["DONE", "\r"],
      ],
    );
    expect({ flags, result: resultOf(shown), exitCode }).toEqual({
      flags: { readline: rawMode, prompt: lineMode, confirm: lineMode, alert: lineMode, readlineAgain: rawMode },
      result: { first: "one", name: "Alice", yes: true, second: "two" },
      exitCode: 0,
    });
    // The terminal echoes what is typed for a dialog.
    expect(shown).toContain("name? Alice\n");
    expect(shown).toContain("yes? [y/N] y\n");
  },
);

// Line mode belongs to the terminal, not to a thread: the last dialog that ends puts raw mode back.
// Both dialogs are alert(): its answer is a line of one byte, which only one of the two reads can take.
test.skipIf(isWindows)("dialogs in a Worker and on the main thread share line mode", async () => {
  const flags = {};
  const { exitCode } = await typeOnTerminal(
    `process.stdin.setRawMode(true);
     const worker = ${blobWorker(`postMessage("ready"); alert("worker!"); console.log("answered in the worker"); postMessage("answered");`)};
     let message = Promise.withResolvers();
     worker.onmessage = event => message.resolve(event.data);
     worker.onerror = event => message.reject(event);
     await message.promise;
     message = Promise.withResolvers();
     alert("main!");
     console.log("answered on the main thread");
     await message.promise;
     worker.terminate();
     console.log("key?");
     require("node:fs").readSync(0, Buffer.alloc(1));`,
    [
      [/worker![^]*main!|main![^]*worker!/, sampleThenType(flags, "bothWait", "\r")],
      ["answered", sampleThenType(flags, "oneWaits", "\r")],
      ["key?", sampleThenType(flags, "noneWaits", "k")],
    ],
  );
  expect({ flags, exitCode }).toEqual({
    flags: { bothWait: lineMode, oneWaits: lineMode, noneWaits: rawMode },
    exitCode: 0,
  });
});

// The owner of raw mode leaves it while a dialog of another thread holds line mode. The dialog keeps
// line mode, and the terminal is not put back in raw mode when the dialog ends.
test.skipIf(isWindows)("setRawMode(false) during a dialog of a Worker is not undone", async () => {
  const flags = {};
  const { shown, exitCode } = await typeOnTerminal(
    `process.on("SIGUSR2", () => {
       process.stdin.setRawMode(false);
       console.log("left raw mode");
     });
     process.stdin.setRawMode(true);
     const worker = ${blobWorker(`postMessage(prompt("worker?"));`)};
     const { promise, resolve, reject } = Promise.withResolvers();
     worker.onmessage = event => resolve(event.data);
     worker.onerror = reject;
     const fromWorker = await promise;
     worker.terminate();
     console.log("line?");
     require("node:fs").readSync(0, Buffer.alloc(16));
     ${resultThenLine(`{ fromWorker, isRaw: process.stdin.isRaw }`)}`,
    [
      [
        "worker?",
        (terminal, proc) => {
          flags.dialog = lineFlags(terminal);
          proc.kill("SIGUSR2");
        },
      ],
      ["left raw mode", sampleThenType(flags, "dialogAfterOwnerLeft", "w\r")],
      ["line?", sampleThenType(flags, "afterDialog", "k\r")],
      ["DONE", "\r"],
    ],
  );
  expect({ flags, result: resultOf(shown), exitCode }).toEqual({
    flags: { dialog: lineMode, dialogAfterOwnerLeft: lineMode, afterDialog: lineMode },
    result: { fromWorker: "w", isRaw: false },
    exitCode: 0,
  });
});

// `bun a.js | less`: a producer that did not change the terminal itself must not write its startup
// termios back at exit, over the mode that `less` set (#29592). A dialog of the producer changes the
// terminal only while it waits.
test.skipIf(isWindows)(
  "a pipeline producer that asked a question does not write the terminal mode at exit",
  async () => {
    const flags = {};
    const producer = `const answer = prompt("answer?");
                      console.log("answered " + answer);
                      require("node:fs").readSync(0, Buffer.alloc(1));`;
    const { exitCode } = await typeOnTerminal(
      `process.stdin.setRawMode(true);
       const producer = Bun.spawn({
         cmd: [process.execPath, "-e", ${JSON.stringify(producer)}],
         stdio: ["inherit", "pipe", "inherit"],
       });
       for await (const chunk of producer.stdout) process.stdout.write(chunk);
       console.log("producer exited " + (await producer.exited));
       require("node:fs").readSync(0, Buffer.alloc(1));`,
      [
        ["answer?", sampleThenType(flags, "dialog", "x\r")],
        [
          "answered x",
          terminal => {
            // What another reader of the same terminal does while the producer runs.
            terminal.localFlags |= ECHO;
            terminal.write("k");
          },
        ],
        ["producer exited 0", sampleThenType(flags, "afterProducer", "k")],
      ],
    );
    expect({ flags, exitCode }).toEqual({ flags: { dialog: lineMode, afterProducer: "ECHO" }, exitCode: 0 });
  },
);

// Only the CRLF terminator's `\r` is stripped. An earlier `\r` is part of the answer.
test.concurrent.each([
  ["hello\r\n", "hello"],
  ["x\r\r\n", "x\r"],
  ["\r\r\n", "\r"],
])("prompt with stdin %j returns %j", async (stdin, expected) => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", `console.error(JSON.stringify(prompt("Q?")));`],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  proc.stdin.write(stdin);
  await proc.stdin.flush();
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "Q? ",
    stderr: JSON.stringify(expected) + "\n",
    exitCode: 0,
  });
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

test("dispatchEvent skips a listener that is a WebAssembly GC object", () => {
  // (module (type $s (struct (field (mut i32))))
  //   (func (export "mk") (result (ref null $s)) struct.new_default $s))
  // prettier-ignore
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x0a, 0x02, 0x5f, 0x01, 0x7f, 0x01, 0x60, 0x00, 0x01, 0x63, 0x00,
    0x03, 0x02, 0x01, 0x01,
    0x07, 0x06, 0x01, 0x02, 0x6d, 0x6b, 0x00, 0x00,
    0x0a, 0x07, 0x01, 0x05, 0x00, 0xfb, 0x01, 0x00, 0x0b,
  ]);
  const listener = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.mk();
  const target = new EventTarget();
  let calls = 0;
  target.addEventListener("a", listener);
  target.addEventListener("a", () => calls++);
  target.dispatchEvent(new Event("a"));
  expect(calls).toBe(1);
});

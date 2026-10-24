import { spawn } from "bun";
import { describe, expect, it, test } from "bun:test";
import { closeSync, existsSync, openSync, readSync } from "fs";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir, withoutAggressiveGC } from "harness";
import { join } from "path";

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

/**
 * Runs `script` with `input` as its stdin and returns what it wrote to stderr.
 * "pipe" holds the whole input after one write. "file" is a regular file at offset 0.
 * "buffer" is what `stdin: Buffer` gives a child: a memfd on Linux, a pipe elsewhere.
 */
async function runWithStdin(kind, script, input) {
  using dir = kind === "file" ? tempDir("web-globals-stdin", { "stdin.txt": input }) : undefined;
  await using proc = spawn({
    cmd: [bunExe(), "-e", script],
    stdin: kind === "file" ? Bun.file(join(String(dir), "stdin.txt")) : kind === "buffer" ? Buffer.from(input) : "pipe",
    stderr: "pipe",
    stdout: "ignore",
    env: bunEnv,
  });
  if (kind === "pipe") {
    proc.stdin.write(input);
    await proc.stdin.end();
  }
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

/** What a script that ends with `console.error(JSON.stringify(value))` gives. */
const printed = value => ({ stderr: JSON.stringify(value) + "\n", exitCode: 0 });

const promptLines = {
  script: `const answers = [prompt("a?"), prompt("b?"), prompt("c?", "C"), prompt("d?", "D"), prompt("e?")];
           console.error(JSON.stringify({ answers, rest: await Bun.stdin.text() }));`,
  input: "hello\nworld\r\n\n\r\n\nrest-of-stdin\nmore\n",
  printed: printed({ answers: ["hello", "world", "C", "D", null], rest: "rest-of-stdin\nmore\n" }),
};

test.concurrent("prompt() takes one line of a Buffer stdin", async () => {
  expect(await runWithStdin("buffer", promptLines.script, promptLines.input)).toEqual(promptLines.printed);
});

describe.concurrent.each(["pipe", "file"])("a dialog takes one line of stdin (%s)", kind => {
  test("prompt(): LF, CRLF and empty lines, then Bun.stdin.text()", async () => {
    expect(await runWithStdin(kind, promptLines.script, promptLines.input)).toEqual(promptLines.printed);
  });

  test("prompt(): lines around the size of one read, then fs.readFileSync(0)", async () => {
    const lines = [10, 4095, 4096, 5000].map((length, i) => Buffer.alloc(length, String(i)).toString());
    expect(
      await runWithStdin(
        kind,
        `import { readFileSync } from "node:fs";
         const lines = [10, 4095, 4096, 5000].map((length, i) => Buffer.alloc(length, String(i)).toString());
         const answers = lines.map(() => prompt("?"));
         const rest = readFileSync(0, "utf8");
         console.error(JSON.stringify({
           lengths: answers.map(answer => answer?.length),
           same: answers.map((answer, i) => answer === lines[i]),
           restLength: rest.length,
           restSame: rest === Buffer.alloc(20000, "r").toString(),
         }));`,
        lines.join("\n") + "\n" + Buffer.alloc(20000, "r").toString(),
      ),
    ).toEqual(
      printed({
        lengths: [10, 4095, 4096, 5000],
        same: [true, true, true, true],
        restLength: 20000,
        restSame: true,
      }),
    );
  });

  test("prompt(): text without a line end is not an answer", async () => {
    expect(
      await runWithStdin(
        kind,
        `const r = prompt("?"); console.error(JSON.stringify({ r, rest: await Bun.stdin.text() }));`,
        "abc",
      ),
    ).toEqual(printed({ r: null, rest: "" }));
  });

  test("a child that inherits stdin gets the line after prompt()", async () => {
    expect(
      await runWithStdin(
        kind,
        `const r = prompt("parent?");
         const child = Bun.spawnSync({
           cmd: [process.execPath, "-e", 'console.error(JSON.stringify(prompt("child?")))'],
           stdin: "inherit",
           stderr: "pipe",
         });
         console.error(JSON.stringify({ r, child: child.stderr.toString() }));`,
        "PARENT\nCHILD\n",
      ),
    ).toEqual(printed({ r: "PARENT", child: '"CHILD"\n' }));
  });

  test.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("prompt(), confirm() and alert() in turn (%s)", async (_, eol) => {
    expect(
      await runWithStdin(
        kind,
        `const name = prompt("name?");
         const yes = confirm("yes?");
         const no = confirm("no?");
         const empty = confirm("empty?");
         alert("hi");
         const dflt = prompt("dflt?", "D");
         const last = prompt("last?");
         console.error(JSON.stringify({ name, yes, no, empty, dflt, last }));`,
        ["Alice", "y", "n", "", "", "", "last", ""].join(eol),
      ),
    ).toEqual(printed({ name: "Alice", yes: true, no: false, empty: false, dflt: "D", last: "last" }));
  });

  // A rejected answer is followed by an accepted one, so an answer that leaves a byte behind shows.
  test("confirm(): one line per answer", async () => {
    const answers = [
      ["y", true],
      ["Y", true],
      ["y\r", true],
      ["Y\r", true],
      ["", false],
      ["\r", false],
      ["n", false],
      ["y", true],
      ["n\r", false],
      ["y", true],
      ["yes", false],
      ["y", true],
      ["yes\r", false],
      ["y", true],
      ["y ", false],
      [" y", false],
      ["\rfoo", false],
      ["y", true],
      ["\ry", false],
      ["y", true],
      ["no\rway", false],
      ["y", true],
      ["y\rx", false],
      ["y", true],
    ];
    expect(
      await runWithStdin(
        kind,
        `const answers = [];
         for (let i = 0; i < ${answers.length}; i++) answers.push(confirm("?"));
         console.error(JSON.stringify({ answers, rest: await Bun.stdin.text() }));`,
        answers.map(([line]) => line + "\n").join("") + "rest\n",
      ),
    ).toEqual(printed({ answers: answers.map(([, yes]) => yes), rest: "rest\n" }));
  });
});

test.concurrent.each(["", "\r", "y", "y\r"])("confirm() is false when stdin ends after %j", async input => {
  expect(
    await runWithStdin(
      "pipe",
      `const c = confirm("?"); console.error(JSON.stringify({ c, rest: await Bun.stdin.text() }));`,
      input,
    ),
  ).toEqual(printed({ c: false, rest: "" }));
});

// A stream of a regular-file stdin starts at byte 0, so this is a pipe.
test.concurrent("the console async iterator gets what prompt() left", async () => {
  expect(
    await runWithStdin(
      "pipe",
      `const r = prompt("Q?");
       const lines = [];
       for await (const line of console) lines.push(line);
       console.error(JSON.stringify({ r, lines }));`,
      "p\nx\ny",
    ),
  ).toEqual(printed({ r: "p", lines: ["x", "y"] }));
});

test.concurrent("prompt() on a file stdin takes one line from the position that it inherits", async () => {
  const header = "SECRET-HEADER\n";
  using dir = tempDir("web-globals-stdin-offset", { "stdin.txt": header + "body1\nbody2\nbody3\n" });
  // The child reads through the offset of this descriptor. This process takes the first line.
  const stdin = openSync(join(String(dir), "stdin.txt"), "r");
  try {
    readSync(stdin, Buffer.alloc(header.length));
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { readSync } from "node:fs";
         const answer = prompt("name?");
         const next = Buffer.alloc(6);
         console.error(JSON.stringify({ answer, next: next.toString("utf8", 0, readSync(0, next)) }));`,
      ],
      stdin,
      stdout: "ignore",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const left = Buffer.alloc(64);
    expect({ stderr, exitCode, left: left.toString("utf8", 0, readSync(stdin, left)) }).toEqual({
      ...printed({ answer: "body1", next: "body2\n" }),
      left: "body3\n",
    });
  } finally {
    closeSync(stdin);
  }
});

// `syscr` of /proc/thread-self/io counts the read calls of the thread. One sample costs `sample` of them.
test.concurrent.skipIf(!existsSync("/proc/thread-self/io"))(
  "prompt() takes a line of a regular-file stdin with one read",
  async () => {
    expect(
      await runWithStdin(
        "file",
        `import { readFileSync } from "node:fs";
         const syscr = () => Number(/syscr: (\\d+)/.exec(readFileSync("/proc/thread-self/io", "utf8"))[1]);
         syscr();
         const sample = -syscr() + syscr();
         const before = syscr();
         const length = prompt("?").length;
         console.error(JSON.stringify({ length, reads: syscr() - before - sample }));`,
        Buffer.alloc(3000, "a").toString() + "\nrest\n",
      ),
    ).toEqual(printed({ length: 3000, reads: 1 }));
  },
);

const workerUrl = source => `URL.createObjectURL(new Blob([${JSON.stringify(source)}]))`;

test.concurrent("prompt() in a Worker takes one line and the main thread takes the next", async () => {
  expect(
    await runWithStdin(
      "pipe",
      `const worker = new Worker(${workerUrl(`postMessage(prompt("worker?"));`)});
       const { promise, resolve, reject } = Promise.withResolvers();
       worker.onmessage = event => resolve(event.data);
       worker.onerror = reject;
       const fromWorker = await promise;
       const fromMain = prompt("main?");
       const rest = await Bun.stdin.text();
       worker.terminate();
       console.error(JSON.stringify({ fromWorker, fromMain, rest }));`,
      "w\nm\nrest\n",
    ),
  ).toEqual(printed({ fromWorker: "w", fromMain: "m", rest: "rest\n" }));
});

/**
 * Runs `script`, which starts a Worker with `workerSource` and then prints "ready", and gives it `input`
 * after that line. The Worker posts "ready" before it reads, so both threads are about to read by then.
 */
async function runWithWorker(workerSource, script, input) {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `const worker = new Worker(${workerUrl(`postMessage("ready"); ${workerSource}`)});
       let message = Promise.withResolvers();
       worker.onmessage = event => message.resolve(event.data);
       worker.onerror = event => message.reject(event);
       await message.promise;
       message = Promise.withResolvers();
       console.error("ready");
       ${script}`,
    ],
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  let stderr = "";
  const ready = Promise.withResolvers();
  const stderrEnded = (async () => {
    for await (const chunk of proc.stderr.pipeThrough(new TextDecoderStream())) {
      stderr += chunk;
      if (stderr.includes("ready\n")) ready.resolve();
    }
    ready.reject(new Error(`exited before it was ready:\n${stderr}`));
  })();
  await ready.promise;
  proc.stdin.write(input);
  await proc.stdin.end();
  const [exitCode] = await Promise.all([proc.exited, stderrEnded]);
  return { stderr: stderr.slice(stderr.indexOf("\n") + 1), exitCode };
}

test.concurrent("a Worker and the main thread that wait in prompt() each get a line", async () => {
  const lines = [Buffer.alloc(300, "a").toString(), Buffer.alloc(300, "b").toString()];
  expect(
    await runWithWorker(
      `postMessage(prompt(""));`,
      `const answers = [prompt(""), await message.promise];
       console.error(JSON.stringify(answers.map(answer => answer?.length + " " + answer?.[0]).sort()));`,
      lines.join("\n") + "\n",
    ),
  ).toEqual(printed(["300 a", "300 b"]));
});

test.concurrent("dialogs on the main thread and in a Worker at the same time take whole lines", async () => {
  const count = 2000;
  expect(
    await runWithWorker(
      `const got = [];
       let yes = 0;
       for (let line; (line = prompt("", "EMPTY")) !== null; ) {
         got.push(line);
         if (confirm("")) yes++;
         alert("");
       }
       postMessage({ got, yes });`,
      `const got = [];
       for (let line; (line = prompt("", "EMPTY")) !== null; ) got.push(line);
       const fromWorker = await message.promise;
       const all = [...got, ...fromWorker.got];
       const taken = got.length + 3 * fromWorker.got.length;
       console.error(JSON.stringify({
         notLines: all.filter(line => !/^line \\d+$/.test(line)),
         duplicates: all.length - new Set(all).size,
         yes: fromWorker.yes,
         allTaken: taken >= ${count} && taken <= ${count} + 2,
       }));`,
      Array.from({ length: count }, (_, i) => `line ${i}\n`).join(""),
    ),
  ).toEqual(printed({ notLines: [], duplicates: 0, yes: 0, allTaken: true }));
});

/**
 * Runs `script` on a pseudo-terminal. `steps` is a list of [text to wait for, keys to type when it shows].
 * The script prints its result with `printResult`.
 */
async function runOnTerminal(script, steps) {
  let output = "";
  let waiting;
  const decoder = new TextDecoder();
  await using proc = spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    terminal: {
      cols: 200,
      rows: 50,
      data(_, chunk) {
        output += decoder.decode(chunk, { stream: true });
        if (waiting && Bun.stripANSI(output).includes(waiting.text)) waiting.resolve();
      },
    },
  });
  const exited = proc.exited.then(exitCode => {
    waiting?.reject(new Error(`exited with code ${exitCode} before ${JSON.stringify(waiting.text)}:\n${output}`));
    return exitCode;
  });
  const waitFor = async text => {
    waiting = { text, ...Promise.withResolvers() };
    if (Bun.stripANSI(output).includes(text)) waiting.resolve();
    await waiting.promise;
    waiting = undefined;
  };
  for (const [text, keys] of steps) {
    await waitFor(text);
    proc.terminal.write(keys);
  }
  await waitFor("DONE");
  const result = Bun.stripANSI(output).match(/RESULT:(.*?)DONE/)?.[1];
  proc.terminal.write("\r");
  return { result, exitCode: await exited };
}

// The script waits for one more line after it, so the terminal is still open when the result is read.
const printResult = object => `console.log("RESULT:" + JSON.stringify(${object}) + "DONE"); alert("");`;
const onTerminal = value => ({ result: JSON.stringify(value), exitCode: 0 });

test.concurrent("on a terminal, each dialog takes the line that was typed for it", async () => {
  const long = Buffer.alloc(300, "abcdefghij").toString();
  expect(
    await runOnTerminal(
      `const no = confirm("no?");
       const yes = confirm("yes?");
       const enter = confirm("enter?");
       alert("alert!");
       const dflt = prompt("dflt?", "D");
       const name = prompt("name?");
       const long = prompt("long?");
       ${printResult(`{ no, yes, enter, dflt, name, longLength: long.length, longSame: long === ${JSON.stringify(long)} }`)}`,
      [
        ["no?", "n\r"],
        ["yes?", "y\r"],
        ["enter?", "\r"],
        ["alert!", "\r"],
        ["dflt?", "\r"],
        ["name?", "Alice\r"],
        ["long?", long + "\r"],
      ],
    ),
  ).toEqual(
    onTerminal({ no: false, yes: true, enter: false, dflt: "D", name: "Alice", longLength: 300, longSame: true }),
  );
});

test.concurrent("on a terminal in raw mode, Enter ends a rejected confirm()", async () => {
  expect(
    await runOnTerminal(
      `process.stdin.setRawMode(true);
       const no = confirm("sure?");
       process.stdin.setRawMode(false);
       const next = prompt("next?");
       ${printResult(`{ no, next }`)}`,
      [
        ["sure?", "n\r"],
        ["next?", "x\r"],
      ],
    ),
  ).toEqual(onTerminal({ no: false, next: "x" }));
});

// Ctrl-D is not a key of the Windows console.
test.concurrent.skipIf(isWindows)("on a terminal, Ctrl-D after text does not end prompt()", async () => {
  expect(
    await runOnTerminal(`const a = prompt("A?"); ${printResult(`{ a }`)}`, [
      ["A?", "abc\x04"],
      ["A?", "def\r"],
    ]),
  ).toEqual(onTerminal({ a: "abcdef" }));
});

// The script reads "!" in raw mode, so both lines are in the terminal before it leaves raw mode.
test.concurrent.skipIf(isWindows)("on a terminal, lines typed in raw mode are taken one at a time", async () => {
  expect(
    await runOnTerminal(
      `import { readSync } from "node:fs";
       process.stdin.setRawMode(true);
       console.log("raw");
       readSync(0, Buffer.alloc(1));
       process.stdin.setRawMode(false);
       const one = prompt("one?");
       const two = prompt("two?");
       ${printResult(`{ one, two }`)}`,
      [["raw", "!one\ntwo\n"]],
    ),
  ).toEqual(onTerminal({ one: "one", two: "two" }));
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

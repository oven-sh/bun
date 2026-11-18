import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import fs from "node:fs";

// `bun fuzzilli` is the REPRL child that the Fuzzilli fuzzer starts with its `bun` profile
// (oven-sh/fuzzilli, Sources/Fuzzilli/Profiles/BunProfile.swift). The loop is
// src/runtime/cli/fuzzilli_command.rs. This is the contract between the two:
//
// - Four inherited descriptors: 100 (commands in), 101 (HELO, then one u32 status per program
//   out), 102 (program source in) and 103 (FUZZILLI_PRINT out). The child reads 102 in sequence,
//   so a driver that keeps one file there rewinds it before each program, as libreprl does.
// - A command is `exec` and a u64 length. The status is 0, or 0x100 when the program threw, left
//   an uncaught error in its event loop, or left an unhandled rejection. Fuzzilli keeps only
//   programs with status 0.
// - A program is global code on a fresh global object, with `require`, `module`, `__filename`
//   and `__dirname`. The preloads of bunfig.toml run on that global first. The event loop of
//   the program runs until it is empty, and no wait in it is longer than what is left of 250 ms
//   (the profile's timeout is 2500 ms). Then the reset of `bun test --isolate` retires the
//   realm and makes the next global.
// - A child that cannot run another program (the event loop is still alive after the reset, or
//   a preload fails) exits in place of the status write, with exit code 0 or 1. libreprl reports
//   that code as the status and starts a new child. The profile also starts a new child after
//   1000 programs.
//
// Here `Bun.spawn` makes the four descriptors. The commands and the programs are written up
// front and the command descriptor is closed, so the child runs every program and leaves on EOF.
//
// The loop is compiled into fuzzilli, debug and ASAN builds only.
const enabled = !isWindows && (isDebug || isASAN);

const REPRL_CRFD = 100;
const REPRL_CWFD = 101;
const REPRL_DRFD = 102;
const REPRL_DWFD = 103;

function owned(fd: number) {
  let open = true;
  const close = () => {
    if (open) fs.closeSync(fd);
    open = false;
  };
  return { fd, close, [Symbol.dispose]: close };
}

const lines = (text: string) => text.split("\n").filter(Boolean);

// A child that ends before the handshake has closed its end of the pipe.
function writeToChild(fd: number, bytes: Buffer) {
  try {
    fs.writeSync(fd, bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPIPE") throw error;
  }
}

// The errors on stderr: without the source excerpt that is printed above each one, and without
// the coverage lines of a fuzzilli build.
const errorLines = (stderr: string) =>
  lines(stderr)
    .filter(line => !/^\s*\d+ \| /.test(line) && !/^\s*\^+$/.test(line) && !line.startsWith("[COV] "))
    .map(line => line.trim());

async function runReprl(
  programs: string[],
  options: { env?: Record<string, string | undefined>; files?: Record<string, string> } = {},
) {
  const sources = programs.map(p => Buffer.from(p, "utf8"));
  const control = [Buffer.from("HELO")];
  for (const source of sources) {
    const size = Buffer.alloc(8);
    size.writeBigUInt64LE(BigInt(source.length));
    control.push(Buffer.from("exec"), size);
  }

  using dir = tempDir("fuzzilli-reprl", options.files ?? {});
  const cwd = fs.realpathSync(String(dir));
  // Descriptors 3 to 99 stay closed in the child. 100 to 103 are the REPRL descriptors.
  const unused = Array.from({ length: REPRL_CRFD - 3 }, () => "ignore" as const);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fuzzilli"],
    env: { ...bunEnv, ...options.env },
    cwd,
    stdio: ["ignore", "pipe", "pipe", ...unused, "pipe", "pipe", "pipe", "pipe"],
  });
  // Reading `stdio` makes the caller the owner of the descriptors.
  const fds = proc.stdio;
  using commands = owned(fds[REPRL_CRFD]!);
  using status = owned(fds[REPRL_CWFD]!);
  using data = owned(fds[REPRL_DRFD]!);
  using _fuzzout = owned(fds[REPRL_DWFD]!);

  writeToChild(commands.fd, Buffer.concat(control));
  writeToChild(data.fd, Buffer.concat(sources));
  commands.close();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const written = fs.readFileSync(status.fd);
  const statuses: number[] = [];
  for (let offset = 4; offset + 4 <= written.length; offset += 4) {
    statuses.push(written.readUInt32LE(offset));
  }
  return {
    handshake: written.subarray(0, 4).toString("latin1"),
    statuses,
    stdout: lines(stdout),
    stderr: errorLines(stderr.replaceAll(cwd, "<dir>")),
    exitCode,
  };
}

// In a child whose event loop is empty, a timer without a reference never fires.
const next = (name: string) =>
  `setTimeout(() => console.log("the event loop was alive"), 1).unref(); console.log("${name}");`;

const RECYCLED = "[REPRL] work of the program outlived the reset: this child ends";

// Under the leak check of CI (scripts/runner.node.ts), a bun process destroys its VM when it exits,
// and that waits for every job on the thread pool. This is for a child that leaves a job that never ends.
const withoutLeakCheck = {
  BUN_DESTRUCT_VM_ON_EXIT: undefined,
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
};

describe.skipIf(!enabled)("bun fuzzilli", () => {
  test.concurrent("every program runs on a fresh global object", async () => {
    const result = await runReprl([
      `
        globalThis.leaked = 1;
        var declared = 2;
        function hoisted() {}
        Object.prototype.polluted = 3;
        Array.prototype.push = function () { throw new Error("patched push"); };
        Object.getPrototypeOf = function () { throw new Error("patched getPrototypeOf"); };
        console.log("program 0 done");
      `,
      `
        console.log(JSON.stringify({
          leaked: typeof leaked,
          declared: typeof declared,
          hoisted: typeof hoisted,
          polluted: "polluted" in {},
          push: [].push(1),
          getPrototypeOf: Object.getPrototypeOf([]) === Array.prototype,
          require: typeof require("node:path").join,
          module: typeof module,
          filename: typeof __filename,
        }));
      `,
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0],
      stdout: [
        "program 0 done",
        JSON.stringify({
          leaked: "undefined",
          declared: "undefined",
          hoisted: "undefined",
          polluted: false,
          push: 1,
          getPrototypeOf: true,
          require: "function",
          module: "object",
          filename: "string",
        }),
      ],
      stderr: [],
      exitCode: 0,
    });
  });

  test.concurrent("the status reports what a program throws, in its own code or in its event loop", async () => {
    const result = await runReprl([
      /* 0 */ `throw new Error("sync failure");`,
      /* 1 */ `setTimeout(() => { throw new Error("timer failure"); }, 1);`,
      /* 2 */ `Promise.reject(new Error("rejection failure"));`,
      /* 3 */ `
        setInterval(() => console.log("interval from program 3"), 1).unref();
        Bun.serve({ port: 0, fetch: () => new Response("program 3") }).unref();
        queueMicrotask(() => console.log("microtask 3"));
      `,
      /* 4 */ `Bun.sleepSync(10); setTimeout(() => console.log("timer 4"), 20);`,
      /* 5 */ `console.log("ok 5");`,
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0x100, 0x100, 0x100, 0, 0, 0],
      stdout: ["microtask 3", "timer 4", "ok 5"],
      stderr: [
        "error: sync failure",
        "at [REPRL]:1:7",
        "error: timer failure",
        "at <anonymous> ([REPRL]:1:52)",
        "error: rejection failure",
        "at [REPRL]:1:16",
      ],
      exitCode: 0,
    });
  });

  test.concurrent("whatever a program throws or patches, it gets a status and the loop goes on", async () => {
    // Thrown values whose string coercion throws, sync and async, and a
    // program that breaks every builtin a loop written in JS would reach for.
    const result = await runReprl([
      /* 0 */ `throw Symbol("sync symbol");`,
      /* 1 */ `function F() {} F[Symbol.toPrimitive] = () => F; throw F;`,
      /* 2 */ `queueMicrotask(() => { throw { toString() { throw new Error("unprintable"); } }; });`,
      /* 3 */ `Promise.reject(Symbol("async symbol"));`,
      /* 4 */ `(async () => { await null; throw new Error("rejected after await"); })();`,
      /* 5 */ [
        `console.log = console.error = () => { throw new Error("patched console"); };`,
        `process.on = process.off = process.emit = process.removeListener = undefined;`,
        `process.removeAllListeners();`,
        `globalThis.Buffer = undefined;`,
        `require("node:fs").writeSync = () => { throw new Error("patched writeSync"); };`,
        `Object.defineProperty(globalThis, "Promise", { value: undefined });`,
        `Reflect.apply = Function.prototype.call = Function.prototype.apply = undefined;`,
        `queueMicrotask(() => { throw new Error("after patching"); });`,
      ].join(" "),
      /* 6 */ `console.log("ok 6");`,
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0x100, 0x100, 0x100, 0x100, 0x100, 0x100, 0],
      stdout: ["ok 6"],
      stderr: [
        "error: sync symbol",
        "Symbol(sync symbol)",
        "F:",
        "[Function: F]",
        "error",
        "at <anonymous> ([REPRL]:1:80)",
        "error: async symbol",
        "Symbol(async symbol)",
        "error: rejected after await",
        "at <anonymous> ([REPRL]:1:34)",
        "error: after patching",
        "at <anonymous> ([REPRL]:1:501)",
      ],
      exitCode: 0,
    });
  });

  test.concurrent("a program that never ends its own event loop still reports a status", async () => {
    // Program 0 stops neither the server nor the interval, so its event loop
    // never ends. The loop gets a fixed slice, then the status goes out and
    // the reset stops both. Program 1 reads the port out of the file, because
    // program 0's globals are gone by then. A second listener on that port
    // binds only if the first one is gone, and it throws at once if not.
    const result = await runReprl([
      `
        const server = Bun.serve({ port: 0, fetch: () => new Response("program 0") });
        setInterval(() => {}, 5);
        require("fs").writeFileSync("port.txt", String(server.port));
        console.log("serving");
      `,
      `
        const port = Number(require("fs").readFileSync("port.txt", "utf8"));
        let stopped = true;
        try {
          Bun.serve({ port, fetch: () => new Response("program 1") }).stop(true);
        } catch {
          stopped = false;
        }
        console.log("server stopped: " + stopped);
      `,
      next("program 2"),
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0, 0],
      stdout: ["serving", "server stopped: true", "program 2"],
      stderr: [],
      exitCode: 0,
    });
  });

  test.concurrent("a wait in the event loop of a program is never longer than its budget", async () => {
    // The poll would sleep until the timer is due. Without the idle timer of the garbage
    // collector, which ends a poll after a second, nothing else would wake it.
    const result = await runReprl([`setTimeout(() => console.log("a minute later"), 60000);`, next("next program")], {
      env: { BUN_GC_TIMER_DISABLE: "1" },
    });

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0],
      stdout: ["next program"],
      stderr: [],
      exitCode: 0,
    });
  });

  test.concurrent("what a handler throws while the reset closes its socket does not fail the program", async () => {
    // The status is decided when the program's slice of the event loop ends.
    // The program leaves both ends of a connection open. The reset closes
    // them, and only then does the close handler run and throw.
    const result = await runReprl([
      [
        `const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() {}, data() {}, close() { throw new Error("close handler"); } } });`,
        `Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open() { console.log("connected"); }, data() {}, close() {} } });`,
      ].join(" "),
      next("next program"),
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0],
      stdout: ["connected", "next program"],
      stderr: ["error: close handler", "at close ([REPRL]:1:109)"],
      exitCode: 0,
    });
  });

  test.concurrent("a Worker that is busy in JIT code when its program ends is stopped by the reset", async () => {
    // JSC stops such a Worker with a signal-based VM trap, so nothing may take
    // SIGSEGV away from JSC in the REPRL child. The program blocks until the
    // Worker reports that its loop is hot, and leaves it spinning.
    const worker = `
      onmessage = event => {
        const hot = new Int32Array(event.data);
        function spin(n) {
          let x = 0;
          for (let i = 0; i < n; i++) x += Math.random();
          return x;
        }
        spin(1e6);
        Atomics.store(hot, 0, 1);
        Atomics.notify(hot, 0);
        while (true) spin(2147483647);
      };
    `;
    const result = await runReprl([
      `
        const hot = new Int32Array(new SharedArrayBuffer(4));
        new Worker(${JSON.stringify("data:text/javascript," + encodeURIComponent(worker))}).postMessage(hot.buffer);
        Atomics.wait(hot, 0, 0, 4000);
        console.log(Atomics.load(hot, 0) === 1 ? "worker is spinning" : "the worker did not start");
      `,
      next("after the worker"),
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0],
      stdout: ["worker is spinning", "after the worker"],
      stderr: [],
      exitCode: 0,
    });
  });

  test.concurrent("the reset also retires the ShadowRealms and the node:vm contexts of a program", async () => {
    // A channel in a ShadowRealm hears the next program, and a function of a node:vm context is
    // called when the reset kills the subprocess. Neither may run after its program.
    const result = await runReprl([
      [
        `new ShadowRealm().evaluate("globalThis.channel = new BroadcastChannel('reprl'); channel.onmessage = () => { throw new Error('handler in the ShadowRealm of program 0'); }; 1");`,
        `const onExit = require("node:vm").runInNewContext("(function () { throw new Error('function in the context of program 0'); })");`,
        `Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], onExit });`,
        `console.log("program 0");`,
      ].join(" "),
      `new BroadcastChannel("reprl").postMessage(1); console.log("program 1");`,
      next("program 2"),
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0, 0],
      stdout: ["program 0", "program 1", "program 2"],
      stderr: [],
      exitCode: 0,
    });
  });

  test.concurrent("a later garbage collection frees what the first program left on its global", async () => {
    const result = await runReprl([
      `globalThis.parked = new Bun.Glob("*.parked");`,
      `1;`,
      `1;`,
      `Bun.gc(true); console.log(require("bun:jsc").heapStats().objectTypeCounts.Glob ?? 0);`,
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0, 0, 0],
      stdout: ["0"],
      stderr: [],
      exitCode: 0,
    });
  });

  describe.each([
    ["passed", "", 0, []],
    ["failed", ` throw new Error("and it fails");`, 1, ["error: and it fails", "at [REPRL]:1:101"]],
  ] as const)("a program that %s and left work that the reset cannot stop", (_, suffix, exitCode, errors) => {
    test.concurrent("ends the child, whose exit code is the status", async () => {
      // The job stays on a thread of the pool until the process ends. libreprl takes the exit
      // code of a child that leaves in place of a status as that status, and starts a new child.
      const result = await runReprl(
        [
          `require("crypto").pbkdf2("a", "b", 2e9, 64, "sha512", () => {}); console.log("the job runs");${suffix}`,
          `console.log("next program");`,
        ],
        { env: withoutLeakCheck },
      );

      expect(result).toEqual({
        handshake: "HELO",
        statuses: [],
        stdout: ["the job runs"],
        stderr: [...errors, RECYCLED],
        exitCode,
      });
    });
  });

  test.concurrent(
    "the reset puts back the directory, the time zone, a proxy variable and the allocation limit",
    async () => {
      const observe = `console.log(JSON.stringify({ cwd: process.cwd(), offset: new Date(0).getTimezoneOffset(), proxy: String(process.env.HTTP_PROXY) }));`;
      const result = await runReprl(
        [
          observe,
          [
            `process.chdir("/"); process.env.TZ = "Asia/Tokyo"; process.env.HTTP_PROXY = "http://127.0.0.1:1";`,
            `require("bun:internal-for-testing").setSyntheticAllocationLimitForTesting(1 << 20);`,
            `new Response(Buffer.alloc(2 << 20, 97)).text().catch(error => console.log(error.code));`,
            `console.log(JSON.stringify({ cwd: process.cwd(), offset: new Date(0).getTimezoneOffset(), proxy: process.env.HTTP_PROXY }));`,
          ].join(" "),
          observe,
          `new Response(Buffer.alloc(8 << 20, 97)).text().then(text => console.log(text.length));`,
        ],
        { env: { TZ: "Etc/UTC", HTTP_PROXY: "" } },
      );

      expect(result.stdout[0]).toBe(result.stdout[3]);
      expect({ ...result, stdout: result.stdout.slice(1) }).toEqual({
        handshake: "HELO",
        statuses: [0, 0, 0, 0],
        stdout: [
          JSON.stringify({ cwd: "/", offset: -540, proxy: "http://127.0.0.1:1" }),
          "ERR_STRING_TOO_LONG",
          result.stdout[0],
          String(8 << 20),
        ],
        stderr: [],
        exitCode: 0,
      });
      expect(JSON.parse(result.stdout[0]!)).toEqual({ cwd: expect.any(String), offset: 0, proxy: "" });
    },
  );

  test.concurrent("the end of a program is not the exit of the process", async () => {
    // No `beforeExit` or `exit` listener runs, and an exit code that a program or its close
    // handler sets is gone before the next program. Only a status of 0 or 0x100 goes out.
    const result = await runReprl([
      `process.on("beforeExit", () => console.log("beforeExit listener")); process.on("exit", () => console.log("exit listener")); process.exitCode = 3;`,
      `console.log(JSON.stringify({ exitCode: String(process.exitCode), listeners: process.listenerCount("exit") + process.listenerCount("beforeExit") }));`,
      [
        `const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() {}, data() {}, close() { process.exitCode = 8; } } });`,
        `Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open() { console.log("connected"); }, data() {}, close() { process.exitCode = 9; } } });`,
      ].join(" "),
      `process.exit();`,
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0, 0],
      stdout: [JSON.stringify({ exitCode: "undefined", listeners: 0 }), "connected"],
      stderr: [],
      exitCode: 0,
    });
  });

  test.concurrent("bunfig.toml in the working directory applies, as for `bun <file>`", async () => {
    const result = await runReprl(
      [`require("fs").writeFileSync("greeting.mytext", "hello"); console.log(require("./greeting.mytext").default);`],
      { files: { "bunfig.toml": `[loader]\n".mytext" = "text"\n` } },
    );

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0],
      stdout: ["hello"],
      stderr: [],
      exitCode: 0,
    });
  });

  describe("a preload of bunfig.toml", () => {
    const bunfig = { "bunfig.toml": `preload = ["./preload.js"]\n` };

    test.concurrent("runs on every fresh global", async () => {
      const result = await runReprl(
        [`fromPreload.push("program 0"); console.log(fromPreload.join());`, `console.log(fromPreload.join());`],
        { files: { ...bunfig, "preload.js": `globalThis.fromPreload = ["preload"];` } },
      );

      expect(result).toEqual({
        handshake: "HELO",
        statuses: [0, 0],
        stdout: ["preload,program 0", "preload"],
        stderr: [],
        exitCode: 0,
      });
    });

    test.concurrent.each([
      ["throws", `throw new Error("preload failure");`, "at <dir>/preload.js:1:11"],
      ["leaves an unhandled rejection", `Promise.reject(new Error("preload failure"));`, "at <dir>/preload.js:1:20"],
    ])("that %s at the start ends the child before the handshake", async (_, preload, frame) => {
      const result = await runReprl([`console.log("program 0");`], {
        files: { ...bunfig, "preload.js": preload },
      });

      expect(result).toEqual({
        handshake: "",
        statuses: [],
        stdout: [],
        stderr: ["error: preload failure", frame, "error: [REPRL] could not start: a preload failed"],
        exitCode: 1,
      });
    });

    test.concurrent("that fails on a later global ends the child, whose exit code is the status", async () => {
      const result = await runReprl(
        [`require("fs").rmSync("preload.js"); console.log("removed");`, `console.log("next program");`],
        { files: { ...bunfig, "preload.js": `globalThis.fromPreload = ["preload"];` } },
      );

      expect(result).toEqual({
        handshake: "HELO",
        statuses: [],
        stdout: ["removed"],
        stderr: [`error: ENOENT reading "<dir>/preload.js"`, "[REPRL] a preload failed: this child ends"],
        exitCode: 0,
      });
    });
  });

  test.concurrent("a program cannot replace the REPRL child with process.execve", async () => {
    const result = await runReprl([
      `process.execve(process.execPath, [process.execPath, "--version"]); console.log("still here");`,
      `console.log("next program");`,
    ]);

    expect(result).toEqual({
      handshake: "HELO",
      statuses: [0, 0],
      stdout: ["still here", "next program"],
      stderr: [],
      exitCode: 0,
    });
  });

  // A program runs like the CommonJS file `bun <file>`, except where a row says why not.
  describe.each([
    { name: "a throw", program: `console.log("before"); throw new Error("x");` },
    {
      name: "a throw with a listener",
      program: `process.on("uncaughtException", error => console.log("listener got", error.message)); throw new Error("x");`,
    },
    { name: "a throw in a timer", program: `setTimeout(() => { throw new Error("x"); }, 1);` },
    {
      name: "a throw in a timer with a listener",
      program: `process.on("uncaughtException", error => console.log("listener got", error.message)); setTimeout(() => { throw new Error("x"); }, 1);`,
    },
    { name: "a rejection", program: `Promise.reject(new Error("x"));` },
    {
      name: "a rejection with a listener",
      program: `process.on("unhandledRejection", error => console.log("listener got", error.message)); Promise.reject(new Error("x"));`,
    },
    {
      name: "a require.extensions hook",
      program: `require("fs").writeFileSync("a.hooked", "not js ("); require.extensions[".hooked"] = module => { module.exports = "from the hook"; }; console.log(require("./a.hooked"));`,
    },
    {
      name: "require of a file with an unknown extension",
      program: `require("fs").writeFileSync("b.unknown", "const x: number = 1; module.exports = x;"); console.log(require("./b.unknown"));`,
    },
    {
      name: "import() of a file with an unknown extension",
      program: `require("fs").writeFileSync("c.unknown", "const x: number = 1;"); import("./c.unknown").then(module => console.log(typeof module.default));`,
    },
    {
      name: "import() of a file that the program wrote",
      program: `require("fs").writeFileSync("late.mjs", "export default 7;"); import("./late.mjs").then(module => console.log(module.default));`,
    },
    {
      name: "a global that a preload of bunfig.toml sets",
      program: `console.log(fromPreload);`,
      files: {
        "bunfig.toml": `preload = ["./preload.js"]\n`,
        "preload.js": `globalThis.fromPreload = "set by the preload";`,
      },
    },
    {
      name: "process.exitCode",
      program: `process.exitCode = 3; console.log("set");`,
      differs: {
        why: "the status reports errors, not the exit code",
        asProgram: { ok: true, stdout: ["set"] },
        asFile: { ok: false, stdout: ["set"] },
      },
    },
    {
      name: "an exit listener",
      program: `process.on("exit", () => console.log("exit listener"));`,
      differs: {
        why: "the process does not exit when a program ends",
        asProgram: { ok: true, stdout: [] },
        asFile: { ok: true, stdout: ["exit listener"] },
      },
    },
    {
      name: "top-level await",
      program: `await 1; console.log("after");`,
      differs: {
        why: "a program is global code, where await is not a keyword",
        asProgram: { ok: false, stdout: [] },
        asFile: { ok: true, stdout: ["after"] },
      },
    },
  ])("$name", ({ program, differs, files }) => {
    test.concurrent(differs ? `differs from bun <file>: ${differs.why}` : "is as with bun <file>", async () => {
      using dir = tempDir("fuzzilli-reprl-file", { ...files, "program.cjs": program });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "program.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "ignore",
      });
      const [reprl, stdout, exitCode] = await Promise.all([
        runReprl([program], { files }),
        proc.stdout.text(),
        proc.exited,
      ]);

      const asProgram = { ok: reprl.statuses[0] === 0, stdout: reprl.stdout };
      const asFile = { ok: exitCode === 0, stdout: lines(stdout) };
      expect(reprl.statuses).toHaveLength(1);
      if (differs) expect({ asProgram, asFile }).toEqual({ asProgram: differs.asProgram, asFile: differs.asFile });
      else expect(asProgram).toEqual(asFile);
    });
  });
});

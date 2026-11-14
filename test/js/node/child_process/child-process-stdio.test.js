import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isAndroid, isFreeBSD, isLinux, isPosix, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { AsyncLocalStorage } from "node:async_hooks";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { Readable } from "node:stream";
import { stdinCallOrders } from "./fixtures/stdin-call-orders-fixture.js";
import { tables } from "./fixtures/stdin-exited-child-fixture.js";

const CHILD_PROCESS_FILE = import.meta.dir + "/spawned-child.js";
const OUT_FILE = import.meta.dir + "/stdio-test-out.txt";

describe("process.stdout", () => {
  it("should allow us to write to it", done => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDOUT"], {
      env: bunEnv,
      stdio: ["inherit", "pipe", "inherit"],
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", data => {
      try {
        expect(data).toBe("stdout_test");
        done();
      } catch (err) {
        done(err);
      }
    });
  });
});

describe("process.stdin", () => {
  it("should allow us to read from stdin in readable mode", done => {
    const input = "hello there\n";
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "READABLE"], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout
      .on("data", chunk => {
        data += chunk;
      })
      .on("end", function () {
        try {
          expect(data).toBe(`data: ${input}`);
          done();
        } catch (err) {
          done(err);
        }
      });
    child.stdin.write(input, function () {
      child.stdin.end(...arguments);
    });
  });

  it("should allow us to read from stdin via flowing mode", done => {
    const input = "hello\n";
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout
      .on("readable", () => {
        let chunk;
        while ((chunk = child.stdout.read()) !== null) {
          data += chunk;
        }
      })
      .on("end", function () {
        try {
          expect(data).toBe(`data: ${input}`);
          done();
        } catch (err) {
          done(err);
        }
      });
    child.stdin.end(input);
  });

  it("should allow us to read > 65kb from stdin", done => {
    const numReps = Math.ceil((1024 * 1024) / 5);
    const input = Buffer.alloc("hello".length * numReps)
      .fill("hello")
      .toString();
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout
      .on("readable", () => {
        let chunk;
        while ((chunk = child.stdout.read()) !== null) {
          data += chunk;
        }
      })
      .on("end", function () {
        try {
          const expected = "data: " + input;
          expect(data.length).toBe(expected.length);
          expect(data).toBe(expected);
          done();
        } catch (err) {
          done(err);
        }
      });
    child.stdin.end(input);
  });

  it("should allow us to read from a file", () => {
    const result = execSync(`${bunExe()} ${CHILD_PROCESS_FILE} STDIN FLOWING < ${import.meta.dir}/readFileSync.txt`, {
      encoding: "utf8",
      env: bunEnv,
    });
    expect(result).toEqual("data: File read successfully");
  });
});

describe("child.stdin", () => {
  it("write() after child 'close' returns false and calls back with ERR_STREAM_DESTROYED", async () => {
    const child = spawn(bunExe(), ["-e", ""], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });
    await once(child, "close");

    const { promise, resolve } = Promise.withResolvers();
    const ret = child.stdin.write("dropped", resolve);
    const cbErr = await promise;

    expect({
      ret,
      cbCode: cbErr?.code,
      destroyed: child.stdin.destroyed,
      writable: child.stdin.writable,
    }).toEqual({
      ret: false,
      cbCode: "ERR_STREAM_DESTROYED",
      destroyed: true,
      writable: false,
    });
  });

  it("write() after child 'exit' (before 'close') returns false and calls back with ERR_STREAM_DESTROYED", async () => {
    const child = spawn(bunExe(), ["-e", "process.stdin.once('data', () => process.exit(0))"], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.stdin.on("error", () => {});
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdin.write("go\n", err => (err ? reject(err) : resolve()));
    });
    await once(child, "exit");

    const { promise, resolve } = Promise.withResolvers();
    const ret = child.stdin.write("late", resolve);
    const cbErr = await promise;

    expect({ ret, cbCode: cbErr?.code }).toEqual({
      ret: false,
      cbCode: "ERR_STREAM_DESTROYED",
    });
  });
});

describe.skipIf(!isPosix)("stdio handed to the child", () => {
  // Prints whether O_NONBLOCK is set on each fd number given in argv.
  const probe = join(import.meta.dir, "..", "..", "bun", "spawn", "fixtures", "fd-nonblock-probe.js");

  it.concurrent("the ipc fd is blocking", async () => {
    // A child that is not bun or node does a plain write(2) on NODE_CHANNEL_FD.
    // On an O_NONBLOCK socket a large message is cut short and lost.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { spawn } = require("node:child_process");
         const child = spawn(process.execPath, [${JSON.stringify(probe)}, "3"], { stdio: ["inherit", "inherit", "inherit", "ipc"] });
         child.on("exit", code => process.exit(code ?? 1));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("3:blocking\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("a pipe slot after many ignore slots", async () => {
    // Run in a fresh process so the pipe's source fd is a low number, below
    // the slot it is dup2'd to. The close of each "ignore" slot used to hit it,
    // and spawn() then threw EBADF synchronously.
    const slots = 60;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { spawn, spawnSync } = require("node:child_process");
         const stdio = ["ignore", "ignore", "ignore", ...Array(${slots - 3}).fill("ignore"), "pipe"];
         const sync = spawnSync("true", [], { stdio });
         console.log("spawnSync:", sync.error?.code ?? "ok", sync.status);
         const child = spawn("true", [], { stdio });
         child.on("error", e => console.log("error event", e.code));
         child.on("exit", code => console.log("spawn:", code));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("spawnSync: ok 0\nspawn: 0\n");
    expect(exitCode).toBe(0);
  });
});

// A child that lives a few milliseconds is gone soon after spawn() returns. Node.js makes the streams
// of its pipes from modules that are loaded already, and sends what child.stdin.end() is given inside
// the call. Here the first stream of a process was loaded and made after the child had started, and
// what child.stdin was given waited for later ticks. Both let the child go first: its stdin got its
// first bytes after it was gone (EPIPE), and a parent that left in that turn had sent nothing.
describe("the pipes of a child in the turn of spawn()", () => {
  const fixture = name => join(import.meta.dir, "fixtures", name);
  // Writes to its stdout what it reads from its stdin, once the stdin is at its end.
  const echo = `const fs = require("node:fs"); fs.writeSync(1, fs.readFileSync(0));`;

  async function run(cmd, env = bunEnv) {
    await using proc = Bun.spawn({ cmd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // A child that has closed its stdin and says so. It stays until it is killed.
  async function childWithClosedStdin() {
    const child = spawn(
      bunExe(),
      ["-e", `require("fs").closeSync(0); process.stdout.write("ready\\n"); setInterval(() => {}, 1e5);`],
      { env: bunEnv, stdio: ["pipe", "pipe", "inherit"] },
    );
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => reject(new Error(`the child exited with ${code} before it was ready`)));
      child.stdout.once("data", resolve);
    });
    child.removeAllListeners("error");
    child.removeAllListeners("exit");
    return child;
  }

  // One at a time: each row starts a process that loads the stream modules, over a second of CPU on a debug build.
  describe("spawn() makes the streams before it starts the child", () => {
    // What the first spawn() of a fresh global object has made when its child starts, and what it makes after: see the fixture.
    async function made(stdio, inWorker = false) {
      const script = fixture("spawn-made-behind-child-fixture.js");
      const argument = JSON.stringify(stdio);
      const cmd = inWorker
        ? [bunExe(), "-e", `new Worker(${JSON.stringify(script)}, { argv: [${JSON.stringify(argument)}] });`]
        : [bunExe(), script, argument];
      const result = await run(cmd);
      expect({ stderr: result.stderr, exitCode: result.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(result.stdout);
    }

    let withoutPipe;

    it.each([
      { stdio: ["pipe", "ignore", "ignore"], madeAhead: [true, null, null], own: ["stdin", "stdio"] },
      { stdio: ["ignore", "pipe", "ignore"], madeAhead: [null, true, null], own: ["stdout", "stdio"] },
      { stdio: ["pipe", "pipe", "pipe"], madeAhead: [true, true, true], own: ["stdin", "stdout", "stderr", "stdio"] },
      { stdio: ["ignore", "ignore", "ignore", "pipe"], madeAhead: [null, null, null, true], own: ["stdio"] },
      { stdio: ["pipe", "ignore", "ignore", "pipe"], madeAhead: [true, null, null, true], own: ["stdin", "stdio"] },
      // Fewer than three entries: the streams were made at their first use, so always behind the child.
      { stdio: ["pipe"], madeAhead: [true, true, true], own: ["stdin", "stdout", "stderr", "stdio"] },
    ])("stdio $stdio", async ({ stdio, madeAhead, own }) => {
      const [piped, unpiped] = await Promise.all([made(stdio), (withoutPipe ??= made(["ignore", "ignore", "ignore"]))]);
      // A child with no pipe has no stream to make, so a piped one may make little more behind the
      // native spawn. One built-in module that loads there makes hundreds of functions.
      const functions = piped.madeBehind.functions - unpiped.madeBehind.functions;
      expect({
        madeAhead: piped.madeAhead,
        streamsMadeBehind: piped.madeBehind.streams,
        functionsMadeBehind: functions <= 16 ? "as with no pipe" : `${functions} more than with no pipe`,
        own: piped.own,
      }).toEqual({ madeAhead, streamsMadeBehind: 0, functionsMadeBehind: "as with no pipe", own });
    });

    // The built-in modules are loaded once per global object: the first spawn() of a Worker is as cold as the first of its process.
    it("in a Worker", async () => {
      const { madeAhead, madeBehind, own } = await made(["pipe", "pipe", "pipe"], true);
      expect({ madeAhead, streamsMadeBehind: madeBehind.streams, own }).toEqual({
        madeAhead: [true, true, true],
        streamsMadeBehind: 0,
        own: ["stdin", "stdout", "stderr", "stdio"],
      });
    });
  });

  // The three tools of the fixture never read their stdin, and close it while the parent is still in the
  // turn that called end(). The parent's bytes are in the pipe by then only if they were sent in the call.
  it.skipIf(!isPosix)("child.stdin.end() sends what the stream was given inside the call", async () => {
    using dir = tempDir("stdin-send-in-call", {});
    const go = join(String(dir), "go");
    const done = join(String(dir), "done");
    mkfifo(go);
    mkfifo(done);
    const { stdout, stderr, exitCode } = await run([bunExe(), fixture("stdin-send-in-call-fixture.js"), go, done]);
    const finished = ["finish", "close 0"];
    expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: { "end(chunk)": finished, "end(16 KiB)": finished, "write(chunk); end()": finished },
      stderr: "",
      exitCode: 0,
    });
  });

  // The echo child inherits the parent's stdout, so that pipe is at EOF only after the child has exited too.
  it("end(chunk) reaches the child when process.exit() follows it", async () => {
    const result = await run(
      [
        bunExe(),
        "-e",
        // detached: on Windows a child in its parent's job object dies with the parent.
        `const { spawn } = require("node:child_process");
         const stdio = ["pipe", "inherit", "inherit"];
         const child = spawn(process.execPath, ["-e", ${JSON.stringify(echo)}], { stdio, detached: true });
         child.stdin.end("hello");
         process.exit(0);`,
      ],
      // CI ASAN lanes set BUN_FEATURE_FLAG_NO_ORPHANS, which makes the parent SIGKILL its child when it exits.
      { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
    );
    expect(result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
  });

  // A pending stream promises a 'ready' event. This one has nothing to open.
  it("stdin is constructed and not pending when it is created, and emits neither 'open' nor 'ready'", async () => {
    const child = spawn(bunExe(), ["-e", ""], { env: bunEnv, stdio: ["pipe", "ignore", "ignore"] });
    const stdin = child.stdin;
    const atBirth = { constructed: stdin._writableState.constructed, pending: stdin.pending };
    const events = [];
    for (const name of ["open", "ready"]) stdin.on(name, () => events.push(name));
    // The exit of the child destroys the stream.
    await once(child, "close");
    expect({ atBirth, events, pendingOnceDestroyed: stdin.pending }).toEqual({
      atBirth: { constructed: true, pending: false },
      events: [],
      pendingOnceDestroyed: true,
    });
  });

  // The streams that spawn() makes take no options. With an `fd` that Object.prototype carried, the input went
  // to that fd, and with a `highWaterMark` of -1 spawn() threw.
  it("the streams of a child take no stream options from Object.prototype", async () => {
    const result = await run([
      bunExe(),
      "-e",
      `const { spawn } = require("node:child_process");
       const inherited = { fd: 2147483647, autoClose: false, highWaterMark: -1, objectMode: true };
       let child;
       Object.assign(Object.prototype, inherited);
       try {
         child = spawn(process.execPath, ["-e", ${JSON.stringify(echo)}], { stdio: ["pipe", "pipe", "inherit"] });
         child.stdin.on("error", err => {
           console.error(err.message);
           child.kill();
         });
         child.stdin.end("hello");
       } finally {
         for (const name of Object.keys(inherited)) delete Object.prototype[name];
       }
       const { fd, autoClose } = child.stdin;
       const { readableObjectMode } = child.stdout;
       let read = "";
       child.stdout.setEncoding("utf8").on("data", chunk => (read += chunk));
       child.on("close", () => console.log(JSON.stringify({ read, fd, autoClose, readableObjectMode })));`,
    ]);
    expect({ ...result, stdout: result.stdout && JSON.parse(result.stdout) }).toEqual({
      stdout: { read: "hello", fd: null, autoClose: true, readableObjectMode: false },
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([
    ["that the sink keeps whole", 100],
    ["that the pipe does not take at once", 1024 * 1024],
  ])("a stream of one chunk %s, piped into child.stdin, reaches a child that reads", async (_, size) => {
    const child = spawn(bunExe(), ["-e", "process.stdin.pipe(process.stdout)"], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let bytes = 0;
    child.stdout.on("data", chunk => (bytes += chunk.length));
    Readable.from([Buffer.alloc(size, "x")]).pipe(child.stdin);
    const [exitCode] = await once(child, "close");
    expect({ bytes, exitCode }).toEqual({ bytes: size, exitCode: 0 });
  });

  describe("calls on child.stdin", () => {
    // Node.js drops a write error on a stream that is destroyed before 'finish'.
    it.each([
      [`destroy()`, undefined, ["close"]],
      [`destroy(new Error("boom"))`, new Error("boom"), ["error boom", "close"]],
    ])("end(chunk); %s to a child that has closed its stdin reports no write error", async (_, error, expected) => {
      const child = await childWithClosedStdin();
      try {
        const stdin = child.stdin;
        const log = [];
        const { promise: closed, resolve: onClose } = Promise.withResolvers();
        stdin.on("error", err => log.push(`error ${err.message}`));
        stdin.on("close", () => {
          log.push("close");
          onClose();
        });
        stdin.end("hello");
        stdin.destroy(error);
        await closed;
        expect(log).toEqual(expected);
      } finally {
        child.kill("SIGKILL");
      }
    });

    // More than the pipe takes, to a child that lives for a second and never reads: the write is in
    // progress when destroy() comes. Node.js closes the pipe at once, and the end callback gets the
    // ECANCELED of the write that it cancels. Here destroy() waited for the child, and then reported
    // the EPIPE of that write as 'error'.
    describe.each([
      ["in the tick of spawn()", "calls()"],
      ["one macrotask later", "setImmediate(calls)"],
    ])("%s", (_, when) => {
      it.each([
        [`destroy()`, ["end cb ERR_STREAM_DESTROYED", "close"]],
        [`destroy(new Error("boom"))`, ["end cb boom", "error boom", "close"]],
      ])("end(1 MiB, cb); %s reports no write error, and calls back ahead of 'close'", async (destroy, log) => {
        const result = await run([
          bunExe(),
          "-e",
          `const { spawn } = require("node:child_process");
           const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { stdio: ["pipe", "ignore", "inherit"] });
           function calls() {
             const stdin = child.stdin;
             const log = [];
             stdin.on("error", err => log.push("error " + err.message));
             stdin.on("close", () => {
               log.push("close");
               console.log(JSON.stringify(log));
               child.kill();
             });
             stdin.end(Buffer.alloc(1024 * 1024, "x"), err => log.push("end cb " + (err ? err.code || err.message : null)));
             stdin.${destroy};
           }
           ${when};`,
        ]);
        expect({ ...result, stdout: result.stdout && JSON.parse(result.stdout) }).toEqual({
          stdout: log,
          stderr: "",
          exitCode: 0,
        });
      });
    });

    // What the child read, then the events and the callbacks of the stream, for each row of the
    // fixture. `node` is the table that Node.js v26.3.0 prints for it, at both times. The child of
    // the fixture is alive and reads: a child that has gone has other rows.
    it.each([
      ["in the tick of spawn()", false],
      ["one macrotask later", true],
    ])(
      "%s, to a child that reads, events and callbacks are those of Node.js, except in the row listed",
      async (_, later) => {
        const row = (bytes, ...log) => ({ bytes, log });
        const finished = ["prefinish", "end cb null", "finish", "close"];
        const node = {
          [`end("hello"); destroy()`]: row("hello", "close"),
          [`end("hello"); destroy(new Error("boom"))`]: row("hello", "error boom", "close"),
          [`end("hello"); end("x")`]: row("hello", "error ERR_STREAM_WRITE_AFTER_END", "close"),
          [`end("hello"); write("x")`]: row("hello", "error ERR_STREAM_WRITE_AFTER_END", "close"),
          [`cork(); write("he"); end("llo"); destroy()`]: row("hello", "close"),
          [`end("68656c6c6f", "hex"); destroy()`]: row("hello", "close"),
          [`end(buffer); buffer.fill(0)`]: row("hello", "prefinish", "finish", "close"),
          [`end("hello", cb); destroy()`]: row("hello", "end cb ERR_STREAM_DESTROYED", "close"),
          [`end("hello", cb); destroy(new Error("boom"))`]: row("hello", "end cb boom", "error boom", "close"),
          [`end(cb); destroy()`]: row("", "end cb ERR_STREAM_DESTROYED", "close"),
          [`end("hello", cb); nextTick(destroy)`]: row("hello", "end cb ERR_STREAM_DESTROYED", "close"),
          [`end("hello", cb); queueMicrotask(destroy)`]: row("hello", "end cb ERR_STREAM_DESTROYED", "close"),
          [`write("hello", cb); end(); destroy()`]: row("hello", "write cb null", "close"),
          [`cork(); write("hello", cb); destroy()`]: row("", "write cb ERR_STREAM_DESTROYED", "close"),
          [`end("hello", cb)`]: row("hello", ...finished),
          [`write("he", cb); end("llo", cb)`]: row("hello", "write cb null", ...finished),
          [`write("he", cb); end("llo", cb); destroy()`]: row(
            "hello",
            "write cb null",
            "end cb ERR_STREAM_DESTROYED",
            "close",
          ),
          [`destroy(); end("hello", cb)`]: row("", "end cb ERR_STREAM_DESTROYED", "close"),
        };
        const bun = {
          // write() hands the chunk to the sink at once and ignores cork().
          [`cork(); write("hello", cb); destroy()`]: row("hello", "write cb null", "close"),
        };
        // The fixture starts from a macrotask, as the main script of a program does.
        const { promise, resolve } = Promise.withResolvers();
        setImmediate(() => resolve(stdinCallOrders(later)));
        expect(await promise).toEqual({ ...node, ...bun });
      },
    );
  });

  // Under Node.js 'finish' and 'close' come a turn of the event loop after end() and destroy(), so a
  // listener that is added some ticks or promise jobs later still hears them. Here they came within
  // a few ticks of the call.
  describe.each([
    ["end()", stdin => stdin.end("x"), ["finish", "close"]],
    ["destroy()", stdin => stdin.destroy(), ["close"]],
  ])("a listener that is added behind %s", (_, call, heard) => {
    const afterTicks = (ticks, then) => (ticks === 0 ? then() : process.nextTick(afterTicks, ticks - 1, then));
    it.each([
      ["three ticks later", attach => afterTicks(3, attach)],
      ["six ticks later", attach => afterTicks(6, attach)],
      ["a promise job later", attach => queueMicrotask(attach)],
      ["a promise job and a tick later", attach => queueMicrotask(() => process.nextTick(attach))],
    ])("%s hears the events", async (_, later) => {
      const child = spawn(bunExe(), ["-e", "process.stdin.resume()"], {
        env: bunEnv,
        stdio: ["pipe", "ignore", "inherit"],
      });
      const seen = [];
      call(child.stdin);
      later(() => {
        child.stdin.on("finish", () => seen.push("finish"));
        child.stdin.on("close", () => seen.push("close"));
      });
      await once(child, "close");
      expect(seen).toEqual(heard);
    });
  });

  // As in Node.js, where end() schedules them. They ran in the store of spawn(), which scheduled
  // the construction of the stream that they waited for.
  it("the end() callback and 'finish' run in the AsyncLocalStorage store of end()", async () => {
    const storage = new AsyncLocalStorage();
    const child = storage.run("spawn", () =>
      spawn(bunExe(), ["-e", "process.stdin.resume()"], { env: bunEnv, stdio: ["pipe", "ignore", "inherit"] }),
    );
    const seen = [];
    storage.run("end", () => {
      child.stdin.on("finish", () => seen.push(`finish in ${storage.getStore()}`));
      child.stdin.end("x", () => seen.push(`end cb in ${storage.getStore()}`));
    });
    await once(child, "close");
    expect(seen).toEqual(["end cb in end", "finish in end"]);
  });

  // child.unref() lets go of the process, not of its pipes. With fewer than three stdio entries the
  // stream of stdout was made at its first use, unreferenced: the parent left, and its timer with it,
  // before the child had the byte that it waits for.
  it("a stdout pipe that is read keeps the parent alive after child.unref(), whatever the length of stdio", async () => {
    const result = await run([
      bunExe(),
      "-e",
      `const { spawn } = require("node:child_process");
       const waits = "require('node:fs').readSync(0, Buffer.alloc(1)); console.log('from the child');";
       const child = spawn(process.execPath, ["-e", waits], { stdio: ["pipe", "pipe"] });
       child.unref();
       child.stdout.on("data", chunk => process.stdout.write(chunk));
       setTimeout(() => child.stdin.end("x"), 0).unref();`,
    ]);
    expect(result).toEqual({ stdout: "from the child\n", stderr: "", exitCode: 0 });
  });

  // The streams that spawn() made for the child that never started are dropped: what the
  // ChildProcess shows and emits is what it showed and emitted before.
  it("a spawn that fails shows destroyed streams and emits nothing for the ones made ahead", async () => {
    const child = spawn(join(import.meta.dir, "does-not-exist"), [], { stdio: ["pipe", "pipe", "pipe"] });
    const log = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers();
    child.on("error", err => log.push(`error ${err.code}`));
    child.on("spawn", () => log.push("spawn"));
    child.on("close", () => {
      log.push("close");
      // One turn of the loop, so that what trails 'close' is in the log.
      setImmediate(onClose);
    });
    const streams = [child.stdin, child.stdout, child.stderr];
    const names = ["stdin", "stdout", "stderr"];
    streams.forEach((stream, i) => {
      for (const event of ["open", "ready", "error", "finish", "end", "close"]) {
        stream.on(event, () => log.push(`${names[i]} ${event}`));
      }
    });
    child.stdin.end("x");
    await closed;
    expect({
      log,
      destroyed: streams.map(stream => stream.destroyed),
      stdio: child.stdio.map((stream, i) => stream === streams[i]),
    }).toEqual({
      log: ["error ENOENT", "close", "stdin close", "stdout close", "stderr close"],
      destroyed: [true, true, true],
      stdio: [true, true, true],
    });
  });
});

// One callback after spawn(), a child that lives a few milliseconds has exited, and this loop has yet to report that:
// it runs its task queue and its immediates ahead of the poll that sees an exit. Node.js polls first, so there the exit
// has destroyed child.stdin before the callback runs, and a write to it ends with no 'error'. Here the write was sent,
// and its EPIPE became an 'error' that ended a parent with no listener for it.
//
// Each row of the fixture proves that its child has exited, without a poll of the event loop. Windows: the fixture has
// no such proof there. FreeBSD: the question that the stream asks is not wired.
describe.skipIf(isWindows || isFreeBSD)("child.stdin one callback after spawn()", () => {
  const fixture = join(import.meta.dir, "fixtures", "stdin-exited-child-fixture.js");

  // The rows of a table of the fixture: { [row]: what followed the calls of the row, in order }.
  async function table(name, { entry = fixture, env = bunEnv } = {}) {
    using dir = tempDir("stdin-exited-child", {});
    await using proc = Bun.spawn({ cmd: [bunExe(), entry, name, String(dir)], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }

  // The part of a row that Node.js shows too: the 'error' of child.stdin, or that it closed with none.
  const ending = events =>
    events.find(event => event.startsWith("stdin error ")) ??
    (events.includes("stdin finish")
      ? "'finish'"
      : events.some(event => event.startsWith("stdin close"))
        ? "no 'error'"
        : "never closed");
  const endings = rows => Object.fromEntries(Object.entries(rows).map(([row, events]) => [row, ending(events)]));
  const every = (name, value) => Object.fromEntries(tables[name].map(row => [row, value]));

  it.concurrent("a parent with no 'error' listener survives a write to a child that has exited", async () => {
    expect(endings(await table("no listener"))).toEqual(every("no listener", "no 'error'"));
  });

  it.concurrent("no 'error' for a child that exited before the callback", async () => {
    expect(endings(await table("exited"))).toEqual(every("exited", "no 'error'"));
  });

  // In the turn of spawn(), for a child that lived through a poll, for a live child that closed its stdin, and for a
  // child that took bytes in the callback and then exited (all of them, or a part while the rest waited): Node.js
  // reports the EPIPE in each.
  it.concurrent("'error' EPIPE where no loop could have reported an exit", async () => {
    expect(endings(await table("not reported"))).toEqual(every("not reported", "stdin error EPIPE"));
  });

  // An ES module with a pending top-level await is run by another function of the event loop (auto_tick).
  it.concurrent("the same from a program that waits in a top-level await", async () => {
    expect(endings(await table("both kinds", { entry: fixture.replace(/js$/, "mjs") }))).toEqual({
      "immediate, end": "no 'error'",
      "immediate, write large": "no 'error'",
      "promise, end": "no 'error'",
      "fs, end": "no 'error'",
      "spawn turn, end": "stdin error EPIPE",
      "closed, end": "stdin error EPIPE",
    });
  });

  // Without a pidfd a thread waits for the child, and the stream gets no answer. These rows have a live child, and the
  // fixture has /dev/null as its stdin: an answer that is read from descriptor 0 says that the child has exited.
  it.skipIf(!isLinux && !isAndroid).concurrent("'error' EPIPE for a live child that a thread waits for", async () => {
    const env = { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "1" };
    expect(endings(await table("closed", { env }))).toEqual(every("closed", "stdin error EPIPE"));
  });

  // The loop reports the exit itself, as it always has: what the child sent before it exited is read first.
  it.concurrent("the output and the message of the child arrive ahead of its 'exit'", async () => {
    const rows = await table("order");
    const ahead = (row, event) =>
      rows[row].includes(event) && rows[row].indexOf(event) < rows[row].indexOf("exit SIGKILL");
    expect({
      stdout: ahead("immediate, end large, output", "stdout data"),
      stderr: ahead("immediate, end large, output", "stderr data"),
      message: [ahead("immediate, end large, ipc", "message"), ahead("fs, end large, ipc", "message")],
      "'close' of the child for a listener that was added late":
        rows["immediate, end, then listen for 'close' of the child, output"].includes("late close"),
    }).toEqual({
      stdout: true,
      stderr: true,
      message: [true, true],
      "'close' of the child for a listener that was added late": true,
    });
  });

  // kill() sends no signal to a child whose exit Node.js has reported, and returns false:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L502-L527
  // An AbortSignal emits its AbortError only if kill() returned true.
  it.concurrent("kill() and an AbortSignal leave a child that has exited alone", async () => {
    const rows = await table("kill");
    const said = Object.fromEntries(
      Object.entries(rows).map(([row, events]) => [row, events.filter(event => !/^(exit|stdin) /.test(event))]),
    );
    expect(said).toEqual({
      "immediate, kill()": ["kill() false, killed false"],
      "promise, kill()": ["kill() false, killed false"],
      "fs, kill()": ["kill() false, killed false"],
      "spawn turn, kill()": ["kill() true, killed true"],
      "later, kill()": ["kill() true, killed true"],
      "immediate, abort, signal": [],
      "spawn turn, abort, signal": ["child error AbortError"],
      // The error of execFile() is that of the exit: the child was killed from outside.
      "immediate, abort, execFile": ["execFile callback Error"],
      "spawn turn, abort, execFile": ["execFile callback AbortError", "child error AbortError"],
    });
  });

  // What the rows above leave out, because it differs from Node.js. Here the failed send itself ends the stream, and the
  // loop reports the exit after it: the callbacks, `errored` and finished() have the EPIPE of the send, and 'exit'
  // comes last. Under Node.js the exit comes first and destroys the stream: `errored` is null, a callback gets
  // ERR_STREAM_DESTROYED or is not called, and finished() after write() and end() resolves.
  //
  // Once this loop reports an exit ahead of its immediates and its tasks, these rows fail. Delete them then, with the
  // question that the stream asks (has_exited_before_first_poll in subprocess.rs).
  describe("while the loop reports an exit behind its immediates and tasks", () => {
    it.concurrent("the callbacks and `errored` have the EPIPE, and 'exit' is last", async () => {
      const rows = await table("exited");
      const closed = ["stdin close, errored EPIPE", "exit SIGKILL"];
      const expected = {};
      for (const when of ["immediate", "promise"]) {
        Object.assign(expected, {
          [`${when}, end`]: ["end callback EPIPE", ...closed],
          [`${when}, end large`]: ["end callback EPIPE", ...closed],
          [`${when}, write large`]: ["write callback EPIPE", ...closed],
          [`${when}, write large twice`]: ["write callback EPIPE", "write callback EPIPE", ...closed],
          [`${when}, write large, end`]: ["write callback EPIPE", "end callback EPIPE", ...closed],
          [`${when}, write, end`]: closed,
          // The sink holds back a small write, and answers it before anything is sent.
          [`${when}, write, end with callback`]: ["write callback ok", "end callback EPIPE", ...closed],
          [`${when}, write, destroy`]: ["stdin close, errored null", "exit SIGKILL"],
        });
      }
      expect(Object.fromEntries(Object.keys(expected).map(row => [row, rows[row]]))).toEqual(expected);
    });

    // The first two rows differ only in where the sink sends: 4096 bytes go out in write(), fewer in end().
    it.concurrent("finished() has the EPIPE whatever the size of the write", async () => {
      const rows = await table("finished");
      const closed = ["stdin close, errored EPIPE", "finished EPIPE", "exit SIGKILL"];
      expect({
        "immediate, write 4095, end, finished": rows["immediate, write 4095, end, finished"],
        "immediate, write 4096, end, finished": rows["immediate, write 4096, end, finished"],
        "immediate, end large, finished": rows["immediate, end large, finished"],
        // fs.stat() is one request to the thread pool. Node.js runs its callback in the poll that also sees the exit,
        // ahead of the exit, and reports EPIPE. Bun does not tell it from fs.readFile(), which is several.
        "fs one hop, end": ending(rows["fs one hop, end"]),
        "fs one hop, write large": ending(rows["fs one hop, write large"]),
      }).toEqual({
        "immediate, write 4095, end, finished": closed,
        "immediate, write 4096, end, finished": closed,
        "immediate, end large, finished": ["end callback EPIPE", ...closed],
        "fs one hop, end": "no 'error'",
        "fs one hop, write large": "no 'error'",
      });
    });

    // Where spawn() runs, against when end() runs. The child of each cell has exited by then.
    it.concurrent("spawn() in a callback", async () => {
      expect(await table("origins")).toEqual({
        "spawn() in a timer, the same turn": "EPIPE",
        "spawn() in a timer, the next immediate": "no 'error'",
        "spawn() in an fs callback, the same turn": "EPIPE",
        // Node.js reports EPIPE in the next two: it has not polled between the two callbacks.
        "spawn() in an fs callback, the next immediate": "no 'error'",
        "spawn() in an fs callback, the next fs callback": "no 'error'",
        "spawn() in an immediate, the same turn": "EPIPE",
        "spawn() in an immediate, the next immediate": "no 'error'",
        "spawn() in an immediate, an immediate of the same batch": "EPIPE",
      });
    });
  });

  // The stream holds the Subprocess of its child to ask about it, and lets go of it when it is destroyed.
  it.concurrent("a stdin that is kept does not keep the Subprocess of its child", async () => {
    const script = `
      const { spawn } = require("node:child_process");
      const { heapStats } = require("bun:jsc");
      const kept = [];
      let open = 30;
      for (let i = 0; i < 30; i++) {
        const child = spawn("true", { stdio: ["pipe", "ignore", "ignore"] });
        kept.push(child.stdin);
        child.on("close", () => {
          if (--open > 0) return;
          setImmediate(() => {
            Bun.gc(true);
            console.log(JSON.stringify({ kept: kept.length, subprocesses: heapStats().objectTypeCounts.Subprocess ?? 0 }));
          });
        });
      }`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { kept, subprocesses } = JSON.parse(stdout);
    expect(kept).toBe(30);
    expect(subprocesses).toBeLessThan(5);
  });
});

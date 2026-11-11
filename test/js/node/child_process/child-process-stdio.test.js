import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { AsyncLocalStorage } from "node:async_hooks";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { Readable } from "node:stream";
import { stdinCallOrders } from "./fixtures/stdin-call-orders-fixture.js";

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

  // The stream of a child's stdin takes no options. With an `fd` that Object.prototype carried, the input went to that fd.
  it("child.stdin takes no stream options from Object.prototype", async () => {
    const result = await run([
      bunExe(),
      "-e",
      `const { spawn } = require("node:child_process");
       const inherited = { fd: 2147483647, autoClose: false };
       let child;
       Object.assign(Object.prototype, inherited);
       try {
         child = spawn(process.execPath, ["-e", ${JSON.stringify(echo)}], { stdio: ["pipe", "inherit", "inherit"] });
         child.stdin.on("error", err => {
           console.error(err.message);
           child.kill();
         });
         child.stdin.end("hello");
       } finally {
         for (const name of Object.keys(inherited)) delete Object.prototype[name];
       }
       const { fd, autoClose } = child.stdin;
       child.on("close", () => process.stdout.write(" " + JSON.stringify({ fd, autoClose })));`,
    ]);
    expect(result).toEqual({ stdout: `hello {"fd":null,"autoClose":true}`, stderr: "", exitCode: 0 });
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
    // progress when destroy() comes. Node.js closes the pipe at once and drops the write. Here
    // destroy() waited for the child, and then reported the EPIPE of that write.
    describe.each([
      ["in the tick of spawn()", "calls()"],
      ["one macrotask later", "setImmediate(calls)"],
    ])("%s", (_, when) => {
      it.each([
        [`destroy()`, ["close"]],
        [`destroy(new Error("boom"))`, ["error boom", "close"]],
      ])("end(1 MiB); %s closes the stream at once, with no write error", async (destroy, log) => {
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
               console.log(JSON.stringify({ log, childRuns: child.exitCode === null && child.signalCode === null }));
               child.kill();
             });
             stdin.end(Buffer.alloc(1024 * 1024, "x"));
             stdin.${destroy};
           }
           ${when};`,
        ]);
        expect({ ...result, stdout: result.stdout && JSON.parse(result.stdout) }).toEqual({
          stdout: { log, childRuns: true },
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
      "%s, to a child that reads, events and callbacks are those of Node.js, except in the rows listed",
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
          // _final completes one tick after end(), where the shutdown of node's socket takes a turn
          // of the event loop: the stream has finished before a destroy() that comes a tick later.
          [`end("hello", cb); nextTick(destroy)`]: row("hello", ...finished),
          [`end("hello", cb); queueMicrotask(destroy)`]: row("hello", ...finished),
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

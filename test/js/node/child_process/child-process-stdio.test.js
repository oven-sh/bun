import { describe, expect, it, onTestFinished } from "bun:test";
import { bunEnv, bunExe, isPosix, isWindows, nodeExe, tempDir } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";

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

  // The tests below run in sequence: each starts a bun child, and several at once run past the
  // default timeout under a debug build.

  // The child reads nothing until the parent says so, so end() finds a backlog. autoDestroy is
  // off: only _final can give the child its end-of-file.
  it("end() with a backlog gives the child end-of-file without autoDestroy", async () => {
    const child = spawn(
      bunExe(),
      [
        "-e",
        `process.on("message", () => {
           process.stdout.write(String(require("fs").readFileSync(0).length));
           process.disconnect();
         });`,
      ],
      { env: bunEnv, stdio: ["pipe", "pipe", "inherit", "ipc"] },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    child.stdin._writableState.autoDestroy = false;
    const chunk = Buffer.alloc(1024 * 1024, "x");
    // On Windows one uv_write takes a whole chunk, and write() reports no backlog for it.
    const most = isWindows ? chunk.length : 64 * chunk.length;
    let written = 0;
    let backedUp = false;
    while (!backedUp && written < most) {
      backedUp = !child.stdin.write(chunk);
      written += chunk.length;
    }
    child.stdin.end();
    child.send("go");
    const [code, signal] = await once(child, "close");
    if (!isWindows) expect(backedUp).toBe(true);
    expect({ stdout, code, signal }).toEqual({ stdout: String(written), code: 0, signal: null });
  });

  // node emits 'close' from the close callback of the handle, a loop turn after 'finish'. Here
  // it comes after the promise jobs and the ticks that the 'finish' listeners queued.
  it("'close' comes after a promise job and after a tick of 'finish'", async () => {
    const child = spawn(bunExe(), ["-e", `console.log(require("fs").readFileSync(0).length);`], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    const closed = once(child, "close");
    const stdin = child.stdin;
    const afterTick = new Promise(resolve =>
      stdin.on("finish", () => process.nextTick(() => stdin.on("close", resolve))),
    );
    stdin.end("hello");
    await once(stdin, "finish");
    await once(stdin, "close");
    await afterTick;
    expect(await closed).toEqual([0, null]);
    expect(stdout).toBe("5\n");
  });

  // The fake timers of a test replace these globals. `use` runs with both replaced.
  async function withoutTimerGlobals(use) {
    const { setImmediate, queueMicrotask } = globalThis;
    const restore = () => void Object.assign(globalThis, { setImmediate, queueMicrotask });
    // Runs after a timeout too: the tests below need the real ones.
    onTestFinished(restore);
    globalThis.setImmediate = globalThis.queueMicrotask = () => {};
    try {
      return await use();
    } finally {
      restore();
    }
  }

  // The stream module read the real queueMicrotask when an earlier test loaded it.
  it("the finish events do not wait for a setImmediate or queueMicrotask that is replaced later", async () => {
    const child = spawn(bunExe(), ["-e", `console.log(require("fs").readFileSync(0).length);`], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    const closed = once(child, "close");
    const stdin = child.stdin;
    const events = [];
    for (const event of ["prefinish", "finish"]) stdin.on(event, () => events.push(event));
    await withoutTimerGlobals(() => {
      stdin.end("hello", err => events.push(`end callback ${err}`));
      return once(stdin, "close");
    });
    expect(events).toEqual(["prefinish", "end callback null", "finish"]);
    expect(await closed).toEqual([0, null]);
    expect(stdout).toBe("5\n");
  });

  // The flush is inside end(): the byte is on the pipe before kill(), so no write fails later.
  // Not on Windows: the uv_write of the byte completes after kill() there.
  it.skipIf(isWindows)("write(), end() and kill() in one block give no 'error'", async () => {
    const child = spawn("cat", [], { stdio: ["pipe", "ignore", "inherit"] });
    const stdin = child.stdin;
    const events = [];
    for (const event of ["finish", "close"]) stdin.on(event, () => events.push(event));
    stdin.on("error", err => events.push(`error ${err.code}`));
    const closed = once(child, "close");
    // The stream is constructed by the time setImmediate runs.
    await new Promise(resolve => setImmediate(resolve));
    stdin.write("x");
    stdin.end();
    child.kill("SIGKILL");
    expect(await closed).toEqual([null, "SIGKILL"]);
    expect(events).toEqual(["finish", "close"]);
  });

  // _destroy finds the sink already ended. 'close' still comes after the queued 'finish'.
  it("destroy() in a 'prefinish' listener keeps 'finish' before 'close'", async () => {
    const child = spawn(bunExe(), ["-e", `console.log(require("fs").readFileSync(0).length);`], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    const stdin = child.stdin;
    const events = [];
    for (const event of ["prefinish", "finish", "close"]) stdin.on(event, () => events.push(event));
    stdin.on("prefinish", () => stdin.destroy());
    stdin.end("hello");
    const [code, signal] = await once(child, "close");
    expect({ events, stdout, code, signal }).toEqual({
      events: ["prefinish", "finish", "close"],
      stdout: "5\n",
      code: 0,
      signal: null,
    });
  });

  // node emits this 'error' before 'finish'. Here it comes with 'close', as before this _final.
  it("destroy(err) in a 'prefinish' listener reports err", async () => {
    const child = spawn(bunExe(), ["-e", `console.log(require("fs").readFileSync(0).length);`], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    const stdin = child.stdin;
    const events = [];
    for (const event of ["prefinish", "finish", "close"]) stdin.on(event, () => events.push(event));
    stdin.on("error", err => events.push(`error ${err.message}`));
    stdin.on("prefinish", () => stdin.destroy(new Error("E1")));
    stdin.end("hello", err => events.push(`end callback ${err?.message}`));
    const [code, signal] = await once(child, "close");
    expect({ events, stdout, code, signal }).toEqual({
      events: ["prefinish", "end callback E1", "finish", "error E1", "close"],
      stdout: "5\n",
      code: 0,
      signal: null,
    });
  });

  // The next four tests replace end() of the FileSink that child.stdin writes to. The real end()
  // returns a promise while a write is in flight on Windows, and fails when that write fails.
  // On POSIX _final flushes until nothing is left, so the real end() has nothing to wait for.
  // The child waits for an end-of-file that the replaced end() never gives it.
  function withSinkEnd(end, use) {
    const child = spawn(bunExe(), ["-e", `require("fs").readFileSync(0);`], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "inherit"],
    });
    const stdin = child.stdin;
    const slot = Object.getOwnPropertySymbols(stdin).find(symbol => symbol.description === "kWriteStreamFastPath");
    Object.defineProperty(stdin[slot], "end", { value: end });
    const events = [];
    for (const event of ["prefinish", "finish"]) stdin.on(event, () => events.push(event));
    stdin.on("error", err => events.push(`error ${err.message}`));
    const closed = new Promise(resolve => stdin.on("close", () => resolve(events.push("close"))));
    return use(stdin, events, closed).finally(() => child.kill("SIGKILL"));
  }

  const failingEnds = {
    "throws from": () => {
      throw new Error("end failed");
    },
    "rejects from": () => Promise.reject(new Error("end failed")),
  };
  for (const [how, end] of Object.entries(failingEnds)) {
    it(`end() reports a sink that ${how} its end()`, async () => {
      const events = await withSinkEnd(end, async (stdin, events, closed) => {
        stdin.end(err => events.push(`end callback ${err?.message}, destroyed ${stdin.destroyed}`));
        await closed;
        return events;
      });
      expect(events).toEqual(["end callback end failed, destroyed true", "error end failed", "close"]);
    });
  }

  // The callbacks of a pending end() need no timer either. They run from a tick, not inside the
  // promise job that the sink settles: a callback that throws is then an uncaughtException.
  it("end() finishes when the pending end() of the sink settles", async () => {
    const ended = Promise.withResolvers();
    const events = await withSinkEnd(
      () => ended.promise,
      async (stdin, events, closed) => {
        stdin.end(() => events.push("end callback"));
        await new Promise(resolve => setImmediate(resolve));
        events.push("the sink ends");
        await withoutTimerGlobals(() => {
          ended.resolve(0);
          Promise.resolve().then(() => events.push("promise job"));
          return closed;
        });
        return events;
      },
    );
    expect(events).toEqual(["the sink ends", "promise job", "prefinish", "end callback", "finish", "close"]);
  });

  // While the sink still ends, the pipe is open and the stream keeps its sink: a destroy() finds
  // it, and spawn() takes its fd. A FileSink has no fd number on Windows.
  it.skipIf(isWindows)("a stdin whose sink is still ending is the stdio of another spawn", async () => {
    const called = Promise.withResolvers();
    const ended = Promise.withResolvers();
    const events = await withSinkEnd(
      () => {
        called.resolve();
        return ended.promise;
      },
      async (stdin, events, closed) => {
        stdin.end();
        await called.promise;
        const writer = spawn("true", [], { stdio: ["ignore", stdin, "ignore"] });
        const [code, signal] = await once(writer, "close");
        events.push(`the writer exited ${code} ${signal}`);
        ended.resolve(0);
        await closed;
        return events;
      },
    );
    expect(events).toEqual(["the writer exited 0 null", "prefinish", "finish", "close"]);
  });

  // A FileSink has no fd number on Windows: spawn() refuses every child.stdin there.
  it.skipIf(isWindows)("an ended stdin is the stdio of another spawn until _final has run", async () => {
    const first = spawn(
      bunExe(),
      ["-e", `console.log("ready"); require("fs").readFileSync(0); console.log("end-of-file");`],
      { env: bunEnv, stdio: ["pipe", "pipe", "inherit"] },
    );
    const writer = () => spawn(bunExe(), ["-e", ""], { env: bunEnv, stdio: ["ignore", first.stdin, "ignore"] });
    let stdout = "";
    first.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    const firstClosed = once(first, "close");
    // From 'prefinish' on the sink is closed and its fd number can belong to another file. node
    // spawns here too: its handle is open until destroy. So did bun before this _final.
    const { promise: fromPrefinish, resolve } = Promise.withResolvers();
    first.stdin.on("prefinish", () => {
      try {
        writer();
        resolve("spawned");
      } catch {
        resolve("refused");
      }
    });
    // The stream is constructed by now, so end() calls _final at once. The sink ends a microtask
    // later, as node's shutdown waits for the event loop: this block still owns the pipe.
    await once(first.stdout, "data");
    first.stdin.end();
    const inBlock = writer();

    expect(await once(inBlock, "close")).toEqual([0, null]);
    expect(await fromPrefinish).toBe("refused");
    expect(await firstClosed).toEqual([0, null]);
    expect(stdout).toBe("ready\nend-of-file\n");
  });

  // In the next three tests the child has closed its own stdin, has said so, and lives as long
  // as its IPC channel. `use` runs from setImmediate, not from a promise job: its nextTicks then
  // run before its promise jobs. On Windows a write fails when its uv_write completes, not inside
  // write() or flush(), so the lists (node v26.3.0 on POSIX) do not apply there.
  async function withClosedStdin(use) {
    const child = spawn(
      bunExe(),
      ["-e", `require("fs").closeSync(0); process.on("message", () => {}); process.send("ready");`],
      { env: bunEnv, stdio: ["pipe", "ignore", "ignore", "ipc"] },
    );
    try {
      const events = [];
      const stdin = child.stdin;
      for (const event of ["prefinish", "finish"]) stdin.on(event, () => events.push(event));
      stdin.on("error", err => events.push(`error ${err.code} ${err.syscall}`));
      const { promise, resolve, reject } = Promise.withResolvers();
      child.on("error", reject);
      child.on("exit", () => reject(new Error("the child exited")));
      child.once("message", () => setImmediate(use, stdin, events, resolve));
      await promise;
      return events;
    } finally {
      child.kill("SIGKILL");
    }
  }

  // The sink holds a chunk of less than 4096 bytes (16384 on Apple Silicon) until a flush, so the
  // flush in _final is the write that fails. As for a failed write, the stream is destroyed
  // before the callback runs.
  it.skipIf(isWindows)("end() reports EPIPE when the child closed its stdin", async () => {
    const events = await withClosedStdin((stdin, events, done) => {
      stdin.on("close", done);
      stdin.end("hello", err => events.push(`end callback ${err?.code}, destroyed ${stdin.destroyed}`));
    });
    expect(events).toEqual(["end callback EPIPE, destroyed true", "error EPIPE write"]);
  });

  // write() fails inside write(). Its rejection is a promise job, and _final starts behind it.
  it.skipIf(isWindows)("end() after a write() that failed reports the failure", async () => {
    const events = await withClosedStdin((stdin, events, done) => {
      stdin.on("close", done);
      stdin.write(Buffer.alloc(64 * 1024, "x"), err => events.push(`write callback ${err?.code}`));
      stdin.end(err => events.push(`end callback ${err?.code}`));
    });
    expect(events).toEqual(["write callback EPIPE", "end callback EPIPE", "error EPIPE write"]);
  });

  // node destroys the stream here whatever autoDestroy says. bun reports the error and calls back.
  // The place of the callback among the other events is not pinned: #45552 moves it.
  it.skipIf(isWindows)("end(cb) after a write() that failed calls back without autoDestroy", async () => {
    const events = await withClosedStdin((stdin, events, done) => {
      stdin._writableState.autoDestroy = false;
      stdin.write(Buffer.alloc(64 * 1024, "x"));
      stdin.end(err => {
        events.push(`end callback ${err?.code}`);
        done();
      });
    });
    expect(events.filter(event => event.startsWith("end callback"))).toEqual(["end callback EPIPE"]);
  });

  // The flush in _final is the write that fails. Nothing destroys the stream, so the callback
  // runs first and then emits 'error', as before this _final: a listener that throws, or none,
  // does not cost the caller the callback.
  it.skipIf(isWindows)("end() calls back before 'error' when the flush fails without autoDestroy", async () => {
    const events = await withClosedStdin((stdin, events, done) => {
      stdin._writableState.autoDestroy = false;
      stdin.on("error", done);
      stdin.end("hello", err => events.push(`end callback ${err?.code}`));
    });
    expect(events).toEqual(["end callback EPIPE", "error EPIPE write"]);
  });

  // This passes without the _final of child.stdin too: it pins the error contract of a backlog.
  // The child reads nothing until the parent has called end(), then one byte, and exits.
  it.skipIf(isWindows)("end() reports EPIPE when the child exits with a backlog unread", async () => {
    const child = spawn(
      bunExe(),
      ["-e", `process.on("message", () => { require("fs").readSync(0, Buffer.alloc(1)); process.exit(0); });`],
      { env: bunEnv, stdio: ["pipe", "ignore", "ignore", "ipc"] },
    );
    const events = [];
    const stdin = child.stdin;
    for (const event of ["prefinish", "finish"]) stdin.on(event, () => events.push(event));
    stdin.on("error", err => events.push(`error ${err.code} ${err.syscall}`));
    const closed = new Promise(resolve => stdin.on("close", resolve));
    // 16 MiB is more than any socket buffer holds.
    const backedUp = !stdin.write(Buffer.alloc(16 * 1024 * 1024, "x"), err =>
      events.push(`write callback ${err?.code}`),
    );
    stdin.end(err => events.push(`end callback ${err?.code}`));
    child.send("go");
    await closed;
    expect({ backedUp, events }).toEqual({
      backedUp: true,
      events: ["write callback EPIPE", "end callback EPIPE", "error EPIPE write"],
    });
  });

  // node's net.Socket shuts the pipe down in _final: the child reads end-of-file before
  // 'prefinish', the end() callback and 'finish' run. Each cell of the fixture ends the stdin of
  // its own child and names what a finish callback then does. The reports are what node v26.3.0
  // prints for the same fixture on POSIX.
  const fixture = join(import.meta.dir, "fixtures", "stdin-end-eof-fixture.js");
  async function reportOf(exe, ...groups) {
    using directory = tempDir("stdin-end-eof", {});
    await using proc = Bun.spawn({
      cmd: [exe, fixture, String(directory), ...groups],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { report: stdout.startsWith("{") ? JSON.parse(stdout) : stdout, stderr, exitCode };
  }
  const threw = ["prefinish", "uncaughtException", "close"];
  const finished = ["prefinish", "finish", "close"];
  const destroyed = ["end callback ERR_STREAM_DESTROYED", "close"];
  const reports = {
    throws: {
      "end callback": { stdin: threw, stdout: "5", code: 0, signal: null },
      "'finish' listener": {
        stdin: ["prefinish", "finish", "uncaughtException", "close"],
        stdout: "5",
        code: 0,
        signal: null,
      },
      "'prefinish' listener": { stdin: threw, stdout: "0", code: 0, signal: null },
      "end callback, in the spawn tick": { stdin: threw, stdout: "5", code: 0, signal: null },
    },
    backlog: {
      "'prefinish' listener, after a backlog": {
        stdin: threw,
        backedUp: true,
        stdout: "the backlog",
        code: 0,
        signal: null,
      },
    },
    wait: {
      "end callback waits for the child": {
        stdin: finished,
        childReachedEndOfFile: true,
        stdout: "",
        code: 0,
        signal: null,
      },
      "end callback waits for the child, after a backlog": {
        stdin: finished,
        backedUp: true,
        childReachedEndOfFile: true,
        stdout: "",
        code: 0,
        signal: null,
      },
      "end callback waits for the child, after a write and a backlog": {
        stdin: finished,
        backedUp: true,
        childReachedEndOfFile: true,
        stdout: "",
        code: 0,
        signal: null,
      },
      "the block of write(line) and end() waits for the child": {
        stdin: finished,
        childReadTheLine: true,
        stdout: "",
        code: 0,
        signal: null,
      },
    },
    destroys: {
      "end(cb), destroy()": { stdin: destroyed, stdout: "0", code: 0, signal: null },
      "write(), end(cb), destroy()": { stdin: destroyed, stdout: "3", code: 0, signal: null },
      "end(chunk, cb), destroy()": { stdin: destroyed, stdout: "5", code: 0, signal: null },
      "end(chunk, cb), destroy() on the next tick": { stdin: destroyed, stdout: "5", code: 0, signal: null },
      "end(chunk, cb), destroy() in a promise job": { stdin: destroyed, stdout: "5", code: 0, signal: null },
    },
  };
  // node calls the end() callback before it destroys the stream, so the throw costs node the
  // 'error' event.
  const fails = {
    "end callback, after a backlog that fails": {
      stdin: ["uncaughtException", "error EPIPE", "close"],
      backedUp: true,
      stdout: "",
      code: 0,
      signal: null,
    },
  };

  it("end() gives the child end-of-file when a finish callback throws", async () => {
    expect(await reportOf(bunExe(), "throws")).toEqual({ report: reports.throws, stderr: "", exitCode: 0 });
  });

  // The child of a backlog cell opens a fifo before it reads: the fixture needs mkfifo and sh.
  it.skipIf(isWindows)("end() gives the child end-of-file when a finish callback throws after a backlog", async () => {
    expect(await reportOf(bunExe(), "backlog", "fails")).toEqual({
      report: { ...reports.backlog, ...fails },
      stderr: "",
      exitCode: 0,
    });
  });

  // The children of these cells are sh and cat.
  it.skipIf(isWindows)("the child reads end-of-file while the end() callback waits for it", async () => {
    expect(await reportOf(bunExe(), "wait")).toEqual({ report: reports.wait, stderr: "", exitCode: 0 });
  });

  // Not on Windows: what node prints there is not known.
  it.skipIf(isWindows)("destroy() in the turn of end() gives no 'finish'", async () => {
    expect(await reportOf(bunExe(), "destroys")).toEqual({ report: reports.destroys, stderr: "", exitCode: 0 });
  });

  // Not on Windows: what node prints there is not known.
  it.skipIf(isWindows || !nodeExe())("node gives the same reports", async () => {
    const groups = Object.keys(reports);
    const fromNode = await Promise.all(groups.map(group => reportOf(nodeExe(), group)));
    expect(fromNode).toEqual(groups.map(group => ({ report: reports[group], stderr: "", exitCode: 0 })));
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

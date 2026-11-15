import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isPosix, isWindows, nodeExeAtLeast, tempDir } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
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

// Node reads a stdio pipe from its poll callback only. `_read()` just starts the
// handle (https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L769-L792), a
// read that comes up short ends the callback
// (https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/stream.c#L1147-L1155),
// and each chunk is pushed from a callback of its own. So the bytes a child
// writes while a listener runs arrive in a later turn of the event loop, after
// that listener's setImmediate, and never before the nextTicks and promise jobs
// of the chunk before. A pull that read the pipe itself pushed its bytes inside
// `_read()`: a 'data' listener that was detached for a moment missed them, and a
// read(n) of exactly what was buffered left the next chunk behind it.
//
// The writer fixture sends item i+1 only after the reader fixture acknowledged
// item i, and the reader's listener returns only when item i+1 is in the pipe.
// So nothing here depends on timing.
describe.concurrent("a Readable over a pipe takes each chunk from the poll callback", () => {
  const reader = join(import.meta.dir, "fixtures", "stdio-handshake-reader-fixture.js");
  const writer = join(import.meta.dir, "fixtures", "stdio-handshake-writer-fixture.js");
  const items = Array.from({ length: 10 }, (_, i) => `item${i}`);
  const mkfifo = Bun.which("mkfifo");
  const quote = arg => `'${String(arg).replaceAll("'", `'\\''`)}'`;
  const threadWaitsForChildren = { BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" };
  // For the rows that also run under Node.js. Node.js ran these fixtures on Linux only.
  const node = isLinux ? nodeExeAtLeast("22.0.0") : null;

  // `here`: whether the poll callback alone reads this source on this platform.
  // Outside Linux that holds for sockets only: kqueue does not report the end of
  // a named pipe, and only a read finds it. `block`: a size that the source takes
  // at once. A pipe takes 16384 bytes also when it has a quarter of the default
  // room. The stdio socket of a child takes as much as one read takes on Linux
  // (208 KiB by default) and on macOS, where Bun asks for 512 KiB (spawn_process.rs).
  const socketBlock = 131072;
  // A pipe of Windows takes 64 KiB, and a default socket of FreeBSD takes 8 KiB.
  const takesASocketBlock = isLinux || isMacOS;
  const sources = {
    "child.stdout": { source: "child.stdout", here: true, block: socketBlock },
    "child.stderr": { source: "child.stderr", here: true, block: socketBlock },
    "Readable.fromWeb(Bun.spawn().stdout)": { source: "Bun.spawn().stdout", here: true, block: socketBlock },
    "Readable.fromWeb(Bun.file(fifo).stream())": { source: "Bun.file(fifo)", here: isLinux && !!mkfifo, block: 16384 },
    "Readable.fromWeb(Bun.stdin.stream()) on a shell pipe": {
      source: "Bun.stdin",
      stdin: "pipe",
      here: isLinux,
      block: 16384,
    },
    "Readable.fromWeb(Bun.stdin.stream()) on a socket": {
      source: "Bun.stdin",
      stdin: "socket",
      here: isPosix,
      block: socketBlock,
    },
  };

  // Does what the writer fixture does, into fd 0 of the reader.
  async function feed(proc, dir, count, block) {
    for (let i = 0; i < count; i++) {
      proc.stdin.write(block ? Buffer.alloc(i === 0 ? 4096 : block, "a") : `item${i}\n`);
      await proc.stdin.flush();
      writeFileSync(join(dir, `wrote${i}`), "");
      while (!existsSync(join(dir, `got${i}`))) {
        if (proc.exitCode !== null) return;
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    await proc.stdin.end();
  }

  async function run(
    { source, stdin },
    consumer,
    { count = items.length, block, highWaterMark, handler, at, readOn, env, runtime = bunExe() } = {},
  ) {
    using dir = tempDir("stdio-handshake", {});
    const writerOptions = block ? [`block=${block}`] : [];
    const options = [...writerOptions];
    if (highWaterMark) options.push(`highWaterMark=${highWaterMark}`);
    if (handler) options.push(`handler=${handler}`);
    if (at !== undefined) options.push(`at=${at}`);
    if (readOn) options.push("readOn");
    if (source === "Bun.file(fifo)") {
      const fifo = join(String(dir), "fifo");
      expect(Bun.spawnSync({ cmd: [mkfifo, fifo] }).exitCode).toBe(0);
      options.push(`fifo=${fifo}`);
    }
    let cmd = [runtime, reader, source, consumer, String(dir), String(count), ...options];
    if (stdin === "pipe") {
      // Through a shell pipe, fd 0 of the reader is a blocking pipe.
      const feeder = [bunExe(), writer, String(dir), String(count), "1", ...writerOptions];
      cmd = ["sh", "-c", `${feeder.map(quote).join(" ")} | ${cmd.map(quote).join(" ")}`];
    }
    await using proc = Bun.spawn({
      cmd,
      env: { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: undefined, ...env },
      stdin: stdin === "socket" ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
      stdin === "socket" ? feed(proc, String(dir), count, block) : undefined,
    ]);
    let result = stdout;
    try {
      result = JSON.parse(stdout);
    } catch {}
    return { result, stderr, exitCode };
  }

  // `pushes`: the chunks that the stream pushed from inside a call of `_read()` after its first one.
  const pushes = { insideRead: 0 };
  const everyItem = { result: { all: items, seen: items, pushes }, stderr: "", exitCode: 0 };
  const nothingLeftBehind = {
    result: { chunks: items.map(item => item + "\n"), bufferedAfterRead: items.map(() => 0), pushes },
    stderr: "",
    exitCode: 0,
  };

  // The writer sends blocks, and the next block is in the pipe before the listener for
  // this one returns. The listener that `events.once` removed is back only after a
  // promise job, or after some nextTicks and promise jobs more.
  async function everyByte(entry, ticks, runtime) {
    const count = 6;
    const total = 4096 + (count - 1) * entry.block;
    expect(await run(entry, `once:${ticks}`, { count, block: entry.block, runtime })).toEqual({
      result: { all: total, seen: total, pushes },
      stderr: "",
      exitCode: 0,
    });
  }

  // Each block stops the stream, and the next block is in the pipe before the 'readable'
  // listener returns. That listener reads in its next setImmediate. Until then the native
  // reader takes nothing, so that read's _read() has no bytes to push.
  async function notReadAhead(runtime) {
    const count = 6;
    expect(await run(sources["child.stdout"], "readable-later", { count, block: 131072, runtime })).toEqual({
      result: { taken: 4096 + (count - 1) * 131072, pushes },
      stderr: "",
      exitCode: 0,
    });
  }

  // The child writes its last item, then a tail on its other stream, then exits, all
  // while the listener for the item before runs. `inOrder`: the two streams also keep
  // the order of the writes between them. epoll reports the fds in the order in which
  // they became ready, and the poll of a stream is armed again before its listener runs.
  async function whileAListenerRuns(name, { inOrder, env, runtime }) {
    const { result, stderr, exitCode } = await run(sources[name], "exit", { env, runtime });
    const events = result.events ?? [result];
    const byStream = [
      ...events.filter(event => event.startsWith("item")),
      ...events.filter(event => event.startsWith("other stream")),
      events.at(-1),
    ];
    expect({ events: inOrder ? events : byStream, stderr, exitCode }).toEqual({
      events: [...items, "other stream: tail", "exit"],
      stderr: "",
      exitCode: 0,
    });
  }

  // push() returned false and stopped the native reader at a full buffer. Then the child
  // wrote its last block and exited, and only then something read the stream. The
  // _read() of that read only arms the poll. With "-late", the first read of the stream
  // finds that full buffer in the pipe.
  const stoppedTotal = 4096 + 2 * 61440;
  async function afterTheStreamStopped(name, consumer, { env, runtime } = {}) {
    const arrivedAt = name.startsWith("child.")
      ? { exit: stoppedTotal }
      : { exited: stoppedTotal, onExit: stoppedTotal };
    expect(await run(sources[name], consumer, { count: 3, block: 61440, env, runtime })).toEqual({
      result: { stopped: true, arrivedAt, taken: stoppedTotal },
      stderr: "",
      exitCode: 0,
    });
  }

  // The child exits at once and leaves a writer on its stdout. That writer sends block
  // i+1 while the listener for block i runs, so the pipe is never empty when the stream
  // pulls again. The read before the report takes what libuv reads of a stream in one
  // poll (32 reads of 64 KiB), and at most one chunk more. Two blocks arrive before it.
  async function behindAWritingGrandchild({ env, runtime } = {}) {
    const count = 40;
    const { result, stderr, exitCode } = await run(sources["child.stdout"], "exit-grandchild", {
      count,
      block: 131072,
      env,
      runtime,
    });
    expect({ all: result.all, stderr, exitCode }).toEqual({
      all: 4096 + (count - 1) * 131072,
      stderr: "",
      exitCode: 0,
    });
    expect(result.atExit).toBeLessThanOrEqual(4096 + 131072 + 32 * 65536 + 262144);
  }

  // The child writes its last item and exits while the listener for the item before runs.
  // The listener of the last item waits for 'exit' inside Bun.build().
  async function waitsForTheExit(env) {
    expect(await run(sources["child.stdout"], "exit-nested", { env })).toEqual({
      result: { events: [...items, "exit", "the wait returned behind the report"] },
      stderr: "",
      exitCode: 0,
    });
  }

  // The listener throws once, at item `at` of `count`, and it keeps every chunk.
  const thrownAt = (at, origin) => ({ message: `thrown at item${at}`, origin });
  async function throwsAndReadsOn(name, at, { count = 5, block, consumer = "throw", env, runtime } = {}) {
    const options = { count, at, block, handler: "uncaughtException", env, runtime };
    expect(await run(sources[name], consumer, options)).toEqual({
      result: {
        all: block ? 4096 + (count - 1) * block : count * "item0\n".length,
        ended: true,
        intact: true,
        got: thrownAt(at, "uncaughtException"),
      },
      stderr: "",
      exitCode: 0,
    });
  }

  describe.each(Object.entries(sources))("%s", (name, entry) => {
    const cell = entry.here ? it : it.skip;
    const blocks = entry.here && takesASocketBlock ? it : it.skip;

    cell("a 'data' listener detached until the next setImmediate misses nothing", async () => {
      expect(await run(entry, "data")).toEqual(everyItem);
    });

    cell("read(n) of exactly what is buffered leaves nothing buffered", async () => {
      expect(await run(entry, "readable")).toEqual(nothingLeftBehind);
    });

    blocks("a loop of `await once(stream, 'data')` that comes back 2 ticks later gets every byte", () =>
      everyByte(entry, 2),
    );

    if (name !== "child.stdout") return;

    blocks("a loop of `await once(stream, 'data')` gets every byte", () => everyByte(entry, 0));

    cell("resume() from a setImmediate after pause() emits nothing before the next setImmediate", async () => {
      expect(await run(entry, "pause")).toEqual(everyItem);
    });
  });

  // process.stdin has its own `_read()` over a reader of the web stream, and its pulls still
  // read the pipe. Its resume() has to read at once (see the test with the timer below).
  // Observed: the detached listener gets item0, item2, item4, item6 and item8.
  it.todo(
    "process.stdin: resume() from a setImmediate after pause() emits nothing before the next setImmediate",
    async () => {
      expect(await run({ source: "process.stdin", stdin: "pipe" }, "pause")).toEqual(everyItem);
    },
  );

  // push() returned false and stopped the native reader. The next _read() starts it again,
  // and that also only arms the poll.
  it("Readable.fromWeb(Bun.spawn().stdout, { highWaterMark: 6 }): a reader that push() stopped starts again from the poll", async () => {
    expect(await run(sources["Readable.fromWeb(Bun.spawn().stdout)"], "readable", { highWaterMark: 6 })).toEqual(
      nothingLeftBehind,
    );
  });

  it.skipIf(!takesASocketBlock)(
    "child.stdout: a stream that push() stopped is not read ahead of its next _read()",
    () => notReadAhead(),
  );

  // The exit of a child and the last bytes of its stdio can be ready in the same poll, the
  // exit first. libuv runs the child watchers after the I/O of that poll
  // (https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/linux.c#L1539-L1547).
  // The fixture finds the exit of the child in /proc, and on macOS it asks `ps`.
  describe.skipIf(!isLinux && !isMacOS)("the bytes that a child wrote arrive before the report of its exit", () => {
    it.each(["child.stdout", "child.stderr"])("%s: written while a 'data' listener ran", name =>
      whileAListenerRuns(name, { inOrder: isLinux }),
    );

    it("child.stdout: a 'data' listener detached until the next setImmediate misses nothing of a child that exits behind its last item", async () => {
      expect(await run(sources["child.stdout"], "data-leave")).toEqual(everyItem);
    });

    // The poll callback runs that listener, and the nested turn of the event loop gets the exit
    // from epoll, which reports the pidfd for as long as it is readable. kqueue reports the exit
    // of a child once, in the same batch as the last item. Ahead of the item, the read before the
    // report runs the listener. Behind it, the nested turn polls again and does not run the rest
    // of that batch. Observed on macOS: the wait never returns.
    it.todoIf(isMacOS)(
      "child.stdout: the listener of the last item can wait for 'exit' in a nested turn of the event loop",
      () => waitsForTheExit(),
    );

    describe("in blocks", () => {
      it.each([
        ["child.stdout", "exit-stopped"],
        ["child.stdout", "exit-stopped-late"],
        ["child.stderr", "exit-stopped"],
        ["Readable.fromWeb(Bun.spawn().stdout)", "exit-stopped"],
        ["Readable.fromWeb(Bun.spawn().stdout)", "exit-stopped-late"],
      ])("%s: written after push() stopped the stream (%s)", (name, consumer) => afterTheStreamStopped(name, consumer));

      it("child.stdout: the report does not wait for all that a grandchild writes", () => behindAWritingGrandchild());
    });

    // Without a pidfd a thread of Bun waits for the child and reports its exit in a task.
    // Tasks run before the setImmediate callbacks and before the poll. The read before the
    // report takes stdout first, whichever stream the child wrote first.
    describe.skipIf(!isLinux)("while a thread waits for the child", () => {
      it("child.stdout: written while a 'data' listener ran", () =>
        whileAListenerRuns("child.stdout", { inOrder: false, env: threadWaitsForChildren }));

      it("child.stdout: written after push() stopped the stream", () =>
        afterTheStreamStopped("child.stdout", "exit-stopped", { env: threadWaitsForChildren }));

      it("child.stdout: the report does not wait for all that a grandchild writes", () =>
        behindAWritingGrandchild({ env: threadWaitsForChildren }));

      // The read before the report runs the listener of the last item.
      it("child.stdout: what the listener of the last item throws is an uncaughtException, and 'end' follows", () =>
        throwsAndReadsOn("child.stdout", 4, { consumer: "throw-leave", env: threadWaitsForChildren }));

      it("child.stdout: a 'data' listener detached until the next setImmediate misses nothing of a child that outlives its last item", async () => {
        expect(await run(sources["child.stdout"], "data", { env: threadWaitsForChildren })).toEqual(everyItem);
      });

      // The read before the report runs the listener of the last item, and the report is
      // behind that read. Observed: the wait never returns.
      it.todo(
        "child.stdout: the listener of the last item can wait for 'exit' in a nested turn of the event loop",
        () => waitsForTheExit(threadWaitsForChildren),
      );

      // Observed: the detached listener misses item9. The read before the report delivers
      // it from the task, ahead of the setImmediate that attaches the listener again.
      it.todo(
        "child.stdout: a 'data' listener detached until the next setImmediate misses nothing of a child that exits behind its last item",
        async () => {
          expect(await run(sources["child.stdout"], "data-leave", { env: threadWaitsForChildren })).toEqual(everyItem);
        },
      );
    });
  });

  // The child writes b<i> to its stdout and then sends m<i>, both while the listener for
  // a<i> runs. The poll of the stream is armed again before that listener runs, so epoll
  // reports the stream ahead of the channel. That holds for a channel that the poll before
  // did not report: the channel is level-triggered, and epoll keeps such a socket in its ready
  // list after a report, ahead of what gets ready later, until the next poll. Bun polls a new
  // channel for writability once, so the child starts after the parent has polled.
  it.skipIf(!isLinux)("child.stdout: bytes that the child wrote before an IPC message arrive before it", async () => {
    const rounds = 5;
    using dir = tempDir("stdio-before-ipc", {
      "child.js": `
        const fs = require("node:fs");
        const rounds = Number(process.argv[2]);
        const nap = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 30_000;
        function waitFor(name) {
          while (!fs.existsSync(__dirname + "/" + name)) {
            if (Date.now() > deadline) process.exit(3);
            Atomics.wait(nap, 0, 0, 1);
          }
        }
        let i = 0;
        waitFor("polled");
        (function round() {
          if (i === rounds) return process.disconnect();
          fs.writeSync(1, "a" + i + "\\n");
          waitFor("go" + i);
          fs.writeSync(1, "b" + i + "\\n");
          process.send("m" + i, () => {
            fs.writeFileSync(__dirname + "/wrote" + i, "");
            waitFor("got" + i);
            i++;
            round();
          });
        })();
      `,
      "parent.js": `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const nap = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 30_000;
        function waitFor(name) {
          while (!fs.existsSync(__dirname + "/" + name)) {
            if (Date.now() > deadline) process.exit(2);
            Atomics.wait(nap, 0, 0, 1);
          }
        }
        const child = spawn(process.execPath, [__dirname + "/child.js", process.argv[2]], {
          stdio: ["ignore", "pipe", "inherit", "ipc"],
        });
        const events = [];
        child.on("message", message => {
          events.push("ipc: " + message);
          fs.writeFileSync(__dirname + "/got" + message.slice(1), "");
        });
        child.stdout.on("data", chunk => {
          for (const line of String(chunk).split("\\n").filter(Boolean)) {
            events.push("stdout: " + line);
            if (line[0] !== "a") continue;
            fs.writeFileSync(__dirname + "/go" + line.slice(1), "");
            // b<i> and m<i> are in their sockets before this listener returns.
            waitFor("wrote" + line.slice(1));
          }
        });
        child.on("close", () => console.log(JSON.stringify(events)));
        // The second callback runs after the first poll, which reported the channel as writable.
        setImmediate(() => setImmediate(() => fs.writeFileSync(__dirname + "/polled", "")));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js", String(rounds)],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = Array.from({ length: rounds }, (_, i) => [`stdout: a${i}`, `stdout: b${i}`, `ipc: m${i}`]).flat();
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(expected) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // libuv calls the listeners of a handle from its read callback, so what a 'data' listener
  // of child.stdout throws is an uncaughtException, whichever chunk it is, and the handle
  // reads on when a handler took it. A chunk that settles a pull reaches the listener
  // inside a promise reaction.
  describe("what a 'data' listener throws", () => {
    it.each([
      ["child.stdout", 2],
      ["child.stdout", 4],
      ["child.stderr", 2],
    ])("%s: at item %d of 5 it is an uncaughtException, and the stream reads on to its end", (name, at) =>
      throwsAndReadsOn(name, at),
    );

    // One read takes the whole block and does not find the pipe empty behind it.
    it.skipIf(!takesASocketBlock)("child.stdout: at a block of 131072 bytes the stream reads on to its end", () =>
      throwsAndReadsOn("child.stdout", 2, { count: 6, block: 131072 }),
    );

    it("child.stdout: an 'unhandledRejection' listener does not get it", async () => {
      const { result, stderr, exitCode } = await run(sources["child.stdout"], "throw", {
        count: 3,
        handler: "unhandledRejection",
      });
      expect({ result, reported: stderr.includes("thrown at item2"), exitCode }).toEqual({
        result: { all: 3 * "item0\n".length, ended: false, intact: true, got: null },
        reported: true,
        exitCode: 1,
      });
    });

    // Node pushes from a promise reaction here too:
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/webstreams/adapters.js#L598-L609
    // Nothing reads the stream again, and the process ends when the writer has left.
    describe("Readable.fromWeb(): it rejects the promise of the read", () => {
      const spawned = sources["Readable.fromWeb(Bun.spawn().stdout)"];
      const shellPipe = sources["Readable.fromWeb(Bun.stdin.stream()) on a shell pipe"];
      const lastOf4 = { all: 4 * "item0\n".length, ended: false, intact: true, got: thrownAt(3, "a promise") };

      it("Bun.spawn().stdout", async () => {
        expect(await run(spawned, "throw", { count: 4, handler: "unhandledRejection" })).toEqual({
          result: lastOf4,
          stderr: "",
          exitCode: 0,
        });
      });

      // A shell pipe gets one read per wakeup, and that read does not arm the poll behind it.
      it.skipIf(!isLinux)("Bun.stdin.stream() on a shell pipe", async () => {
        expect(await run(shellPipe, "throw", { count: 4, handler: "unhandledRejection" })).toEqual({
          result: lastOf4,
          stderr: "",
          exitCode: 0,
        });
      });

      async function readsOn(entry) {
        expect(await run(entry, "throw", { count: 5, at: 2, readOn: true, handler: "unhandledRejection" })).toEqual({
          result: { all: 5 * "item0\n".length, ended: true, intact: true, got: thrownAt(2, "a promise") },
          stderr: "",
          exitCode: 0,
        });
      }

      it("Bun.spawn().stdout: a read(0) from the handler reads on, with the chunk of the listener untouched", () =>
        readsOn(spawned));

      it.skipIf(!isLinux)(
        "Bun.stdin.stream() on a shell pipe: a read(0) from the handler reads on, with the chunk of the listener untouched",
        () => readsOn(shellPipe),
      );
    });
  });

  // The rows for child.stdout and child.stderr state what Node.js does. A Linux host that
  // has a Node.js runs the same fixtures under it.
  describe.skipIf(!node)("the same fixtures under Node.js", () => {
    describe.each(["child.stdout", "child.stderr"])("%s", name => {
      const entry = sources[name];

      it("a 'data' listener detached until the next setImmediate misses nothing", async () => {
        expect(await run(entry, "data", { runtime: node })).toEqual(everyItem);
      });

      it("read(n) of exactly what is buffered leaves nothing buffered", async () => {
        expect(await run(entry, "readable", { runtime: node })).toEqual(nothingLeftBehind);
      });

      it("resume() from a setImmediate after pause() emits nothing before the next setImmediate", async () => {
        expect(await run(entry, "pause", { runtime: node })).toEqual(everyItem);
      });

      it("a loop of `await once(stream, 'data')` gets every byte", () => everyByte(entry, 0, node));

      it("a loop of `await once(stream, 'data')` that comes back 2 ticks later gets every byte", () =>
        everyByte(entry, 2, node));

      it("bytes written while a 'data' listener ran arrive before 'exit'", () =>
        whileAListenerRuns(name, { inOrder: true, runtime: node }));

      it("what a 'data' listener throws is an uncaughtException, and the stream reads on to its end", () =>
        throwsAndReadsOn(name, 2, { runtime: node }));
    });

    it("child.stdout: a 'data' listener detached until the next setImmediate misses nothing of a child that exits behind its last item", async () => {
      expect(await run(sources["child.stdout"], "data-leave", { runtime: node })).toEqual(everyItem);
    });

    it("child.stdout: a stream that push() stopped is not read ahead of its next _read()", () => notReadAhead(node));

    it("child.stdout: bytes written after push() stopped the stream arrive before 'exit'", () =>
      afterTheStreamStopped("child.stdout", "exit-stopped", { runtime: node }));

    it("child.stdout: 'exit' does not wait for all that a grandchild writes", () =>
      behindAWritingGrandchild({ runtime: node }));

    it("child.stdout: after a throw at a block of 131072 bytes the stream reads on to its end", () =>
      throwsAndReadsOn("child.stdout", 2, { count: 6, block: 131072, runtime: node }));
  });

  // A slice with no bytes left is never polled: its first read reports the end.
  it.skipIf(!isLinux || !mkfifo)(
    "Readable.fromWeb(Bun.file(fifo).slice(0, 0).stream()) ends while a writer holds the FIFO open",
    async () => {
      using dir = tempDir("stdio-empty-slice", {});
      const fifo = join(String(dir), "fifo");
      expect(Bun.spawnSync({ cmd: [mkfifo, fifo] }).exitCode).toBe(0);
      const script = `
        const fs = require("node:fs");
        const { Readable } = require("node:stream");
        // Both ends stay open, so the FIFO never reports a hang-up.
        const held = fs.openSync(process.argv[1], fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
        const stream = Readable.fromWeb(Bun.file(process.argv[1]).slice(0, 0).stream());
        let bytes = 0;
        stream.on("data", chunk => (bytes += chunk.length));
        stream.on("end", () => {
          console.log(JSON.stringify({ bytes }));
          fs.closeSync(held);
        });
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script, fifo],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: JSON.stringify({ bytes: 0 }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // process.stdin.resume() reads the pipe at once. Bun runs setImmediate callbacks before it
  // polls, so a resume() that waited for the poll would get no bytes in this window.
  it.skipIf(isWindows)(
    "process.stdin: resume() from a timer with pause() in that timer's setImmediate reads each item",
    async () => {
      using dir = tempDir("stdin-timer-window", {
        "reader.js": `
          const fs = require("node:fs");
          const [dir, count] = [process.argv[2], Number(process.argv[3])];
          const nap = new Int32Array(new SharedArrayBuffer(4));
          const deadline = Date.now() + 30_000;
          const received = [];
          process.stdin.on("data", chunk => received.push(String(chunk)));
          process.stdin.pause();
          let round = 0;
          function next() {
            if (round === count) {
              console.log(JSON.stringify(received));
              process.exit(0);
            }
            const i = round++;
            // Item i is in the pipe before the window opens.
            while (!fs.existsSync(dir + "/wrote" + i)) {
              if (Date.now() > deadline) process.exit(2);
              Atomics.wait(nap, 0, 0, 1);
            }
            setTimeout(() => {
              process.stdin.resume();
              setImmediate(() => {
                process.stdin.pause();
                fs.writeFileSync(dir + "/got" + i, "");
                setTimeout(next, 1);
              });
            }, 1);
          }
          setTimeout(next, 1);
        `,
      });
      const feeder = [bunExe(), writer, String(dir), String(items.length), "1"];
      const windowReader = [bunExe(), join(String(dir), "reader.js"), String(dir), String(items.length)];
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", `${feeder.map(quote).join(" ")} | ${windowReader.map(quote).join(" ")}`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: JSON.stringify(items.map(item => item + "\n")) + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // The decoder holds the stray byte back, so its push adds no text. Pushed from
  // inside _read(), such a chunk stopped the stream: no 'end', and no callback.
  // With `bulk`, the stray byte follows a chunk that is as much as one read takes.
  it.each(takesASocketBlock ? [0, 131072] : [0])(
    "execFile(): the callback comes when the child wrote part of a character while a 'data' listener ran (after %d more bytes)",
    async bulk => {
      using dir = tempDir("stdio-held-chunk", {
        "child.js": `
        const fs = require("node:fs");
        const bulk = Number(process.argv[2]);
        const nap = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 30_000;
        function waitFor(name) {
          while (!fs.existsSync(__dirname + "/" + name)) {
            if (Date.now() > deadline) process.exit(3);
            Atomics.wait(nap, 0, 0, 1);
          }
        }
        function writeAll(bytes) {
          for (let offset = 0; offset < bytes.length; ) offset += fs.writeSync(1, bytes, offset);
        }
        writeAll(Buffer.from("hello\\n"));
        if (bulk) {
          waitFor("go-bulk");
          writeAll(Buffer.alloc(bulk, "b"));
          fs.writeFileSync(__dirname + "/wrote-bulk", "");
        }
        waitFor("go");
        writeAll(Buffer.from([0xe2]));
        fs.writeFileSync(__dirname + "/wrote", "");
        waitFor("release");
      `,
        "parent.js": `
        const { execFile } = require("node:child_process");
        const fs = require("node:fs");
        const bulk = Number(process.argv[2]);
        const nap = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 30_000;
        function waitFor(name) {
          while (!fs.existsSync(__dirname + "/" + name)) {
            if (Date.now() > deadline) process.exit(2);
            Atomics.wait(nap, 0, 0, 1);
          }
        }
        const child = execFile(process.execPath, [__dirname + "/child.js", String(bulk)], { maxBuffer: Infinity }, (err, stdout) => {
          console.log(JSON.stringify({ err, length: stdout.length, start: stdout.slice(0, 6), end: stdout.slice(-1) }));
        });
        let received = 0;
        let askedForBulk = false;
        let askedForByte = false;
        child.stdout.on("data", chunk => {
          received += chunk.length;
          if (bulk && !askedForBulk) {
            // The bulk is in the pipe before this listener returns.
            askedForBulk = true;
            fs.writeFileSync(__dirname + "/go-bulk", "");
            waitFor("wrote-bulk");
            return;
          }
          if (received < "hello\\n".length + bulk || askedForByte) return;
          askedForByte = true;
          fs.writeFileSync(__dirname + "/go", "");
          // The stray byte is in the pipe before this listener returns.
          waitFor("wrote");
          // The child exits in a later turn of the event loop.
          setImmediate(() => fs.writeFileSync(__dirname + "/release", ""));
        });
      `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "parent.js", String(bulk)],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout:
          JSON.stringify({ err: null, length: "hello\n".length + bulk + 1, start: "hello\n", end: "\ufffd" }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // The wait for the next chunk can start before the delivery of this chunk has
  // returned: Bun.build runs the event loop until an async plugin setup settles.
  // Only the poll can deliver to that wait, so the poll has to be armed while the
  // delivery runs. On Windows the next read starts only after the delivery
  // returned (#45473, #40023).
  it.skipIf(isWindows)("child.stdout: an event loop wait nested in a 'data' delivery gets the next chunk", async () => {
    using dir = tempDir("stdio-nested-wait", {});
    const script = `
    const { spawn } = require("node:child_process");
    const echo = "process.stdin.on('data', d => require('node:fs').writeSync(1, d))";
    const child = spawn(process.execPath, ["-e", echo], { stdio: ["pipe", "pipe", "inherit"] });
    const waiting = [];
    child.stdout.on("data", d => waiting.shift()?.(String(d).trim()));
    const request = line => new Promise(resolve => {
      waiting.push(resolve);
      child.stdin.write(line + "\\n");
    });
    (async () => {
      // The rest of this function runs inside the delivery of "one".
      const first = await request("one");
      let nested = null;
      const build = Bun.build({
        entrypoints: ["./does-not-exist.js"],
        plugins: [{ name: "nested wait", async setup() { nested = await request("two"); } }],
      });
      // "two" only if Bun.build() ran the event loop before it returned.
      const nestedWhenBuildReturned = nested;
      await build.catch(() => {});
      console.log(JSON.stringify({ first, nestedWhenBuildReturned }));
      child.kill();
    })();
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ first: "one", nestedWhenBuildReturned: "two" }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

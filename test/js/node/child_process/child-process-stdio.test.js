import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, isWindows, nodeExeAtLeast, tempDir } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { finished } from "node:stream";
import { getSystemErrorName } from "node:util";

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

  // Not concurrent: each case starts a bun child, and ten debug-build children at once push the cases past the timeout.
  describe("destroy() while the child does not read", () => {
    const MB = () => Buffer.alloc(1 << 20, 97);
    const turn = () => new Promise(resolve => setImmediate(resolve));
    // Not events.once(): that one rejects when 'error' comes first.
    const closeOf = stream => new Promise(resolve => stream.once("close", resolve));
    const alive = child => child.exitCode === null && child.signalCode === null;
    const canceled = { message: "write ECANCELED", code: "ECANCELED", syscall: "write", errno: "ECANCELED" };
    const shape = err => ({
      message: err?.message,
      code: err?.code,
      syscall: err?.syscall,
      errno: err && getSystemErrorName(err.errno),
    });

    // One line per case: the events in the order node v26 emits them.
    const fixture = join(import.meta.dir, "fixtures", "stdin-destroy-fixture.js");
    const sameAsNode = {
      "destroy()": "closed=true, callback write ECANCELED, close, child alive",
      "destroy(err)": "closed=true, error EBOOM, callback write ECANCELED, close, child alive",
      "two writes, destroy()": "first write ECANCELED, second write ECANCELED, close, child alive",
      "two writes, destroy(err)": "error EBOOM, first write ECANCELED, second EBOOM, close, child alive",
      "write after destroy()":
        "write returned false, late ERR_STREAM_DESTROYED, callback write ECANCELED, close, child alive",
      "finished()": "callback write ECANCELED, close, finished write ECANCELED, child alive",
      "aborted pipeline()": "closed=true, error ABORT_ERR, pipeline ABORT_ERR, close, child alive",
      "destroy() with nothing written": "closed=true, close, child alive",
      "'close' listener added one tick after destroy()": "close, late listener, child alive",
      "destroy() in 'prefinish'": "prefinish, finish, close, child alive",
      "end(callback), then destroy()": "callback write ECANCELED, end write ECANCELED, close, child alive",
      "destroy(), then end(callback)": "callback write ECANCELED, end write ECANCELED, close, child alive",
    };
    // Before v24 node passes no error to a canceled write. On Windows a pipe takes the first write whole.
    const node = isPosix ? nodeExeAtLeast("24.0.0") : null;

    // A few cases per process: a debug build needs about half a second for each.
    const titles = Object.keys(sameAsNode);
    const parts = [titles.slice(0, 4), titles.slice(4, 7), titles.slice(7)];

    describe.each([
      ["bun", bunExe()],
      ["node", node],
    ])("the events are node's (%s)", (runtime, exe) => {
      it.skipIf(!exe).each([0, 1, 2])("part %d", async part => {
        const cases = parts[part];
        await using proc = Bun.spawn({ cmd: [exe, fixture, ...cases], env: bunEnv, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout.trim().split("\n")).toEqual(cases.map(title => `${title}: ${sameAsNode[title]}`));
        expect(exitCode).toBe(0);
      });
    });

    // Never reads its stdin. It exits by itself, so a test that stops early leaves no process behind.
    // One loop turn passes first: a destroy() in the tick of the spawn finds a stream that is still under construction.
    async function spawnChild(script = "setTimeout(() => {}, 30000)", stdio = ["pipe", "ignore", "ignore"]) {
      const child = spawn(bunExe(), ["-e", script], { env: bunEnv, stdio });
      await turn();
      return child;
    }

    async function stop(child) {
      if (!alive(child)) return;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }

    // Writes 1 MB until the pipe does not take one whole (Windows takes the first). `callback` is that write's.
    function parkWrite(stdin, callback) {
      for (;;) {
        let insideWrite = true;
        let acknowledged = false;
        stdin.write(MB(), err => {
          if (insideWrite) acknowledged = true;
          else callback(err);
        });
        insideWrite = false;
        if (!acknowledged) return;
      }
    }

    for (const withError of [false, true]) {
      it(`destroy(${withError ? "err" : ""}) calls every callback behind the parked write with the stream's error`, async () => {
        const child = await spawnChild();
        try {
          const { stdin } = child;
          const seen = [];
          const closed = closeOf(stdin);
          stdin.on("error", () => {});
          parkWrite(stdin, err => seen.push(["first write", err]));
          stdin.write("queued behind it", err => seen.push(["second write", err]));
          // The chunk of end() goes through Writable's own _write.
          stdin.end(MB(), err => seen.push(["end", err]));

          const boom = withError ? Object.assign(new Error("boom"), { code: "EBOOM" }) : undefined;
          stdin.destroy(boom);
          expect(stdin.closed).toBe(true);
          await closed;

          expect(seen.map(([name]) => name)).toEqual(["first write", "second write", "end"]);
          const [first, second, end] = seen.map(([, err]) => err);
          expect(shape(first)).toEqual(canceled);
          expect(stdin.errored).toBe(boom ?? first);
          expect(second).toBe(stdin.errored);
          expect(end).toBe(stdin.errored);
          expect(alive(child)).toBe(true);
        } finally {
          await stop(child);
        }
      });
    }

    it("cancels a small write and a large one made in the same tick", async () => {
      const child = await spawnChild();
      try {
        const { stdin } = child;
        const written = Promise.withResolvers();
        const closed = closeOf(stdin);
        stdin.write("header\n");
        stdin.write(MB(), written.resolve);
        stdin.destroy();
        expect(stdin.closed).toBe(true);

        expect(shape(await written.promise)).toEqual(canceled);
        await closed;
        expect(alive(child)).toBe(true);
      } finally {
        await stop(child);
      }
    });

    it("destroy() in the callback of a write the child has read cancels the write made there", async () => {
      // Reads the first megabyte and then stops.
      const child = await spawnChild(`
        let received = 0;
        process.stdin.on("data", function read(chunk) {
          received += chunk.length;
          if (received < 1 << 20) return;
          process.stdin.off("data", read);
          process.stdin.pause();
        });
        setTimeout(() => {}, 30000);`);
      try {
        const { stdin } = child;
        const seen = [];
        const closed = closeOf(stdin);
        stdin.write(MB(), err => {
          seen.push(["read by the child", err ?? null]);
          parkWrite(stdin, err => seen.push(["parked", shape(err)]));
          stdin.destroy();
        });
        await closed;
        expect(seen).toEqual([
          ["read by the child", null],
          ["parked", canceled],
        ]);
        expect(alive(child)).toBe(true);
      } finally {
        await stop(child);
      }
    });

    // Starts to read its stdin when the parent says so, and reports how many bytes came before the end.
    const counter = `
      process.on("message", () => {
        let received = 0;
        process.stdin.on("data", chunk => (received += chunk.length));
        process.stdin.on("end", () => process.send(received, () => process.exit(0)));
      });`;
    const spawnCounter = () => spawnChild(counter, ["pipe", "ignore", "inherit", "ipc"]);

    async function receivedBy(child) {
      const message = once(child, "message");
      child.send("read");
      const [received] = await message;
      return received;
    }

    it.each([
      ["one small write", stdin => stdin.write("hello"), 5],
      [
        "twenty small writes",
        stdin => {
          for (let i = 0; i < 20; i++) stdin.write(Buffer.alloc(1000, 97));
        },
        20_000,
      ],
    ])("delivers %s made in the tick of the destroy()", async (_, write, bytes) => {
      const child = await spawnCounter();
      try {
        child.stdin.on("error", () => {});
        write(child.stdin);
        child.stdin.destroy();
        expect(await receivedBy(child)).toBe(bytes);
        expect(child.stdin.errored).toBeNull();
      } finally {
        await stop(child);
      }
    });

    it("drops the bytes of a parked write that the pipe has not taken", async () => {
      const child = await spawnCounter();
      try {
        child.stdin.on("error", () => {});
        child.stdin.write(MB());
        child.stdin.destroy();
        expect(await receivedBy(child)).toBeLessThan(1 << 20);
      } finally {
        await stop(child);
      }
    });

    // write() acknowledges a small chunk from a buffer. One per loop turn, until one is not called back by the next.
    async function writeSmall(stdin, limit) {
      const errors = [];
      for (let count = 0; count < limit; count++) {
        let acknowledged = false;
        stdin.write(Buffer.alloc(1000, 97), err => {
          acknowledged = true;
          if (err) errors.push(err);
        });
        await turn();
        if (!acknowledged) return { count, errors };
      }
      return { count: limit, errors };
    }

    it("with the pipe full, loses less than one buffer of acknowledged bytes and keeps the error", async () => {
      const probe = await spawnChild();
      let acknowledged;
      try {
        probe.stdin.on("error", () => {});
        acknowledged = (await writeSmall(probe.stdin, Infinity)).count;
      } finally {
        await stop(probe);
      }
      expect(acknowledged).toBeGreaterThan(0);

      // The same writes again: every callback runs with no error, and the pipe holds back the last bytes.
      const child = await spawnCounter();
      try {
        const { stdin } = child;
        stdin.on("error", () => {});
        const { count, errors } = await writeSmall(stdin, acknowledged);
        expect(errors).toEqual([]);

        const closed = closeOf(stdin);
        stdin.destroy();
        expect(stdin.closed).toBe(true);
        await closed;

        const lost = count * 1000 - (await receivedBy(child));
        // The writer's buffer is one page: 4 KB, or 16 KB on Apple Silicon.
        expect(lost).toBeWithin(0, 16384);
        expect(lost === 0 ? stdin.errored : shape(stdin.errored)).toEqual(lost === 0 ? null : canceled);
      } finally {
        await stop(child);
      }
    });

    // Windows is not run: a write that is with the kernel there is the open repair of this teardown.
    it.skipIf(!isPosix)("end() and then destroy() keeps the error of those bytes too", async () => {
      const probe = await spawnChild();
      let acknowledged;
      try {
        probe.stdin.on("error", () => {});
        acknowledged = (await writeSmall(probe.stdin, Infinity)).count;
      } finally {
        await stop(probe);
      }
      expect(acknowledged).toBeGreaterThan(0);

      const child = await spawnCounter();
      try {
        const { stdin } = child;
        stdin.on("error", () => {});
        const { count, errors } = await writeSmall(stdin, acknowledged);
        expect(errors).toEqual([]);

        // No write is parked: the flush of end() is what waits for the pipe.
        const finishedWith = Promise.withResolvers();
        finished(stdin, err => finishedWith.resolve(err ?? null));
        const closed = closeOf(stdin);
        stdin.end();
        stdin.destroy();
        await closed;

        const lost = count * 1000 - (await receivedBy(child));
        expect(lost).toBeWithin(0, 16384);
        const error = await finishedWith.promise;
        expect({ errored: stdin.errored, finished: error && shape(error) }).toEqual({
          errored: error,
          finished: lost === 0 ? null : canceled,
        });
      } finally {
        await stop(child);
      }
    });

    it.skipIf(!isPosix)("keeps the error of acknowledged bytes that a closed pipe refuses", async () => {
      const child = await spawnChild(
        `require("node:fs").closeSync(0); process.stdout.write("closed"); setTimeout(() => {}, 30000);`,
        ["pipe", "pipe", "inherit"],
      );
      try {
        const { stdin } = child;
        await once(child.stdout, "data");
        const events = [];
        stdin.on("error", err => events.push("error " + err.code));
        const closed = closeOf(stdin);
        stdin.write("hello", err => events.push("write callback " + (err ? err.code : "ok")));
        stdin.destroy();
        await closed;
        expect(events).toEqual(["write callback ok"]);
        expect(stdin.errored?.code).toBe("EPIPE");
      } finally {
        await stop(child);
      }
    });

    it("lets the parent exit while the child is alive", async () => {
      // The child says when it runs. It never reads its stdin, and it exits by itself after 30 s.
      using dir = tempDir("child-stdin-destroy", {
        "deaf.js": `
          setTimeout(() => {}, 30000);
          console.log("running");`,
        "launcher.js": `
          const { spawn } = require("node:child_process");
          const { join } = require("node:path");
          const child = spawn(process.execPath, [join(__dirname, "deaf.js")], { stdio: ["pipe", "pipe", "ignore"] });
          child.stdin.on("error", () => {});
          child.stdout.once("data", () => {
            child.stdout.destroy();
            child.unref();
            child.stdin.write(Buffer.alloc(1 << 20, 97));
            setImmediate(() => child.stdin.destroy());
            console.log(child.pid);
          });`,
      });
      await using launcher = Bun.spawn({
        cmd: [bunExe(), "launcher.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        launcher.stdout.text(),
        launcher.stderr.text(),
        launcher.exited,
      ]);
      // The launcher prints the pid after the child said that it runs. Signal 0 is no test of the child here:
      // the exit of a parent ends its children on Windows and with BUN_FEATURE_FLAG_NO_ORPHANS (the ASAN lane).
      const pid = Number(stdout);
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      expect(stderr).toBe("");
      expect({ childRan: pid > 0, exitCode }).toEqual({ childRan: true, exitCode: 0 });
    });
  });

  // The child exits while a write to its stdin is parked. Node destroys stdin in its exit handler, libuv cancels the
  // write that is still queued, and the callback gets `write ECANCELED`: after 'exit', and with no 'error'.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L270-L294
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L81-L93
  // In most cases here a process that the child started (the holder) still has the pipe, so the pipe is not broken. A
  // killed shell leaves that: dash forks every command of `sh -c`, and bash every command but the last.
  describe("a write parked when the child exits", () => {
    const fixture = join(import.meta.dir, "fixtures", "stdin-held-exit-fixture.js");
    const canceled = "write ECANCELED";
    const canceledWrite = `exit 0, callback ${canceled}, close, errored ${canceled}`;
    const throws = "end(callback) in 'exit' that throws";
    const noShell = "no 'error' listener, a child with no shell";

    // One line per case: the events in the order node v26 emits them.
    const sameAsNode = {
      "write(chunk, callback)": canceledWrite,
      "no 'error' listener": canceledWrite,
      "two writes": `exit 0, first ${canceled}, second the same error, close, errored ${canceled}`,
      "end(chunk, callback)": `exit 0, end callback ${canceled}, close, errored ${canceled}`,
      "end(chunk), no 'error' listener": `exit 0, close, errored ${canceled}`,
      "end(chunk, callback) behind a write": `exit 0, callback ${canceled}, end callback ${canceled}, close, errored ${canceled}`,
      "end(callback) behind a write": `exit 0, callback ${canceled}, end callback ${canceled}, close, errored ${canceled}`,
      "end(callback) behind a write with no callback": `exit 0, end callback ${canceled}, close, errored ${canceled}`,
      "end(callback) behind two writes": `exit 0, first ${canceled}, second ${canceled}, end callback ${canceled}, close, errored ${canceled}`,
      "end(callback) in 'exit'": `exit 0, callback ${canceled}, end callback ${canceled}, close, errored ${canceled}`,
      [throws]: `exit 0, callback ${canceled}, end callback ${canceled}, close, errored ${canceled}`,
      "finished(stdin)": `${canceledWrite}, finished ${canceled}`,
      "kill()": `exit SIGTERM, callback ${canceled}, close, errored ${canceled}`,
      "pipeline(source, stdin)": `exit SIGTERM, close, errored ${canceled}, pipeline ${canceled}`,
      "once(stdin, 'drain')": `${canceledWrite}, the waiter is pending`,
      "once(stdin, 'finish')": `exit 0, close, errored ${canceled}, the waiter is pending`,
      // The case reads /proc.
      ...(isLinux && { "destroy() in the turn of the exit": canceledWrite }),
    };
    const bun = {
      ...sameAsNode,
      // Only bun sends what a parked sink holds at a microtask checkpoint. The case reads /proc.
      ...(isLinux && {
        "the pipe takes the rest of the write in the turn of the exit": "exit 0, callback ok, close, errored ok",
      }),
    };
    // With no holder the kill breaks the pipe. Node is not run on these: it reports the broken pipe too, but it
    // cancels the write in the runs where it sees the exit first.
    const broken =
      "callback EPIPE: broken pipe, write, error EPIPE: broken pipe, write, close, errored EPIPE: broken pipe, write, exit SIGTERM";
    const brokenPipe = {
      "a broken pipe, kill() from a listener": broken,
      "a broken pipe, kill() from a timer": broken,
    };

    // `title x3` is that case three times.
    const linesOf = (expected, cases) =>
      cases.flatMap(arg => {
        const [, title, times = "1"] = /^(.*?)(?: x(\d+))?$/.exec(arg);
        return Array(Number(times)).fill(`${title}: ${expected[title]}`);
      });

    async function expectEvents(exe, expected, cases, env = bunEnv) {
      await using proc = Bun.spawn({ cmd: [exe, fixture, ...cases], env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim().split("\n")).toEqual([
        ...linesOf(expected, cases),
        `uncaught: ${cases.includes(throws) ? "EBOOM" : "none"}`,
        "unhandled rejections: none",
        "holders gone early: none",
      ]);
      expect(exitCode).toBe(0);
    }

    // Node passes the error to a canceled write since v22.9.0: https://github.com/nodejs/node/pull/54032
    const node = nodeExeAtLeast("22.9.0");

    // The children of the fixture are sh scripts.
    describe.skipIf(!isPosix)("and a process of its own holds the pipe", () => {
      // A few cases per process, and one process at a time: a debug build needs about 200 ms for each case, and twice
      // that when these run together.
      const titles = Object.keys(bun);
      const parts = [titles.slice(0, 5), titles.slice(5, 10), titles.slice(10, 14), titles.slice(14)];
      it.each([0, 1, 2, 3])("the events are node's, part %d", async part => {
        await expectEvents(bunExe(), bun, parts[part]);
      });

      it("a broken pipe is still EPIPE and 'error', whether the exit or the failed write comes first", async () => {
        await expectEvents(
          bunExe(),
          brokenPipe,
          Object.keys(brokenPipe).map(title => `${title} x3`),
        );
      });

      // Without a pidfd the exit comes from a thread: a task reports it, and not the poll of the event loop.
      it.skipIf(!isLinux)("the same when the waiter thread reports the exit", async () => {
        const cases = ["write(chunk, callback)", "end(callback) in 'exit'", "kill()"];
        await expectEvents(
          bunExe(),
          { ...bun, ...brokenPipe },
          [...cases, ...Object.keys(brokenPipe).map(title => `${title} x2`)],
          { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
        );
      });

      it.skipIf(!node)("node emits these events", async () => {
        await expectEvents(node, sameAsNode, Object.keys(sameAsNode));
      });

      it("the callback gets the same error when a nested wait of the event loop sees the exit", async () => {
        const child = spawn("sh", ["-c", "exec 3<&0; sleep 30 <&3 3<&- >/dev/null 2>&1 & echo $!"], {
          stdio: ["pipe", "pipe", "inherit"],
        });
        const seen = [];
        let holder = "";
        child.stdout.setEncoding("utf8").on("data", chunk => (holder += chunk));
        child.on("exit", code => seen.push(`exit ${code}`));
        child.stdin.write(Buffer.alloc(1 << 20, 97), err => seen.push(`callback ${err?.message}`));
        const closed = new Promise(resolve => child.stdin.on("close", () => resolve(seen)));
        // `resolves` waits for the promise in a loop of its own.
        await expect(closed).resolves.toEqual(["exit 0", `callback ${canceled}`]);

        expect(holder).toMatch(/^[1-9]\d*\n$/);
        process.kill(Number(holder), "SIGKILL");
      });

      it("Bun.spawn's own stdin still fails the write with EPIPE, before `exited`", async () => {
        // The child gives its stdin to `sleep`, prints the pid of that process, and exits.
        await using proc = Bun.spawn({
          cmd: ["sh", "-c", "exec 3<&0; sleep 30 <&3 3<&- >/dev/null 2>&1 & echo $!"],
          stdin: "pipe",
          stdout: "pipe",
          stderr: "inherit",
        });
        const seen = [];
        const write = proc.stdin.write(Buffer.alloc(1 << 20, 97));
        expect(write).toBeInstanceOf(Promise);
        const settled = write.then(
          () => seen.push("written"),
          err => seen.push({ code: err.code, syscall: err.syscall }),
        );
        const exited = proc.exited.then(code => seen.push(`exited ${code}`));
        const holder = await proc.stdout.text();
        await Promise.all([settled, exited]);

        // The kill throws when the holder is gone: the pipe was then broken, which is another case.
        expect(holder).toMatch(/^[1-9]\d*\n$/);
        process.kill(Number(holder), "SIGKILL");
        expect(seen).toEqual([{ code: "EPIPE", syscall: "write" }, "exited 0"]);
      });
    });

    // The same held pipe with no shell, so that it runs on Windows. There the exit still fails the write with EPIPE
    // (FileSink::errno_at_exit), and with no 'error' listener that is an uncaught exception.
    it.failingIf(isWindows)("the events are node's when the child is no shell", async () => {
      await expectEvents(bunExe(), { [noShell]: canceledWrite }, [noShell]);
    });

    // Windows: not measured under node.
    it.skipIf(!isPosix || !node)("node emits these events when the child is no shell", async () => {
      await expectEvents(node, { [noShell]: canceledWrite }, [noShell]);
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

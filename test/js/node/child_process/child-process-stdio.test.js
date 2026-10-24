import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix, nodeExeAtLeast, tempDir } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
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

    it("with the pipe full, loses less than one buffer of acknowledged bytes and keeps the error", async () => {
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

    // The child exits while another process holds the pipe. Node: the callback gets `write ECANCELED`, no 'error'.
    it.todo("a write parked when the child exits is canceled, not failed with EPIPE");
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

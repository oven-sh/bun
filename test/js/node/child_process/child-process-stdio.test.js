import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isPosix, isWindows, tempDir } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";

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
// handle (https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L769-L792), and
// a read that comes up short ends the callback
// (https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/stream.c#L1147-L1155).
// So the bytes a child writes while a listener runs arrive in a later turn of the
// event loop, after that listener's setImmediate. A pull that read the pipe again
// in the same turn delivered them early: a 'data' listener detached until the next
// setImmediate missed them, and a read(n) of exactly what was buffered left the
// next chunk behind it.
//
// On Linux without a pidfd a thread of Bun waits for the child. Its report of the
// exit is not ordered against the poll, so a pull keeps its read there.
const watchesChildrenWithPoll =
  !isLinux ||
  (() => {
    const probe = Bun.spawn({ cmd: ["sleep", "60"], stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    try {
      return readdirSync("/proc/self/fd").some(fd => {
        try {
          return readlinkSync(`/proc/self/fd/${fd}`) === "anon_inode:[pidfd]";
        } catch {
          return false;
        }
      });
    } finally {
      probe.kill();
    }
  })();

(watchesChildrenWithPoll ? describe.concurrent : describe.skip)(
  "bytes written while a stdio listener runs arrive in a later turn of the event loop",
  () => {
    const reader = join(import.meta.dir, "fixtures", "stdio-handshake-reader-fixture.js");
    const writer = join(import.meta.dir, "fixtures", "stdio-handshake-writer-fixture.js");
    const items = Array.from({ length: 10 }, (_, i) => `item${i}`);
    const count = String(items.length);
    const mkfifo = Bun.which("mkfifo");

    async function run(source, consumer) {
      using dir = tempDir("stdio-handshake", {});
      let cmd = [bunExe(), reader, source, consumer, String(dir), count];
      if (source === "Bun.file(fifo)") {
        const fifo = join(String(dir), "fifo");
        expect(Bun.spawnSync({ cmd: [mkfifo, fifo] }).exitCode).toBe(0);
        cmd.push(fifo);
      } else if (source === "Bun.stdin") {
        // Through a shell pipe, fd 0 of the reader is a blocking pipe.
        const pipeline = `"$0" "$1" "$3" ${count} 1 | "$0" "$2" Bun.stdin ${consumer} "$3" ${count}`;
        cmd = ["sh", "-c", pipeline, bunExe(), writer, reader, String(dir)];
      }
      await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      let result = stdout;
      try {
        result = JSON.parse(stdout);
      } catch {}
      return { result, stderr, exitCode };
    }

    const everyItem = { result: { all: items, seen: items }, stderr: "", exitCode: 0 };

    it.each([
      ["child.stdout", "child.stdout"],
      ["child.stderr", "child.stderr"],
      ["Readable.fromWeb(Bun.spawn().stdout)", "Bun.spawn"],
    ])("%s: a 'data' listener detached until the next setImmediate misses nothing", async (_, source) => {
      expect(await run(source, "data")).toEqual(everyItem);
    });

    // Linux only: elsewhere a pull still reads a pipe that is not a socket, because
    // kqueue does not report the end of a named pipe and only a read finds it.
    it.skipIf(!isLinux || !mkfifo)(
      "Readable.fromWeb(Bun.file(fifo).stream()): a 'data' listener detached until the next setImmediate misses nothing",
      async () => {
        expect(await run("Bun.file(fifo)", "data")).toEqual(everyItem);
      },
    );

    it.skipIf(!isLinux)(
      "Readable.fromWeb(Bun.stdin.stream()) on a shell pipe: a 'data' listener detached until the next setImmediate misses nothing",
      async () => {
        expect(await run("Bun.stdin", "data")).toEqual(everyItem);
      },
    );

    it("child.stdout: resume() from a setImmediate after pause() emits nothing before the next setImmediate", async () => {
      expect(await run("child.stdout", "pause")).toEqual(everyItem);
    });

    it("child.stdout: read(n) of exactly what is buffered leaves nothing buffered", async () => {
      expect(await run("child.stdout", "readable")).toEqual({
        result: { chunks: items.map(item => item + "\n"), bufferedAfterRead: items.map(() => 0) },
        stderr: "",
        exitCode: 0,
      });
    });

    // The child writes its last item, then a tail on its other stream, then exits,
    // all while the listener for the item before runs. The three events come in
    // the order they happened. The fixture finds the exit in /proc.
    it.skipIf(!isLinux).each(["child.stdout", "child.stderr"])(
      "%s: bytes written before the child's other stream wrote and before the child exited arrive first",
      async source => {
        expect(await run(source, "exit")).toEqual({
          result: { events: [...items, "other stream: tail", "exit"] },
          stderr: "",
          exitCode: 0,
        });
      },
    );

    // The decoder holds the stray byte back, so its push adds no text. Pushed from
    // inside _read(), such a chunk stopped the stream: no 'end', and no callback.
    it("execFile(): the callback comes when the child wrote part of a character while a 'data' listener ran", async () => {
      using dir = tempDir("stdio-held-chunk", {
        "child.js": `
        const fs = require("node:fs");
        const nap = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 30_000;
        function waitFor(name) {
          while (!fs.existsSync(__dirname + "/" + name)) {
            if (Date.now() > deadline) process.exit(3);
            Atomics.wait(nap, 0, 0, 1);
          }
        }
        fs.writeSync(1, "hello\\n");
        waitFor("go");
        fs.writeSync(1, Buffer.from([0xe2]));
        fs.writeFileSync(__dirname + "/wrote", "");
        waitFor("release");
      `,
        "parent.js": `
        const { execFile } = require("node:child_process");
        const fs = require("node:fs");
        const nap = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 30_000;
        const child = execFile(process.execPath, [__dirname + "/child.js"], (err, stdout) => {
          console.log(JSON.stringify({ err, stdout }));
        });
        child.stdout.once("data", () => {
          fs.writeFileSync(__dirname + "/go", "");
          // The stray byte is in the pipe before this listener returns.
          while (!fs.existsSync(__dirname + "/wrote")) {
            if (Date.now() > deadline) process.exit(2);
            Atomics.wait(nap, 0, 0, 1);
          }
          // The child exits in a later turn of the event loop.
          setImmediate(() => fs.writeFileSync(__dirname + "/release", ""));
        });
      `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "parent.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: JSON.stringify({ err: null, stdout: "hello\n\ufffd" }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // The wait for the next chunk can start before the delivery of this chunk has
    // returned: Bun.build runs the event loop until an async plugin setup settles.
    // Only the poll can deliver to that wait, so the poll has to be armed while the
    // delivery runs. On Windows the next read starts only after the delivery
    // returned (#45473, #40023).
    it.skipIf(isWindows)(
      "child.stdout: an event loop wait nested in a 'data' delivery gets the next chunk",
      async () => {
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
      },
    );
  },
);

// In Node a child's pipe is a net.Socket: `_read()` asks libuv for bytes and the read callback pushes them, one read
// at a time, with the nextTicks and promise jobs of the listeners in between. A pipe that answers `_read()` inside
// the call lets the stream emit the next chunk before those have run. So a Node stream over a pipe gets every chunk
// from the poll callback, also after a read that did not find the pipe empty.
//
// Linux and macOS: there the socket of a child holds the parts that the fixture writes with nothing reading.
describe.skipIf((!isLinux && !isMacOS) || !watchesChildrenWithPoll)("a stdio stream read one event at a time", () => {
  // The stream and the form of each consumer: see the fixture.
  async function consumeWith(env, ...consumers) {
    using dir = tempDir("stdio-once-data", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "fixtures", "child-process-stdio-once-data-fixture.js"),
        String(dir),
        ...consumers,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let result = stdout;
    try {
      result = JSON.parse(stdout);
    } catch {}
    return { consumers: result, stderr, exitCode };
  }
  const consume = (...consumers) => consumeWith(bunEnv, ...consumers);
  const all = { exitCode: 0, sawEnd: true, length: 4 + 96 * 1024, intact: true };
  const forms = ["job", "tick", "pause", "text", "beside", "race"];

  describe.concurrent("in a process of its own", () => {
    // `web`: Readable.fromWeb() over the stdout of Bun.spawn() is the same stream over the same pipe.
    const loops = [
      ...forms.map(form => `stdout:${form}`),
      "stderr:job",
      "stderr:tick",
      "web:job",
      "web:tick",
      "web:text",
      "web:beside",
    ];

    // The read that takes a head of 4 bytes finds the pipe empty after it. A head of 132 KiB ends a read with no sign
    // of that, and the read that the next `_read()` asks for is one that the reader could make at once. The first
    // chunk shows it: over half of the 256 KiB that the reader takes in one go.
    it.each([
      ["left the pipe empty", "", 4, false],
      ["filled its buffer", ":full", 132 * 1024, true],
    ])("a loop of once('data') gets every byte after a read that %s", async (_, variant, head, firstIsOverHalf) => {
      const consumers = loops.map(loop => loop + variant);
      const result = await consume(...consumers);
      for (const consumer of consumers) {
        const got = result.consumers[consumer];
        if (typeof got?.first === "number") got.first = got.first > 128 * 1024;
      }
      const each = { ...all, length: head + 96 * 1024, first: firstIsOverHalf, pushedInsideRead: 0 };
      expect(result).toEqual({
        consumers: Object.fromEntries(consumers.map(consumer => [consumer, each])),
        stderr: "",
        exitCode: 0,
      });
    });

    // Readable.fromWeb(Bun.stdin.stream()) behind a shell pipe: a blocking pipe, which is read once for each wakeup.
    // A read of 64 KiB took all that the pipe can hold, and does not say that the pipe is empty.
    // Linux only: elsewhere only a socket is read from the poll callback alone.
    it.skipIf(!isLinux)("a loop of once('data') gets every byte of a pipe that a shell made", async () => {
      const consumers = forms.map(form => `stdin:${form}:full`);
      const each = { ...all, length: 64 * 1024 + 60_000, first: 64 * 1024, pushedInsideRead: 0 };
      expect(await consume(...consumers)).toEqual({
        consumers: Object.fromEntries(consumers.map(consumer => [consumer, each])),
        stderr: "",
        exitCode: 0,
      });
    });

    // #48514. A chunk pushed inside the `_read()` of that read(n) stayed in the buffer of the stream with no
    // 'readable' event. The child holds the pipe open until the listener has every byte, so nothing more came.
    // `later`: the stream has stopped its reader when the tail comes, and a reader that reads on all the same has the
    // tail ready for that `_read()`.
    it("a 'readable' listener that takes all that is buffered hears of the bytes that follow", async () => {
      const readable = { ...all, length: (64 + 96) * 1024 };
      const later = { ...all, length: (132 + 4) * 1024 };
      expect(await consume("stdout:readable", "stdout:later", "web:readable", "web:later")).toEqual({
        consumers: { "stdout:readable": readable, "stdout:later": later, "web:readable": readable, "web:later": later },
        stderr: "",
        exitCode: 0,
      });
    });

    it("bytes stay in order when a paused stream is resumed later", async () => {
      expect(await consume("stdout:order")).toEqual({
        consumers: { "stdout:order": { ...all, length: 4 + 64 * 1024 + 2000 } },
        stderr: "",
        exitCode: 0,
      });
    });

    // libuv reads what the pipe holds before it reports the exit of the child, and a socket's 'close' comes after its
    // 'end' listeners and their promise jobs. So a 'data' listener has every byte at 'exit', and a `for await` loop is
    // done before the ChildProcess emits 'close'. `late`: the stream had stopped its reader, so nothing waited for the
    // pipe when the last bytes came, and the poll that is armed at resume() comes behind the exit.
    // `reader:late`: the same for a reader of the web stream, whose read waits for the poll callback after a short read.
    it.skipIf(!isLinux)("the exit of a child is reported after the output that it left in its pipe", async () => {
      const atExit = { ...all, atExit: all.length };
      expect(
        await consume(
          "stdout:exit",
          "stdout:late",
          "stderr:late",
          "stdout:iterate",
          "web:exit",
          "web:late",
          "reader:late",
        ),
      ).toEqual({
        consumers: {
          "stdout:exit": atExit,
          "stdout:late": atExit,
          "stderr:late": atExit,
          "stdout:iterate": { ...all, closedInLoop: false },
          "web:exit": atExit,
          "web:late": atExit,
          "reader:late": { ...all, length: 4 + 160 * 1024, atExit: 4 + 160 * 1024 },
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // Where no pidfd exists a thread of Bun waits for the children. It reports an exit as a task, and tasks run before
    // the poll: bytes that waited for the poll would come after 'exit'. There a read for `_read()` is made inside it.
    // `exit:full`: such a read, nested in the read loop that delivered the head, takes a tail that does not fit its
    // buffer of 64 KiB (see "child.stdout pull nested in a 'data' event" in child_process.test.ts).
    it.skipIf(!isLinux)("'exit' comes after the output when a thread waits for the children", async () => {
      const atExit = { ...all, atExit: all.length };
      const full = (132 + 96) * 1024;
      expect(
        await consumeWith(
          { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
          "stdout:exit",
          "stdout:late",
          "stdout:exit:full",
        ),
      ).toEqual({
        consumers: {
          "stdout:exit": atExit,
          "stdout:late": atExit,
          "stdout:exit:full": { ...all, length: full, atExit: full, after: [64 * 1024, 32 * 1024] },
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // Node calls the listeners from the read callback of the handle. What they throw is an uncaughtException, and the
    // handle reads on.
    it("a 'data' listener that throws is an uncaughtException and the stream reads on", async () => {
      const uncaught = "thrown by the 'data' listener";
      expect(await consume("stdout:throw", "stdout:throw:second")).toEqual({
        consumers: {
          "stdout:throw": { ...all, uncaught },
          "stdout:throw:second": { ...all, length: all.length + 1000, uncaught },
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // With no handler the process is on its way out. The stream must not go on to 'close', where this program exits
    // with the status of its child.
    it("a 'data' listener that throws ends a process that has no handler with status 1", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { spawn } = require("node:child_process");
            const child = spawn("sh", ["-c", "read x; printf hhhh"], { stdio: ["pipe", "pipe", "ignore"] });
            // The read of the stream waits: the chunk comes from the read callback of the pipe.
            child.stdout.once("resume", () => child.stdin.end("go\\n"));
            child.stdout.on("data", () => {
              throw new Error("thrown by the 'data' listener");
            });
            child.on("close", code => process.exit(code));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, threw: stderr.includes("error: thrown by the 'data' listener"), exitCode }).toEqual({
        stdout: "",
        threw: true,
        exitCode: 1,
      });
    });

    // Not so for Readable.fromWeb(): no handle calls its listeners, and what they throw goes the way it went before.
    it("a 'data' listener of Readable.fromWeb() that throws is not reported by the stream", async () => {
      const { consumers, stderr, exitCode } = await consume("web:throw");
      expect({ consumers, threw: stderr.includes("error: thrown by the 'data' listener"), exitCode }).toEqual({
        consumers: "",
        threw: true,
        exitCode: 1,
      });
    });
  });

  // The property behind the loops: after its first read the stream pushes nothing while `_read()` is on the stack. The
  // child waits for the EOF of its stdin, so no hang-up reaches the reader while this counts.
  it.each(["data", "pause", "pipe"])(
    "a stream pushes no chunk inside _read() after its first read: %s",
    async shape => {
      const total = 4 * 1024 * 1024;
      const child = spawn("sh", ["-c", `head -c ${total} /dev/zero; cat > /dev/null`], {
        stdio: ["pipe", "pipe", "ignore"],
      });
      const stream = child.stdout;
      let reads = 0;
      let depth = 0;
      let pushedInsideRead = 0;
      let bytes = 0;
      const read = stream._read;
      stream._read = function (size) {
        reads++;
        depth++;
        try {
          return read.call(this, size);
        } finally {
          depth--;
        }
      };
      const push = stream.push;
      stream.push = function (chunk, encoding) {
        if (chunk !== null && depth > 0 && reads > 1) pushedInsideRead++;
        return push.call(this, chunk, encoding);
      };
      const got = chunk => {
        bytes += chunk.length;
        if (bytes === total) child.stdin.end();
      };
      if (shape === "data") {
        stream.on("data", got);
      } else if (shape === "pause") {
        stream.on("data", chunk => {
          got(chunk);
          stream.pause();
          setImmediate(() => stream.resume());
        });
      } else {
        stream.pipe(
          new Writable({
            write(chunk, _encoding, callback) {
              got(chunk);
              setImmediate(callback);
            },
          }),
        );
      }
      const [exitCode] = await once(child, "close");
      expect({ bytes, pushedInsideRead, exitCode }).toEqual({ bytes: total, pushedInsideRead: 0, exitCode: 0 });
    },
  );

  // Node has read the pipe by then. Here a stream that nothing consumes yet answers its first read() inside the call.
  it("read() inside 'exit' returns what the child wrote", async () => {
    const child = spawn("sh", ["-c", "printf AAAABB"], { stdio: ["ignore", "pipe", "ignore"] });
    const closed = once(child, "close");
    const { promise, resolve } = Promise.withResolvers();
    child.on("exit", () => resolve(child.stdout.read()));
    expect(String(await promise)).toBe("AAAABB");
    await closed;
  });

  // Every read of such a stream is made by the poll callback, which reads until the pipe is empty. libuv stops after
  // 32 reads of 64 KiB, so that a writer that stays ahead of the listeners does not keep the event loop from its
  // timers. The two tests below hold the writer ahead: a listener returns when the writer sleeps in write(), which is
  // when the socket is full again. `/proc/<pid>/stat` shows it.
  describe.skipIf(!isLinux)("a writer that stays ahead of the 'data' listeners", () => {
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    // "<pid> (<name>) <state> ...": S sleeps, Z is a zombie.
    function stateOf(pid) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
        return stat[stat.lastIndexOf(")") + 2];
      } catch {
        return "gone";
      }
    }
    // Blocks the event loop until `isSo()` holds.
    function waitUntil(isSo) {
      const deadline = Date.now() + 15_000;
      while (!isSo()) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the writer");
        Atomics.wait(sleeper, 0, 0, 1);
      }
    }

    it("gets no more than 2 MiB in one turn of the event loop", async () => {
      const child = spawn("dd", ["if=/dev/zero", "bs=65536"], { stdio: ["ignore", "pipe", "ignore"] });
      const { promise, resolve, reject } = Promise.withResolvers();
      child.on("error", reject);
      let inTurn = 0;
      let turns = 0;
      let largest = 0;
      let done = false;
      const finish = () => {
        done = true;
        resolve();
      };
      setImmediate(function turn() {
        if (inTurn > 0) turns++;
        largest = Math.max(largest, inTurn);
        inTurn = 0;
        if (turns === 4) finish();
        if (!done) setImmediate(turn);
      });
      child.stdout.on("data", chunk => {
        if (done) return;
        inTurn += chunk.length;
        try {
          waitUntil(() => stateOf(child.pid) === "S");
        } catch (error) {
          return reject(error);
        }
        // Far past the bound: the turn does not end.
        if (inTurn > 16 * 1024 * 1024) {
          largest = inTurn;
          finish();
        }
      });
      try {
        await promise;
      } finally {
        done = true;
        child.kill("SIGKILL");
      }
      // The read that reaches the bound can take 256 KiB more.
      expect(largest).toBeLessThanOrEqual((2048 + 256) * 1024);
      expect(largest).toBeGreaterThan(0);
    });

    // The read that Bun makes of the pipe before it reports the exit has the same bound.
    it("does not hold back the 'exit' of the child that left it behind", async () => {
      using dir = tempDir("stdio-writer-left-behind", {});
      const pidFile = join(String(dir), "pid");
      const child = spawn("sh", ["-c", `yes 0123456789abcdef & echo $! > "$0.tmp"; mv "$0.tmp" "$0"`, pidFile], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const { promise, resolve, reject } = Promise.withResolvers();
      child.on("error", reject);
      let writer = 0;
      let bytes = 0;
      let atExit = -1;
      let done = false;
      const finish = () => {
        done = true;
        resolve();
      };
      child.on("exit", () => {
        atExit = bytes;
        finish();
      });
      child.stdout.on("data", chunk => {
        if (done) return;
        bytes += chunk.length;
        try {
          // The shell is gone, and its writer has filled the socket again.
          waitUntil(() => {
            if (writer === 0 && existsSync(pidFile)) writer = Number(readFileSync(pidFile, "utf8"));
            const shell = stateOf(child.pid);
            return writer !== 0 && (shell === "Z" || shell === "gone") && stateOf(writer) === "S";
          });
        } catch (error) {
          return reject(error);
        }
        // Far past the bound: the exit is not reported.
        if (bytes > 32 * 1024 * 1024) finish();
      });
      try {
        await promise;
      } finally {
        done = true;
        // It sleeps in write() with the socket full, or nothing has read its pid yet and the closed pipe ends it.
        if (writer !== 0) process.kill(writer, "SIGKILL");
        child.stdout.destroy();
      }
      // -1: the exit was not reported in 32 MiB. Else a few wakeups of the pipe and the read before the exit came first.
      expect(atExit).toBeGreaterThanOrEqual(0);
      expect(atExit).toBeLessThanOrEqual(4 * (2048 + 256) * 1024);
    });
  });
});

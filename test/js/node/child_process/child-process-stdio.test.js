import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, isWindows, tempDir } from "harness";
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
describe.concurrent("bytes written while a stdio listener runs arrive in a later turn of the event loop", () => {
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

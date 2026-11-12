import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
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

// child.stdout and child.stderr read into one buffer again and again, and each 'data' chunk was a view of it: all the
// chunks of the stream lay in one ArrayBuffer of 64 KiB. test/js/node/stream/node-stream.test.js has what follows from
// that, for the other streams of the same kind.
describe.concurrent("child.stdout and child.stderr", () => {
  // The writer sends block i (`size` times the letter a + i) when it gets a line on stdin, so every block is a read of
  // its own.
  function spawnWriter(stream, size = 8) {
    const writer = `let i = 0; const next = () => i < 4 ? process.${stream}.write(Buffer.alloc(${size}, 97 + i++)) : process.exit(0); next(); process.stdin.on("data", next);`;
    const child = spawn(bunExe(), ["-e", writer], {
      env: bunEnv,
      stdio: ["pipe", stream === "stdout" ? "pipe" : "inherit", stream === "stderr" ? "pipe" : "inherit"],
    });
    // The last line can reach a writer that already exited.
    child.stdin.on("error", () => {});
    return child;
  }
  // "a8": the letter of a block and its length.
  const runOf = bytes =>
    Buffer.from(bytes)
      .toString("latin1")
      .replace(/(.)\1*/g, run => run[0] + run.length);
  // As postMessage(chunk, [chunk.buffer]) moves it.
  const moveOut = chunk => runOf(structuredClone(chunk, { transfer: [chunk.buffer] }));

  // 3000 bytes are more than the typed arrays that JavaScriptCore keeps in the heap of its cells.
  it.each([
    ["stdout", 8],
    ["stderr", 8],
    ["stdout", 3000],
  ])("each 'data' chunk of %s is a Buffer of its own (blocks of %d bytes)", async (stream, size) => {
    const child = spawnWriter(stream, size);
    // Whether each chunk is a Buffer when the stream gets it. Any other view costs a Buffer around it.
    const pushed = [];
    const push = child[stream].push;
    child[stream].push = function (chunk, encoding) {
      if (chunk !== null) pushed.push(Buffer.isBuffer(chunk));
      return push.call(this, chunk, encoding);
    };
    const kept = [];
    child[stream].on("data", chunk => {
      kept.push(chunk);
      child.stdin.write("\n");
    });
    await once(child[stream], "end");

    const shapes = kept.map(chunk => runOf(chunk) + " " + chunk.byteOffset + "/" + chunk.buffer.byteLength);
    const buffers = new Set(kept.map(chunk => chunk.buffer)).size;
    // Each chunk goes without the others.
    const moved = kept.map(chunk => {
      try {
        return moveOut(chunk);
      } catch (error) {
        return error.name;
      }
    });
    const blocks = Array.from("abcd", letter => letter + size);
    expect({ shapes, buffers, moved, pushed }).toEqual({
      shapes: blocks.map(block => `${block} 0/${size}`),
      buffers: 4,
      moved: blocks,
      pushed: [true, true, true, true],
    });
  });

  // Resolves when a block waits in `stream`, and rejects when `stream` is over first.
  function nextBlockWaits(stream) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const over = () => reject(new Error("the stream was over before its next block"));
    // 'readable' with nothing to read is the end of the stream.
    const onReadable = () => (stream.readableLength > 0 ? resolve() : over());
    stream.on("readable", onReadable).on("close", over).on("error", reject);
    return promise.finally(() => stream.off("readable", onReadable).off("close", over).off("error", reject));
  }

  it("a chunk of a for await loop moves out while the next one waits in the stream", async () => {
    const child = spawnWriter("stdout");
    const moved = [];
    for await (const chunk of child.stdout) {
      child.stdin.write("\n");
      if (moved.length < 3 && child.stdout.readableLength === 0) await nextBlockWaits(child.stdout);
      moved.push(chunk.length > 0 ? moveOut(chunk) : "");
    }
    expect(moved).toEqual(["a8", "b8", "c8", "d8"]);
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

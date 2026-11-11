import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix, isWindows } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { allCases, deliveredAll, readInPart } from "../stream/readable-partial-read";

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

// A reader takes a header with read(8) and leaves the rest to a 'readable' listener that it adds afterwards. Node
// announces what is left again with the next chunk, as long as no more than highWaterMark bytes are left. libuv
// gives Node at most 64 KiB a read, and none of it while that read(8) still runs, so a child's stdio never stalls
// there. The default highWaterMark on Windows is 16 KiB, under which Node stalls too.
it.skipIf(isWindows)("a child's stdio that was read in part announces the rest", async () => {
  const cases = [
    "child-stdout:swap",
    "child-stdout:once",
    "child-stdout:unshift",
    "child-stdout:awaitSwap",
    "child-stdout:iterateThenListen",
    "child-stderr:swap",
    "child-stdio3:swap",
  ];
  expect(await readInPart(cases)).toEqual(allCases(cases, deliveredAll));
});

// A child's stdio is read when the stream asks for bytes. The first read of a stream that holds nothing answers at
// once, so a read() with no listener finds what the child wrote, as it does in Node, which reads from the start.
describe.concurrent("a child's stdout that nothing listens to", () => {
  async function run(script) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("read(8) returns 8 of the bytes that the child wrote", async () => {
    const result = await run(`
      const { spawn } = require("node:child_process");
      const writer = "process.stdout.write('0123456789abcdef', () => process.stderr.write('.')); process.stdin.resume();";
      const child = spawn(process.execPath, ["-e", writer], { stdio: ["pipe", "pipe", "pipe"] });
      // The child writes to stderr when its stdout has the bytes. One more turn of the loop, for a runtime that reads ahead.
      child.stderr.once("data", () => setImmediate(() => {
        console.log(String(child.stdout.read(8)), String(child.stdout.read(8)), child.stdout.read(8));
        child.stdin.end();
      }));
    `);
    expect(result).toEqual({ stdout: "01234567 89abcdef null\n", stderr: "", exitCode: 0 });
  });

  it("read() in 'exit' returns the child's output", async () => {
    const result = await run(`
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "process.stdout.write('hello from the child')"], { stdio: ["ignore", "pipe", "inherit"] });
      child.on("exit", () => console.log(String(child.stdout.read())));
    `);
    expect(result).toEqual({ stdout: "hello from the child\n", stderr: "", exitCode: 0 });
  });
});

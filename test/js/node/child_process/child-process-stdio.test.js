import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix, isWindows, tempDir } from "harness";
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

// Node reads a child's stdio from a libuv handle. It reports each chunk, the EOF and the close from
// a libuv callback of its own, and it runs every nextTick and promise job between two callbacks.
// So the nextTicks and the promise jobs that the listeners of an event queue, and all that those
// queue, run before the next event. The fixture prints the same lines under Node.
describe.concurrent("child.stdout and child.stderr event order", () => {
  const fixture = import.meta.dir + "/fixtures/child-process-stdio-event-order.js";
  const chain = label => `tick(${label}) job(${label}) job2(${label}) job3(${label})`;
  const end = `end ${chain("end")} close(false)`;
  // The consumer awaits the end of the stream. Then it listens for 'close' and awaits the child's 'close': both still come.
  const awaited = "data(AAAABB) consumed close(false) late-close(false) child-close-settled";
  const expected = {
    data: `data(AAAABB) ${chain("AAAABB")} ${end}`,
    readable: `read(AAAABB) read(null) ${chain("AAAABB")} read(null) ${end}`,
    // The listener destroys the stream from a promise job: no 'end' follows, and the rest of that job comes before 'close'.
    destroy: "data(AAAABB) destroy job(destroy) tick(destroy) job2(destroy) job3(destroy) close(false)",
    // destroy() swallows the throw of its callback, and 'close' still comes.
    "destroy-callback-throws": "data(AAAABB) destroy-callback close(false)",
    // The throw is an uncaught exception, and the stream reads on.
    throw: `data(AAAABB) uncaughtException(uncaughtException) ${chain("AAAABB")} ${end}`,
    // Nobody listens: a read() call gets the bytes at once.
    "read-on-exit": `read(AAAABB) ${end}`,
    both: `data(OUT) ${chain("OUT")} data(ERR) ${chain("ERR")}`,
    "two-chunks": `data(AAAA) ${chain("AAAA")} data(BBBB) ${chain("BBBB")} ${end}`,
    "for-await": awaited,
    "await-end": awaited,
    "held-open": `exit ${awaited}`,
  };

  it.each([
    // first-read: the bytes and the EOF are in the pipe before the parent reads for the first time.
    ["stdout", "first-read", "data"],
    ["stdout", "first-read", "readable"],
    ["stdout", "first-read", "destroy"],
    ["stdout", "first-read", "for-await"],
    ["stdout", "first-read", "await-end"],
    ["stderr", "first-read", "data"],
    ["both", "first-read", "data"],
    // waiting-read: the parent's read already waits when the child writes.
    ["stdout", "waiting-read", "data"],
    ["stdout", "waiting-read", "readable"],
    ["stdout", "waiting-read", "destroy"],
    ["stdout", "waiting-read", "throw"],
    ["stdout", "waiting-read", "destroy-callback-throws"],
    // two-chunks: the second chunk and the EOF are in the pipe while the first 'data' listener runs.
    ["stdout", "two-chunks", "data"],
    ...(isWindows
      ? []
      : [
          // Not on Windows. There Node runs the promise jobs of a listener that threw after 'end', when
          // the EOF is already in the pipe. And Bun reads a pipe asynchronously there, so a read() call
          // in 'exit' finds no bytes yet.
          ["stdout", "first-read", "throw"],
          ["stdout", "first-read", "read-on-exit"],
          // held-open: a grandchild holds the pipe until the parent has seen the child's 'exit', so the
          // 'close' of the pipe is also the 'close' of the child. Not checked on Windows.
          ["stdout", "held-open", "for-await"],
          ["stdout", "held-open", "await-end"],
        ]),
  ])("%s, %s, %s", async (which, mode, consumer) => {
    using dir = tempDir("child-stdio-event-order", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, which, mode, consumer, String(dir)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: expected[which === "both" ? which : mode === "two-chunks" || mode === "held-open" ? mode : consumer],
      stderr: "",
      exitCode: 0,
    });
  });

  // The events above wait for the tick loop, not for process.nextTick(), which fake timers replace
  // (they read it first). The loop that flushes the held ticks stands in for the fake clock.
  it.each([
    ["before its first read", "process.nextTick = held;"],
    ["after a read", "const real = process.nextTick; process.nextTick = held;"],
  ])("child.stdout delivers when process.nextTick is replaced %s", async (_, replace) => {
    const script = `
      const ticks = [];
      const held = (fn, ...args) => void ticks.push(() => fn(...args));
      ${replace}
      const flush = setInterval(() => { while (ticks.length) ticks.shift()(); }, 1);
      const { spawn } = require("node:child_process");
      const events = [];
      const child = spawn(process.execPath, ["-e", "process.stdout.write('hi')"], { stdio: ["ignore", "pipe", "ignore"] });
      child.stdout.on("data", chunk => events.push("data(" + chunk + ")"));
      child.stdout.on("end", () => events.push("end"));
      child.on("close", () => {
        clearInterval(flush);
        console.log(events.join(" "));
      });
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "data(hi) end", stderr: "", exitCode: 0 });
  });
});

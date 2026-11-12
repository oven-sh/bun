import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, isWindows, nodeExeAtLeast, tempDir } from "harness";
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

// Node completes the end and the close of child.stdin from libuv: 'finish' after every tick and promise job of
// the turn that called end(), and 'close' after that turn's immediates as well.
describe("stdin 'finish' and 'close' come from the event loop", () => {
  const fixture = join(import.meta.dir, "fixtures", "stdin-late-listener-fixture.js");
  const calls = ['end("abc")', "end()", "destroy()", 'end("abc"); destroy()'];
  const origins = [
    "the main script",
    "a nextTick callback",
    "the child's 'spawn' listener",
    "a promise job",
    "a timer",
    "a setImmediate callback",
    "an fs callback",
    "a 'data' listener of the child's stdout",
  ];
  const sameTurn = [
    "one tick",
    "one promise job",
    "two promise jobs",
    "a tick, then a promise job",
    "a promise job, then a tick",
  ];
  // What a listener hears that is added that much later than the call, by node v26.3.0 on POSIX.
  const expected = Object.fromEntries(
    calls.map(call => {
      const ends = !call.includes("destroy()");
      return [
        call,
        Object.fromEntries(
          origins.map(origin => [
            origin,
            {
              ...Object.fromEntries(sameTurn.map(later => [later, ends ? "finish, close" : "close"])),
              // 'finish' precedes the immediates. So does the 'close' of a destroy() that an immediate called.
              "one setImmediate": ends || origin !== "a setImmediate callback" ? "close" : "nothing",
            },
          ]),
        ),
      ];
    }),
  );

  // On Windows a write to a pipe completes from the event loop. So end("abc") finishes one turn of the loop later
  // than end(): behind the immediates of its turn, or ahead of the next ones when an immediate called it. A
  // destroy() behind that write closes one turn later too.
  if (isWindows) {
    for (const origin of origins) {
      if (origin !== "a setImmediate callback") expected['end("abc")'][origin]["one setImmediate"] = "finish, close";
    }
    expected['end("abc"); destroy()']["a setImmediate callback"]["one setImmediate"] = "close";
  }

  const order = join(import.meta.dir, "fixtures", "stdin-end-order-fixture.js");
  const expectedOrder = {
    'end("abc", cb)': {
      log: isWindows
        ? ["immediate", "prefinish", "end callback null", "finish", "close"]
        : ["prefinish", "end callback null", "finish", "immediate", "close"],
      read: "abc",
    },
    'end("abc", cb); destroy()': ["end callback ERR_STREAM_DESTROYED", "immediate", "close"],
    "destroy(err)": ["error BOOM", "immediate", "close"],
    "destroy() of two children in one turn": ["immediate", "stdin 1", "stdin 0"],
    ...(!isWindows && {
      "an ended stdin as the stdout of another child": { second: 0, first: 0 },
      "a 'finish' listener that throws": { read: "abc", code: 0, uncaught: ["from 'finish'"] },
      "a large chunk behind a small one, to a reader that starts late": {
        before: [],
        log: ["prefinish", "finish", "close"],
        bytes: 1024 * 1024 + 5,
      },
      "end() behind a chunk whose flush failed while the script was busy": ["error EPIPE", "close"],
      "a chunk that the pipe did not take, when the child exits and a grandchild keeps the pipe": ["close"],
    }),
    ...(isLinux && {
      "end(cb) from an immediate, with the exit of the child due in the next poll": [
        "prefinish",
        "end callback null",
        "finish",
        "exit",
        "immediate",
        "close",
      ],
    }),
  };

  // The second fixture keeps its signal files in a directory of its own.
  async function report(exe, file) {
    using dir = tempDir("stdin-end-order", {});
    await using proc = Bun.spawn({ cmd: [exe, file, String(dir)], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, report: stdout && JSON.parse(stdout), exitCode };
  }

  it("a listener added later in the turn hears them", async () => {
    expect(await report(bunExe(), fixture)).toEqual({ stderr: "", report: expected, exitCode: 0 });
  });

  it("end() and destroy() keep node's order", async () => {
    expect(await report(bunExe(), order)).toEqual({ stderr: "", report: expectedOrder, exitCode: 0 });
  });

  // The reports above are those of node v26.3.0. On Windows node's own report changes with the machine: where
  // 'finish' comes after end("abc") follows a write that a thread completes.
  const node = nodeExeAtLeast("22.0.0");
  it.skipIf(!node || isWindows)("node prints the same reports", async () => {
    expect(await Promise.all([report(node, fixture), report(node, order)])).toEqual([
      { stderr: "", report: expected, exitCode: 0 },
      { stderr: "", report: expectedOrder, exitCode: 0 },
    ]);
  });

  it("an unref'd child still gets 'finish' and 'close' of its stdin", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { spawn } = require("node:child_process");
         const child = spawn(${JSON.stringify(isWindows ? bunExe() : "cat")}, ${JSON.stringify(isWindows ? ["-e", "process.stdin.resume()"] : [])}, { stdio: ["pipe", "ignore", "inherit"] });
         child.unref();
         child.stdin.on("finish", () => console.log("finish"));
         child.stdin.on("close", () => console.log("close"));
         child.stdin.end("abc");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "finish\nclose\n", stderr: "", exitCode: 0 });
  });

  it("an await of 'finish' behind another await goes on", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { spawn } = require("node:child_process"), { once } = require("node:events");
         (async () => {
           const child = spawn(${JSON.stringify(isWindows ? bunExe() : "cat")}, ${JSON.stringify(isWindows ? ["-e", "process.stdin.pipe(process.stdout)"] : [])});
           let answer = "";
           child.stdout.setEncoding("utf8").on("data", chunk => (answer += chunk));
           const closed = once(child, "close");
           child.stdin.end("3 jobs");
           await once(child, "spawn");
           await once(child.stdin, "finish");
           await closed;
           console.log("answer [" + answer + "]");
         })();`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "answer [3 jobs]\n", stderr: "", exitCode: 0 });
  });
});

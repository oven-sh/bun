import { beforeAll, describe, expect, it } from "bun:test";
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

// In Node, child.stdout and child.stderr are net.Sockets. A net.Socket emits
// 'close' itself and arms it before the 'error' emit, so a throw from that emit
// (no 'error' listener, or a listener that throws) does not lose it. The
// ChildProcess emits its own 'close' only after the 'close' of both pipes.
describe("'close' of the stdout and stderr of a child that started", () => {
  // One process runs every row. It prints what each row saw when it exits, so a
  // 'close' that never comes is a missing entry and not a timeout.
  const fixture = /* js */ `
    const { execFile, spawn } = require("node:child_process");
    const { finished, Readable } = require("node:stream");
    // A child that exits at once. A debug build of bun is slow to start.
    const [command, args] = process.platform === "win32" ? [process.execPath, ["-e", "0"]] : ["true", []];
    // A child that prints one chunk.
    const printer = process.platform === "win32" ? [process.execPath, ["-e", "process.stdout.write('x')"]] : ["echo", ["x"]];
    const bothPipes = ["ignore", "pipe", "pipe"];
    const stdoutOnly = ["ignore", "pipe", "ignore"];

    const seen = {};
    const position = {};
    process.on("exit", () => console.log(JSON.stringify({ seen, position })));
    // Each error names its row, so one handler serves all of them.
    process.on("uncaughtException", e => {
      const [row, what] = e.message.split(": ");
      seen[row].uncaught.push(what);
    });

    function row(name, run) {
      const log = (seen[name] = { uncaught: [], stdout: [], stderr: [], child: [] });
      const watch = (stream, as) => stream.on("close", (...args) => log[as].push("close(" + args + ")"));
      const open = (stdio, child = spawn(command, args, { stdio })) => {
        child.on("exit", () => log.child.push("exit"));
        child.on("close", () => log.child.push("close"));
        if (child.stdout) watch(child.stdout, "stdout");
        if (child.stderr) watch(child.stderr, "stderr");
        return child;
      };
      run({ open, watch, log, error: what => new Error(name + ": " + what) });
    }

    row("no 'error' listener", ({ open, log, error }) => {
      const { stdout, stderr } = open(bothPipes);
      stdout.destroy(error("mine"));
      log.stdout.push("closed=" + stdout.closed);
      stderr.destroy(error("mine"));
    });
    row("'error' listeners, the one on stderr throws", ({ open, log, error }) => {
      const { stdout, stderr } = open(bothPipes);
      stdout.on("error", () => log.stdout.push("error"));
      stderr.on("error", () => {
        log.stderr.push("error");
        throw error("from listener");
      });
      stdout.destroy(error("mine"));
      stderr.destroy(error("mine"));
    });
    row("destroy() callback that throws on stdout, finished() callback that throws on stderr", ({ open, log, error }) => {
      const { stdout, stderr } = open(bothPipes);
      stdout.destroy(error("mine"), () => {
        log.stdout.push("callback");
        throw error("from callback");
      });
      finished(stderr, () => {
        log.stderr.push("finished");
        throw error("from finished");
      });
      stderr.destroy(error("mine"));
    });
    row("no error", ({ open, log }) => {
      const { stdout, stderr } = open(bothPipes);
      stdout.destroy();
      stderr.on("end", () => log.stderr.push("end"));
      finished(stderr, () => log.stderr.push("finished"));
      stderr.resume();
    });
    row("execFile()", ({ open, log, error }) => {
      const child = execFile(command, args, (err, stdout) => {
        log.child.push("callback(" + err + ", " + JSON.stringify(stdout) + ")");
      });
      open(undefined, child).stdout.destroy(error("mine"));
    });
    row("destroy(err) inside the first 'data'", ({ open, log, error }) => {
      const { stdout } = open(undefined, spawn(...printer, { stdio: stdoutOnly }));
      stdout.on("data", () => {
        log.stdout.push("data");
        stdout.destroy(error("mine"));
      });
    });
    // Not a child's pipe. In Node this is a plain Readable: 'close' has no argument and follows 'error'.
    const fromWeb = () => Readable.fromWeb(new Blob(["x"]).stream());
    row("Readable.fromWeb() of a native stream", ({ watch, log, error }) => {
      const stream = watch(fromWeb(), "stdout");
      stream.on("error", () => log.stdout.push("error"));
      stream.destroy(error("mine"));
      log.stdout.push("closed=" + stream.closed);
    });

    // Where 'close' comes among the ticks, the promise jobs and the immediates that are queued just before destroy().
    function trace(name, stream, untilEnd) {
      const log = (position[name] = []);
      const mark = what => () => log.push(what);
      stream.on("close", mark("close"));
      const queueThenDestroy = () => {
        process.nextTick(() => {
          log.push("tick 1");
          process.nextTick(() => {
            log.push("tick 2");
            process.nextTick(mark("tick 3"));
          });
        });
        Promise.resolve().then(mark("promise job"));
        setImmediate(mark("immediate"));
        // At 'end' the stream destroys itself when its listeners return.
        if (!untilEnd) stream.destroy();
      };
      if (untilEnd) stream.on("end", queueThenDestroy).resume();
      else queueThenDestroy();
    }
    for (const untilEnd of [false, true]) {
      const when = untilEnd ? "at 'end'" : "destroy()";
      trace("child.stdout, " + when, spawn(command, args, { stdio: stdoutOnly }).stdout, untilEnd);
      trace("Readable.fromWeb(), " + when, fromWeb(), untilEnd);
    }
  `;

  const child = ["exit", "close"];
  // What Node v26.3.0 prints for the same fixture.
  const expected = {
    "no 'error' listener": {
      uncaught: ["mine", "mine"],
      stdout: ["closed=true", "close(true)"],
      stderr: ["close(true)"],
      child,
    },
    "'error' listeners, the one on stderr throws": {
      uncaught: ["from listener"],
      stdout: ["error", "close(true)"],
      stderr: ["error", "close(true)"],
      child,
    },
    // Node's destroy() catches what its callback throws.
    "destroy() callback that throws on stdout, finished() callback that throws on stderr": {
      uncaught: ["from finished"],
      stdout: ["callback", "close(true)"],
      stderr: ["finished", "close(true)"],
      child,
    },
    "no error": { uncaught: [], stdout: ["close(false)"], stderr: ["end", "finished", "close(false)"], child },
    "execFile()": {
      uncaught: ["mine"],
      stdout: ["close(true)"],
      stderr: ["close(false)"],
      child: ["exit", 'callback(null, "")', "close"],
    },
    "destroy(err) inside the first 'data'": { uncaught: ["mine"], stdout: ["data", "close(true)"], stderr: [], child },
    "Readable.fromWeb() of a native stream": {
      uncaught: [],
      stdout: ["closed=false", "error", "close()"],
      stderr: [],
      child: [],
    },
  };

  let seen, position;
  beforeAll(async () => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    ({ seen, position } = JSON.parse(stdout));
  });

  it.each(Object.keys(expected))("%s", row => {
    expect(seen[row]).toEqual(expected[row]);
  });

  // Not Node's position: Node emits this 'close' in the close phase of the loop, after the immediates. It is the
  // position of the 'close' that the stream layer emits, which Readable.fromWeb() of a native stream still uses.
  it("comes at the tick where the stream layer emits 'close'", () => {
    const order = ["tick 1", "tick 2", "close", "tick 3", "promise job", "immediate"];
    expect(position).toEqual({
      "child.stdout, destroy()": order,
      "Readable.fromWeb(), destroy()": order,
      "child.stdout, at 'end'": order,
      "Readable.fromWeb(), at 'end'": order,
    });
  });

  describe("after a fatal error (no 'error' listener, no 'uncaughtException' listener)", () => {
    async function run(source) {
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, boom: stderr.includes("boom"), exitCode };
    }
    const spawnOf = (posix, windows) => `
      const { spawn } = require("node:child_process");
      const [command, args] = process.platform === "win32" ? [process.execPath, ["-e", ${JSON.stringify(windows)}]] : ${JSON.stringify(posix)};`;
    // This child waits for its stdin, so its 'exit' cannot come first.
    const waits = spawnOf(["cat", []], "process.stdin.resume()");
    const prints = spawnOf(["echo", ["x"]], "process.stdout.write('x')");

    // An immediate that is pending keeps the loop of a process that has a fatal error alive.
    it("'close' adds no turn of the event loop", async () => {
      expect(
        await run(`${waits}
          const { getEventLoopStats } = require("bun:internal-for-testing");
          const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
          let turns;
          process.on("exit", () => console.log("turns after the error: " + (getEventLoopStats().iteration - turns)));
          child.stdout.destroy(new Error("boom"));
          turns = getEventLoopStats().iteration;`),
      ).toEqual({ stdout: "turns after the error: 0\n", boom: true, exitCode: 1 });
    });

    // Node exits at a fatal error. Bun first runs what is queued behind it, 'close' listeners included:
    // https://github.com/oven-sh/bun/pull/34661. Observed: stdout is "the 'close' listener ran\n".
    it.failing("no 'close' listener runs", async () => {
      expect(
        await run(`${waits}
          const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
          child.stdout.on("close", () => console.log("the 'close' listener ran"));
          child.stdout.destroy(new Error("boom"));`),
      ).toEqual({ stdout: "", boom: true, exitCode: 1 });
    });

    // The output is not read, so stdout is still open at 'exit'. Observed: the exit code is 0.
    it.failing("a wrapper that exits with the code of its child exits 1", async () => {
      expect(
        await run(`${prints}
          const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
          child.on("close", code => process.exit(code));
          child.on("exit", () => child.stdout.destroy(new Error("boom")));`),
      ).toEqual({ stdout: "", boom: true, exitCode: 1 });
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

import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isAndroid, isFreeBSD, isLinux, isPosix, isWindows, tempDir } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { tables } from "./fixtures/stdin-exited-child-fixture.js";

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

// One callback after spawn(), a child that lives a few milliseconds has exited, and this loop has yet to report that:
// it runs its task queue and its immediates ahead of the poll that sees an exit. Node.js polls first, so there the exit
// has destroyed child.stdin before the callback runs, and a write to it ends with no 'error'. Here the write was sent,
// and its EPIPE became an 'error' that ended a parent with no listener for it.
//
// Each row of the fixture proves that its child has exited, without a poll of the event loop. Windows: the fixture has
// no such proof there. FreeBSD: the question that the stream asks is not wired.
describe.skipIf(isWindows || isFreeBSD)("child.stdin one callback after spawn()", () => {
  const fixture = join(import.meta.dir, "fixtures", "stdin-exited-child-fixture.js");

  // The rows of a table of the fixture: { [row]: what followed the calls of the row, in order }.
  async function table(name, { entry = fixture, env = bunEnv } = {}) {
    using dir = tempDir("stdin-exited-child", {});
    await using proc = Bun.spawn({ cmd: [bunExe(), entry, name, String(dir)], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }

  // The part of a row that Node.js shows too: the 'error' of child.stdin, or that it closed with none.
  const ending = events =>
    events.find(event => event.startsWith("stdin error ")) ??
    (events.some(event => event.startsWith("stdin close")) ? "no 'error'" : "never closed");
  const endings = rows => Object.fromEntries(Object.entries(rows).map(([row, events]) => [row, ending(events)]));
  const every = (name, value) => Object.fromEntries(tables[name].map(row => [row, value]));

  it.concurrent("a parent with no 'error' listener survives a write to a child that has exited", async () => {
    expect(endings(await table("no listener"))).toEqual(every("no listener", "no 'error'"));
  });

  it.concurrent("no 'error' for a child that exited before the callback", async () => {
    expect(endings(await table("exited"))).toEqual(every("exited", "no 'error'"));
  });

  // In the turn of spawn(), for a child that lived through a poll, for a live child that closed its stdin, and for a
  // child that took bytes in the callback and then exited (all of them, or a part while the rest waited): Node.js
  // reports the EPIPE in each.
  it.concurrent("'error' EPIPE where no loop could have reported an exit", async () => {
    expect(endings(await table("not reported"))).toEqual(every("not reported", "stdin error EPIPE"));
  });

  // An ES module with a pending top-level await is run by another function of the event loop (auto_tick).
  it.concurrent("the same from a program that waits in a top-level await", async () => {
    expect(endings(await table("both kinds", { entry: fixture.replace(/js$/, "mjs") }))).toEqual({
      "immediate, end": "no 'error'",
      "immediate, write large": "no 'error'",
      "promise, end": "no 'error'",
      "fs, end": "no 'error'",
      "spawn turn, end": "stdin error EPIPE",
      "closed, end": "stdin error EPIPE",
    });
  });

  // Without a pidfd a thread waits for the child, and the stream gets no answer. These rows have a live child, and the
  // fixture has /dev/null as its stdin: an answer that is read from descriptor 0 says that the child has exited.
  it.skipIf(!isLinux && !isAndroid).concurrent("'error' EPIPE for a live child that a thread waits for", async () => {
    const env = { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "1" };
    expect(endings(await table("closed", { env }))).toEqual(every("closed", "stdin error EPIPE"));
  });

  // The loop reports the exit itself, as it always has: what the child sent before it exited is read first.
  it.concurrent("the output and the message of the child arrive ahead of its 'exit'", async () => {
    const rows = await table("order");
    const ahead = (row, event) =>
      rows[row].includes(event) && rows[row].indexOf(event) < rows[row].indexOf("exit SIGKILL");
    expect({
      stdout: ahead("immediate, end large, output", "stdout data"),
      stderr: ahead("immediate, end large, output", "stderr data"),
      message: [ahead("immediate, end large, ipc", "message"), ahead("fs, end large, ipc", "message")],
      "'close' of the child for a listener that was added late":
        rows["immediate, end, then listen for 'close' of the child, output"].includes("late close"),
    }).toEqual({
      stdout: true,
      stderr: true,
      message: [true, true],
      "'close' of the child for a listener that was added late": true,
    });
  });

  // kill() sends no signal to a child whose exit Node.js has reported, and returns false:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L502-L527
  // An AbortSignal emits its AbortError only if kill() returned true.
  it.concurrent("kill() and an AbortSignal leave a child that has exited alone", async () => {
    const rows = await table("kill");
    const said = Object.fromEntries(
      Object.entries(rows).map(([row, events]) => [row, events.filter(event => !/^(exit|stdin) /.test(event))]),
    );
    expect(said).toEqual({
      "immediate, kill()": ["kill() false, killed false"],
      "promise, kill()": ["kill() false, killed false"],
      "fs, kill()": ["kill() false, killed false"],
      "spawn turn, kill()": ["kill() true, killed true"],
      "later, kill()": ["kill() true, killed true"],
      "immediate, abort, signal": [],
      "spawn turn, abort, signal": ["child error AbortError"],
      // The error of execFile() is that of the exit: the child was killed from outside.
      "immediate, abort, execFile": ["execFile callback Error"],
      "spawn turn, abort, execFile": ["execFile callback AbortError", "child error AbortError"],
    });
  });

  // What the rows above leave out, because it differs from Node.js. Here the failed send itself ends the stream, and the
  // loop reports the exit after it: the callbacks, `errored` and finished() have the EPIPE of the send, and 'exit'
  // comes last. Under Node.js the exit comes first and destroys the stream: `errored` is null, a callback gets
  // ERR_STREAM_DESTROYED or is not called, and finished() after write() and end() resolves.
  //
  // Once this loop reports an exit ahead of its immediates and its tasks, these rows fail. Delete them then, with the
  // question that the stream asks (has_exited_before_first_poll in subprocess.rs).
  describe("while the loop reports an exit behind its immediates and tasks", () => {
    it.concurrent("the callbacks and `errored` have the EPIPE, and 'exit' is last", async () => {
      const rows = await table("exited");
      const closed = ["stdin close, errored EPIPE", "exit SIGKILL"];
      // Without "write large, end": after a write() that sends inside the call, end() does not wait for that write (#46187).
      const expected = {};
      for (const when of ["immediate", "promise"]) {
        Object.assign(expected, {
          [`${when}, end`]: ["end callback EPIPE", ...closed],
          [`${when}, end large`]: ["end callback EPIPE", ...closed],
          [`${when}, write large`]: ["write callback EPIPE", ...closed],
          [`${when}, write large twice`]: ["write callback EPIPE", "write callback EPIPE", ...closed],
          [`${when}, write, end`]: closed,
          // The sink holds back a small write, and answers it before anything is sent.
          [`${when}, write, end with callback`]: ["write callback ok", "end callback EPIPE", ...closed],
          [`${when}, write, destroy`]: ["stdin close, errored null", "exit SIGKILL"],
        });
      }
      expect(Object.fromEntries(Object.keys(expected).map(row => [row, rows[row]]))).toEqual(expected);
    });

    it.concurrent("finished() has the EPIPE", async () => {
      const rows = await table("finished");
      const closed = ["stdin close, errored EPIPE", "finished EPIPE", "exit SIGKILL"];
      expect({
        "immediate, write, end, finished": rows["immediate, write, end, finished"],
        "immediate, end large, finished": rows["immediate, end large, finished"],
        // fs.stat() is one request to the thread pool. Node.js runs its callback in the poll that also sees the exit,
        // ahead of the exit, and reports EPIPE. Bun does not tell it from fs.readFile(), which is several.
        "fs one hop, end": ending(rows["fs one hop, end"]),
        "fs one hop, write large": ending(rows["fs one hop, write large"]),
      }).toEqual({
        "immediate, write, end, finished": closed,
        "immediate, end large, finished": ["end callback EPIPE", ...closed],
        "fs one hop, end": "no 'error'",
        "fs one hop, write large": "no 'error'",
      });
    });

    // Where spawn() runs, against when end() runs. The child of each cell has exited by then.
    it.concurrent("spawn() in a callback", async () => {
      expect(await table("origins")).toEqual({
        "spawn() in a timer, the same turn": "EPIPE",
        "spawn() in a timer, the next immediate": "no 'error'",
        "spawn() in an fs callback, the same turn": "EPIPE",
        // Node.js reports EPIPE in the next two: it has not polled between the two callbacks.
        "spawn() in an fs callback, the next immediate": "no 'error'",
        "spawn() in an fs callback, the next fs callback": "no 'error'",
        "spawn() in an immediate, the same turn": "EPIPE",
        "spawn() in an immediate, the next immediate": "no 'error'",
        "spawn() in an immediate, an immediate of the same batch": "EPIPE",
      });
    });
  });

  // The stream holds the Subprocess of its child to ask about it, and lets go of it when it is destroyed.
  it.concurrent("a stdin that is kept does not keep the Subprocess of its child", async () => {
    const script = `
      const { spawn } = require("node:child_process");
      const { heapStats } = require("bun:jsc");
      const kept = [];
      let open = 30;
      for (let i = 0; i < 30; i++) {
        const child = spawn("true", { stdio: ["pipe", "ignore", "ignore"] });
        kept.push(child.stdin);
        child.on("close", () => {
          if (--open > 0) return;
          setImmediate(() => {
            Bun.gc(true);
            console.log(JSON.stringify({ kept: kept.length, subprocesses: heapStats().objectTypeCounts.Subprocess ?? 0 }));
          });
        });
      }`;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { kept, subprocesses } = JSON.parse(stdout);
    expect(kept).toBe(30);
    expect(subprocesses).toBeLessThan(5);
  });
});

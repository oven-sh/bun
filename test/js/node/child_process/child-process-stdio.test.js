import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix, isWindows } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
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

  // 1 MiB is more than the pipe holds, so the first write is pending while the other
  // two are made. The empty chunk never reaches the pipe and "x" waits behind the first.
  const pending = () => Buffer.alloc((1 << 20) + 1, "a");

  it("write callbacks run in the order of the writes, after write() returned", async () => {
    const child = spawn(bunExe(), ["-e", "process.stdin.resume()"], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });
    const events = [];
    let inside = true;
    const record = name => err => events.push(`${inside ? "inside write(): " : ""}${name}:${err?.code ?? "ok"}`);
    child.stdin.on("finish", () => events.push("finish"));

    child.stdin.write(pending(), record("w1"));
    child.stdin.write("", record("w2"));
    child.stdin.write("x", record("w3"));
    child.stdin.end(() => events.push("end callback"));
    inside = false;
    await once(child.stdin, "close");

    expect(events).toEqual(["w1:ok", "w2:ok", "w3:ok", "end callback", "finish"]);
  });

  // end(chunk) and code that calls Writable.prototype.write() reach the pipe through
  // _write(), not through the stream's own write().
  for (const [what, first] of [
    ["the pipe takes at once", () => "a"],
    ["the pipe holds", pending],
  ]) {
    it(`the child reads the chunks in call order when Writable.prototype.write() follows a write() that ${what}`, async () => {
      const child = spawn(bunExe(), ["-e", "process.stdin.pipe(process.stdout)"], {
        env: bunEnv,
        stdio: ["pipe", "pipe", "ignore"],
      });
      child.stdin.write(first(), () => {});
      Writable.prototype.write.call(child.stdin, "B");
      child.stdin.write("C");
      child.stdin.end("D");

      const chunks = [];
      for await (const chunk of child.stdout) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString();
      expect({ bytes: text.length, end: text.slice(-3) }).toEqual({ bytes: first().length + 3, end: "BCD" });
    });
  }

  // On Windows one uv_write takes the whole chunk, so the write has reported before the pipe fails.
  it.skipIf(isWindows)(
    "a write that fails gives the error to every pending write callback in write order, then to 'error'",
    async () => {
      // The child closes its end of the pipe and stays alive, so that the error comes from
      // the pipe and not from the exit of the child.
      const child = spawn(bunExe(), ["-e", "require('fs').closeSync(0); setInterval(() => {}, 1 << 30);"], {
        env: bunEnv,
        stdio: ["pipe", "ignore", "ignore"],
      });
      try {
        const events = [];
        const record = name => err =>
          events.push(`${name}:${err?.code ?? "ok"}${child.stdin.destroyed ? " after destroy" : ""}`);
        child.stdin.on("drain", () => events.push("drain"));
        child.stdin.on("error", err => events.push(`error:${err.code}`));
        // Not events.once(): it rejects on 'error', which is expected here.
        const { promise: closed, resolve: onClose } = Promise.withResolvers();
        child.stdin.on("close", onClose);

        child.stdin.write(pending(), record("w1"));
        child.stdin.write("", record("w2"));
        child.stdin.write("x", record("w3"));
        await closed;

        // EPIPE on POSIX. Whatever the platform calls it, every callback gets the same one.
        const code = events[0]?.slice("w1:".length);
        expect(code).toMatch(/^E[A-Z]+$/);
        expect(events).toEqual([`w1:${code}`, `w2:${code}`, `w3:${code}`, `error:${code}`]);
      } finally {
        child.kill();
      }
    },
  );
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

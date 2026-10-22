import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix, isWindows } from "harness";
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

  // A child that prints "ready", reads stdin only on SIGUSR1, then prints the byte count it read. On Windows a
  // write to child.stdin is never held (one uv_write takes the whole chunk), so there is no backpressure to observe.
  const gatedReader = `process.on("SIGUSR1", async () => {
    let n = 0;
    for await (const c of process.stdin) n += c.length;
    process.stdout.write(String(n), () => process.exit(0));
  });
  setInterval(() => {}, 1 << 30);
  process.stdout.write("ready\\n");`;

  it.skipIf(isWindows)("a held write is pending in writableLength and writableNeedDrain until 'drain'", async () => {
    const child = spawn(bunExe(), ["-e", gatedReader], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    const stdin = child.stdin;
    const state = () => ({ length: stdin.writableLength, needDrain: stdin.writableNeedDrain });
    const order = [];
    // SIGUSR1 before the child installs its listener would kill it.
    let stdout = "";
    const ready = new Promise(resolve => {
      child.stdout.on("data", c => {
        stdout += c;
        if (stdout.startsWith("ready\n")) resolve();
      });
    });

    // 128 KiB chunks until the sink holds one. The chunks it took at once are done: only the held one is pending.
    const chunk = 128 * 1024;
    let held = 0;
    for (;;) {
      const i = held;
      if (stdin.write(Buffer.alloc(chunk, "A"), () => order.push(i)) === false) break;
      held++;
      expect(held).toBeLessThan(64);
    }
    const lastCb = Promise.withResolvers();
    const retB = stdin.write("B", () => {
      order.push("B");
      lastCb.resolve();
    });
    expect({ retB, order, ...state() }).toEqual({ retB: false, order: [], length: chunk + 1, needDrain: true });
    const drained = once(stdin, "drain").then(() => order.push("drain"));

    await ready;
    child.kill("SIGUSR1");
    await Promise.all([drained, lastCb.promise]);
    const done = [];
    for (let i = 0; i < held; i++) done.push(i);
    // Callbacks run in write order. 'drain' fires once, when nothing is pending.
    expect({
      callbacks: order.filter(o => o !== "drain"),
      drains: order.filter(o => o === "drain"),
      ...state(),
    }).toEqual({
      callbacks: [...done, held, "B"],
      drains: ["drain"],
      length: 0,
      needDrain: false,
    });

    const exited = once(child, "exit");
    const closed = once(child, "close");
    stdin.end();
    const [[exitCode]] = await Promise.all([exited, closed]);
    expect(stdout).toBe("ready\n" + String(chunk * (held + 1) + 1));
    expect(exitCode).toBe(0);
  });

  it("write() is inherited from the prototype", async () => {
    const child = spawn(bunExe(), ["-e", ""], { env: bunEnv, stdio: ["pipe", "ignore", "ignore"] });
    expect({
      own: Object.hasOwn(child.stdin, "write"),
      proto: child.stdin.write === child.stdin.constructor.prototype.write,
    }).toEqual({ own: false, proto: true });
    child.stdin.end();
    await once(child, "close");
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

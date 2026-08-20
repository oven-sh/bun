import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { readSync, writeSync } from "node:fs";

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

describe("stdio _handle", () => {
  it("piped stdio streams carry a _handle with a numeric fd", async () => {
    const child = spawn(bunExe(), ["-e", "setTimeout(() => {}, 100_000)"], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      expect(typeof child.stdin._handle.fd).toBe("number");
      expect(typeof child.stdout._handle.fd).toBe("number");
      expect(typeof child.stderr._handle.fd).toBe("number");
      if (!isWindows) {
        // Windows pipes have no CRT fd: Node reports -1 there too.
        expect(child.stdin._handle.fd).toBeGreaterThanOrEqual(0);
        expect(child.stdout._handle.fd).toBeGreaterThanOrEqual(0);
        expect(child.stderr._handle.fd).toBeGreaterThanOrEqual(0);
      }
    } finally {
      child.kill();
    }
    await once(child, "exit");
    // The parent-end write fd is closed once the child is gone: the handle
    // must not leak the stale number.
    expect(child.stdin._handle.fd).toBe(-1);
  });

  it.skipIf(isWindows)("stdin _handle.fd is -1 after end()", async () => {
    const child = spawn(bunExe(), ["-e", "process.stdin.resume(); setTimeout(() => {}, 30_000)"], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "inherit"],
    });
    try {
      expect(child.stdin._handle.fd).toBeGreaterThanOrEqual(0);
      child.stdin.end();
      await once(child.stdin, "finish");
      expect(child.stdin._handle.fd).toBe(-1);
    } finally {
      child.kill();
    }
    await once(child, "exit");
  });

  it("child.stdin.unref releases the stdin writer keep-alive", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { spawn } = require("node:child_process");
        const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
          stdio: ["pipe", "ignore", "ignore"],
        });
        process.on("exit", () => child.kill());
        // Fill the pipe so the sink's writable poll stays armed, then unref
        // everything: the process must exit on its own.
        child.stdin.write(Buffer.alloc(1 << 20, 10));
        child.stdin.unref();
        child.unref();
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // The synchronous fd-based IPC pattern used by TypeScript 7's sync API:
  // grab the raw fds from _handle, make them blocking, keep the streams
  // paused, and drive a request/response cycle with writeSync/readSync.
  it.skipIf(isWindows)("_handle.fd supports blocking readSync/writeSync IPC", async () => {
    const child = spawn(
      bunExe(),
      ["-e", `process.stdin.once("data", d => process.stdout.write("pong:" + d.toString().trim()))`],
      { env: bunEnv, stdio: ["pipe", "pipe", "inherit"] },
    );
    try {
      const readFd = child.stdout._handle.fd;
      const writeFd = child.stdin._handle.fd;
      expect(child.stdout._handle.setBlocking(true)).toBe(true);
      expect(child.stdin._handle.setBlocking(true)).toBe(true);
      child.stdout.pause();
      child.stdout.unref();
      child.stdin.unref();
      child.unref();

      writeSync(writeFd, "ping\n");
      const buf = Buffer.alloc(64);
      let out = "";
      while (!out.includes("pong:ping")) {
        const n = readSync(readFd, buf, 0, buf.length, null);
        expect(n).toBeGreaterThan(0);
        out += buf.toString("utf8", 0, n);
      }
      expect(out).toBe("pong:ping");
    } finally {
      child.kill();
    }
    await once(child, "exit");
  });
});

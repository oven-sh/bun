import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { finished } from "node:stream/promises";

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

// https://github.com/oven-sh/bun/pull/31833
// Short stdio arrays are padded to length 3; the eager-load guard used to read
// the raw pre-padding length, so a 2-element array left stdout un-eagerly-
// loaded and accessing it after exit hit an assertion in native-readable.
describe("short stdio arrays", () => {
  test.each([
    [["pipe", "pipe"]],
    [["ignore", "pipe"]],
    [["inherit", "pipe"]],
    [["pipe", "pipe", "pipe"]], // 3-element control row
  ])("stdio %j: stdout streams while the child runs", async stdio => {
    const child = spawn(bunExe(), ["-e", "process.stdout.write('ok')"], { env: bunEnv, stdio });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", d => (out += d));
    child.stderr?.resume();
    const [code, signal] = await once(child, "close");
    expect(out).toBe("ok");
    expect(child.stdout.readable).toBe(false);
    expect(signal).toBeNull();
    expect(code).toBe(0);
  });

  // The regression: `.stdio` must not be touched before exit, otherwise it is
  // constructed while the handle is still alive and the missing eager load is
  // invisible. Without the fix the 2-element rows skip the eager load, so this
  // first post-exit access constructs a native Readable over a released handle
  // and throws "ASSERTION FAILED: typeof bunNativePtr === object".
  // The invariant under test is that reading `.stdout` after exit is safe and
  // the stream can still be driven to a clean end, not that the bytes are
  // retrievable.
  test.each([
    [["pipe", "pipe"]],
    [["ignore", "pipe"]],
    [["pipe", "pipe", "pipe"]], // 3-element control row
  ])("stdio %j: stdout is a usable Readable when first accessed after exit", async stdio => {
    const child = spawn(bunExe(), ["-e", "process.stdout.write('ok')"], { env: bunEnv, stdio });
    const [code, signal] = await once(child, "exit");
    expect(signal).toBeNull();
    expect(code).toBe(0);

    // First `.stdout` access of this ChildProcess' lifetime: must not throw.
    const stdout = child.stdout;
    expect(stdout).not.toBeNull();
    expect(typeof stdout.on).toBe("function");

    // On Windows the pipe EOF can lag the 'exit' event, so drive the stream to
    // completion instead of asserting it is already ended.
    stdout.resume();
    await finished(stdout);
    expect(stdout.readableEnded).toBe(true);
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

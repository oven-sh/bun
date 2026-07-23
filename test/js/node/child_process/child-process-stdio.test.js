import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { Duplex, PassThrough, Readable, Writable } from "node:stream";

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

describe("spawn stdio validation", () => {
  it.each([
    [
      "Writable",
      () =>
        new Writable({
          write(c, e, cb) {
            cb();
          },
        }),
    ],
    ["Readable", () => new Readable({ read() {} })],
    [
      "Duplex",
      () =>
        new Duplex({
          read() {},
          write(c, e, cb) {
            cb();
          },
        }),
    ],
    ["PassThrough", () => new PassThrough()],
  ])("stream without an fd (%s) throws ERR_INVALID_ARG_VALUE", (name, make) => {
    let err;
    try {
      spawn(bunExe(), ["-e", "0"], { env: bunEnv, stdio: ["pipe", make(), "pipe"] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TypeError);
    expect({ code: err.code, message: err.message }).toEqual({
      code: "ERR_INVALID_ARG_VALUE",
      message: expect.stringMatching(/^The argument 'stdio' is invalid\. Received /),
    });
    expect(err.message).toContain(name);
    expect(err.message).not.toContain("TODO");
  });
});

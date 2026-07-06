import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { execSync, spawn } from "node:child_process";

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
  it("fails a write issued after end() with ERR_STREAM_WRITE_AFTER_END", async () => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });

    const echoed = Promise.withResolvers();
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => (data += chunk));
    child.stdout.on("end", () => echoed.resolve(data));
    child.stdout.on("error", echoed.reject);
    child.on("error", echoed.reject);

    // Surfacing the error also destroys the stream, which emits 'error'.
    const errorEvents = [];
    child.stdin.on("error", err => errorEvents.push(err.code));

    const finished = Promise.withResolvers();
    child.stdin.on("finish", finished.resolve);
    child.stdin.end("kept\n");
    await finished.promise;

    const writeCb = Promise.withResolvers();
    const ret = child.stdin.write("dropped\n", err => writeCb.resolve(err));

    expect((await writeCb.promise)?.code).toBe("ERR_STREAM_WRITE_AFTER_END");
    expect(ret).toBe(false);
    // The bytes must not reach the child.
    expect(await echoed.promise).toBe("data: kept\n");
    expect(errorEvents).toEqual([]);
  });

  it("emits 'error' for a callback-less write issued after end()", async () => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });

    const errored = Promise.withResolvers();
    child.stdin.on("error", errored.resolve);
    child.on("error", errored.reject);
    child.on("exit", () => errored.reject(new Error("child exited before stdin errored")));

    child.stdin.end("kept\n");
    const ret = child.stdin.write("dropped\n");

    expect((await errored.promise).code).toBe("ERR_STREAM_WRITE_AFTER_END");
    expect(ret).toBe(false);
    child.kill();
  });

  it("fails a write issued after destroy() with ERR_STREAM_DESTROYED", async () => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });

    child.stdin.destroy();

    const writeCb = Promise.withResolvers();
    const ret = child.stdin.write("dropped\n", err => writeCb.resolve(err));

    expect((await writeCb.promise)?.code).toBe("ERR_STREAM_DESTROYED");
    expect(ret).toBe(false);
    child.kill();
  });
});

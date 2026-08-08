import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { Duplex, Readable, Writable } from "node:stream";

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

describe("ChildProcess stdio streams", () => {
  // https://github.com/oven-sh/bun/issues/11011
  it("child.stdin is a Duplex and supports setEncoding", async () => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: "pipe",
    });

    try {
      expect({
        "typeof stdin.setEncoding": typeof child.stdin.setEncoding,
        "typeof stdin.pause": typeof child.stdin.pause,
        "typeof stdin.resume": typeof child.stdin.resume,
        "typeof stdin.write": typeof child.stdin.write,
        "typeof stdin.end": typeof child.stdin.end,
        "typeof stdin.destroySoon": typeof child.stdin.destroySoon,
        "stdin instanceof Duplex": child.stdin instanceof Duplex,
        "stdin instanceof Readable": child.stdin instanceof Readable,
        "stdin instanceof Writable": child.stdin instanceof Writable,
        "stdin.readable": child.stdin.readable,
        "stdin.writable": child.stdin.writable,
      }).toEqual({
        "typeof stdin.setEncoding": "function",
        "typeof stdin.pause": "function",
        "typeof stdin.resume": "function",
        "typeof stdin.write": "function",
        "typeof stdin.end": "function",
        "typeof stdin.destroySoon": "function",
        "stdin instanceof Duplex": true,
        "stdin instanceof Readable": true,
        "stdin instanceof Writable": true,
        "stdin.readable": false,
        "stdin.writable": true,
      });
    } finally {
      child.stdin.end();
      await once(child, "exit");
    }
  });

  it("child.stdin.destroySoon flushes pending writes then closes", async () => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: "pipe",
    });

    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      data += chunk;
    });

    child.stdin.write("abc\n");
    child.stdin.destroySoon();

    const [code] = await once(child, "close");
    expect(data).toBe("data: abc\n");
    expect(child.stdin.destroyed).toBe(true);
    expect(code).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/11011
  it("setEncoding can be called on stdin, stdout and stderr and writes still reach the child", async () => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: "pipe",
    });

    // python-shell calls setEncoding on all three stdio streams unconditionally.
    for (const name of ["stdout", "stdin", "stderr"]) {
      expect(child[name].setEncoding("utf8")).toBe(child[name]);
    }

    let data = "";
    child.stdout.on("data", chunk => {
      data += chunk;
    });

    child.stdin.write("hello");
    child.stdin.write(" ");
    child.stdin.write("world\n");
    child.stdin.end();

    const [code, signal] = await once(child, "close");
    expect(data).toBe("data: hello world\n");
    expect(code).toBe(0);
    expect(signal).toBeNull();
  });

  it("child.stdin.write preserves non-UTF-8 encodings", async () => {
    const child = spawn(
      bunExe(),
      ["-e", `process.stdin.on("data", chunk => process.stdout.write(chunk.toString("hex")))`],
      { env: bunEnv, stdio: ["pipe", "pipe", "ignore"] },
    );

    child.stdout.setEncoding("utf8");
    let data = "";
    child.stdout.on("data", chunk => {
      data += chunk;
    });

    child.stdin.write("\u00e9", "latin1");
    child.stdin.write("\u00e9", "utf8");
    child.stdin.write(Buffer.from([0xff]));
    child.stdin.end();

    const [code] = await once(child, "close");
    // latin1 "é" -> e9, utf8 "é" -> c3 a9, raw buffer -> ff
    expect(data).toBe("e9c3a9ff");
    expect(code).toBe(0);
  });
});

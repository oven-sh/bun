import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
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

// Node wraps piped stdio in `net.Socket` instances (lib/internal/child_process.js
// createSocket). Packages like Nx check `instanceof net.Socket` to decide whether
// to `unref()` the stream.
// https://github.com/oven-sh/bun/issues/26505
// https://github.com/oven-sh/bun/issues/11011
describe("ChildProcess stdio pipe streams are net.Socket", () => {
  // https://github.com/oven-sh/bun/issues/11011 (setEncoding on child.stdin)
  // https://github.com/oven-sh/bun/issues/26505 (instanceof net.Socket)
  it("stdin/stdout/stderr pass instanceof and shape checks", async () => {
    const child = spawn(bunExe(), ["-e", ""], { env: bunEnv, stdio: "pipe" });
    try {
      const shape = name => ({
        "constructor.name": child[name].constructor.name,
        "instanceof net.Socket": child[name] instanceof net.Socket,
        "instanceof Duplex": child[name] instanceof Duplex,
        "instanceof Readable": child[name] instanceof Readable,
        "instanceof Writable": child[name] instanceof Writable,
        "typeof ref": typeof child[name].ref,
        "typeof unref": typeof child[name].unref,
        "typeof setEncoding": typeof child[name].setEncoding,
        "typeof pause": typeof child[name].pause,
        "typeof resume": typeof child[name].resume,
        "typeof write": typeof child[name].write,
        "typeof end": typeof child[name].end,
        "typeof destroySoon": typeof child[name].destroySoon,
        "unref() === this": child[name].unref() === child[name],
        "ref() === this": child[name].ref() === child[name],
      });
      const expected = {
        "constructor.name": "Socket",
        "instanceof net.Socket": true,
        "instanceof Duplex": true,
        "instanceof Readable": true,
        "instanceof Writable": true,
        "typeof ref": "function",
        "typeof unref": "function",
        "typeof setEncoding": "function",
        "typeof pause": "function",
        "typeof resume": "function",
        "typeof write": "function",
        "typeof end": "function",
        "typeof destroySoon": "function",
        "unref() === this": true,
        "ref() === this": true,
      };
      expect({
        stdin: shape("stdin"),
        stdout: shape("stdout"),
        stderr: shape("stderr"),
        "stdin.readable": child.stdin.readable,
        "stdin.writable": child.stdin.writable,
      }).toEqual({
        stdin: expected,
        stdout: expected,
        stderr: expected,
        "stdin.readable": false,
        "stdin.writable": true,
      });
    } finally {
      child.stdin.end();
      await once(child, "close");
    }
  });

  it("stdin still delivers writes to the child and stdout still delivers reads", async () => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"], {
      env: bunEnv,
      stdio: "pipe",
    });
    expect(child.stdin instanceof net.Socket).toBe(true);
    expect(child.stdout instanceof net.Socket).toBe(true);

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

  it("stdin.write respects the encoding argument", async () => {
    const child = spawn(
      bunExe(),
      ["-e", `process.stdin.on("data", chunk => process.stdout.write(chunk.toString("hex")))`],
      { env: bunEnv, stdio: ["pipe", "pipe", "ignore"] },
    );

    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      data += chunk;
    });

    child.stdin.write("\u00e9", "latin1");
    child.stdin.write("\u00e9", "utf8");
    child.stdin.write(Buffer.from([0xff]));
    child.stdin.end();

    const [code] = await once(child, "close");
    // latin1 é = 0xe9, utf8 é = 0xc3 0xa9, raw buffer = 0xff
    expect(data).toBe("e9c3a9ff");
    expect(code).toBe(0);
  });

  it("stdin.destroySoon flushes pending writes then closes", async () => {
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
});

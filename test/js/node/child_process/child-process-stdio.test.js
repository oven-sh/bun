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

describe.concurrent("a pipe at fd 3", () => {
  function start(script) {
    const child = spawn(bunExe(), ["-e", script], { env: bunEnv, stdio: ["ignore", "pipe", "pipe", "pipe"] });
    const text = async stream => Buffer.concat(await Array.fromAsync(stream)).toString();
    const ended = Promise.all([text(child.stdout), text(child.stderr), once(child, "exit")]);
    return {
      pipe: child.stdio[3],
      result: () => ended.then(([stdout, stderr, [exitCode]]) => ({ stdout, stderr, exitCode })),
      async [Symbol.asyncDispose]() {
        child.stdio[3].destroy();
        child.kill();
        await ended;
      },
    };
  }
  function receive(stream, length) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const chunks = [];
    stream.on("data", chunk => {
      chunks.push(chunk);
      if ((length -= chunk.length) <= 0) resolve(Buffer.concat(chunks));
    });
    stream.on("error", reject).on("close", () => reject(new Error(`closed with ${length} bytes to go`)));
    return promise;
  }

  it("carries data both ways at the same time", async () => {
    const size = 2 * 1024 * 1024;
    await using child = start(`
      const pipe = require("net").connect({ fd: 3 });
      const hash = new Bun.CryptoHasher("sha1");
      let left = ${size};
      pipe.on("data", chunk => {
        hash.update(chunk);
        if ((left -= chunk.length) === 0) console.log(hash.digest("hex"));
      });
      pipe.write(Buffer.alloc(${size}, "from child|"));
    `);
    const sent = Buffer.alloc(size, "from parent|");
    const written = new Promise(resolve => child.pipe.write(sent, resolve));
    expect((await receive(child.pipe, size)).equals(Buffer.alloc(size, "from child|"))).toBe(true);
    await written;
    child.pipe.end();
    expect(await child.result()).toEqual({ stdout: Bun.SHA1.hash(sent, "hex") + "\n", stderr: "", exitCode: 0 });
  });

  it.each([
    ["net.connect()", `const pipe = require("net").connect({ fd: 3 }); pipe.on("data", chunk => pipe.write(chunk))`],
    [
      "fs streams",
      `fs.createReadStream(null, { fd: 3, autoClose: false }).on("data", chunk => fs.writeSync(3, chunk)).on("error", () => {})`,
    ],
    ["Bun.file(3)", `for await (const chunk of Bun.file(3).stream()) await Bun.write(Bun.file(3), chunk)`],
  ])("answers message by message through %s", async (_, echo) => {
    await using child = start(`import fs from "fs"; ${echo}`);
    for (let i = 0; i < 50; i++) {
      child.pipe.write(`message ${i}`);
      expect(String((await once(child.pipe, "data"))[0])).toBe(`message ${i}`);
    }
    child.pipe.end();
    expect(await child.result()).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it.each([
    ["exits", "process.exit(0)"],
    ["closes it", "fs.closeSync(3); setInterval(() => {}, 1e6)"],
    ["is killed", "process.kill(process.pid, 'SIGKILL')"],
  ])("still gives what the child wrote before it %s, then ends", async (_, leave) => {
    await using child = start(`const fs = require("fs"); fs.writeSync(3, Buffer.alloc(8000, "x")); ${leave}`);
    expect(Buffer.concat(await Array.fromAsync(child.pipe)).toString()).toBe(Buffer.alloc(8000, "x").toString());
  });
});

describe.concurrent("writes to a child's stdin that have to wait", () => {
  const megabyte = 1024 * 1024;
  // Reads nothing until it is told to, over IPC.
  function start(onMessage) {
    const child = spawn(
      bunExe(),
      ["-e", `process.once("message", () => { process.disconnect(); ${onMessage} }); console.log("ready");`],
      { env: bunEnv, stdio: ["pipe", "pipe", "inherit", "ipc"] },
    );
    child.stdout.setEncoding("utf8");
    child[Symbol.asyncDispose] = async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGKILL");
      await once(child, "exit");
    };
    return child;
  }
  const rest = async child => (await Array.fromAsync(child.stdout)).join("");
  const count = `let n = 0; process.stdin.on("data", chunk => (n += chunk.length)).on("end", () => console.log(n));`;

  it("arrive in order, and their callbacks run in order", async () => {
    await using child = start(`Bun.stdin.bytes().then(bytes => console.log(Bun.SHA1.hash(bytes, "hex")))`);
    await once(child.stdout, "data");
    const chunks = Array.from({ length: 8 }, (_, i) => Buffer.alloc(i % 2 ? 3 : megabyte / 2, `${i}|`));
    const order = [];
    chunks.forEach((chunk, i) => child.stdin.write(chunk, error => order.push(error ?? i)));
    child.stdin.end();
    child.send("read");
    expect(await rest(child)).toBe(Bun.SHA1.hash(Buffer.concat(chunks), "hex") + "\n");
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  // On Windows the callback runs at once, with null.
  it.todoIf(isWindows).each([
    ["is killed", child => child.kill("SIGKILL")],
    ["exits", child => child.send("exit")],
  ])("fail once when the child %s", async (_, leave) => {
    await using child = start("process.exit(0)");
    await once(child.stdout, "data");
    const errors = [];
    child.stdin.on("error", error => errors.push(error.code));
    const { promise, resolve } = Promise.withResolvers();
    child.stdin.write(Buffer.alloc(4 * megabyte), resolve);
    const closed = once(child, "close");
    leave(child);
    expect(await promise).toBeInstanceOf(Error);
    await closed;
    expect(errors.length).toBeLessThanOrEqual(1);
    expect(child.stdin.destroyed).toBe(true);
  });

  it("do not keep the child from seeing the end after destroy()", async () => {
    await using child = start(count);
    await once(child.stdout, "data");
    child.stdin.on("error", () => {});
    child.stdin.write(Buffer.alloc(4 * megabyte));
    child.stdin.destroy();
    child.send("read");
    expect(await rest(child)).toMatch(/^\d+\n$/);
  });

  it("are all delivered by end() before the child sees the end", async () => {
    await using child = start(count);
    await once(child.stdout, "data");
    child.stdin.end(Buffer.alloc(4 * megabyte));
    child.send("read");
    expect(await rest(child)).toBe(`${4 * megabyte}\n`);
  });

  it.each(["process.exit(0)", "child.kill()", "child.stdin.end(); child.kill()"])(
    "do not keep the parent from ending with %s",
    async leave => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 20_000)"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
           process.on("exit", () => child.kill());
           Promise.resolve(child.stdin.write(Buffer.alloc(${4 * megabyte}))).catch(() => {});
           process.on("unhandledRejection", () => {});
           setImmediate(() => { console.log("leaving"); ${leave}; });`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: "leaving\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );
});

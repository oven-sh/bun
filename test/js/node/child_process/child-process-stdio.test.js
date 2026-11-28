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

describe.concurrent("extra stdio pipe at fd 3", () => {
  function spawnChild(script) {
    const child = spawn(bunExe(), ["-e", script], { env: bunEnv, stdio: ["ignore", "pipe", "pipe", "pipe"] });
    const readText = async stream => Buffer.concat(await Array.fromAsync(stream)).toString();
    const finished = Promise.all([readText(child.stdout), readText(child.stderr), once(child, "exit")]);
    return {
      pipe: child.stdio[3],
      result: () => finished.then(([stdout, stderr, [exitCode]]) => ({ stdout, stderr, exitCode })),
      async [Symbol.asyncDispose]() {
        child.stdio[3].destroy();
        child.kill();
        await finished;
      },
    };
  }
  function readBytes(stream, remaining) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const chunks = [];
    stream.on("data", chunk => {
      chunks.push(chunk);
      if ((remaining -= chunk.length) <= 0) resolve(Buffer.concat(chunks));
    });
    stream.on("error", reject).on("close", () => reject(new Error(`closed with ${remaining} bytes remaining`)));
    return promise;
  }

  it("transfers data in both directions concurrently", async () => {
    const size = 2 * 1024 * 1024;
    await using child = spawnChild(`
      const pipe = require("net").connect({ fd: 3 });
      const hash = new Bun.CryptoHasher("sha1");
      let remaining = ${size};
      pipe.on("data", chunk => {
        hash.update(chunk);
        if ((remaining -= chunk.length) === 0) console.log(hash.digest("hex"));
      });
      pipe.write(Buffer.alloc(${size}, "from child|"));
    `);
    const payload = Buffer.alloc(size, "from parent|");
    const written = new Promise(resolve => child.pipe.write(payload, resolve));
    expect((await readBytes(child.pipe, size)).equals(Buffer.alloc(size, "from child|"))).toBe(true);
    await written;
    child.pipe.end();
    expect(await child.result()).toEqual({ stdout: Bun.SHA1.hash(payload, "hex") + "\n", stderr: "", exitCode: 0 });
  });

  it.each([
    ["net.connect()", `const pipe = require("net").connect({ fd: 3 }); pipe.on("data", chunk => pipe.write(chunk))`],
    [
      "fs streams",
      `fs.createReadStream(null, { fd: 3, autoClose: false }).on("data", chunk => fs.writeSync(3, chunk)).on("error", () => {})`,
    ],
    ["Bun.file(3)", `for await (const chunk of Bun.file(3).stream()) await Bun.write(Bun.file(3), chunk)`],
  ])("echoes each message through %s", async (_, echoScript) => {
    await using child = spawnChild(`import fs from "fs"; ${echoScript}`);
    for (let i = 0; i < 50; i++) {
      child.pipe.write(`message ${i}`);
      expect(String((await once(child.pipe, "data"))[0])).toBe(`message ${i}`);
    }
    child.pipe.end();
    expect(await child.result()).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it.each([
    ["exits", "process.exit(0)"],
    ["closes the fd", "fs.closeSync(3); setInterval(() => {}, 1e6)"],
    ["is killed", "process.kill(process.pid, 'SIGKILL')"],
  ])("delivers buffered data and EOF after the child %s", async (_, closeScript) => {
    await using child = spawnChild(
      `const fs = require("fs"); fs.writeSync(3, Buffer.alloc(8000, "x")); ${closeScript}`,
    );
    expect(Buffer.concat(await Array.fromAsync(child.pipe)).toString()).toBe(Buffer.alloc(8000, "x").toString());
  });
});

describe.concurrent.skipIf(!isWindows)("child output written while the parent's event loop is blocked", () => {
  it.each([
    ["is fully read before 'exit'", 1, 20_000, 100_000, 1, `child.on("exit", report)`],
    ["is fully read when a write to the same pipe fails", 3, 1, 60_000, 4_000_000, `output.on("close", report)`],
  ])("%s", async (_, fd, firstWriteSize, lastWriteSize, parentWriteSize, reportScript) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { OpenProcess, WaitForSingleObject } = require("bun:ffi").dlopen("kernel32.dll", {
           OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
           WaitForSingleObject: { args: ["ptr", "u32"], returns: "u32" },
         }).symbols;
         const SYNCHRONIZE = 0x100000;
         const child = child_process.spawn(process.execPath, ["-e", process.argv[1]], { stdio: ["ignore", "pipe", "inherit", "pipe"] });
         const output = child.stdio[${fd}];
         const report = () => console.log(waitResult, bytesRead);
         let bytesRead = 0;
         let waitResult;
         child.stdio[3].on("error", () => {});
         output.on("data", chunk => {
           if ((bytesRead += chunk.length) !== ${firstWriteSize}) return;
           setImmediate(() => {
             child.stdio[3].write(Buffer.alloc(${parentWriteSize}));
             waitResult = WaitForSingleObject(OpenProcess(SYNCHRONIZE, 0, child.pid), 3000);
           });
         });
         ${reportScript};`,
        `fs.writeSync(${fd}, Buffer.alloc(${firstWriteSize})); fs.readSync(3, Buffer.alloc(1)); fs.writeSync(${fd}, Buffer.alloc(${lastWriteSize}));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `0 ${firstWriteSize + lastWriteSize}\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.concurrent.skipIf(!isWindows)("large write completes while the writer's event loop is blocked", () => {
  const size = 12 * 1024 * 1024;
  const readStdinScript = `for (let n = 0, chunk = Buffer.alloc(65536); n < ${size}; ) n += fs.readSync(0, chunk);`;
  it.each([
    ["stdin.write()", `(child = child_process.spawn(cmd[0], cmd.slice(1))).stdin.write(bytes)`, readStdinScript],
    ["Buffer as stdin", `child = Bun.spawn(cmd, { stdin: bytes })`, readStdinScript],
    [
      "send()",
      `(child = Bun.spawn(cmd, { ipc() {}, serialization: "json" })).send(bytes.toString())`,
      `process.on("message", () => process.exit())`,
    ],
  ])("%s", async (_, writeScript, readScript) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { OpenProcess, WaitForSingleObject } = require("bun:ffi").dlopen("kernel32.dll", {
           OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
           WaitForSingleObject: { args: ["ptr", "u32"], returns: "u32" },
         }).symbols;
         const SYNCHRONIZE = 0x100000;
         const cmd = [process.execPath, "-e", process.argv[1]];
         const bytes = Buffer.alloc(${size}, "x");
         let child;
         ${writeScript};
         console.log(WaitForSingleObject(OpenProcess(SYNCHRONIZE, 0, child.pid), 30_000));
         child.kill();`,
        readScript,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
  });
});

describe.concurrent("pending writes to a child's stdin", () => {
  const megabyte = 1024 * 1024;
  // The child does not read stdin until it receives an IPC message.
  function spawnChild(onMessageScript) {
    const child = spawn(
      bunExe(),
      ["-e", `process.once("message", () => { process.disconnect(); ${onMessageScript} }); console.log("ready");`],
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
  const readStdout = async child => (await Array.fromAsync(child.stdout)).join("");
  const countBytesScript = `let n = 0; process.stdin.on("data", chunk => (n += chunk.length)).on("end", () => console.log(n));`;

  it("are delivered in order and call back in order", async () => {
    await using child = spawnChild(`Bun.stdin.bytes().then(bytes => console.log(Bun.SHA1.hash(bytes, "hex")))`);
    await once(child.stdout, "data");
    const chunks = Array.from({ length: 8 }, (_, i) => Buffer.alloc(i % 2 ? 3 : megabyte / 2, `${i}|`));
    const order = [];
    chunks.forEach((chunk, i) => child.stdin.write(chunk, error => order.push(error ?? i)));
    child.stdin.end();
    child.send("read");
    expect(await readStdout(child)).toBe(Bun.SHA1.hash(Buffer.concat(chunks), "hex") + "\n");
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it.todoIf(isWindows).each([
    ["is killed", child => child.kill("SIGKILL")],
    ["exits", child => child.send("exit")],
  ])("fail with at most one 'error' event when the child %s", async (_, stopChild) => {
    await using child = spawnChild("process.exit(0)");
    await once(child.stdout, "data");
    const errors = [];
    child.stdin.on("error", error => errors.push(error.code));
    const { promise, resolve } = Promise.withResolvers();
    child.stdin.write(Buffer.alloc(4 * megabyte), resolve);
    const closed = once(child, "close");
    stopChild(child);
    expect(await promise).toBeInstanceOf(Error);
    await closed;
    expect(errors.length).toBeLessThanOrEqual(1);
    expect(child.stdin.destroyed).toBe(true);
  });

  it("do not block EOF after destroy()", async () => {
    await using child = spawnChild(countBytesScript);
    await once(child.stdout, "data");
    child.stdin.on("error", () => {});
    child.stdin.write(Buffer.alloc(4 * megabyte));
    child.stdin.destroy();
    child.send("read");
    expect(await readStdout(child)).toMatch(/^\d+\n$/);
  });

  it("are flushed by end() before EOF", async () => {
    await using child = spawnChild(countBytesScript);
    await once(child.stdout, "data");
    child.stdin.end(Buffer.alloc(4 * megabyte));
    child.send("read");
    expect(await readStdout(child)).toBe(`${4 * megabyte}\n`);
  });

  it.each(["process.exit(0)", "child.kill()", "child.stdin.end(); child.kill()"])(
    "do not prevent the parent from exiting after %s",
    async exitScript => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 20_000)"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
           process.on("exit", () => child.kill());
           Promise.resolve(child.stdin.write(Buffer.alloc(${4 * megabyte}))).catch(() => {});
           process.on("unhandledRejection", () => {});
           setImmediate(() => { console.log("exiting"); ${exitScript}; });`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: "exiting\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );
});

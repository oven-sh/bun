import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isDebug, isLinux, isWindows, tempDir } from "harness";
import path from "path";

// The receiver rejects a JSON line that's longer than the UTF-8 encoding of a max-length string can be.
// BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT lowers the max string length.
const maxStringLength = 64 * 1024;
const lowLimitEnv = { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(maxStringLength) };

// Sender code that writes 1 MiB of "a" without a newline, which is over the lowered limit.
// It exits with 1 if the receiver accepted all of it.
const flood = `
  const chunk = Buffer.alloc(65536, "a");
  for (let i = 0; i < 16; i++) write(chunk);
  process.exit(1);
`;

/**
 * Runs `senderSource` as the child of a process that receives IPC messages under the lowered
 * limit. The sender can call `write(bytes)` to put raw bytes on the channel and `send(message)`
 * to send one JSON message. It exits with 42 once the receiver closes the channel.
 */
async function runReceiver(serialization: "json" | "advanced", senderSource: string, disconnectAfter = 0) {
  using dir = tempDir("ipc-receive-limit", {
    "receiver.js": `
      let received = 0;
      const sender = Bun.spawn({
        cmd: [process.execPath, "sender.js"],
        env: { ...process.env, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: undefined },
        stdio: ["ignore", "inherit", "inherit"],
        serialization: ${JSON.stringify(serialization)},
        ipc(message, subprocess) {
          console.log("MESSAGE", typeof message === "string" ? "string of " + message.length : JSON.stringify(message));
          // The sender waits for the channel to close, so disconnect once every expected
          // message has arrived.
          if (++received === ${disconnectAfter}) subprocess.disconnect();
        },
      });
      console.log("SENDER_EXIT", await sender.exited);
    `,
    "sender.js": `
      const { writeSync } = require("fs");
      const retry = new Int32Array(new SharedArrayBuffer(4));
      // When the receiver closes the channel, an in-flight write fails with EPIPE, ECONNRESET
      // or ENOTCONN (macOS checks the connection first).
      const closed = new Set(["EPIPE", "ECONNRESET", "ENOTCONN"]);
      function write(bytes) {
        for (let offset = 0; offset < bytes.length; ) {
          try {
            offset += writeSync(3, bytes, offset);
          } catch (e) {
            if (closed.has(e.code)) process.exit(42);
            if (e.code !== "EAGAIN") throw e;
            Atomics.wait(retry, 0, 0, 1);
          }
        }
      }
      function send(message) {
        process.send(message);
      }
      process.on("disconnect", () => process.exit(42));
      ${senderSource}
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "receiver.js"],
    env: lowLimitEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.split("\n").filter(Boolean), stderr, exitCode };
}

describe.each(["advanced", "json"])("ipc mode %s", mode => {
  it("the subprocess should be defined and the child should send", done => {
    gcTick();
    const returned_subprocess = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js")], {
      ipc: (message, subProcess) => {
        expect(subProcess).toBe(returned_subprocess);
        expect(message).toBe("hello");
        subProcess.kill();
        done();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });
  });

  it("the subprocess should receive the parent message and respond back", done => {
    gcTick();

    const parentMessage = "I am your father";
    const childProc = spawn([bunExe(), path.join(__dirname, "bun-ipc-child-respond.js")], {
      ipc: (message, subProcess) => {
        expect(message).toBe(`pong:${parentMessage}`);
        subProcess.kill();
        done();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });

    childProc.send(parentMessage);
    gcTick();
  });

  it("ipc works when preceded by a non-pipe extra stdio slot", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    await using child = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js")], {
      env: bunEnv,
      stdio: ["inherit", "inherit", "inherit", "ignore"],
      serialization: mode,
      ipc: message => resolve(message),
    });
    child.exited.then(code => reject(new Error(`exited ${code} before message`)));
    expect(await promise).toBe("hello");
  });

  it("delivers the outer message when a getter run during send enqueues more sends", async () => {
    const childSource = [
      `const fill = Buffer.alloc(8192, "x").toString();`,
      `const obj = {`,
      `  get inner() {`,
      `    for (let i = 0; i < 32; i++) process.send({ nested: i, fill });`,
      `    return "outer";`,
      `  },`,
      `};`,
      `process.send(obj);`,
      `process.on("message", () => {});`,
    ].join("\n");
    const { promise, resolve, reject } = Promise.withResolvers<any[]>();
    const messages: any[] = [];
    await using child = spawn([bunExe(), "-e", childSource], {
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization: mode,
      ipc(message) {
        messages.push(message);
        if (messages.length === 33) resolve(messages);
      },
      onExit(_subprocess, exitCode, signalCode) {
        reject(new Error(`child exited (${exitCode}, ${signalCode}) after ${messages.length} messages`));
      },
    });
    const received = await promise;
    expect(received.filter(message => "inner" in message)).toEqual([{ inner: "outer" }]);
    expect(
      received
        .filter(message => "nested" in message)
        .map(message => message.nested)
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it("a message the serializer rejects throws from send() and leaves the channel usable", async () => {
    // JSON.stringify rejects cycles; structured clone rejects functions. Both
    // surface from the native serializer as a pending exception that send()
    // must rethrow without having written anything to the channel.
    const rejected =
      mode === "json" ? `const rejected = {}; rejected.self = rejected;` : `const rejected = { callback() {} };`;
    const childSource = [
      rejected,
      `let thrown = null;`,
      `try {`,
      `  process.send(rejected);`,
      `} catch (error) {`,
      `  thrown = { name: error.name, message: error.message };`,
      `}`,
      `process.send({ thrown });`,
      `process.on("message", () => {});`,
    ].join("\n");
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    await using child = spawn([bunExe(), "-e", childSource], {
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization: mode,
      ipc: message => resolve(message),
      onExit(_subprocess, exitCode, signalCode) {
        reject(new Error(`child exited (${exitCode}, ${signalCode}) before a message arrived`));
      },
    });
    expect(await promise).toEqual({
      thrown:
        mode === "json"
          ? { name: "TypeError", message: "JSON.stringify cannot serialize cyclic structures." }
          : { name: "DataCloneError", message: "The object can not be cloned." },
    });
  });
});

describe("ipc mode json", () => {
  it.skipIf(isWindows)("closes the channel on a line that holds only the internal tag byte", async () => {
    // An internal JSON message is "\\x02" + json + "\\n". A line of just the tag
    // byte strips to an empty payload. The receiver must treat it like an empty
    // line (invalid, close the channel) instead of building an external string
    // over a zero-length slice.
    //
    // The receiver runs in its own subprocess so a crash shows up as a failing
    // assertion here rather than taking out the test runner.
    const parent = `
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          'process.on("disconnect", () => process.exit(42)); require("fs").writeSync(3, "\\\\x02\\\\n");',
        ],
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "json",
        ipc(msg) { console.error("UNEXPECTED_IPC_MESSAGE", msg); },
      });
      console.log("CHILD_EXIT", await child.exited);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parent],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("CHILD_EXIT 42");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it.concurrent.skipIf(isWindows)("closes the channel when an unterminated line exceeds the length limit", async () => {
    // The complete lines are delivered. The bytes after them are never terminated by a newline.
    expect(await runReceiver("json", `write(Buffer.from('{"n":1}\\n{"n":2}\\n'));` + flood)).toEqual({
      stdout: ['MESSAGE {"n":1}', 'MESSAGE {"n":2}', "SENDER_EXIT 42"],
      stderr: "IPC message is too long.\n",
      exitCode: 0,
    });
  });

  it.concurrent("delivers a message as long as the max string length", async () => {
    const sender = `send("\u4e2d".repeat(${maxStringLength - 2})); send({ after: true });`;
    expect(await runReceiver("json", sender, 2)).toEqual({
      stdout: [`MESSAGE string of ${maxStringLength - 2}`, 'MESSAGE {"after":true}', "SENDER_EXIT 42"],
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("ipc mode advanced", () => {
  it("unwraps the Buffer envelope before cmd dispatch", async () => {
    // A cmd-bearing message whose payload holds a Buffer travels as the
    // [message, buffers] envelope. The receiver's cmd fast-path reads
    // message.cmd straight off the decoded value, so the envelope must be
    // restored first — otherwise the fast-get sees an array (no cmd), the
    // NODE_HANDLE interception is skipped, and user listeners receive the
    // raw envelope instead of the message.
    const childSource = [
      // A non-NODE cmd goes through the same fast-get, then to the user.
      `process.send({ cmd: "USER_CMD", payload: Buffer.from("through-dispatch") });`,
      // A NODE_HANDLE cmd (no fd attached) must be intercepted, NACKed and
      // withheld from user listeners — proving cmd was readable post-restore.
      `process.send({ cmd: "NODE_HANDLE", type: "net.Socket", msg: { buf: Buffer.from("hidden") } });`,
      `process.send({ done: true });`,
      `process.on("message", () => {});`,
    ].join("\n");
    const { promise, resolve, reject } = Promise.withResolvers<any[]>();
    const messages: any[] = [];
    await using child = spawn([bunExe(), "-e", childSource], {
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "advanced",
      ipc(message) {
        messages.push(message);
        if (message?.done) resolve(messages);
      },
      onExit(_subprocess, exitCode, signalCode) {
        reject(new Error(`child exited (${exitCode}, ${signalCode}) after ${messages.length} messages`));
      },
    });
    const received = await promise;
    const userCmd = received.filter(message => message?.cmd === "USER_CMD");
    expect(userCmd).toHaveLength(1);
    expect(Buffer.isBuffer(userCmd[0].payload)).toBe(true);
    expect(userCmd[0].payload.toString()).toBe("through-dispatch");
    // The NODE_HANDLE message is protocol traffic, not a user message.
    expect(received.filter(message => message?.cmd === "NODE_HANDLE")).toHaveLength(0);
    // And no raw [message, buffers] envelope may leak through.
    expect(received.filter(message => Array.isArray(message))).toHaveLength(0);
  });

  it("a message_len that overflows header_length + message_len does not crash the receiver", async () => {
    // The advanced IPC framing is [u8 type][u32-le length][payload]. Decoding previously
    // checked `data.len < header_length + message_len`, which is u32 arithmetic: a child
    // sending length 0xFFFFFFFB makes the sum wrap to 0, the guard passes, and the receiver
    // slices `data[5..0]` (length ~SIZE_MAX) straight into the deserializer.
    //
    // Run the receiver in its own subprocess so a crash is observed as a failing
    // assertion here rather than taking out the test runner.
    // prettier-ignore
    const parent = `
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          // type = SerializedMessage (0x02), length = 0xFFFFFFFB (little-endian).
          // header_length (5) + 0xFFFFFFFB wraps to 0 in u32.
          'require("fs").writeSync(3, Buffer.from([0x02, 0xfb, 0xff, 0xff, 0xff]))',
        ],
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "advanced",
        ipc(msg) { console.error("UNEXPECTED_IPC_MESSAGE", msg); },
      });
      await child.exited;
      console.log("PARENT_OK");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parent],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("PARENT_OK");
    expect(stderr).not.toContain("UNEXPECTED_IPC_MESSAGE");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)("rejects a Buffer envelope whose buffer list holds a non-Uint8Array view", async () => {
    // Frame type 4 carries a [message, buffers] envelope and the receiver puts
    // Buffer.prototype on every entry of `buffers`. Only Uint8Arrays may be
    // there: a Float64Array with that prototype reads as a Buffer whose
    // methods index the wrong element size. The peer controls the envelope,
    // so the receiver must check each entry and reject the frame.
    const parent = `
      const { types } = require("node:util");
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          \`
          const { serialize } = require("bun:jsc");
          const f = new Float64Array([1.5]);
          const body = serialize([{ b: f }, [f]], { binaryType: "nodebuffer" });
          const head = Buffer.alloc(5);
          head[0] = 4;
          head.writeUInt32LE(body.length, 1);
          process.on("disconnect", () => process.exit(42));
          require("fs").writeSync(3, Buffer.concat([head, body]));
          \`,
        ],
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "advanced",
        ipc(msg, subprocess) {
          // Delivered means the frame was accepted. Report and stop the child,
          // which otherwise waits for a disconnect that never comes.
          console.log("MESSAGE", Buffer.isBuffer(msg.b), types.isUint8Array(msg.b));
          subprocess.kill();
        },
      });
      process.on("uncaughtException", err => console.log("UNCAUGHT", err.message));
      console.log("CHILD_EXIT", await child.exited);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parent],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.split("\n").filter(Boolean)).toEqual([
      "UNCAUGHT failed to parse serialized buffer envelope",
      "CHILD_EXIT 42",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)(
    "closes the channel when a frame declares a length that cannot be framed with its header",
    async () => {
      const parent = `
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          'process.on("disconnect", () => process.exit(42)); require("fs").writeSync(3, Buffer.from([0x02, 0xff, 0xff, 0xff, 0xff]));',
        ],
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "advanced",
        ipc(msg) { console.error("UNEXPECTED_IPC_MESSAGE", msg); },
      });
      console.log("CHILD_EXIT", await child.exited);
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", parent],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("CHILD_EXIT 42");
      expect(stderr).not.toContain("UNEXPECTED_IPC_MESSAGE");
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.skipIf(isWindows)(
    "closes the channel as soon as a frame header declares a length that's too long to deserialize",
    async () => {
      const header = `write(Buffer.from([0x02, 0x01, 0x00, 0x01, 0x00]));`;
      expect(await runReceiver("advanced", header + flood)).toEqual({
        stdout: ["SENDER_EXIT 42"],
        stderr: "",
        exitCode: 0,
      });
    },
  );
});

// The exit can be noticed before the loop has polled the channel: by the waiter thread, or, on macOS, because a process
// that is already gone can't be watched.
describe.skipIf(isWindows).each(["advanced", "json"] as const)("a child's last messages (%s)", serialization => {
  async function run(parent: string, env: Record<string, string> = {}) {
    using dir = tempDir("ipc-last-messages", {
      "parent.js": `
        const { existsSync, readFileSync } = require("fs");
        const { getPriority } = require("os");
        function until(condition) {
          const deadline = Date.now() + 30_000;
          while (!condition()) {
            if (Date.now() > deadline) {
              console.error("30 seconds have passed without " + condition);
              process.exit(1);
            }
            Bun.sleepSync(1);
          }
        }
        const messages = [];
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        const child = {
          cmd: [process.execPath, "child.js"],
          env: { ...process.env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: undefined, BUN_GARBAGE_COLLECTOR_LEVEL: undefined },
          stdin: "ignore",
          stdout: "ignore",
          stderr: "inherit",
          serialization: ${JSON.stringify(serialization)},
          ipc(message, subprocess) {
            messages.push([message, subprocess === proc]);
          },
          onDisconnect,
        };
        ${parent}
        await disconnected;
        console.log(JSON.stringify({ messages, exitCode: await proc.exited, connected: proc.connected }));
      `,
      "child.js": `
        process.send("first");
        process.send({ second: 2 });
        process.send("last");
        require("fs").writeFileSync("sent", String(process.pid));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.split("\n").filter(line => line && !line.startsWith("WARNING: ASAN interferes"))).toEqual([]);
    expect(JSON.parse(stdout)).toEqual({
      messages: [
        ["first", true],
        [{ second: 2 }, true],
        ["last", true],
      ],
      exitCode: 0,
      connected: false,
    });
    expect(exitCode).toBe(0);
  }

  it.skipIf(!isLinux)("arrive if the waiter thread reaps it before the loop turns", async () => {
    await run(
      `
        const proc = Bun.spawn(child);
        const next = Bun.spawn({ cmd: ["cat"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
        const isReaped = ({ pid }) => {
          try {
            return !process.kill(pid, 0);
          } catch {
            return true;
          }
        };
        until(() => isReaped(proc));
        // The thread posts each exit before it waits for the next process.
        next.kill("SIGKILL");
        until(() => isReaped(next));
      `,
      { BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "1" },
    );
  });

  it("arrive if it exits before it is watched", async () => {
    // pull() runs inside of Bun.spawn(), after the process has started. macOS finds no zombie for getpriority() either.
    await run(`
      const isZombie = pid => {
        if (existsSync("/proc/self/stat")) return readFileSync(\`/proc/\${pid}/stat\`, "latin1").includes(") Z ");
        try {
          getPriority(pid);
          return false;
        } catch {
          return true;
        }
      };
      child.stdin = new ReadableStream({
        type: "direct",
        pull(controller) {
          let pid;
          until(() => existsSync("sent") && (pid = Number(readFileSync("sent", "latin1"))));
          until(() => isZombie(pid));
          controller.close();
        },
      });
      const proc = Bun.spawn(child);
    `);
  });
});

// get_ipc_instance error path: on Windows, windows_configure_client can open
// the pipe, mark the socket open, then fail read_start, at which point
// close_socket has queued a deferred task that holds a ref on the SendQueue.
// get_ipc_instance detaches the queue, so the task emits no close event, and
// drops its own ref; the task releases the last one. On POSIX no task is
// queued and that drop frees the queue.
it("child with unusable NODE_CHANNEL_FD tears down IPC without crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.on('error', e => console.log('err', e.code));
        process.send('x');
        setImmediate(() => setImmediate(() => console.log('ok')));
      `,
    ],
    env: {
      ...bunEnv,
      NODE_CHANNEL_FD: "921",
      NODE_CHANNEL_SERIALIZATION_MODE: "json",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("Unable to start IPC");
  expect(stdout).toBe("err ERR_IPC_CHANNEL_CLOSED\nok\n");
  expect(exitCode).toBe(0);
});

it.skipIf(isWindows)("advanced serialization advertises wire format version 2", async () => {
  // The version packet is the first frame on the channel:
  // [type=Version(1), u32 LE version]. Read it raw off fd 3 before the
  // child's own channel machinery starts consuming the socket.
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const fs = require("fs");
      const buf = Buffer.alloc(5);
      let n = 0;
      while (n < 5) {
        try {
          n += fs.readSync(3, buf, n, 5 - n);
        } catch (e) {
          if (e.code !== "EAGAIN") throw e;
        }
      }
      console.log(JSON.stringify([...buf]));`,
    ],
    env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
    serialization: "advanced",
    ipc() {},
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  expect(JSON.parse(stdout.trim())).toEqual([1, 2, 0, 0, 0]);
  expect(exitCode).toBe(0);
});

/** Runs parent.js next to child.js. Both have the helpers below. */
async function runPair(parent: string, child: string, env: Record<string, string> = {}) {
  const helpers = `
    const fs = require("node:fs");
    const net = require("node:net");
    function until(file) {
      const deadline = Date.now() + 30_000;
      while (!fs.existsSync(file)) {
        if (Date.now() > deadline) throw new Error("30 seconds have passed without " + file);
        Bun.sleepSync(1);
      }
    }
    function retry(syscall) {
      for (;;) {
        try {
          return syscall();
        } catch (e) {
          if (e.code !== "EAGAIN") throw e;
          Bun.sleepSync(1);
        }
      }
    }
    function write(bytes) {
      bytes = Buffer.from(bytes);
      for (let offset = 0; offset < bytes.length; ) offset += retry(() => fs.writeSync(3, bytes, offset));
    }
    function advancedFrame(message) {
      const body = Buffer.from(require("bun:jsc").serialize(message));
      const header = Buffer.from([2, 0, 0, 0, 0]);
      header.writeUInt32LE(body.length, 1);
      return Buffer.concat([header, body]);
    }
    const spawnChild = options =>
      Bun.spawn({
        cmd: [process.execPath, "child.js"],
        env: { ...process.env, BUN_JSC_gcMaxHeapSize: undefined },
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "json",
        ipc() {},
        ...options,
      });
    const listen = () => new Promise(resolve => { const server = net.createServer().listen(0, () => resolve(server)); });
    const turn = () => new Promise(resolve => setImmediate(resolve));
    const openFds = () => fs.readdirSync("/proc/self/fd").length;
    // Bun.build() runs the event loop until the setup() of a plugin has settled.
    const runEventLoopUntil = promise =>
      void Bun.build({ entrypoints: ["./empty.js"], plugins: [{ name: "wait", setup: () => promise.then(() => {}) }] });
  `;
  using dir = tempDir("ipc-pair", { "parent.js": helpers + parent, "child.js": helpers + child, "empty.js": "" });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.js"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.split("\n").filter(Boolean), stderr, exitCode };
}

describe.concurrent("the send queue", () => {
  it("does not run a setter on Array.prototype to store a callback", async () => {
    const result = await runPair(
      `
        const server = await listen();
        const child = spawnChild();
        // Nothing follows a handle until it is acked, so the next three are joined.
        child.send("handle", server);
        child.send("a", () => console.log("a"));
        child.send("b", () => console.log("b"));
        Object.defineProperty(Array.prototype, 2, {
          configurable: true,
          set() {
            delete Array.prototype[2];
            console.log("setter");
            for (let i = 0; i < 16; i++) child.send("handle", server);
          },
        });
        child.send("c", () => console.log("c"));
        delete Array.prototype[2];
        child.send("last");
        await child.exited;
        server.close();
      `,
      `
        process.on("message", (message, handle) => {
          handle?.close();
          if (message === "last") process.disconnect();
        });
      `,
    );
    expect(result).toEqual({ stdout: ["a", "b", "c"], stderr: "", exitCode: 0 });
  });

  it.skipIf(isWindows)("writes a long backlog of replies without overflowing the stack", async () => {
    const count = isDebug ? 10_000 : 100_000;
    const result = await runPair(
      `await spawnChild({ ipc: () => fs.writeFileSync("queued", "") }).exited;`,
      `
        // Each announces a handle that does not come, and is answered with a NACK.
        write(Buffer.alloc(${count} * 22, '{"cmd":"NODE_HANDLE"}\\n'));
        write('"last"\\n');
        until("queued");
        const buffer = Buffer.alloc(1 << 20);
        let total = 0;
        for (let n = 1; n && total < ${count} * 27; total += n) n = retry(() => fs.readSync(3, buffer));
        console.log(total / 27);
      `,
    );
    expect(result).toEqual({ stdout: [String(count)], stderr: "", exitCode: 0 });
  });

  // On Windows the handle is still being written at the first disconnect(), which then waits for no ack.
  it.skipIf(isWindows)("is flushed when disconnect() is called again after the ack it waited for", async () => {
    const result = await runPair(
      `
        const server = await listen();
        const child = spawnChild();
        child.send("handle", server, () => {
          child.disconnect();
          fs.writeFileSync("disconnected twice", "");
        });
        child.send(Buffer.alloc(4 << 20, "x").toString());
        child.disconnect();
        await child.exited;
        server.close();
      `,
      `
        process.on("message", (message, handle) => {
          console.log(message.length);
          if (!handle) return;
          handle.close();
          until("disconnected twice");
        });
      `,
    );
    expect(result).toEqual({ stdout: ["6", String(4 << 20)], stderr: "", exitCode: 0 });
  });

  it.skipIf(!isLinux)("releases a handle if the channel closes while its message is serialized", async () => {
    const result = await runPair(
      `
        const server = await listen();
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        const child = spawnChild({ onDisconnect });
        const message = {
          toJSON() {
            child.disconnect();
            runEventLoopUntil(Promise.all([disconnected, child.exited]));
            return "late";
          },
        };
        child.send(message, server);
        const inode = fd => fs.statSync("/proc/self/fd/" + fd, { throwIfNoEntry: false })?.ino;
        console.log(fs.readdirSync("/proc/self/fd").filter(fd => inode(fd) === inode(server._handle.fd)).length);
        server.close();
      `,
      `process.on("message", () => {});`,
    );
    expect(result).toEqual({ stdout: ["1"], stderr: "", exitCode: 0 });
  });
});

describe.concurrent.skipIf(!isLinux)("a received descriptor", () => {
  // The tag byte makes the receiver ignore the message that carries the descriptor, and `line` then claims it.
  const sendDescriptorWith = (line: string) => `
    const server = await listen();
    write("\\x02");
    process.send("ignored", server, () => {
      server.close();
      process.send("last");
    });
    write(${JSON.stringify(line + "\n")});
  `;

  it("is closed once if dgram.Native cannot adopt it", async () => {
    const result = await runPair(
      `
        const { closeSync } = fs;
        let next;
        // What is opened after a close gets the number that was freed.
        fs.closeSync = fd => {
          closeSync(fd);
          next = fs.openSync("/dev/null");
        };
        process.on("uncaughtException", error => console.log(error.message));
        const before = openFds();
        await spawnChild().exited;
        await turn();
        if (next !== undefined) closeSync(next);
        console.log("leaked", openFds() - before);
      `,
      sendDescriptorWith(JSON.stringify({ cmd: "NODE_HANDLE", type: "dgram.Native" })),
    );
    expect(result).toEqual({
      stdout: ["failed to open received dgram handle: -22", "leaked 0"],
      stderr: "",
      exitCode: 0,
    });
  });

  it("is closed by a parent, which has no use for one in a cluster message", async () => {
    const result = await runPair(
      `
        const before = openFds();
        await spawnChild().exited;
        await turn();
        console.log("leaked", openFds() - before);
      `,
      sendDescriptorWith('\x02{"$hasHandle":true}'),
    );
    expect(result).toEqual({ stdout: ["leaked 0"], stderr: "", exitCode: 0 });
  });

  it("is closed once if a worker thread exits in the handler", async () => {
    const result = await runPair(
      `
        const { Worker, isMainThread, workerData } = require("node:worker_threads");
        if (isMainThread) {
          const shared = new Int32Array(new SharedArrayBuffer(8));
          const worker = new Worker(__filename, { workerData: shared });
          await new Promise(resolve => worker.once("message", resolve));
          // Take the number as soon as it is free.
          const deadline = Date.now() + 30_000;
          Atomics.store(shared, 1, 1);
          for (let fd; (fd = fs.openSync("/dev/null")) !== shared[0] && Date.now() < deadline; ) {
            if (fd > shared[0]) fs.closeSync(fd);
          }
          await new Promise(resolve => worker.once("exit", resolve));
          console.log(fs.readlinkSync("/proc/self/fd/" + shared[0]));
        } else {
          spawnChild({
            ipc(message, child, socket) {
              workerData[0] = socket._handle.fd;
              require("node:worker_threads").parentPort.postMessage("");
              while (!Atomics.load(workerData, 1)) Bun.sleepSync(1);
              process.exit();
            },
          });
        }
      `,
      `
        const server = await listen();
        const socket = net.connect(server.address().port, () => process.send("socket", socket));
        process.on("disconnect", () => process.exit());
      `,
    );
    expect(result).toEqual({ stdout: ["/dev/null"], stderr: "", exitCode: 0 });
  });
});

// Linux only: what one write() sends has to arrive in one read.
describe.concurrent.skipIf(!isLinux)("a message handler that runs the event loop", () => {
  it.each([
    ["messages arrive in order", `advancedFrame("m3")`, ["m1", "m2", "m3"]],
    [
      "an undecodable message is reported once",
      `[2, 4, 0, 0, 0, 255, 255, 255, 255]`,
      ["m1", "m2", "Unable to deserialize data."],
    ],
  ])("while messages are buffered: %s", async (_, later, expected) => {
    const result = await runPair(
      `
        process.on("uncaughtException", error => console.log(error.message));
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        spawnChild({
          serialization: "advanced",
          onDisconnect,
          ipc(message) {
            console.log(message);
            if (message === "m0") fs.writeFileSync("one byte is buffered", "");
            if (message !== "m1") return;
            fs.writeFileSync("in the handler", "");
            runEventLoopUntil(disconnected);
          },
        });
      `,
      `
        const bytes = Buffer.concat(["m1", "m2"].map(advancedFrame));
        write(Buffer.concat([advancedFrame("m0"), bytes.subarray(0, 1)]));
        until("one byte is buffered");
        write(bytes.subarray(1));
        until("in the handler");
        write(${later});
      `,
    );
    expect(result).toEqual({ stdout: ["m0", ...expected], stderr: "", exitCode: 0 });
  });

  it.each(["json", "advanced"])("until nothing else keeps the Subprocess: %s", async serialization => {
    const result = await runPair(
      `
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        spawnChild({
          serialization: "${serialization}",
          onDisconnect,
          ipc(message, child) {
            console.log(message.length);
            if (message !== "first") return;
            child.disconnect();
            runEventLoopUntil(Promise.all([disconnected, child.exited]));
          },
        });
        until("written");
      `,
      `
        const frame = "${serialization}" === "json" ? it => Buffer.from(JSON.stringify(it) + "\\n") : advancedFrame;
        // The receiver collects garbage while it decodes the second one.
        write(Buffer.concat(["first", Array.from({ length: 5000 }, (_, i) => ({ i })), "last"].map(frame)));
        fs.writeFileSync("written", "");
      `,
      { BUN_JSC_gcMaxHeapSize: "196608", BUN_JSC_useGenerationalGC: "0", BUN_JSC_useConcurrentGC: "0" },
    );
    expect(result).toEqual({ stdout: ["5", "5000", "4"], stderr: "", exitCode: 0 });
  });
});

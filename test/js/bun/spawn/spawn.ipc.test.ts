import { spawn } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isDebug, isLinux, isWindows, libcPathForDlopen, tempDir } from "harness";
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

describe("every ipc call, then onDisconnect, then exited and onExit", () => {
  async function callsOf(env: { LEAVE: string; MESSAGES: number; BUSY: boolean; CHILDREN: number }) {
    using dir = tempDir("spawn-callback-order", {
      "parent.js": `
        const { readFileSync } = require("node:fs");
        const { LEAVE, MESSAGES, BUSY, CHILDREN } = JSON.parse(process.env.ORDER);
        for (let i = 0; i < CHILDREN; i++) {
          const calls = [];
          let left = 3;
          const done = () => --left || console.log(calls.join(", "));
          const child = Bun.spawn({
            cmd: [process.execPath, "child.js"],
            stdio: ["ignore", "inherit", "inherit"],
            ipc(message) {
              if (message !== "ready") return calls.push("ipc");
              child.send({ leave: LEAVE, messages: MESSAGES });
              // A zombie with one thread left: the channel has ended and the exit has been reported.
              while (BUSY && !/^\\d+ \\(.*\\) Z (?:-?\\d+ ){16}1 /s.test(readFileSync("/proc/" + child.pid + "/stat", "utf8")));
            },
            onDisconnect: () => (calls.push("onDisconnect"), done()),
            onExit: (_, code, signal) => (calls.push("onExit " + (signal ?? code)), done()),
          });
          child.exited.then(() => (calls.push("exited"), done()));
        }`,
      "child.js": `
        process.once("message", ({ leave, messages }) => {
          const go = () => {
            if (leave === "process.disconnect()") process.disconnect();
            else if (leave === "process.exit()") process.exit(0);
            else process.kill(process.pid, "SIGKILL");
          };
          if (!messages) return go();
          for (let i = 1; i <= messages; i++) process.send(i, i === messages ? go : undefined);
        });
        process.send("ready");`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      cwd: String(dir),
      env: { ...bunEnv, ORDER: JSON.stringify(env) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim().split("\n"), stderr, exitCode };
  }

  const leaves = ["process.disconnect()", "process.exit()", "SIGKILL"];
  it.skipIf(!isLinux).concurrent.each(leaves.flatMap(leave => [[leave, 2] as const, [leave, 0] as const]))(
    "when a busy parent finds them all waiting: %s after %d unread messages",
    async (LEAVE, MESSAGES) => {
      expect(await callsOf({ LEAVE, MESSAGES, BUSY: true, CHILDREN: 1 })).toEqual({
        stdout: [
          `${Buffer.alloc(5 * MESSAGES, "ipc, ")}onDisconnect, exited, onExit ${LEAVE === "SIGKILL" ? LEAVE : 0}`,
        ],
        stderr: "",
        exitCode: 0,
      });
    },
  );

  it.concurrent("when children of an idle parent exit right after their last message", async () => {
    const result = await callsOf({ LEAVE: "process.exit()", MESSAGES: 1, BUSY: false, CHILDREN: 8 });
    // An exit that another thread waited for is a task, which runs microtasks at its end.
    result.stdout = result.stdout.map(line => line.replace("onExit 0, exited", "exited, onExit 0"));
    expect(result).toEqual({
      stdout: Array(8).fill("ipc, onDisconnect, exited, onExit 0"),
      stderr: "",
      exitCode: 0,
    });
  });
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

// The peer hand-rolls the sendmsg(2) so it can attach three descriptors to one
// NODE_HANDLE message, which neither Bun nor libuv ever do. The receiver (this
// test process) has to use the first one and close the others. The peer keeps
// the far ends of the two extras, so EOF on those proves we closed our copies.
const scmRightsPeerSource = `
const { dlopen, FFIType, ptr } = require("bun:ffi");
const isDarwin = process.platform === "darwin";
const libc = dlopen(process.env.LIBC_PATH, {
  socket: { args: [FFIType.int, FFIType.int, FFIType.int], returns: FFIType.int },
  socketpair: { args: [FFIType.int, FFIType.int, FFIType.int, FFIType.ptr], returns: FFIType.int },
  sendmsg: { args: [FFIType.int, FFIType.ptr, FFIType.int], returns: FFIType.i64_fast },
  recv: { args: [FFIType.int, FFIType.ptr, FFIType.u64, FFIType.int], returns: FFIType.i64_fast },
  close: { args: [FFIType.int], returns: FFIType.int },
});
const AF_UNIX = 1, AF_INET = 2, SOCK_STREAM = 1, SOCK_DGRAM = 2;
const SOL_SOCKET = isDarwin ? 0xffff : 1;
const SCM_RIGHTS = 1;
const MSG_DONTWAIT = isDarwin ? 0x80 : 0x40;

function socketpair() {
  const fds = new Int32Array(2);
  if (libc.symbols.socketpair(AF_UNIX, SOCK_STREAM, 0, fds) !== 0) throw new Error("socketpair() failed");
  return fds;
}

// fds[0] is the handle the message describes; the receiver must close the rest.
const udp = libc.symbols.socket(AF_INET, SOCK_DGRAM, 0);
if (udp < 0) throw new Error("socket() failed");
const [extraA, keptA] = socketpair();
const [extraB, keptB] = socketpair();
const fds = [udp, extraA, extraB];

const payload = Buffer.from(JSON.stringify({ cmd: "NODE_HANDLE", type: "dgram.Native", msg: { hello: "handle" } }) + "\\n");

// struct cmsghdr: Linux { size_t len; int level; int type; } (data 8-aligned),
// Darwin { socklen_t len; int level; int type; } (data 4-aligned). Both are
// little-endian, so 32-bit writes into a zeroed buffer fill the wider fields too.
const cmsgHeader = isDarwin ? 12 : 16;
const cmsgAlign = isDarwin ? 4 : 8;
const cmsgLen = cmsgHeader + 4 * fds.length;
const cmsgSpace = cmsgHeader + Math.ceil((4 * fds.length) / cmsgAlign) * cmsgAlign;
const control = new Uint8Array(cmsgSpace);
const controlView = new DataView(control.buffer);
controlView.setUint32(0, cmsgLen, true);
controlView.setInt32(isDarwin ? 4 : 8, SOL_SOCKET, true);
controlView.setInt32(isDarwin ? 8 : 12, SCM_RIGHTS, true);
fds.forEach((fd, i) => controlView.setInt32(cmsgHeader + 4 * i, fd, true));

// struct iovec { void *base; size_t len; } is the same on both.
const iov = new Uint8Array(16);
const iovView = new DataView(iov.buffer);
iovView.setBigUint64(0, BigInt(ptr(payload)), true);
iovView.setUint32(8, payload.byteLength, true);

// struct msghdr: name @0, namelen @8, iov @16, iovlen @24 (size_t on Linux, int
// on Darwin), control @32, controllen @40 (size_t on Linux, socklen_t on Darwin
// followed by flags @44), flags @48 on Linux. Zeroed buffer, so the narrower
// Darwin fields and the padding come out right from the same 32-bit writes.
const msg = new Uint8Array(56);
const msgView = new DataView(msg.buffer);
msgView.setBigUint64(16, BigInt(ptr(iov)), true);
msgView.setUint32(24, 1, true);
msgView.setBigUint64(32, BigInt(ptr(control)), true);
msgView.setUint32(40, control.byteLength, true);

// Bun put the IPC channel on fd 3 (no other extra stdio).
const sent = libc.symbols.sendmsg(3, msg, 0);
if (sent !== payload.byteLength) throw new Error("sendmsg() returned " + sent);
// Drop our copies: from here on only the receiver keeps extraA/extraB open, so
// EOF on keptA/keptB means the receiver closed them.
for (const fd of fds) libc.symbols.close(fd);

// Nothing is ever written on these pairs, so recv() is 0 (EOF) once every copy
// of the far end is closed and -1 (EAGAIN) while the receiver still holds one.
process.on("message", () => {
  const probe = new Uint8Array(1);
  const state = fd => (libc.symbols.recv(fd, probe, 1, MSG_DONTWAIT) === 0 ? "closed" : "open");
  process.send({ extras: [state(keptA), state(keptB)] });
});
`;

it.skipIf(isWindows)(
  "a NODE_HANDLE message carrying several descriptors delivers the first and closes the rest",
  async () => {
    using dir = tempDir("ipc-scm-rights", { "peer.js": scmRightsPeerSource });
    const { promise, resolve, reject } = Promise.withResolvers<{ message: unknown; handle: any; peer: unknown }>();
    let first: { message: unknown; handle: any } | undefined;
    await using child = spawn({
      cmd: [bunExe(), "peer.js"],
      cwd: String(dir),
      env: { ...bunEnv, LIBC_PATH: libcPathForDlopen() },
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "json",
      ipc(message, subprocess, handle) {
        if (!first) {
          first = { message, handle };
          // By the time the handle reaches us the receive path has already dealt
          // with the other descriptors, so the peer can check its ends now.
          subprocess.send("probe");
        } else {
          resolve({ ...first, peer: message });
        }
      },
      onExit(_subprocess, exitCode, signalCode) {
        reject(new Error(`peer exited (${exitCode}, ${signalCode}) before reporting`));
      },
    });
    const { message, handle, peer } = await promise;

    // `handle` is the dgram wrap Bun built around the first descriptor, so
    // handle.fd is that descriptor as received into this process.
    const F_GETFD = 1;
    const FD_CLOEXEC = 1;
    const libc = dlopen(libcPathForDlopen(), { fcntl: { args: ["int", "int"], returns: "int" } });
    const fdFlags = libc.symbols.fcntl(handle.fd, F_GETFD);
    libc.close();
    handle.close();

    // A failed fcntl() returns -1, and -1 & FD_CLOEXEC would read as the flag being set.
    expect(fdFlags).toBeGreaterThanOrEqual(0);
    expect({ message, peer, cloexec: fdFlags & FD_CLOEXEC }).toEqual({
      message: { hello: "handle" },
      peer: { extras: ["closed", "closed"] },
      cloexec: FD_CLOEXEC,
    });
  },
);

/** Runs parent.js next to child.js. Both have the helpers below. */
async function runPair(parent: string, child: string, env: Record<string, string> = {}, prelude = "") {
  const helpers = `
    const fs = require("node:fs");
    // So that a child does not outlive a test that timed out.
    const deadline = Date.now() + 120_000;
    function until(file) {
      while (!fs.existsSync(file)) {
        if (Date.now() > deadline) throw new Error("gave up waiting for " + file);
        Bun.sleepSync(1);
      }
    }
    function retry(syscall) {
      for (;;) {
        try {
          return syscall();
        } catch (e) {
          if (e.code !== "EAGAIN" || Date.now() > deadline) throw e;
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
        onExit: (_, code, signal) => void (code === 0 || console.log("child failed", code, signal)),
        ...options,
      });
    const listen = () =>
      new Promise((resolve, reject) => {
        const server = require("node:net").createServer().once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve(server));
      });
    const turn = () => new Promise(resolve => setImmediate(resolve));
    const openFds = () => fs.readdirSync("/proc/self/fd").length;
  `;
  const nested = parent.includes("runEventLoopUntil")
    ? `const { runEventLoopUntil } = require("bun:internal-for-testing");`
    : "";
  using dir = tempDir("ipc-pair", {
    "parent.js": prelude + helpers + nested + parent,
    "child.js": helpers + child,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-orphans", "parent.js"],
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

  // The child uses descriptor 3 directly. Windows frames what goes through its pipe.
  it.skipIf(isWindows)("writes a long backlog of replies without overflowing the stack", async () => {
    const count = isDebug ? 4_000 : 100_000;
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
        console.log("replies", total / 27);
      `,
    );
    expect(result).toEqual({ stdout: [`replies ${count}`], stderr: "", exitCode: 0 });
  });

  // Linux only: reads /proc/self/fd.
  it.skipIf(!isLinux).each([
    { handle: "server", keepOpen: false, descriptorsLeft: 1 },
    { handle: "socket", keepOpen: true, descriptorsLeft: 1 },
    { handle: "socket", keepOpen: false, descriptorsLeft: 0 },
  ])("releases a $handle (keepOpen: $keepOpen) if the channel closes while its message is serialized", async row => {
    const result = await runPair(
      `
        const server = await listen();
        const socket = require("node:net").connect(server.address().port, "127.0.0.1");
        await require("node:events").once(socket, "connect");
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        const child = spawnChild({ onDisconnect });
        const message = {
          toJSON() {
            child.disconnect();
            runEventLoopUntil(Promise.all([disconnected, child.exited]));
            return "late";
          },
        };
        const inode = fd => fs.statSync("/proc/self/fd/" + fd, { throwIfNoEntry: false })?.ino;
        const sentInode = inode(${row.handle}._handle.fd);
        child.send(message, ${row.handle}, { keepOpen: ${row.keepOpen} });
        await turn();
        console.log("descriptors left", fs.readdirSync("/proc/self/fd").filter(fd => inode(fd) === sentInode).length);
        process.exit(0);
      `,
      `process.on("message", () => {});`,
    );
    expect(result).toEqual({ stdout: [`descriptors left ${row.descriptorsLeft}`], stderr: "", exitCode: 0 });
  });

  it.each(["undefined", "server"])(
    "calls the callback with EPIPE if the channel closes while its message is serialized (handle: %s)",
    async handle => {
      const result = await runPair(
        `
        const server = await listen();
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        const { promise: ready, resolve: ipc } = Promise.withResolvers();
        const child = spawnChild({ ipc, onDisconnect });
        await ready.then(turn);
        const message = {
          toJSON() {
            child.disconnect();
            runEventLoopUntil(Promise.all([disconnected, child.exited]));
            return "late";
          },
        };
        child.send(message, ${handle}, {}, error => console.log(error?.code));
        server.close();
      `,
        `process.on("message", () => {}).send("ready");`,
      );
      expect(result).toEqual({ stdout: ["EPIPE"], stderr: "", exitCode: 0 });
    },
  );

  // Windows has given the child its duplicate by then, so the peer sees no end while the child lives.
  it.skipIf(isWindows).each(["json", "advanced"])(
    "closes a socket whose message the serializer rejects: %s",
    async serialization => {
      const result = await runPair(
        `
        const { once } = require("node:events");
        const server = await listen();
        const socket = require("node:net").connect(server.address().port, "127.0.0.1");
        const [[peer]] = await Promise.all([once(server, "connection"), once(socket, "connect")]);
        try {
          spawnChild({ serialization: "${serialization}" }).send({ get a() { throw new Error("rejected"); } }, socket);
        } catch (error) {
          console.log(error.message);
        }
        await once(peer.resume(), "end");
        console.log("closed");
        process.exit(0);
      `,
        `process.on("message", () => {});`,
      );
      expect(result).toEqual({ stdout: ["rejected", "closed"], stderr: "", exitCode: 0 });
    },
  );

  it("has the same number of GC roots for any number of callbacks", async () => {
    const result = await runPair(
      `
        const roots = () => require("bun:jsc").heapStats().protectedObjectCount;
        const server = await listen();
        const child = spawnChild();
        const called = [];
        child.send("handle", server);
        for (let i = 0; i < 10; i++) child.send(i, () => called.push(i));
        const before = roots();
        for (let i = 10; i < 1000; i++) child.send(i, () => called.push(i));
        console.log("new roots", roots() - before);
        Bun.gc(true);
        child.send("last");
        await child.exited;
        console.log("called", called.length, "in order", called.every((it, i) => it === i));
        server.close();
      `,
      `
        process.on("message", (message, handle) => {
          handle?.close();
          if (message === "last") process.disconnect();
        });
      `,
    );
    expect(result).toEqual({ stdout: ["new roots 0", "called 1000 in order true"], stderr: "", exitCode: 0 });
  });
});

// The child uses descriptor 3 directly.
describe.concurrent.skipIf(isWindows)("a process.nextTick that runs the event loop until the child is gone", () => {
  // Native code calls this one, because nothing has read the original.
  const prelude = `
    let onNextTick;
    process.nextTick = (callback, ...args) => {
      onNextTick?.(callback);
      queueMicrotask(() => callback(...args));
    };
  `;
  const sendAndForget = (send: string) => `
    const sent = () => console.log("sent");
    const { promise: exited, resolve } = Promise.withResolvers();
    // Not resolved with the Subprocess, which the promise would keep.
    const onExit = () => resolve();
    const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
    onNextTick = callback => {
      if (callback !== sent) return;
      fs.writeFileSync("in nextTick", "");
      runEventLoopUntil(gone);
      for (let i = 0; i < 3; i++) Bun.gc(true), runEventLoopUntil(turn());
      console.log("collected garbage");
    };
    disconnected.then(() => console.log("disconnected"));
    ${send}
  `;

  it("when a write completes", async () => {
    const result = await runPair(
      sendAndForget(`
        const gone = Promise.all([exited, disconnected]);
        (() => void spawnChild({ onExit, onDisconnect }).send(Buffer.alloc(1 << 20, "x").toString(), sent))();
        fs.writeFileSync("blocked", "");
      `),
      `
        until("blocked");
        const buffer = Buffer.alloc(1 << 20);
        for (let n = 1, total = 0; n && total < (1 << 20) + 3; total += n) n = retry(() => fs.readSync(3, buffer));
      `,
      {},
      prelude,
    );
    expect(result).toEqual({ stdout: ["disconnected", "collected garbage", "sent"], stderr: "", exitCode: 0 });
  });

  it("when the close is reported", async () => {
    const result = await runPair(
      sendAndForget(`
        const gone = exited;
        const server = await listen();
        (() => void spawnChild({ onExit, onDisconnect }).send("never acked", server, sent))();
        server.close();
      `),
      `
        retry(() => fs.readSync(3, Buffer.alloc(100)));
        fs.closeSync(3);
        until("in nextTick");
      `,
      {},
      prelude,
    );
    expect(result.stdout.sort()).toEqual(["collected garbage", "disconnected", "sent"]);
    expect(result).toMatchObject({ stderr: "", exitCode: 0 });
  });
});

// Linux only: elsewhere the sender does not see that the peer shut down its reading side.
it.skipIf(!isLinux)("the channel closes if the peer refuses a handle and stays", async () => {
  const result = await runPair(
    `
      const server = await listen();
      const child = spawnChild({
        onDisconnect: () => (console.log("disconnect"), server.close(), fs.writeFileSync("done", "")),
      });
      until("shut down");
      child.send("handle", server, error => console.log("callback", error));
    `,
    `
      const libc = require("bun:ffi").dlopen(process.env.LIBC_PATH, { shutdown: { args: ["int", "int"], returns: "int" } });
      if (libc.symbols.shutdown(3, 0) !== 0) throw new Error("shutdown() failed");
      fs.writeFileSync("shut down", "");
      until("done");
    `,
    { LIBC_PATH: libcPathForDlopen() },
  );
  expect(result.stdout.sort()).toEqual(["callback null", "disconnect"]);
  expect(result).toMatchObject({ stderr: "", exitCode: 0 });
});

// Linux only: reads /proc, so that the end of the channel and the exit are found by one poll.
describe.concurrent.skipIf(!isLinux)("a child that is killed with messages it never took", () => {
  const untilZombie = `
    const untilZombie = pid => {
      // With one thread left: the channel has ended and the exit has been reported.
      while (!/^\\d+ \\(.*\\) Z (?:-?\\d+ ){16}1 /s.test(fs.readFileSync("/proc/" + pid + "/stat", "utf8"))) Bun.sleepSync(1);
    };
  `;
  const neverReads = `until("never");`;

  describe.each([
    ["a backlog", `Buffer.alloc(8 << 20, "x").toString(), undefined`],
    ["a handle", `"handle", server`],
  ])("%s", (_, args) => {
    it.each([
      { spawner: "graph", sender: "graph", stdout: ["reaped"] },
      { spawner: "host", sender: "graph", stdout: ["reaped"] },
      { spawner: "graph", sender: "host", stdout: ["called", "reaped"] },
    ])("after dispose() of a Bun.ModuleGraph: $spawner spawned, $sender sent", async ({ spawner, sender, stdout }) => {
      const result = await runPair(
        `
          const server = await listen();
          const graph = new Bun.ModuleGraph();
          const host = { run: fn => fn() };
          const child = ${spawner}.run(() => spawnChild({ onExit() {} }));
          ${sender}.run(() => child.send(${args}, {}, () => console.log("called")));
          process.kill(child.pid, "SIGKILL");
          graph.dispose();
          while (fs.existsSync("/proc/" + child.pid)) await turn();
          await turn();
          server.close();
          console.log("reaped");
        `,
        neverReads,
      );
      expect(result).toEqual({ stdout, stderr: "", exitCode: 0 });
    });

    it("calls the callback in the context of the send()", async () => {
      const result = await runPair(
        `
          const server = await listen();
          const storage = new (require("node:async_hooks").AsyncLocalStorage)();
          const graph = new Bun.ModuleGraph();
          const child = spawnChild({ onExit() {} });
          const sent = () => {
            console.log(storage.getStore());
            // The process ends only if this is the graph's.
            setInterval(() => {}, 1000);
            graph.dispose();
            server.close();
          };
          graph.run(() => storage.run("store", () => child.send(${args}, {}, sent)));
          child.kill("SIGKILL");
        `,
        neverReads,
      );
      expect(result).toEqual({ stdout: ["store"], stderr: "", exitCode: 0 });
    });
  });

  it("closes the socket that a disposed Bun.ModuleGraph sent", async () => {
    const result = await runPair(
      `${untilZombie}
        const { once } = require("node:events");
        const server = await listen();
        const peer = require("node:net").connect(server.address().port, "127.0.0.1");
        const [socket] = await once(server, "connection");
        const graph = new Bun.ModuleGraph();
        const child = graph.run(() => spawnChild({ onDisconnect() {} }));
        graph.run(() => child.send("socket", socket));
        graph.dispose();
        untilZombie(child.pid);
        await once(peer.resume(), "close");
        console.log("closed");
        server.close();
      `,
      neverReads,
    );
    expect(result).toEqual({ stdout: ["closed"], stderr: "", exitCode: 0 });
  });

  it("reports the disconnect and the exit if process.nextTick throws", async () => {
    const result = await runPair(
      `${untilZombie}
        process.on("uncaughtException", error => console.log(error.message));
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
        const handle = Object.assign(Object.create(require("node:net").Server.prototype), { _handle: server });
        const child = spawnChild({
          onDisconnect: () => console.log("disconnect"),
          onExit: () => (console.log("exit"), server.stop()),
        });
        child.send("handle", handle, function sent() {});
        child.kill("SIGKILL");
        untilZombie(child.pid);
      `,
      neverReads,
      {},
      `process.nextTick = (callback, ...args) => {
        if (callback.name === "sent") throw new Error("from nextTick");
        queueMicrotask(() => callback(...args));
      };`,
    );
    expect(result).toEqual({ stdout: ["from nextTick", "disconnect", "exit"], stderr: "", exitCode: 0 });
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

  it("while nothing is buffered: the bytes of another socket are not read as a message", async () => {
    const result = await runPair(
      `
        const { promise: received, resolve: data } = Promise.withResolvers();
        const { port } = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data } });
        const client = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
        spawnChild({
          serialization: "advanced",
          onDisconnect: () => process.exit(0),
          ipc(message) {
            console.log(message);
            if (message !== "m1") return;
            client.write(Buffer.concat(["aa", "zz"].map(advancedFrame)));
            runEventLoopUntil(received);
            fs.writeFileSync("received", "");
          },
        });
      `,
      `
        write(Buffer.concat(["m1", "m2"].map(advancedFrame)));
        until("received");
      `,
    );
    expect(result).toEqual({ stdout: ["m1", "m2"], stderr: "", exitCode: 0 });
  });

  it("while nothing is buffered: messages arrive in order through two nested reads", async () => {
    const result = await runPair(
      `
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        spawnChild({
          serialization: "advanced",
          onDisconnect,
          ipc(message) {
            console.log(message);
            if (message !== "m1" && message !== "m2") return;
            fs.writeFileSync("in " + message, "");
            runEventLoopUntil(disconnected);
          },
        });
      `,
      `
        write(Buffer.concat(["m1", "m2", "m3"].map(advancedFrame)));
        until("in m1");
        write(advancedFrame("m4"));
        until("in m2");
        write(advancedFrame("m5"));
      `,
    );
    expect(result).toEqual({ stdout: ["m1", "m2", "m3", "m4", "m5"], stderr: "", exitCode: 0 });
  });

  it.each(["buffered", "not buffered"])("or script that does while Buffers are restored: %s", async kind => {
    const result = await runPair(
      `
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        const { types } = require("node:util");
        const { isUint8Array } = types;
        types.isUint8Array = value => {
          fs.writeFileSync("restoring", "");
          runEventLoopUntil(disconnected);
          return isUint8Array(value);
        };
        spawnChild({
          serialization: "advanced",
          onDisconnect,
          ipc(message) {
            console.log(String(message));
            if (message === "m0") fs.writeFileSync("got m0", "");
          },
        });
      `,
      `
        const buffer = Buffer.from("m1");
        const envelope = advancedFrame([buffer, [buffer]]);
        envelope[0] = 4;
        const bytes = Buffer.concat([envelope, advancedFrame("m2")]);
        const early = ${kind === "buffered" ? 1 : 0};
        write(Buffer.concat([advancedFrame("m0"), bytes.subarray(0, early)]));
        until("got m0");
        write(bytes.subarray(early));
        until("restoring");
        write(advancedFrame("m3"));
      `,
    );
    // m1 is last, because restoring it waits for the rest.
    expect(result).toEqual({ stdout: ["m0", "m2", "m3", "m1"], stderr: "", exitCode: 0 });
  });

  it.each(["json", "advanced"])("until nothing else keeps the Subprocess: %s", async serialization => {
    const result = await runPair(
      `
        const { promise: disconnected, resolve: onDisconnect } = Promise.withResolvers();
        spawnChild({
          serialization: "${serialization}",
          onDisconnect,
          ipc(message, child) {
            console.log(Array.isArray(message) ? message.length + " objects" : message);
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
    expect(result).toEqual({ stdout: ["first", "5000 objects", "last"], stderr: "", exitCode: 0 });
  });
});

// Linux only: reads /proc/self/fd.
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

  it("is closed by a child that queues a cluster message, because node:cluster is not loaded", async () => {
    const result = await runPair(
      `
        // Both ends of the channel are children.
        const spawnEnd = (role, channel) =>
          spawnChild({
            cmd: [process.execPath, "child.js", role],
            env: { ...process.env, NODE_CHANNEL_FD: "3", NODE_CHANNEL_SERIALIZATION_MODE: "json" },
            stdio: ["ignore", "inherit", "inherit", channel],
            ipc: undefined,
          });
        const receiver = spawnEnd("receive", "pipe");
        await Promise.all([receiver.exited, spawnEnd("send", receiver.stdio[3]).exited]);
      `,
      `
        if (process.argv[2] === "send") {
          ${sendDescriptorWith('\x02{"$hasHandle":true}')}
        } else {
          process.on("message", () => {
            console.log("leaked", openFds() - before);
            process.disconnect();
          });
          const before = openFds();
        }
      `,
    );
    expect(result).toEqual({ stdout: ["leaked 0"], stderr: "", exitCode: 0 });
  });

  it("is closed once if the Worker that receives it exits in the listener", async () => {
    const result = await runPair(
      `
        const { Worker, isMainThread, workerData } = require("node:worker_threads");
        const [FD, TAKEN] = [0, 1];
        if (isMainThread) {
          const shared = new Int32Array(new SharedArrayBuffer(8));
          const worker = new Worker(__filename, { workerData: shared });
          worker.on("message", () => {
            while (fs.openSync("/dev/null") !== shared[FD]);
            Atomics.store(shared, TAKEN, 1);
            Atomics.notify(shared, TAKEN);
          });
          worker.on("exit", () => console.log(fs.fstatSync(shared[FD]).isCharacterDevice()));
        } else {
          spawnChild({
            ipc(message, child, socket) {
              // The number is free now, and the main thread takes it.
              workerData[FD] = socket._handle.fd;
              socket._handle.terminate();
              require("node:worker_threads").parentPort.postMessage("closed");
              Atomics.wait(workerData, TAKEN, 0);
              process.exit(0);
            },
          });
        }
      `,
      `
        const server = await listen();
        const socket = require("node:net").connect(server.address().port, "127.0.0.1", () => process.send("socket", socket));
        process.on("disconnect", () => process.exit(0));
      `,
    );
    expect(result).toEqual({ stdout: ["true"], stderr: "", exitCode: 0 });
  });

  it("is delivered while a callback of a disposed Bun.ModuleGraph runs the event loop", async () => {
    const result = await runPair(
      `
        const done = Promise.withResolvers();
        const child = spawnChild({
          ipc(message, _, handle) {
            console.log(message, handle?.constructor.name);
            handle?.on("error", () => {});
            if (message === "last") done.resolve();
          },
        });
        const graph = new Bun.ModuleGraph();
        const data = () => {
          graph.dispose();
          child.send("go");
          runEventLoopUntil(done.promise);
          child.disconnect();
        };
        const { port } = graph.run(() => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data } }));
        const client = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
        client.write("x");
        await child.exited;
      `,
      `
        const server = await listen();
        process.on("message", () => {
          const socket = require("node:net").connect(server.address().port, "127.0.0.1", () => {
            process.send("socket", socket);
            process.send("last");
          });
        });
        process.on("disconnect", () => process.exit(0));
      `,
    );
    expect(result).toEqual({ stdout: ["socket Socket", "last undefined"], stderr: "", exitCode: 0 });
  });
});

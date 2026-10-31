import { spawn } from "bun";
import { socketFaultInjection } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isAndroid, isASAN, isLinux, isWindows, tempDir } from "harness";
import { constants } from "node:os";
import path from "path";
import { shapes as lastMessageShapes, terminalShape } from "./ipc-last-message-fixture.ts";

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

// getIPCInstance error path: on Windows, windowsConfigureClient can open the
// pipe, set socket=.open, then fail readStart — at which point closeSocket
// queued an _onAfterIPCClosed task holding *SendQueue, and instance.deinit()
// (previously TrivialDeinit) freed it without cancelling. IPCInstance.deinit
// now runs SendQueue.deinit() so the tracked after_close_task is cancelled on
// both platforms before the allocation is released.
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

// Where pidfd_open fails, a thread reaps the children and its report of an exit is a task: it runs before the loop
// has read the channel. The channel used to close with that report, on top of the message that the child sent last.
describe.skipIf(!isLinux && !isAndroid)("the last message of a child that the waiter thread reaps is delivered", () => {
  // The flag is read when BUN_GARBAGE_COLLECTOR_LEVEL is set, and bunEnv sets it.
  const env = { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" };

  // One at a time: each case starts two or more bun processes, and a debug build starts slowly.
  it.each(lastMessageShapes)("%s", async (_, shape, expected) => {
    await using proc = spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "ipc-last-message-fixture.ts"), shape],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let report: unknown = stdout;
    try {
      report = JSON.parse(stdout);
    } catch {}
    expect({ report, stderr, exitCode }).toEqual({ report: expected, stderr: "", exitCode: 0 });
  });

  // The exit report still waits for its read when the process ends, and the Subprocess is released all the same.
  it.skipIf(!isASAN)("Bun.spawn: the process ends before the loop has read the channel", async () => {
    await using proc = spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "ipc-last-message-fixture.ts"), "end-before-the-read"],
      env: {
        ...env,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${path.join(import.meta.dir, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ report: stdout.trim(), stderr, exitCode }).toEqual({
      report: JSON.stringify({ events: ["spawn returned"] }),
      stderr: "",
      exitCode: 0,
    });
  });

  it("Bun.spawn: ipc handlers wait for the exit and for the disconnect in a nested turn of the loop", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "test", "./ipc-last-message-nested-fixture.ts"],
      cwd: import.meta.dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    const delivered = ["message", "exit 0 null", "disconnect"];
    expect({ events: stdout.split("\n").find(line => line.startsWith("EVENTS ")), exitCode }).toEqual({
      events: "EVENTS " + JSON.stringify([delivered, delivered, delivered]),
      exitCode: 0,
    });
  });

  // The last output of the terminal is handed over while the exit is taken in, ahead of the read of the channel.
  it("Bun.spawn: a child with a terminal reads as running in the data callback of the terminal too", async () => {
    await using proc = spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "ipc-last-message-fixture.ts"), "terminal"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let report: unknown = stdout;
    try {
      report = JSON.parse(stdout);
    } catch {}
    expect({ report, stderr, exitCode }).toEqual({ report: terminalShape, stderr: "", exitCode: 0 });
  });
});

/**
 * A parent sends a handle to a child that has one message unread in the channel, and prints what happens. Either the
 * child has closed its end of the channel by then, or it still holds it and bun's own sendmsg is told to fail with `errno`.
 */
async function sendHandleOverUnreadMessage(errno?: number) {
  const closesChannel = errno === undefined ? `eval "exec $NODE_CHANNEL_FD>&-"; ` : "";
  using dir = tempDir("ipc-send-over-unread", {
    "parent.js": `
      const fault = ${errno === undefined ? "undefined" : `require("bun:internal-for-testing").socketFaultInjection`};
      const { readFileSync } = require("node:fs");
      const events = [];
      process.on("exit", () => console.log(JSON.stringify(events)));
      const server = require("node:net").createServer(() => {});
      server.listen(0, () => {
        const child = Bun.spawn({
          // One message, then it closes the fifo, and then it waits for its parent to end it.
          cmd: ["sh", "-c", 'exec 9>gone; echo \\'"last"\\' >&$NODE_CHANNEL_FD; ${closesChannel}exec 9>&-; while kill -0 $PPID 2>/dev/null; do sleep 0.05; done'],
          serialization: "json",
          stdio: ["ignore", "inherit", "inherit"],
          ipc() {
            events.push("message");
          },
          onExit(_, exitCode, signalCode) {
            events.push("exit " + exitCode + " " + signalCode);
          },
          onDisconnect() {
            events.push("disconnect");
            fault?.clear();
            server.close();
            child.kill();
          },
        });
        // Returns when the child has closed the fifo: the message is in the channel by then.
        readFileSync("gone");
        fault?.set({ syscall: "sendmsg", action: "errno", errno: ${errno}, repeat: -1 });
        events.push("send() returned " + child.send("ping", server) + ", connected " + child.connected);
      });
    `,
  });
  expect(Bun.spawnSync({ cmd: ["mkfifo", path.join(String(dir), "gone")] }).exitCode).toBe(0);
  await using proc = spawn({
    cmd: [bunExe(), "parent.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { events: stdout.trim(), stderr, exitCode };
}
const closeWaitedForTheMessage = JSON.stringify([
  "send() returned true, connected true",
  "message",
  "disconnect",
  "exit null SIGTERM",
]);

// A send that fails closes the channel, and a handle sent to a child that has closed its end fails. That close used to
// come on top of what the child had sent before. No flag and no exit are needed for this one.
it.skipIf(isWindows)(
  "a handle sent to a child that closed the channel does not close it over an unread message",
  async () => {
    expect(await sendHandleOverUnreadMessage()).toEqual({ events: closeWaitedForTheMessage, stderr: "", exitCode: 0 });
  },
);

// Only an errno that says the peer is gone makes that close wait. After any other one the channel closes at once, as
// it always did: the child is alive, and nothing says that a read comes.
describe.skipIf(isWindows || !socketFaultInjection.available())(
  "a handle send that fails with an unread message in the channel",
  () => {
    it.each(["EPIPE", "ECONNRESET", "ENOTCONN"] as const)("%s: the close waits for the message", async errno => {
      expect(await sendHandleOverUnreadMessage(constants.errno[errno])).toEqual({
        events: closeWaitedForTheMessage,
        stderr: "",
        exitCode: 0,
      });
    });

    it.each(["EBADF", "EMSGSIZE"] as const)("%s: the channel closes at once", async errno => {
      expect(await sendHandleOverUnreadMessage(constants.errno[errno])).toEqual({
        events: JSON.stringify(["send() returned true, connected false", "disconnect", "exit null SIGTERM"]),
        stderr: "",
        exitCode: 0,
      });
    });
  },
);

// The same failed send from the other side: process.send() of a handle in a bun child whose parent has ended, with the
// last message of the parent unread. The child has unref'd all it has, so only that wait keeps it alive for the read.
it.skipIf(isWindows)(
  "process.send() of a handle to a parent that has ended does not drop the last message of the parent",
  async () => {
    using dir = tempDir("ipc-child-send-to-gone", {
      "parent.js": `
        const child = Bun.spawn({
          cmd: [process.execPath, "child.js"],
          env: { ...process.env, PARENT_PID: String(process.pid) },
          serialization: "json",
          stdio: ["ignore", "inherit", "inherit"],
          ipc() {},
        });
        child.send("last");
        child.unref();
        process.exit(0);
      `,
      "child.js": `
        const events = [];
        process.on("exit", code => console.log(JSON.stringify({ events, code })));
        // Ends a child that nothing else would end. The timer does not keep the child alive.
        setTimeout(() => process.exit(3), 10_000).unref();
        const server = require("node:net").createServer(() => {});
        server.listen(0, () => {
          // Off the loop until the parent is gone: its end of the channel is closed by then.
          for (;;) {
            try {
              process.kill(Number(process.env.PARENT_PID), 0);
            } catch {
              break;
            }
            Bun.sleepSync(1);
          }
          process.on("message", message => events.push("message " + message));
          process.on("disconnect", () => {
            events.push("disconnect");
            server.close();
          });
          events.push("send() returned " + process.send("take", server) + ", connected " + process.connected);
          process.channel.unref();
          server.unref();
        });
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "parent.js"],
      cwd: String(dir),
      // The child has to outlive its parent. Where the runner sets this flag, a bun process ends its children with itself.
      env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    // The child holds the stdout of its parent, so this reads until the child has ended too.
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ report: stdout.trim(), stderr, exitCode }).toEqual({
      report: JSON.stringify({
        events: ["send() returned true, connected true", "message last", "disconnect"],
        code: 0,
      }),
      stderr: "",
      exitCode: 0,
    });
  },
);

// The poll of the loop gets the exit of a child and a message in the channel at once, the exit first: what the child
// left behind wrote the message after the child had ended. The exit used to be reported before the message. This is
// the route that every child takes where pidfd_open or kqueue works, with no flag and no shim.
it.skipIf(isWindows)(
  "the exit that the poll reports ahead of a message in the channel waits for that message",
  async () => {
    using dir = tempDir("ipc-exit-ahead-of-message", {
      "parent.mjs": `
      import { readFileSync, writeFileSync } from "node:fs";
      const events = [];
      process.on("exit", () => console.log(JSON.stringify(events)));
      Bun.spawn({
        // Only the child holds the write end of "alive". What it leaves behind waits for a line from "late", writes
        // the message, and then closes "written".
        cmd: ["sh", "-c", "exec 8>alive; (read x <late; echo '\\"last\\"' >&$NODE_CHANNEL_FD; : >written) 8>&- >/dev/null 2>&1 &"],
        serialization: "json",
        stdio: ["ignore", "inherit", "inherit"],
        ipc() {
          events.push("message");
        },
        onExit(_, exitCode, signalCode) {
          events.push("exit " + exitCode + " " + signalCode);
        },
        onDisconnect() {
          events.push("disconnect");
        },
      });
      // The loop first takes what a new channel has for it, so that the next poll starts with the exit.
      await Bun.spawn({ cmd: ["true"], stdio: ["ignore", "ignore", "ignore"] }).exited;
      await Bun.spawn({ cmd: ["true"], stdio: ["ignore", "ignore", "ignore"] }).exited;
      // Off the loop from here on. This returns when the child has ended, the next line has the message written, and
      // the last one returns when it is in the channel.
      readFileSync("alive");
      writeFileSync("late", "\\n");
      readFileSync("written");
    `,
    });
    for (const fifo of ["alive", "late", "written"]) {
      expect(Bun.spawnSync({ cmd: ["mkfifo", path.join(String(dir), fifo)] }).exitCode).toBe(0);
    }
    await using proc = spawn({
      cmd: [bunExe(), "parent.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ events: stdout.trim(), stderr, exitCode }).toEqual({
      events: JSON.stringify(["message", "exit 0 null", "disconnect"]),
      stderr: "",
      exitCode: 0,
    });
  },
);

// The exit waits for what the channel held when the child ended, and for no more than that: a process that the child
// left behind can hold its end of the channel and keep writing. This one passes without the wait too: it guards the
// bound of the wait where no flag is set.
it.skipIf(isWindows)(
  "a child that bun ends at its timeout is disconnected while what it left behind floods the channel",
  async () => {
    // Long lines, so that what piles up in the channel is few messages.
    const writer = `(while echo '"${Buffer.alloc(1024, "x")}"'; do :; done) >&$NODE_CHANNEL_FD 2>/dev/null & wait`;
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const events = [];
        process.on("exit", () => console.log(JSON.stringify(events)));
        Bun.spawn({
          cmd: ["sh", "-c", ${JSON.stringify(writer)}],
          serialization: "json",
          stdio: ["ignore", "inherit", "inherit"],
          timeout: 100,
          // The writer stays ahead of a reader that takes this long: the channel is then never empty after a read.
          ipc() {
            for (const until = performance.now() + 0.2; performance.now() < until; );
          },
          onExit(_, exitCode, signalCode) {
            events.push("exit " + exitCode + " " + signalCode);
          },
          onDisconnect() {
            events.push("disconnect");
          },
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ events: stdout.trim(), stderr, exitCode }).toEqual({
      events: JSON.stringify(["exit null SIGTERM", "disconnect"]),
      stderr: "",
      exitCode: 0,
    });
  },
);

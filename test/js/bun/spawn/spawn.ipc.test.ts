import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isPosix, isWindows, tempDir } from "harness";
import { spawn as spawnNode } from "node:child_process";
import { once } from "node:events";
import { totalmem } from "node:os";
import type { Writable } from "node:stream";
import { text } from "node:stream/consumers";
import path from "path";

// A receiver refuses a JSON line longer than the longest UTF-8 form of the longest string.
// BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT lowers that string length, so these tests reach
// the limit with kilobytes instead of gigabytes.
const maxStringLength = 64 * 1024;
const maxLineLength = 3 * maxStringLength + 1;
const lowLimitEnv = { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(maxStringLength) };

// Sender source: 1 MiB of "a" and no newline, which is past the lowered limit. Exit code 1
// says the receiver took all of it.
const flood = `
  const chunk = Buffer.alloc(65536, "a");
  for (let i = 0; i < 16; i++) write(chunk);
  process.exit(1);
`;

/**
 * Runs `senderSource` as the child of a process that receives on the IPC channel under the
 * lowered limit. The sender has `write(bytes)`, which puts raw bytes on its end of the
 * channel, and `send(message)`, which sends one JSON message. The sender exits with 42 once
 * the receiver has closed the channel.
 *
 * The receiver runs in its own subprocess so a crash shows up as a failing assertion here
 * rather than taking out the test runner.
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
          // The sender waits for the channel to close, so end it once every message the
          // test expects has arrived.
          if (++received === ${disconnectAfter}) subprocess.disconnect();
        },
      });
      console.log("SENDER_EXIT", await sender.exited);
    `,
    "sender.js": `
      const { writeSync } = require("fs");
      const retry = new Int32Array(new SharedArrayBuffer(4));
      // The receiver's close reaches a write in flight as EPIPE, ECONNRESET or (on macOS,
      // which tests the connection first) ENOTCONN.
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

  it.concurrent.skipIf(isWindows)("closes the channel when an unfinished line passes the length limit", async () => {
    // The complete lines come first and are delivered. The bytes behind them never get a
    // newline: the receiver must close the channel once they pass the limit, and not buffer
    // them while it waits for one.
    expect(await runReceiver("json", `write(Buffer.from('{"n":1}\\n{"n":2}\\n'));` + flood)).toEqual({
      stdout: ['MESSAGE {"n":1}', 'MESSAGE {"n":2}', "SENDER_EXIT 42"],
      stderr: "IPC message is too long.\n",
      exitCode: 0,
    });
  });

  it.concurrent.skipIf(isWindows)(
    "a child closes the channel when its parent sends an unfinished line past the length limit",
    async () => {
      // The child is the receiver. Its channel is the extra stdio pipe that NODE_CHANNEL_FD
      // names, so this process can write raw bytes to it.
      const child = spawnNode(
        bunExe(),
        [
          "-e",
          `process.on("message", () => console.log("MESSAGE"));
           process.on("disconnect", () => console.log("DISCONNECT"));`,
        ],
        {
          env: { ...lowLimitEnv, NODE_CHANNEL_FD: "3", NODE_CHANNEL_SERIALIZATION_MODE: "json" },
          stdio: ["ignore", "pipe", "pipe", "pipe"],
        },
      );
      const channel = child.stdio[3] as Writable;
      // The child closes its end while most of these bytes are still unread.
      channel.on("error", () => {});
      channel.end(Buffer.alloc(16 * maxLineLength, "a"));

      const [stdout, stderr, [exitCode]] = await Promise.all([
        text(child.stdout!),
        text(child.stderr!),
        once(child, "exit"),
      ]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "DISCONNECT\n",
        stderr: "IPC message is too long.\n",
        exitCode: 0,
      });
    },
  );

  it.concurrent("refuses a message that is longer than a string, and reports it", async () => {
    // 65535 characters of U+4E2D: 196607 bytes of JSON text, under the byte limit, and one
    // character past what a string of the receiver's limit holds. The merge base closes the
    // channel here with nothing on stderr.
    const sender = `send("\u4e2d".repeat(${maxStringLength - 1}));`;
    expect(await runReceiver("json", sender)).toEqual({
      stdout: ["SENDER_EXIT 42"],
      stderr: "IPC message is too long.\n",
      exitCode: 0,
    });
  });

  it.concurrent("delivers a message as long as a string, in reads of its own size", async () => {
    // 65534 characters of U+4E2D: 196604 bytes of JSON text, exactly the longest string the
    // receiver holds. It also spans several reads on both platforms, which is what makes the
    // Windows read chunk visible: the message must arrive whole.
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
    "closes the channel at the header of a frame that is too long to deserialize",
    async () => {
      // A frame longer than the deserializer's buffer can never decode. The receiver must
      // refuse it when the header arrives, and not buffer a body of that length first.
      const header = `write(Buffer.from([0x02, 0x01, 0x00, 0x01, 0x00]));`;
      expect(await runReceiver("advanced", header + flood)).toEqual({
        stdout: ["SENDER_EXIT 42"],
        stderr: "",
        exitCode: 0,
      });
    },
  );
});

// The line limit is derived from the longest string, so without the synthetic limit above it
// takes gigabytes to reach. A peer that writes 2^32 bytes with no newline used to abort the
// receiver in a length cast. The receiver holds the whole line until it refuses it, so this
// runs one case at a time, in a child process, and only on machines with room.
describe.skipIf(!isPosix || totalmem() < 16 * 1024 ** 3)("ipc mode json at the real line limit", () => {
  it("closes the channel instead of aborting when a peer writes 2^32 bytes with no newline", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const sender = Bun.spawn({
            cmd: ["sh", "-c", "head -c 4294967296 /dev/zero >&3"],
            stdio: ["ignore", "inherit", "inherit"],
            serialization: "json",
            ipc(message) { console.log("MESSAGE", typeof message); },
          });
          // The sender's own exit says nothing: the receiver closes the channel while its
          // last bytes are still on the way, so it ends by itself or on a broken pipe.
          await sender.exited;
          console.log("RECEIVER_ALIVE");
          `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "RECEIVER_ALIVE\n",
      stderr: "IPC message is too long.\n",
      exitCode: 0,
      signalCode: null,
    });
  }, 180_000);
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

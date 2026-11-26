import { spawn } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isDebug, isLinux, isWindows, tempDir } from "harness";
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
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

  it.concurrent(
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

// The error path of get_ipc_instance.
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

// On Windows the channel is framed as in Node.js: four u32 fields (flags, reserved1, data length, reserved2), then
// the data. reserved2 must be zero.
describe.concurrent.skipIf(!isWindows)("Windows IPC framing", () => {
  /** `senderSource` can call `write(bytes)`, and `await waitForReceiver()` to let the receiver's event loop run. */
  async function receiveFrames(senderSource: string) {
    using dir = tempDir("ipc-frames", {
      "sender.js": `
        const fs = require("fs");
        const encodeHeader = (flags, length, reserved2 = 0) => Buffer.from(new Uint32Array([flags, 0, length, reserved2]).buffer);
        const encodeFrame = text => Buffer.concat([encodeHeader(1, Buffer.byteLength(text)), Buffer.from(text)]);
        const write = bytes => fs.writeSync(3, bytes);
        const stdinLines = require("readline").createInterface({ input: process.stdin })[Symbol.asyncIterator]();
        const waitForReceiver = () => {
          console.log("waiting");
          return stdinLines.next();
        };
        (async () => { ${senderSource}; console.log("done"); await stdinLines.next(); process.exit(0); })();
      `,
      "receiver.js": `
        const events = [];
        const sender = Bun.spawn([process.execPath, "sender.js"], {
          stdio: ["pipe", "pipe", "inherit"],
          serialization: "json",
          ipc: message => events.push(message),
          onDisconnect: () => events.push("disconnect"),
        });
        for await (const chunk of sender.stdout) {
          for (let i = 0; i < 5; i++) await Bun.sleep(1);
          if (String(Buffer.from(chunk)).includes("done")) events.push("done");
          sender.stdin.write("go\\n");
          sender.stdin.flush();
        }
        await sender.exited;
        console.log(JSON.stringify(events.slice(0, events.indexOf("done"))));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "receiver.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }

  it.each([
    ["one message", `write(encodeFrame('1\\n'))`, [1]],
    ["several frames in one write", `write(Buffer.concat(['1\\n', '2\\n', '3\\n'].map(encodeFrame)))`, [1, 2, 3]],
    ["several messages in one frame", `write(encodeFrame('1\\n2\\n3\\n'))`, [1, 2, 3]],
    [
      "a message split across frames",
      `for (const chunk of ['"a', 'b', 'c"', '\\n']) { write(encodeFrame(chunk)); await waitForReceiver(); }`,
      ["abc"],
    ],
    [
      "a UTF-8 character split across frames",
      `for (const hex of ['22c3', 'a9220a']) { write(Buffer.concat([encodeHeader(1, hex.length / 2), Buffer.from(hex, "hex")])); await waitForReceiver(); }`,
      ["\u00e9"],
    ],
    [
      "empty frames",
      `write(encodeHeader(0, 0)); await waitForReceiver(); write(encodeHeader(1, 0)); await waitForReceiver(); write(encodeFrame('1\\n'))`,
      [1],
    ],
    [
      "a frame larger than the pipe buffer",
      `write(encodeFrame(JSON.stringify(Buffer.alloc(300000, "x").toString().length) + '\\n' + JSON.stringify([Buffer.alloc(300000, " ").toString().trim()]).padEnd(300000) + '\\n'))`,
      [300000, [""]],
    ],
  ])("decodes %s", async (_, senderSource, expected) => {
    expect(await receiveFrames(senderSource)).toEqual(expected);
  });

  it.each([
    ["unknown flags", "encodeHeader(9, 0)"],
    ["a length without the data flag", "encodeHeader(0, 2)"],
    ["the connection flag without a socket", "encodeHeader(5, 0)"],
    ["a non-zero reserved2 field", "encodeHeader(1, 0, 1)"],
  ])("delivers earlier messages, then disconnects on an invalid header: %s", async (_, invalidHeader) => {
    expect(
      await receiveFrames(
        `write(encodeFrame('1\\n')); await waitForReceiver(); write(${invalidHeader}); await waitForReceiver()`,
      ),
    ).toEqual([1, "disconnect"]);
  });

  it("delivers a message written together with an invalid header, then disconnects", async () => {
    expect(
      await receiveFrames(`write(Buffer.concat([encodeFrame('1\\n'), encodeHeader(9, 0)])); await waitForReceiver()`),
    ).toEqual([1, "disconnect"]);
  });

  it.each(["json", "advanced"] as const)("process.send() writes well-formed frames (%s)", async serialization => {
    const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
    const child = nodeSpawn(bunExe(), ["-e", `process.send("a"); process.send("bc", () => process.exit(0))`], {
      env: { ...bunEnv, NODE_CHANNEL_FD: "3", NODE_CHANNEL_SERIALIZATION_MODE: serialization },
      stdio: ["ignore", "inherit", "inherit", "pipe"],
    });
    Array.fromAsync<Buffer>(child.stdio[3] as any).then(chunks => resolve(Buffer.concat(chunks)), reject);
    const bytes = await promise;
    const headers: number[][] = [];
    const payloads: Buffer[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16 + payloads.at(-1)!.length) {
      headers.push([bytes.readUInt32LE(offset), bytes.readUInt32LE(offset + 12)]);
      payloads.push(bytes.subarray(offset + 16, offset + 16 + bytes.readUInt32LE(offset + 8)));
    }
    expect(headers.length).toBeGreaterThan(0);
    expect(headers).toEqual(headers.map(() => [1, 0]));
    if (serialization === "json") expect(Buffer.concat(payloads).toString()).toBe('"a"\n"bc"\n');
    else expect(Buffer.concat(payloads).toString("latin1")).toMatch(/a[^]*bc/);
  });
});

it.skipIf(!isWindows)("a large IPC write is received in full when the sender is killed mid-write", async () => {
  const { OpenProcess, WaitForSingleObject, CloseHandle } = dlopen("kernel32.dll", {
    OpenProcess: { args: ["u32", "i32", "u32"], returns: "u64" },
    WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
    CloseHandle: { args: ["u64"], returns: "i32" },
  }).symbols;
  const SYNCHRONIZE = 0x100000;
  const lengths: number[] = [];
  let waitResult;
  const { promise, resolve } = Promise.withResolvers<void>();
  await using child = spawn({
    cmd: [
      bunExe(),
      "-e",
      `const payload = Buffer.from('"a"\\n"' + Buffer.alloc(2_000_000, "x") + '"\\n');
       fs.writeSync(3, Buffer.concat([Buffer.from(new Uint32Array([1, 0, payload.length, 0]).buffer), payload]));
       Bun.sleepSync(30_000);`,
    ],
    env: bunEnv,
    stdio: ["ignore", "inherit", "inherit"],
    serialization: "json",
    ipc(message, child) {
      if (lengths.push(message.length) > 1) return;
      const processHandle = OpenProcess(SYNCHRONIZE, 0, child.pid);
      child.kill("SIGKILL");
      waitResult = WaitForSingleObject(processHandle, 4000);
      CloseHandle(processHandle);
    },
    onDisconnect: () => resolve(),
  });
  await Promise.all([promise, child.exited]);
  expect({ waitResult, lengths }).toEqual({ waitResult: 0, lengths: [1, 2_000_000] });
});

// Not concurrent: an exiting child waits only briefly for the parent to drain its pending write.
describe.skipIf(!isWindows).each(["json", "advanced"] as const)("large IPC messages in %s mode", serialization => {
  it.each([
    ["exits", "process.exit(0)"],
    ["throws", "throw new Error()"],
    ["kills itself", "process.kill(process.pid, 'SIGKILL')"],
  ])("delivers a large message sent right before the child %s", async (_, exitStatement) => {
    const lengths: number[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [bunExe(), "-e", `process.send(Buffer.alloc(2_000_000, "x").toString()); ${exitStatement}`],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      serialization,
      ipc: message => void lengths.push(message.length),
      onDisconnect: () => resolve(),
    });
    await Promise.all([promise, child.exited]);
    expect(lengths).toEqual([2_000_000]);
  });
});

describe.concurrent.each(["json", "advanced"] as const)("IPC message delivery in %s mode", serialization => {
  // On Windows the total exceeds the pipe buffer.
  const sizeStep = isWindows ? 100 : 0;
  function spawnChild(script: string, ipc: (message: any, child: Bun.Subprocess) => void) {
    return spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization,
      ipc,
    });
  }

  it("does not deadlock when both sides send megabytes before reading", async () => {
    const messageCount = 64;
    const received: number[] = [];
    const complete = Promise.withResolvers<void>();
    await using child = spawnChild(
      `const payload = Buffer.alloc(24 * 1024, "c").toString();
       let nextIndex = 0;
       process.on("message", ([i, data]) => {
         if (i !== nextIndex++ || data.length !== 24 * 1024) process.exit(2);
         if (nextIndex === ${messageCount}) process.send("complete");
       });
       for (let i = 0; i < ${messageCount}; i++) process.send([i, payload]);`,
      message =>
        message === "complete" ? complete.resolve() : received.push(message[1].length === 24 * 1024 ? message[0] : -1),
    );
    child.exited.then(code => complete.reject(new Error(`exited with ${code}`)));
    const payload = Buffer.alloc(24 * 1024, "p").toString();
    for (let i = 0; i < messageCount; i++) child.send([i, payload]);
    await complete.promise;
    expect(received).toEqual(Array.from({ length: messageCount }, (_, i) => i));
  });

  it.each([
    ["exits normally", "process.send(lastMessage)"],
    ["disconnects", "process.send(lastMessage); process.disconnect()"],
    ["exits in the last send callback", "process.send(lastMessage, () => process.exit(0))"],
  ])("delivers every message sent before the child %s", async (_, tail) => {
    const received: number[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const lastMessage = [99, ""];
         for (let i = 0; i < 99; i++) process.send([i, Buffer.alloc(i * ${sizeStep}, "x").toString()]);
         ${tail}`,
      ],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization,
      ipc: message => void received.push(message[0]),
      onDisconnect: () => resolve(),
    });
    await Promise.all([promise, child.exited]);
    expect(received).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(child.exitCode).toBe(0);
  });

  it.each([
    ["exits", "process.exit(0)"],
    ["throws", "throw new Error()"],
    ["kills itself", "process.kill(process.pid, 'SIGKILL')"],
  ])("delivers small messages sent right before the child %s", async (_, exitStatement) => {
    const received: number[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [bunExe(), "-e", `for (let i = 0; i < 100; i++) process.send(i); ${exitStatement}`],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      serialization,
      ipc: message => void received.push(message),
      onDisconnect: () => resolve(),
    });
    await Promise.all([promise, child.exited]);
    expect(received).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it("delivers a burst sent from an unhandledRejection listener", async () => {
    const received: number[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.on("unhandledRejection", index => process.send(index));
         process.on("message", () => { for (let i = 0; i < 6; i++) Promise.reject(i); });
         // After the engine's startup timer, which would wake the event loop.
         setTimeout(() => process.send("ready"), 200);`,
      ],
      env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
      stdio: ["ignore", "inherit", "inherit"],
      serialization,
      ipc(message, child) {
        if (message === "ready") child.send("go");
        else if (received.push(message) === 6) resolve();
      },
    });
    await promise;
    child.kill();
    expect(received).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it.each([0, 1, 2])(
    "delivers every message if listener call %d runs the event loop until the child exits",
    async at => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const received = [];
         Bun.spawn([process.execPath, "-e", "for (let i = 0; i < 6; i++) process.send(i)"], {
           serialization: "${serialization}",
           ipc(message, child) {
             received.push(message);
             if (message !== ${at}) return;
             const setup = () => child.exited.then(() => new Promise(setImmediate));
             Bun.build({ entrypoints: ["missing"], throw: false, plugins: [{ name: "wait", setup }] });
           },
         });
         process.on("exit", () => console.log(received.join("")));`,
        ],
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      expect(await proc.stdout.text()).toBe("012345\n");
      expect(await proc.exited).toBe(0);
    },
  );

  it.serial.skipIf(!isWindows)("delivers no message after disconnect()", async () => {
    using dir = tempDir("ipc-after-disconnect", {});
    const marker = path.join(String(dir), "sent");
    const received: number[] = [];
    await using child = spawnChild(
      `process.on("message", () => {});
       process.send(1);
       process.send(2);
       process.send(3, () => require("fs").writeFileSync(${JSON.stringify(marker)}, ""));`,
      (message, child) => {
        received.push(message);
        child.disconnect();
      },
    );
    for (const deadline = Date.now() + 4000; !existsSync(marker) && Date.now() < deadline;) Bun.sleepSync(1);
    expect(existsSync(marker)).toBe(true);
    expect(await child.exited).toBe(0);
    expect(received).toEqual([1]);
  });

  it("delivers every message sent before the parent disconnects", async () => {
    await using child = spawn({
      cmd: [
        bunExe(),
        "-e",
        `let count = 0; process.on("message", () => count++).on("disconnect", () => console.log(count)); process.send("ready")`,
      ],
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
      serialization,
      ipc(_, child) {
        for (let i = 0; i < 100; i++) child.send(Buffer.alloc(i * sizeStep, "x").toString());
        child.disconnect();
      },
    });
    expect(await child.stdout.text()).toBe("100\n");
    expect(await child.exited).toBe(0);
  });

  it("disconnects when the child is killed with messages still queued", async () => {
    const ready = Promise.withResolvers<void>();
    const disconnected = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [bunExe(), "-e", `process.send("ready", () => Bun.sleepSync(30_000))`],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization,
      ipc: () => ready.resolve(),
      onDisconnect: () => disconnected.resolve(),
    });
    await ready.promise;
    for (let i = 0; i < 20; i++) child.send(Buffer.alloc(100_000, "x").toString());
    child.kill("SIGKILL");
    await Promise.all([child.exited, disconnected.promise]);
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("emits 'disconnect' in the child when the parent is killed", async () => {
    await using parent = spawn({
      cmd: [
        bunExe(),
        "-e",
        `Bun.spawn([process.execPath, "-e", "process.on('disconnect', () => console.log('disconnected')); process.send(0)"], {
           detached: true,
           stdio: ["ignore", "inherit", "inherit"],
           serialization: ${JSON.stringify(serialization)},
           ipc: () => process.kill(process.pid, "SIGKILL"),
         })`,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      stdio: ["ignore", "pipe", "inherit"],
    });
    expect(await parent.stdout.text()).toBe("disconnected\n");
  });
});

it.each(["json", "advanced"] as const)("delivers messages while the sender is blocked (%s)", async serialization => {
  using dir = tempDir("ipc-busy-sender", {});
  let count = 0;
  await using child = spawn({
    cmd: [
      bunExe(),
      "-e",
      `for (let i = 0; i < 2; i++) process.send(i);
       while (!require("fs").existsSync("received")) Bun.sleepSync(1);`,
    ],
    cwd: String(dir),
    env: bunEnv,
    serialization,
    ipc() {
      if (++count === 2) Bun.write(`${dir}/received`, "");
    },
  });
  expect(await child.exited).toBe(0);
});

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
    // Bun.build() runs the event loop until the setup() of a plugin has settled.
    const runEventLoopUntil = promise =>
      void Bun.build({ entrypoints: ["./empty.js"], plugins: [{ name: "wait", setup: () => promise.then(() => {}) }] });
  `;
  using dir = tempDir("ipc-pair", {
    "parent.js": prelude + helpers + parent,
    "child.js": helpers + child,
    "empty.js": "",
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

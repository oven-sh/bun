import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isLinux, isWindows, tempDir } from "harness";
import { spawn as nodeSpawn } from "node:child_process";
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

// On Windows the channel carries frames, as Node.js sends them: flags, a reserved word, the length of the data,
// a zero word, then the data.
describe.concurrent.skipIf(!isWindows)("frames on the channel", () => {
  /** The peer calls `write(bytes)`, and `await step()` to wait until the receiver's event loop has turned. */
  async function receive(peer: string) {
    using dir = tempDir("ipc-frames", {
      "peer.js": `
        const fs = require("fs");
        const header = (flags, length, zero = 0) => Buffer.from(new Uint32Array([flags, 0, length, zero]).buffer);
        const frame = text => Buffer.concat([header(1, Buffer.byteLength(text)), Buffer.from(text)]);
        const write = bytes => fs.writeSync(3, bytes);
        const lines = require("readline").createInterface({ input: process.stdin })[Symbol.asyncIterator]();
        const step = () => (console.log("step"), lines.next());
        (async () => { ${peer}; console.log("done"); await lines.next(); process.exit(0); })();
      `,
      "receiver.js": `
        const seen = [];
        const peer = Bun.spawn([process.execPath, "peer.js"], {
          stdio: ["pipe", "pipe", "inherit"],
          serialization: "json",
          ipc: message => seen.push(message),
          onDisconnect: () => seen.push("disconnect"),
        });
        for await (const chunk of peer.stdout) {
          for (let turns = 0; turns < 5; turns++) await Bun.sleep(1);
          if (String(Buffer.from(chunk)).includes("done")) seen.push("done");
          peer.stdin.write("go\\n"), peer.stdin.flush();
        }
        await peer.exited;
        console.log(JSON.stringify(seen.slice(0, seen.indexOf("done"))));
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
    ["one message", `write(frame('1\\n'))`, [1]],
    ["several frames in one write", `write(Buffer.concat(['1\\n', '2\\n', '3\\n'].map(frame)))`, [1, 2, 3]],
    ["several messages in one frame", `write(frame('1\\n2\\n3\\n'))`, [1, 2, 3]],
    [
      "a message over several frames",
      `for (const part of ['"a', 'b', 'c"', '\\n']) write(frame(part)), await step()`,
      ["abc"],
    ],
    [
      "a character over two frames",
      `for (const part of ['22c3', 'a9220a']) write(Buffer.concat([header(1, part.length / 2), Buffer.from(part, "hex")])), await step()`,
      ["\u00e9"],
    ],
    [
      "a frame without data",
      `write(header(0, 0)); await step(); write(header(1, 0)); await step(); write(frame('1\\n'))`,
      [1],
    ],
    [
      "a frame larger than the pipe",
      `write(frame(JSON.stringify(Buffer.alloc(300000, "x").toString().length) + '\\n' + JSON.stringify([Buffer.alloc(300000, " ").toString().trim()]).padEnd(300000) + '\\n'))`,
      [300000, [""]],
    ],
  ])("%s", async (_, peer, expected) => {
    expect(await receive(peer)).toEqual(expected);
  });

  it.each([
    ["unknown flags", "header(9, 0)"],
    ["a length without the data flag", "header(0, 2)"],
    ["the connection flag without a socket", "header(5, 0)"],
    ["a last word that is not zero", "header(1, 0, 1)"],
  ])("%s ends the channel after the messages before it", async (_, bad) => {
    expect(await receive(`write(frame('1\\n')); await step(); write(${bad}); await step()`)).toEqual([1, "disconnect"]);
  });

  it("a frame that is none ends the channel after the message that came in the same write", async () => {
    expect(await receive(`write(Buffer.concat([frame('1\\n'), header(9, 0)])); await step()`)).toEqual([
      1,
      "disconnect",
    ]);
  });

  it.each(["json", "advanced"] as const)("what a child sends has one header per message (%s)", async serialization => {
    const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
    const child = nodeSpawn(bunExe(), ["-e", `process.send("a"); process.send("bc", () => process.exit(0))`], {
      env: { ...bunEnv, NODE_CHANNEL_FD: "3", NODE_CHANNEL_SERIALIZATION_MODE: serialization },
      stdio: ["ignore", "inherit", "inherit", "pipe"],
    });
    Array.fromAsync<Buffer>(child.stdio[3] as any).then(chunks => resolve(Buffer.concat(chunks)), reject);
    const bytes = await promise;
    const headers: number[][] = [];
    const data: Buffer[] = [];
    for (let at = 0; at < bytes.length; at += 16 + data.at(-1)!.length) {
      headers.push([bytes.readUInt32LE(at), bytes.readUInt32LE(at + 12)]);
      data.push(bytes.subarray(at + 16, at + 16 + bytes.readUInt32LE(at + 8)));
    }
    expect(headers.length).toBeGreaterThan(0);
    expect(headers).toEqual(headers.map(() => [1, 0]));
    if (serialization === "json") expect(Buffer.concat(data).toString()).toBe('"a"\n"bc"\n');
    else expect(Buffer.concat(data).toString("latin1")).toMatch(/a[^]*bc/);
  });
});

describe.concurrent.each(["json", "advanced"] as const)("traffic in %s mode", serialization => {
  // On Windows more than the pipe holds. Elsewhere disconnect() drops what the socket has no room for.
  const growth = isWindows ? 100 : 0;
  function start(script: string, ipc: (message: any, child: Bun.Subprocess) => void) {
    return spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization,
      ipc,
    });
  }

  it("both sides send megabytes before either reads", async () => {
    const count = 64;
    const got: number[] = [];
    const all = Promise.withResolvers<void>();
    await using child = start(
      `const text = Buffer.alloc(24 * 1024, "c").toString();
       let next = 0;
       process.on("message", ([i, text]) => {
         if (i !== next++ || text.length !== 24 * 1024) process.exit(2);
         if (next === ${count}) process.send("complete");
       });
       for (let i = 0; i < ${count}; i++) process.send([i, text]);`,
      message => (message === "complete" ? all.resolve() : got.push(message[1].length === 24 * 1024 ? message[0] : -1)),
    );
    child.exited.then(code => all.reject(new Error(`exited with ${code}`)));
    const text = Buffer.alloc(24 * 1024, "p").toString();
    for (let i = 0; i < count; i++) child.send([i, text]);
    await all.promise;
    expect(got).toEqual(Array.from({ length: count }, (_, i) => i));
  });

  it.each([
    ["returns", ""],
    ["disconnects", "process.disconnect()"],
    ["exits in the last callback", "process.send(last, () => process.exit(0))"],
  ])("everything arrives that a child sent before it %s", async (_, leave) => {
    const got: number[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const last = [99, ""];
         for (let i = 0; i < 99; i++) process.send([i, Buffer.alloc(i * ${growth}, "x").toString()]);
         ${leave.includes("last") ? leave : `process.send(last); ${leave}`}`,
      ],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization,
      ipc: message => void got.push(message[0]),
      onDisconnect: () => resolve(),
    });
    await Promise.all([promise, child.exited]);
    expect(got).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(child.exitCode).toBe(0);
  });

  it.each([
    ["exits", "process.exit(0)"],
    ["throws", "throw new Error()"],
    ["kills itself", "process.kill(process.pid, 'SIGKILL')"],
  ])("short messages arrive that a child sent right before it %s", async (_, leave) => {
    const got: number[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [bunExe(), "-e", `for (let i = 0; i < 100; i++) process.send(i); ${leave}`],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      serialization,
      ipc: message => void got.push(message),
      onDisconnect: () => resolve(),
    });
    await Promise.all([promise, child.exited]);
    expect(got).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it("everything arrives that a parent sent before it disconnects", async () => {
    await using child = spawn({
      cmd: [
        bunExe(),
        "-e",
        `let n = 0; process.on("message", () => n++).on("disconnect", () => console.log(n)); process.send("ready")`,
      ],
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
      serialization,
      ipc(_, child) {
        for (let i = 0; i < 100; i++) child.send(Buffer.alloc(i * growth, "x").toString());
        child.disconnect();
      },
    });
    expect(await child.stdout.text()).toBe("100\n");
    expect(await child.exited).toBe(0);
  });

  it("a child that is killed with messages waiting for it ends the channel", async () => {
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

  it("a child hears that its parent is gone", async () => {
    await using parent = spawn({
      cmd: [
        bunExe(),
        "-e",
        `Bun.spawn([process.execPath, "-e", "process.on('disconnect', () => console.log('alone')); process.send(0)"], {
           detached: true,
           stdio: ["ignore", "inherit", "inherit"],
           serialization: ${JSON.stringify(serialization)},
           ipc: () => process.kill(process.pid, "SIGKILL"),
         })`,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      stdio: ["ignore", "pipe", "inherit"],
    });
    expect(await parent.stdout.text()).toBe("alone\n");
  });
});

it.each(["json", "advanced"] as const)("two messages arrive while their sender is busy (%s)", async serialization => {
  using dir = tempDir("ipc-busy-sender", {});
  let count = 0;
  await using child = spawn({
    cmd: [
      bunExe(),
      "-e",
      `for (let i = 0; i < 2; i++) process.send(i);
       while (!require("fs").existsSync("heard")) Bun.sleepSync(1);`,
    ],
    cwd: String(dir),
    env: bunEnv,
    serialization,
    ipc: () => void (++count === 2 && Bun.write(`${dir}/heard`, "")),
  });
  expect(await child.exited).toBe(0);
});

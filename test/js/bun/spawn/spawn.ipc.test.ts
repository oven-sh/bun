import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isWindows } from "harness";
import { closeSync, writeSync } from "node:fs";
import path from "path";

// The uncaught exception a receiver reports for bytes that are not a message in
// the channel's serialization format. The channel is closed before the report.
const undecodableMessageError = {
  advancedFromSubprocess:
    `The subprocess (pid <pid>) sent an IPC message that is not in Bun's "advanced" serialization format, so Bun closed the IPC channel. ` +
    `"advanced" serialization only works between two Bun processes. For IPC between Bun and Node.js, use serialization: "json".`,
  advancedFromParent:
    `The parent process sent an IPC message that is not in Bun's "advanced" serialization format, so Bun closed the IPC channel. ` +
    `"advanced" serialization only works between two Bun processes. For IPC between Bun and Node.js, use serialization: "json".`,
  jsonFromSubprocess: `The subprocess (pid <pid>) sent an IPC message that is not valid JSON, so Bun closed the IPC channel.`,
};

// What a Node.js process whose channel uses serialization: "advanced" writes for
// send({ hello: "from node" }): a 4-byte big-endian length, then the v8.serialize()
// payload (0xff 0x0f is the v8 wire-format version header). See writeChannelMessage in
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process/serialization.js#L109-L124
const nodeAdvancedFrame = Buffer.from("00000017ff0f6f220568656c6c6f220966726f6d206e6f64657b01", "hex");

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
    // line (invalid: report it and close the channel) instead of building an
    // external string over a zero-length slice.
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
      process.on("uncaughtException", err => {
        console.log("UNCAUGHT", child.connected, err.message.replaceAll(String(child.pid), "<pid>"));
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

    expect(stdout.trim().split("\n")).toEqual([
      `UNCAUGHT false ${undecodableMessageError.jsonFromSubprocess}`,
      "CHILD_EXIT 42",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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

  // The raw-frame tests below inject bytes with fs.writeSync(3). On Windows the
  // channel is a libuv IPC pipe with its own framing under ours, so a raw write
  // never reaches the decoder; the node-peer tests in spawn.ipc.bun-node.test.ts
  // and spawn.ipc.node-bun.test.ts cover the undecodable-message report there.
  it.skipIf(isWindows)(
    "a message_len that overflows header_length + message_len does not crash the receiver",
    async () => {
      // The advanced IPC framing is [u8 type][u32-le length][payload]. Decoding previously
      // checked `data.len < header_length + message_len`, which is u32 arithmetic: a child
      // sending length 0xFFFFFFFB makes the sum wrap to 0, the guard passes, and the receiver
      // slices `data[5..0]` (length ~SIZE_MAX) straight into the deserializer.
      //
      // Run the receiver in its own subprocess so a crash is observed as a failing
      // assertion here rather than taking out the test runner.
      // prettier-ignore
      const parent = `
      // The child exits right after writing, so its exit and the report can
      // land in either order; print at parent exit, when both have happened.
      const lines = [];
      process.on("uncaughtException", err => {
        lines.push("UNCAUGHT " + err.message.replaceAll(String(child.pid), "<pid>"));
      });
      process.on("exit", () => console.log([...lines, "PARENT_EXIT"].join("\\n")));
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
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", parent],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim().split("\n")).toEqual([
        `UNCAUGHT ${undecodableMessageError.advancedFromSubprocess}`,
        "PARENT_EXIT",
      ]);
      expect(stderr).not.toContain("UNEXPECTED_IPC_MESSAGE");
      expect(exitCode).toBe(0);
    },
  );

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
      process.on("uncaughtException", err => {
        console.log("UNCAUGHT", err.message.replaceAll(String(child.pid), "<pid>"));
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

      expect(stdout.trim().split("\n")).toEqual([
        `UNCAUGHT ${undecodableMessageError.advancedFromSubprocess}`,
        "CHILD_EXIT 42",
      ]);
      expect(stderr).not.toContain("UNEXPECTED_IPC_MESSAGE");
      expect(exitCode).toBe(0);
    },
  );

  it.skipIf(isWindows)("reports a subprocess that does not speak the advanced format", async () => {
    // A Node.js child answers a Bun.spawn({ ipc }) parent in v8's framing, which
    // no Bun receiver can decode. The parent must say so (naming the remedy)
    // instead of dropping the channel silently. The child here is Bun writing the
    // exact bytes Node writes, so the test does not need a node binary.
    const parent = `
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          'process.on("disconnect", () => process.exit(42)); require("fs").writeSync(3, Buffer.from("${nodeAdvancedFrame.toString("hex")}", "hex"));',
        ],
        stdio: ["ignore", "inherit", "inherit"],
        // no serialization option: "advanced", as in a bare Bun.spawn({ ipc }).
        ipc(msg) { console.error("UNEXPECTED_IPC_MESSAGE", msg); },
      });
      process.on("uncaughtException", err => {
        console.log("UNCAUGHT", child.connected, err.message.replaceAll(String(child.pid), "<pid>"));
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

    expect(stdout.trim().split("\n")).toEqual([
      `UNCAUGHT false ${undecodableMessageError.advancedFromSubprocess}`,
      "CHILD_EXIT 42",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)("a child reports a parent that does not speak the advanced format", async () => {
    // The reverse pairing: a Node.js parent that spawned Bun with
    // serialization: "advanced". The test plays the parent by holding the other
    // end of the child's NODE_CHANNEL_FD and writing Node's bytes into it.
    await using child = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          process.on("uncaughtException", err => console.log("UNCAUGHT", process.connected, err.message));
          process.on("disconnect", () => process.exit(42));
          process.on("message", msg => console.log("UNEXPECTED_IPC_MESSAGE", msg));
        `,
      ],
      env: { ...bunEnv, NODE_CHANNEL_FD: "3", NODE_CHANNEL_SERIALIZATION_MODE: "advanced" },
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    // Reading .stdio[3] hands the descriptor to us; we close it.
    const fd = child.stdio[3] as number;
    try {
      writeSync(fd, nodeAdvancedFrame);
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      expect(stdout.trim().split("\n")).toEqual([`UNCAUGHT false ${undecodableMessageError.advancedFromParent}`]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(42);
    } finally {
      closeSync(fd);
    }
  });
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

import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isWindows, tempDir } from "harness";
import * as cp from "node:child_process";
import path from "path";

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
});

describe("ipc mode advanced", () => {
  it("Buffer round-trips as Buffer (not Uint8Array) at every depth", async () => {
    // Node's advanced IPC serializer registers Buffer as a host object so the subclass
    // survives; structuredClone and Worker postMessage deliberately do not, and those
    // paths are asserted here to keep that distinction covered.
    const childSource = `
      process.on("message", m => {
        process.send({
          top:    { isBuf: Buffer.isBuffer(m.top),      ctor: m.top.constructor.name,      hex: m.top.toString("hex") },
          nested: { isBuf: Buffer.isBuffer(m.o.inner),  ctor: m.o.inner.constructor.name,  hex: m.o.inner.toString("hex") },
          inArr:  { isBuf: Buffer.isBuffer(m.arr[0]),   ctor: m.arr[0].constructor.name,   hex: m.arr[0].toString("hex") },
          u8:     { isBuf: Buffer.isBuffer(m.u8),       ctor: m.u8.constructor.name },
          empty:  { isBuf: Buffer.isBuffer(m.empty),    ctor: m.empty.constructor.name,    len: m.empty.length },
          sc:     structuredClone(Buffer.from([1])).constructor.name,
        });
        process.disconnect();
      });
    `;
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    await using child = spawn([bunExe(), "-e", childSource], {
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "advanced",
      ipc: message => resolve(message),
      onExit: (_p, exitCode, signalCode) => reject(new Error(`child exited (${exitCode}, ${signalCode}) before reply`)),
    });
    child.send({
      top: Buffer.from([0x01, 0x02, 0x03]),
      o: { inner: Buffer.from([0x09]) },
      arr: [Buffer.from([0xab, 0xcd])],
      u8: new Uint8Array([7, 8]),
      empty: Buffer.alloc(0),
    });
    const m = await promise;
    expect(m).toEqual({
      top: { isBuf: true, ctor: "Buffer", hex: "010203" },
      nested: { isBuf: true, ctor: "Buffer", hex: "09" },
      inArr: { isBuf: true, ctor: "Buffer", hex: "abcd" },
      u8: { isBuf: false, ctor: "Uint8Array" },
      empty: { isBuf: true, ctor: "Buffer", len: 0 },
      sc: "Uint8Array",
    });
  });

  it("Buffer round-trips as Buffer via child_process.fork with serialization: advanced", async () => {
    using dir = tempDir("ipc-advanced-buffer", {
      "child.js": `
        process.on("message", m => {
          process.send({
            isBuf: Buffer.isBuffer(m.b),
            ctor: m.b.constructor.name,
            nestedIsBuf: Buffer.isBuffer(m.o.inner),
            bytes: Array.from(m.b),
          });
          process.disconnect();
        });
      `,
    });
    const child = cp.fork(path.join(String(dir), "child.js"), [], {
      execPath: bunExe(),
      env: bunEnv,
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    try {
      const { promise, resolve, reject } = Promise.withResolvers<any>();
      child.once("message", resolve);
      child.once("error", reject);
      child.once("exit", (code, sig) => reject(new Error(`child exited (${code}, ${sig}) before reply`)));
      child.send({ b: Buffer.from([1, 2, 3]), o: { inner: Buffer.from([9]) } });
      const m = await promise;
      expect(m).toEqual({ isBuf: true, ctor: "Buffer", nestedIsBuf: true, bytes: [1, 2, 3] });
    } finally {
      child.kill("SIGKILL");
    }
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

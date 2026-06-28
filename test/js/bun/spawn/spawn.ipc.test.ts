import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { fork } from "child_process";
import { bunEnv, bunExe, gcTick, nodeExe, tempDir } from "harness";
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
});

describe("ipc mode advanced", () => {
  it("a message_len that overflows header_length + message_len does not crash the receiver", async () => {
    // The advanced IPC framing is [u32-be length][payload]. Checking
    // `data.len < header_length + message_len` in u32 arithmetic would let a
    // peer-controlled length near u32::MAX wrap the sum past the guard and
    // slice an enormous range into the deserializer; the decoder must compare
    // the length against the *remaining* bytes instead.
    //
    // Run the receiver in its own subprocess so a crash is observed as a failing
    // assertion here rather than taking out the test runner.
    // prettier-ignore
    const parent = `
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          // length = 0xFFFFFFFC (big-endian); header_length (4) + 0xFFFFFFFC
          // wraps to 0 in u32.
          'require("fs").writeSync(3, Buffer.from([0xff, 0xff, 0xff, 0xfc]))',
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

  it("a deeply nested message is a catchable RangeError, not a stack overflow", async () => {
    // The serializer recurses once per nesting level of the message, so it
    // must bound recursion by the native stack and throw, exactly like Node.
    using dir = tempDir("ipc-adv-deep", {
      "parent.cjs": /* js */ `
        const { fork } = require("child_process");
        const child = fork(require("path").join(__dirname, "echo.cjs"), [], {
          execPath: process.execPath, execArgv: [], serialization: "advanced", stdio: "ignore",
        });
        let deep = {};
        for (let i = 0; i < 200000; i++) deep = { deep };
        let name = "no-error";
        try {
          child.send(deep);
        } catch (e) {
          name = e.name;
        }
        child.kill();
        console.log("SURVIVED " + name);
      `,
      "echo.cjs": `process.on("message", () => {});`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "parent.cjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("SURVIVED RangeError");
    expect(exitCode).toBe(0);
  });

  it("a typed array larger than 4 GiB throws instead of truncating its length", async () => {
    // The wire format stores lengths as 32-bit varints, so byteLength is
    // narrowed from size_t. Without a guard, a 2**32-byte view wraps to 0 and
    // the receiver silently gets an empty array. V8 throws DataCloneError.
    //
    // The 4 GiB allocation is lazy zero pages and is never read (the guard
    // fires before any copy), so peak RSS stays low. Runners that still
    // cannot allocate it report SKIP instead of failing, following the
    // convention of the oversized-ArrayBuffer structuredClone tests.
    using dir = tempDir("ipc-adv-huge", {
      "parent.cjs": /* js */ `
        const { fork } = require("child_process");
        let huge;
        try {
          huge = new Uint8Array(2 ** 32);
        } catch {
          console.log("SKIP");
          process.exit(0);
        }
        const child = fork(require("path").join(__dirname, "echo.cjs"), [], {
          execPath: process.execPath, execArgv: [], serialization: "advanced", stdio: "ignore",
        });
        let name = "no-error";
        try {
          child.send(huge);
        } catch (e) {
          name = e.name;
        }
        child.kill();
        console.log("SURVIVED " + name);
      `,
      "echo.cjs": `process.on("message", () => {});`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "parent.cjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(["SURVIVED DataCloneError", "SKIP"]).toContain(stdout.trim());
    expect(exitCode).toBe(0);
  });

  it("a dense array whose trailer property count disagrees with the stream is rejected", async () => {
    // V8 (and Node) emit arrays with the dense tag 'A' and end them with
    // kEndDenseJSArray followed by two redundant varints: the number of extra
    // named properties and the length. Both must match what was actually
    // read, or the payload is malformed and the whole frame is rejected;
    // accepting it would mean a corrupt stream delivers a message.
    //
    // The child writes two complete frames to the channel fd in one syscall:
    // the same [1,2,3] dense array twice, first with the correct trailer
    // (propertyCount=0, length=3) and then with propertyCount corrupted to 5.
    // The first must be delivered; the second must not be.
    const valid = "ff0f4103490249044906240003";
    const corrupt = "ff0f4103490249044906240503";
    const got: unknown[] = [];
    const first = Promise.withResolvers<void>();
    await using child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `const v = Buffer.from("${valid}", "hex"), c = Buffer.from("${corrupt}", "hex");
         const be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
         require("fs").writeSync(3, Buffer.concat([be(v.length), v, be(c.length), c]));`,
      ],
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "advanced",
      env: bunEnv,
      ipc(message) {
        got.push(message);
        first.resolve();
      },
    });
    // Both frames arrive in one write and are decoded in the same pass, so by
    // the time the first message is observed the second has already been
    // accepted or rejected; awaiting exit then bounds the whole exchange.
    await first.promise;
    const exitCode = await child.exited;
    expect(got).toEqual([[1, 2, 3]]);
    expect(exitCode).toBe(0);
  });
});

// Node's "advanced" IPC uses V8's value-serializer format behind a 4-byte
// big-endian length prefix. Bun previously framed advanced IPC with its own
// JSC structured-clone bytes, so a bun process and a node process connected
// over an advanced channel could not understand each other in either
// direction: messages were silently never delivered.
// https://nodejs.org/api/child_process.html#advanced-serialization
describe.skipIf(!nodeExe())("ipc mode advanced node interop", () => {
  // A CJS child that runs unchanged under node and bun: echo each message
  // verbatim, then exit after the sentinel so the parent's channel closes.
  const ECHO_CHILD = /* js */ `
    process.on("message", m => {
      process.send(m);
      if (m && m.done) process.exit(0);
    });
  `;

  // A rich payload that JSON-mode IPC cannot represent. Every property here is
  // lost or corrupted by JSON (Buffer/TypedArray/Map/Set/Date/RegExp/BigInt,
  // holes, cycles, shared identity), so it can only travel over "advanced".
  function richPayload() {
    const cyclic: any[] = [1];
    cyclic.push(cyclic);
    const shared = { x: 1 };
    return {
      int: 42,
      neg: -7,
      dbl: 1.5,
      big: 2n ** 70n,
      negBig: -5n,
      str: "h\u00e9llo \u65e5\u672c",
      buf: Buffer.from([1, 2, 3]),
      u16: new Uint16Array([256, 513]),
      map: new Map<unknown, unknown>([
        ["k", 1],
        [2, "v"],
      ]),
      set: new Set([1, "a"]),
      date: new Date(12345),
      re: /ab+c/gi,
      undef: { a: undefined },
      nul: null,
      sparse: [, , 7],
      cyclic,
      shared: [shared, shared],
      done: true,
    };
  }

  // Forks `childSource` with the given execPath over an advanced channel,
  // sends `payload`, and resolves with the first echoed message. Every
  // failure path (exit before echo, channel error) rejects so a broken wire
  // format fails the test immediately instead of just hanging.
  function echoOnce(childPath: string, execPath: string, payload: unknown): Promise<any> {
    const child = fork(childPath, [], { execPath, execArgv: [], serialization: "advanced", stdio: "ignore" });
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    child.on("message", resolve);
    child.on("error", reject);
    child.on("exit", (code, signal) => reject(new Error(`child exited (${code}, ${signal}) before echoing`)));
    child.send(payload as any);
    return promise.finally(() => child.kill());
  }

  // The node child both deserializes what bun serialized and re-serializes the
  // echo with real V8, so one round trip exercises both halves of the format
  // against the reference implementation.
  it("a bun parent can exchange structured values with a node child", async () => {
    using dir = tempDir("ipc-adv-bun-node", { "echo.cjs": ECHO_CHILD });
    const sent = richPayload();
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), nodeExe()!, sent);

    expect(got).toEqual(sent as any);
    expect(Buffer.isBuffer(got.buf)).toBe(true);
    expect(got.u16).toBeInstanceOf(Uint16Array);
    expect(got.map).toBeInstanceOf(Map);
    expect(got.set).toBeInstanceOf(Set);
    expect(got.date).toBeInstanceOf(Date);
    expect(got.re).toBeInstanceOf(RegExp);
    // Holes survive as holes, not undefined elements.
    expect(0 in got.sparse).toBe(false);
    // Cycles and shared references deserialize to the same object identity.
    expect(got.cyclic[1]).toBe(got.cyclic);
    expect(got.shared[0]).toBe(got.shared[1]);
  });

  // Same exchange with a bun child, driven by a node parent whose
  // assert.deepStrictEqual is the reference comparison. This covers the
  // child-side NODE_CHANNEL_FD setup path, which is distinct from the
  // Subprocess path the previous test exercises.
  it("a node parent can exchange structured values with a bun child", async () => {
    using dir = tempDir("ipc-adv-node-bun", {
      "echo.cjs": ECHO_CHILD,
      // prettier-ignore
      "parent.cjs": /* js */ `
        const assert = require("assert");
        const { fork } = require("child_process");
        const cyclic = [1]; cyclic.push(cyclic);
        const shared = { x: 1 };
        const sent = {
          int: 42, neg: -7, dbl: 1.5, big: 2n ** 70n, negBig: -5n,
          str: "h\\u00e9llo \\u65e5\\u672c",
          buf: Buffer.from([1, 2, 3]),
          u16: new Uint16Array([256, 513]),
          map: new Map([["k", 1], [2, "v"]]),
          set: new Set([1, "a"]),
          date: new Date(12345),
          re: /ab+c/gi,
          undef: { a: undefined },
          nul: null,
          sparse: [, , 7],
          cyclic,
          shared: [shared, shared],
          done: true,
        };
        const child = fork(require("path").join(__dirname, "echo.cjs"), [], {
          execPath: process.argv[2], execArgv: [], serialization: "advanced", stdio: "ignore",
        });
        child.on("exit", () => { console.log("FAIL child exited before echoing"); process.exit(1); });
        child.on("message", got => {
          child.removeAllListeners("exit");
          try {
            assert.deepStrictEqual(got, sent);
            assert.strictEqual(got.cyclic[1], got.cyclic);
            assert.strictEqual(got.shared[0], got.shared[1]);
            assert.strictEqual(0 in got.sparse, false);
            console.log("OK");
          } catch (e) {
            console.log("FAIL " + e.message);
          }
          child.kill();
          process.exit(0);
        });
        child.send(sent);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [nodeExe()!, path.join(String(dir), "parent.cjs"), bunExe()],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({ stdout: "OK", exitCode: 0, stderr: "" });
  });

  it("a bun parent can exchange structured values with a bun child", async () => {
    using dir = tempDir("ipc-adv-bun-bun", { "echo.cjs": ECHO_CHILD });
    const sent = richPayload();
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), bunExe(), sent);

    expect(got).toEqual(sent as any);
    expect(Buffer.isBuffer(got.buf)).toBe(true);
    expect(got.cyclic[1]).toBe(got.cyclic);
    expect(got.shared[0]).toBe(got.shared[1]);
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

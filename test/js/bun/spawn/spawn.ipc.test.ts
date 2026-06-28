import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { fork } from "child_process";
import { bunEnv, bunExe, gcTick, isWindows, nodeExe, tempDir } from "harness";
import path from "path";

// Tests that inject raw wire bytes via `fs.writeSync()` to the channel fd.
// On Windows the channel is a libuv named pipe already claimed by uv_read_start,
// so a raw write is unsupported; the decoder paths are platform-independent.
const rawInjection = it.skipIf(isWindows);

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
  // Writes each hex payload to the channel fd as a complete advanced frame
  // (4-byte big-endian length + bytes). `onDisconnect` runs after all frames
  // were decoded or rejected, so `messages` is final and an empty one rejects.
  async function injectFrames(...hexPayloads: string[]): Promise<{ messages: any[]; exitCode: number }> {
    const messages: any[] = [];
    const closed = Promise.withResolvers<void>();
    await using child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `const frames = ${JSON.stringify(hexPayloads)}.map(h => Buffer.from(h, "hex"));
         const be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
         require("fs").writeSync(3, Buffer.concat(frames.flatMap(p => [be(p.length), p])));`,
      ],
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "advanced",
      env: bunEnv,
      ipc(message) {
        messages.push(message);
      },
      onDisconnect() {
        if (messages.length) closed.resolve();
        else closed.reject(new Error("IPC channel closed before any injected frame was delivered"));
      },
    });
    await closed.promise;
    return { messages, exitCode: await child.exited };
  }

  rawInjection("a message_len that overflows header_length + message_len does not crash the receiver", async () => {
    // A peer-controlled length near u32::MAX must not wrap the bounds check
    // and slice an enormous range into the deserializer; the decoder compares
    // against the *remaining* bytes. The injector sends one valid {a:1} frame
    // (proving the write landed and the decoder is running), then the raw
    // header [ff ff ff fc], then exits. EOF is only observed after every
    // preceding byte was consumed, so by the time `onDisconnect` fires the
    // overflow guard has provably parsed 0xFFFFFFFC and survived it. The
    // decoder runs in a nested bun process so a native crash shows up as a
    // nonzero exit code instead of taking the test runner with it.
    // prettier-ignore
    const parent = `
      const messages = [];
      const disconnected = Promise.withResolvers();
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          // One well-formed frame ({a: 1}), then a bare 4-byte header whose
          // length (0xFFFFFFFC) + header_length (4) wraps to 0 in u32.
          'const a = Buffer.from("ff0f6f22016149027b01", "hex");' +
          'const be = Buffer.alloc(4); be.writeUInt32BE(a.length);' +
          'require("fs").writeSync(3, Buffer.concat([be, a, Buffer.from([0xff, 0xff, 0xff, 0xfc])]))',
        ],
        stdio: ["ignore", "inherit", "inherit"],
        serialization: "advanced",
        ipc(msg) { messages.push(msg); },
        onDisconnect: disconnected.resolve,
      });
      await disconnected.promise;
      console.log(JSON.stringify(messages));
      await child.exited;
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parent],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: JSON.stringify([{ a: 1 }]),
      exitCode: 0,
      stderr: expect.any(String),
    });
  });

  rawInjection("a payload that is not V8-serialized closes the channel instead of hanging", async () => {
    // An older bun's advanced mode opened with the private version packet
    // [01 01 00 00 00], which reads as a ~16 MB length that never arrives.
    // The parent must detect the bad frame and disconnect rather than hang.
    using dir = tempDir("ipc-adv-badframe", {
      "parent.cjs": /* js */ `
        const { fork } = require("child_process");
        const child = fork(require("path").join(__dirname, "inject.cjs"), [], {
          execPath: process.execPath, execArgv: [], serialization: "advanced", stdio: "ignore",
        });
        child.on("message", m => console.error("UNEXPECTED_IPC_MESSAGE", JSON.stringify(m)));
        // The injector never exits on its own. An exit seen before disconnect
        // means its writeSync to fd 3 failed, not that the decoder rejected
        // the frame, so that path must not pass.
        child.on("exit", (code, signal) => {
          console.log("FAIL injector exited before the decoder rejected the frame: " + code + ", " + signal);
          process.exitCode = 1;
        });
        child.on("disconnect", () => {
          child.removeAllListeners("exit");
          console.log("DISCONNECTED");
          child.kill();
        });
      `,
      "inject.cjs": /* js */ `
        require("fs").writeSync(3, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00]));
        setInterval(() => {}, 1000);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "parent.cjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("UNEXPECTED_IPC_MESSAGE");
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "DISCONNECTED", exitCode: 0 });
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
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: "SURVIVED RangeError",
      exitCode: 0,
      stderr: expect.any(String),
    });
  });

  it("a typed array larger than 4 GiB throws instead of truncating its length", async () => {
    // Wire lengths are 32-bit varints; without a guard a 2**32-byte view
    // wraps to 0 and the receiver silently gets an empty array. The 4 GiB is
    // lazy zero pages that are never read; runners that can't allocate it SKIP.
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
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(["SURVIVED DataCloneError", "SKIP"]).toContain(stdout.trim());
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.any(String) });
  });

  rawInjection("a dense array whose trailer property count disagrees with the stream is rejected", async () => {
    // V8's dense-array trailer carries two redundant varints (extra property
    // count, length). Both frames are [1,2,3]; the second corrupts the
    // property count to 5. The first must arrive, the corrupt one must not.
    const valid = "ff0f4103490249044906240003";
    const corrupt = "ff0f4103490249044906240503";
    const { messages, exitCode } = await injectFrames(valid, corrupt);
    expect(messages).toEqual([[1, 2, 3]]);
    expect(exitCode).toBe(0);
  });

  rawInjection("kTheHole anywhere but a dense array's element list is rejected", async () => {
    // kTheHole ('-') only ever marks a hole inside a dense array. V8 rejects
    // it in any other position, so `{a: <kTheHole>}` must close the channel
    // rather than be delivered as `{a: undefined}`.
    const valid = "ff0f6f22016149027b01"; // {a: 1}
    const holeAsValue = "ff0f6f2201612d7b01"; // {a: <kTheHole>}
    const { messages, exitCode } = await injectFrames(valid, holeAsValue);
    expect(messages).toEqual([{ a: 1 }]);
    expect(exitCode).toBe(0);
  });

  rawInjection("the V8 wire version is floored at 13 and open-ended above", async () => {
    // The decoder speaks the v13+ grammar, so a lower version would silently
    // mis-parse and must be rejected. A HIGHER version is accepted on purpose
    // (deliberate divergence from V8's own `> kLatestVersion` check): as a
    // follower implementation, rejecting the header the day Node bumps its
    // wire version would fail every frame, instead of only the frames that
    // use a genuinely new tag. Payloads are {a: 1}; only the version differs.
    // A trailing valid frame after v12 proves v12 CLOSED the channel rather
    // than being silently skipped: if it were skipped the sentinel would land.
    const v15 = "ff0f6f22016149027b01";
    const v16 = "ff106f22016149027b01";
    const v12 = "ff0c6f22016149027b01";
    const { messages, exitCode } = await injectFrames(v15, v16, v12, v15);
    expect(messages).toEqual([{ a: 1 }, { a: 1 }]);
    expect(exitCode).toBe(0);
  });

  // A raw `new v8.Serializer()` emits views as kArrayBuffer + kArrayBufferView
  // (with a trailing flags varint), not as host objects. Payload is that
  // serializer's v15 output for `{ view: new Uint8Array([10, 20, 30]) }`.
  rawInjection("a raw V8 ArrayBuffer plus ArrayBufferView record deserializes to a typed array", async () => {
    const { messages, exitCode } = await injectFrames("ff0f6f22047669657742030a141e56420003007b01");
    expect(messages).toEqual([{ view: new Uint8Array([10, 20, 30]) }]);
    expect(messages[0].view).toBeInstanceOf(Uint8Array);
    expect(exitCode).toBe(0);
  });

  // A second view over an already-seen buffer arrives as `^<id> V<subtag>...`;
  // the 'V' must be consumed as that buffer's view. Payload is v8.Serializer
  // output for `{pair: [a, b]}`, both views over ArrayBuffer([10,20,30,40]).
  rawInjection("two views over one ArrayBuffer via kObjectReference share the buffer", async () => {
    const { messages, exitCode } = await injectFrames(
      "ff0f6f220470616972410242040a141e2856420002005e0256420202002400027b01",
    );
    const [got] = messages;
    expect(got.pair).toEqual([new Uint8Array([10, 20]), new Uint8Array([30, 40])]);
    // The defining property of the kObjectReference form: both views are
    // backed by the SAME ArrayBuffer, at their original offsets.
    expect(got.pair[0].buffer).toBe(got.pair[1].buffer);
    expect(got.pair[0].byteOffset).toBe(0);
    expect(got.pair[1].byteOffset).toBe(2);
    expect(exitCode).toBe(0);
  });

  // A length-tracking view travels with wire byteLength 0 and flags 0x03;
  // taking that 0 literally yields an empty view. Payload is v8.Serializer
  // output for a Uint8Array over `new ArrayBuffer(4, {maxByteLength: 8})`.
  rawInjection("a length-tracking view over a resizable ArrayBuffer stays length-tracking", async () => {
    const { messages, exitCode } = await injectFrames("ff0f6f2204766965777e04080102030456420000037b01");
    const [got] = messages;
    expect(got.view).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(got.view.buffer.resizable).toBe(true);
    expect(got.view.buffer.maxByteLength).toBe(8);
    // Length-tracking is the load-bearing property: growing the buffer must
    // grow the view. V8's own deserializer reports length 8 here.
    got.view.buffer.resize(8);
    expect(got.view.length).toBe(8);
    expect(exitCode).toBe(0);
  });

  // V8's ValidateJSArrayBufferViewFlags requires the view's "backed by a
  // resizable buffer" bit to agree with the buffer that preceded it, in both
  // directions. Both frames were confirmed rejected by `v8.deserialize()`.
  rawInjection("a view whose resizable-buffer flag disagrees with its buffer is rejected", async () => {
    const valid = "ff0f6f22016149027b01"; // {a: 1}
    // kArrayBuffer(4 bytes) + View(Uint8, off 0, len 4, flags 0b10 = rab set)
    const rabFlagOnFixedBuffer = "ff0f4204010203045642000402";
    // kResizableArrayBuffer(len 4, max 8) + View(Uint8, off 0, len 4, flags 0)
    const noRabFlagOnResizableBuffer = "ff0f7e0408010203045642000400";
    for (const corrupt of [rabFlagOnFixedBuffer, noRabFlagOnResizableBuffer]) {
      const { messages, exitCode } = await injectFrames(valid, corrupt);
      expect(messages).toEqual([{ a: 1 }]);
      expect(exitCode).toBe(0);
    }
  });
});

// Structured-clone round trips over an advanced channel. The node-interop
// cases (gated on node being installed) validate against V8 as the reference
// implementation; the bun<->bun cases run unconditionally.
describe("ipc mode advanced structured clone", () => {
  // An echo child that runs under both node and bun. It never exits on its
  // own (under node a sync `process.exit` races the async echo's flush), so
  // every parent kills it after receiving the echo.
  const ECHO_CHILD = /* js */ `
    process.on("message", m => {
      process.send(m);
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
      // Integer-valued doubles past the int32 range, non-finites, and -0 all
      // have to take the serializer's kDouble path rather than its int32
      // downgrade, and each is a distinct Number on the far side.
      wide: 2 ** 40,
      inf: Infinity,
      negInf: -Infinity,
      nan: NaN,
      negZero: -0,
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

  // Forks `childPath` with the given execPath over an advanced channel, sends
  // `payload`, and resolves with the first echoed message. Every failure
  // (exit / error / disconnect / a throwing send) rejects instead of hanging.
  function echoOnce(childPath: string, execPath: string, payload: unknown): Promise<any> {
    const child = fork(childPath, [], { execPath, execArgv: [], serialization: "advanced", stdio: "ignore" });
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    child.on("message", resolve);
    child.on("error", reject);
    child.on("disconnect", () => reject(new Error("IPC channel disconnected before echoing")));
    child.on("exit", (code, signal) => reject(new Error(`child exited (${code}, ${signal}) before echoing`)));
    // Route a synchronous serialization throw into the same reject path so the
    // `finally` below still kills the (otherwise immortal) echo child.
    try {
      child.send(payload as any);
    } catch (error) {
      reject(error);
    }
    return promise.finally(() => child.kill());
  }

  // The node child both deserializes what bun serialized and re-serializes the
  // echo with real V8, so one round trip exercises both halves of the format
  // against the reference implementation.
  it.skipIf(!nodeExe())("a bun parent can exchange structured values with a node child", async () => {
    using dir = tempDir("ipc-adv-bun-node", { "echo.cjs": ECHO_CHILD });
    const sent = richPayload();
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), nodeExe()!, sent);

    expect(got).toEqual(sent as any);
    // toEqual does not distinguish -0 from +0; only SameValue does.
    expect(Object.is(got.negZero, -0)).toBe(true);
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

  // Same exchange with a bun child driven by a node parent, whose
  // assert.deepStrictEqual is the reference. This covers the child-side
  // NODE_CHANNEL_FD setup path, distinct from the Subprocess path above.
  it.skipIf(!nodeExe())("a node parent can exchange structured values with a bun child", async () => {
    using dir = tempDir("ipc-adv-node-bun", {
      "echo.cjs": ECHO_CHILD,
      // prettier-ignore
      "parent.cjs": /* js */ `
        const assert = require("assert");
        const { fork } = require("child_process");
        const cyclic = [1]; cyclic.push(cyclic);
        const shared = { x: 1 };
        const sent = {
          int: 42, neg: -7, dbl: 1.5,
          wide: 2 ** 40, inf: Infinity, negInf: -Infinity, nan: NaN, negZero: -0,
          big: 2n ** 70n, negBig: -5n,
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
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: "OK",
      exitCode: 0,
      stderr: expect.any(String),
    });
  });

  it("a bun parent can exchange structured values with a bun child", async () => {
    using dir = tempDir("ipc-adv-bun-bun", { "echo.cjs": ECHO_CHILD });
    const sent = richPayload();
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), bunExe(), sent);

    expect(got).toEqual(sent as any);
    // toEqual does not distinguish -0 from +0; only SameValue does.
    expect(Object.is(got.negZero, -0)).toBe(true);
    expect(Buffer.isBuffer(got.buf)).toBe(true);
    expect(got.cyclic[1]).toBe(got.cyclic);
    expect(got.shared[0]).toBe(got.shared[1]);
  });

  // V8 snapshots the own key list and re-checks own-ness before each read,
  // so a getter that deletes a sibling must omit it, not emit it as
  // `undefined` (which a prototype-walking [[Get]] on the stale list would).
  it("a property deleted by an earlier getter is omitted, not serialized as undefined", async () => {
    using dir = tempDir("ipc-adv-deleted-prop", { "echo.cjs": ECHO_CHILD });
    const sent = {
      get a() {
        delete (this as any).b;
        return 1;
      },
      b: 2,
      done: true,
    };
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), bunExe(), sent);

    // `toEqual` treats `{b: undefined}` and `{}` as equal, so assert the key
    // list directly: `b` must not exist at all on the received object.
    expect(Object.keys(got).sort()).toEqual(["a", "done"]);
    expect("b" in got).toBe(false);
    expect(got.a).toBe(1);
  });

  // V8 enumerates only an array's own keys, so an inherited index must stay
  // a hole. The index is injected via a per-array prototype swap rather than
  // polluting Array.prototype, which bun's internal holey arrays also observe.
  it.skipIf(!nodeExe())("an inherited array index is not serialized as an own element", async () => {
    using dir = tempDir("ipc-adv-inherited-index", {
      "echo.cjs": ECHO_CHILD,
      // prettier-ignore
      "parent.cjs": /* js */ `
        const { fork } = require("child_process");
        const child = fork(require("path").join(__dirname, "echo.cjs"), [], {
          execPath: process.argv[2], execArgv: [], serialization: "advanced", stdio: "ignore",
        });
        child.on("exit", () => { console.log("FAIL child exited before echoing"); process.exit(1); });
        child.on("message", got => {
          child.removeAllListeners("exit");
          const own = [Object.hasOwn(got, 0), Object.hasOwn(got, 1), Object.hasOwn(got, 2)].join();
          const vals = [got[0], got[1], got[2], got.length].join();
          console.log(own === "true,false,true" && vals === "0,,2,3" ? "OK" : "FAIL own=" + own + " vals=" + vals);
          child.kill();
          process.exit(0);
        });
        // arr[1] is a hole, but "1 in arr" is true via the swapped-in
        // prototype. A serializer that probes indices through the prototype
        // chain emits 99 as an own element at index 1.
        const arr = [0, , 2];
        Object.setPrototypeOf(arr, { __proto__: Array.prototype, 1: 99 });
        child.send(arr);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "parent.cjs"), nodeExe()!],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "OK", exitCode: 0 });
  });

  // V8's error reader walks the sub-tags in the fixed order message, stack,
  // cause, so emitting the cause early makes node reject the frame. The node
  // child re-serializes the echo, proving the reader against real V8 output too.
  it.skipIf(!nodeExe())("an Error with an object cause round-trips through a node child", async () => {
    using dir = tempDir("ipc-adv-err-node", { "echo.cjs": ECHO_CHILD });
    const e = new TypeError("boom");
    e.cause = { x: 1 };
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), nodeExe()!, { e, pair: [e, e], done: true });

    expect(got.e).toBeInstanceOf(TypeError);
    expect(got.e.message).toBe("boom");
    expect(got.e.cause).toEqual({ x: 1 });
    // A second reference to the Error must resolve to the Error, not to its cause.
    expect(got.pair[0]).toBe(got.e);
    expect(got.pair[1]).toBe(got.e);
  });

  // V8 gates kCause on HasOwnProperty: an inherited cause is never serialized
  // but an own `cause: undefined` is. The inherited cause is injected via a
  // per-object prototype swap rather than polluting Error.prototype globally.
  it.skipIf(!nodeExe())("an inherited Error cause is not serialized but an own undefined one is", async () => {
    using dir = tempDir("ipc-adv-err-own-cause", { "echo.cjs": ECHO_CHILD });
    const noOwn = new TypeError("no own cause");
    Object.setPrototypeOf(noOwn, { __proto__: TypeError.prototype, cause: { inherited: true } });
    const ownUndef = new TypeError("own undefined cause");
    ownUndef.cause = undefined;
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), nodeExe()!, { noOwn, ownUndef, done: true });

    expect(got.noOwn).toBeInstanceOf(TypeError);
    expect({ hasOwnCause: Object.hasOwn(got.noOwn, "cause"), cause: got.noOwn.cause }).toEqual({
      hasOwnCause: false,
      cause: undefined,
    });
    expect({ hasOwnCause: Object.hasOwn(got.ownUndef, "cause"), cause: got.ownUndef.cause }).toEqual({
      hasOwnCause: true,
      cause: undefined,
    });
  });

  // Both ends must assign the Error its object id BEFORE the cause's objects
  // get theirs; getting the reader backwards shifts every id assigned after
  // the cause, so [e, e] silently comes back as [e, e.cause].
  it("object ids stay aligned across an Error cause between two bun processes", async () => {
    using dir = tempDir("ipc-adv-err-ids", { "echo.cjs": ECHO_CHILD });
    const e = new Error("m");
    e.cause = { x: 1 };
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), bunExe(), { pair: [e, e], done: true });

    expect(got.pair[1]).toBe(got.pair[0]);
    expect(got.pair[0].cause).toEqual({ x: 1 });
    expect(got.pair[1]).not.toBe(got.pair[0].cause);
  });

  // Registering the Error before reading its cause is also what lets a
  // self-referential cause resolve; V8 round-trips this with identity intact.
  it("a self-referential Error cause round-trips with identity", async () => {
    using dir = tempDir("ipc-adv-err-self", { "echo.cjs": ECHO_CHILD });
    const e = new Error("self");
    e.cause = e;
    const got = await echoOnce(path.join(String(dir), "echo.cjs"), bunExe(), { e, done: true });

    expect(got.e).toBeInstanceOf(Error);
    expect(got.e.cause).toBe(got.e);
  });

  // V8 refuses to clone these; falling through to the plain-object path would
  // silently deliver `{}` to the receiver instead of throwing at the sender.
  it("sending a WeakMap, WeakSet, WeakRef, or FinalizationRegistry throws DataCloneError", async () => {
    using dir = tempDir("ipc-adv-weak", { "echo.cjs": ECHO_CHILD });
    const child = fork(path.join(String(dir), "echo.cjs"), [], {
      execPath: bunExe(),
      execArgv: [],
      serialization: "advanced",
      stdio: "ignore",
    });
    try {
      for (const value of [new WeakMap(), new WeakSet(), new WeakRef({}), new FinalizationRegistry(() => {})]) {
        expect(() => child.send(value as any)).toThrow("could not be cloned");
      }
    } finally {
      child.kill();
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

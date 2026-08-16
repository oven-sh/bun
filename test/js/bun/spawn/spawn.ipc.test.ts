import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isLinux, isWindows, shellExe, tempDir } from "harness";
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

  // On the waiter-thread exit path (no usable pidfd, forced here with the feature flag) the
  // child's exit reaches the parent as a task, which runs before the event loop polls the IPC
  // socket. The parent used to close the channel on exit without reading it, dropping whatever
  // the child sent right before exiting; node reads the channel to EOF. The parent below stays
  // off its event loop until the child is dead, so the exit is always processed first.
  it.concurrent.skipIf(!isLinux)("delivers messages sent right before exit when the exit is seen first", async () => {
    const parent = `
      const { readFileSync } = require("node:fs");
      const received = [];
      const disconnected = Promise.withResolvers();
      const child = Bun.spawn({
        cmd: [
          process.execPath, "-e",
          'process.send("one"); process.send({ two: 2 }); Promise.resolve().then(() => process.exit(7));',
        ],
        stdio: ["ignore", "inherit", "inherit"],
        serialization: ${JSON.stringify(mode)},
        ipc(message) { received.push(message); },
        onDisconnect() { disconnected.resolve(); },
      });
      function childIsDead() {
        let stat;
        try {
          stat = readFileSync("/proc/" + child.pid + "/stat", "latin1");
        } catch {
          return true; // already reaped
        }
        // "<pid> (<comm>) <state> ..."
        return stat[stat.lastIndexOf(")") + 2] === "Z";
      }
      const deadline = Date.now() + 30_000;
      while (!childIsDead()) {
        if (Date.now() > deadline) throw new Error("child did not exit");
        Bun.sleepSync(1);
      }
      // The waiter thread posts the exit task moments after the child dies; give it a generous
      // head start before this process returns to its event loop.
      Bun.sleepSync(50);
      const exitCode = await child.exited;
      const receivedBeforeExited = [...received];
      await disconnected.promise;
      console.log(JSON.stringify({ receivedBeforeExited, received, exitCode }));
    `;
    await using proc = spawn({
      cmd: [bunExe(), "-e", parent],
      // BUN_FEATURE_FLAG_FORCE_WAITER_THREAD is only honored when BUN_GARBAGE_COLLECTOR_LEVEL is
      // also set; bunEnv sets the latter.
      env: { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        receivedBeforeExited: ["one", { two: 2 }],
        received: ["one", { two: 2 }],
        exitCode: 7,
      }),
      stderr: "",
      exitCode: 0,
    });
  });
});

// After the child exits the channel is closed even if its end is still held open by a grandchild
// (the channel is never awaited to EOF), but not before what was already written has been read.
it.concurrent.skipIf(isWindows)(
  "a grandchild holding the channel open delays neither the last message nor the disconnect",
  async () => {
    const received: unknown[] = [];
    const disconnected = Promise.withResolvers<void>();
    await using child = spawn({
      // fd 3 is the child's end of the channel. `sleep` inherits it and outlives the shell.
      cmd: [shellExe(), "-c", 'echo \'{"from":"shell"}\' >&3; sleep 30 >/dev/null 2>&1 & echo $!'],
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
      serialization: "json",
      ipc(message) {
        received.push(message);
      },
      onDisconnect() {
        disconnected.resolve();
      },
    });
    const grandchildPid = Number((await child.stdout.text()).trim());
    try {
      expect(grandchildPid).toBeGreaterThan(0);
      expect(await child.exited).toBe(0);
      await disconnected.promise;
      expect(received).toEqual([{ from: "shell" }]);
    } finally {
      if (grandchildPid > 0) process.kill(grandchildPid);
    }
  },
);

// Same race as "delivers messages sent right before exit" above, on every POSIX platform that can
// force the waiter thread (macOS included, where /proc is not available): the child writes a
// sentinel file once it has sent, and the parent stays off its event loop until the sentinel exists
// and the child has had time to exit, so the exit is normally processed before the channel is read.
it.concurrent.skipIf(isWindows)("delivers a message sent right before exit on the waiter-thread path", async () => {
  using dir = tempDir("ipc-exit-message", {});
  const sentinel = path.join(String(dir), "sent");
  const child = `process.send("hello"); require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, ""); Promise.resolve().then(() => process.exit(0));`;
  const parent = `
    const { existsSync } = require("node:fs");
    const received = [];
    const child = Bun.spawn({
      cmd: [process.execPath, "-e", ${JSON.stringify(child)}],
      stdio: ["ignore", "inherit", "inherit"],
      serialization: "json",
      ipc(message) { received.push(message); },
    });
    const deadline = Date.now() + 30_000;
    while (!existsSync(${JSON.stringify(sentinel)})) {
      if (Date.now() > deadline) throw new Error("child did not send");
      Bun.sleepSync(1);
    }
    // The child exits right after writing the sentinel; stay off the event loop until the waiter
    // thread has had time to post the exit.
    Bun.sleepSync(100);
    const exitCode = await child.exited;
    console.log(JSON.stringify({ received, exitCode }));
  `;
  await using proc = spawn({
    cmd: [bunExe(), "-e", parent],
    // Only honored together with BUN_GARBAGE_COLLECTOR_LEVEL, which bunEnv sets.
    env: { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ received: ["hello"], exitCode: 0 }),
    stderr: "",
    exitCode: 0,
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

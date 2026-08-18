import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isLinux, isWindows } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import path from "path";

// Kills the child and returns once it is dead without touching the event loop, so that its exit
// is pending at the same time as whatever its death did to the channel. On Linux the child is dead
// once /proc shows it as a zombie with no other threads left (the last thread to go is the one
// that closes its descriptors and signals the exit; a debug build takes ~15ms to get there), or
// once it is gone from /proc (already reaped by the waiter thread). Elsewhere a SIGKILL'd child is
// gone within a few milliseconds.
function killAndBlockUntilDead(child: Bun.Subprocess) {
  child.kill("SIGKILL");
  if (!isLinux) {
    Bun.sleepSync(100);
    return;
  }
  const deadline = Date.now() + 30_000;
  for (;;) {
    let dead: boolean;
    try {
      const stat = readFileSync(`/proc/${child.pid}/stat`, "latin1");
      dead = stat[stat.lastIndexOf(")") + 2] === "Z" && readdirSync(`/proc/${child.pid}/task`).length === 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
      dead = true;
    }
    if (dead) return;
    if (Date.now() > deadline) throw new Error("child did not die");
    Bun.sleepSync(1);
  }
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

  // The tests below kill the child and stay off the event loop until it is dead, so the channel
  // going away and the exit are both pending when the loop resumes. As in node, the channel's close
  // has to be reported before the exit; it used to be left to a later event-loop task, so onExit
  // ran first.
  async function killAndReportOrder(child: Bun.Subprocess, events: string[], done: Promise<unknown>) {
    killAndBlockUntilDead(child);
    await done;
    return events;
  }

  it.concurrent("onDisconnect runs before onExit when the child dies with the channel drained", async () => {
    const events: string[] = [];
    const ready = Promise.withResolvers<void>();
    const disconnected = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.on("message", () => console.log("received")); setInterval(() => {}, 1000); process.send("ready");`,
      ],
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
      serialization: mode,
      ipc: () => ready.resolve(),
      onDisconnect() {
        events.push("disconnect");
        disconnected.resolve();
      },
      onExit() {
        events.push("exit");
        exited.resolve();
      },
    });
    await ready.promise;
    child.send("read me");
    // Once this is printed the child has read everything we sent, so its end closes cleanly (EOF).
    await child.stdout.getReader().read();
    expect(await killAndReportOrder(child, events, Promise.all([disconnected.promise, exited.promise]))).toEqual([
      "disconnect",
      "exit",
    ]);
  });

  // The child never reads its end of the channel, so what we send stays unread; on Linux our end
  // then reports ECONNRESET instead of EOF when the child dies, which closes the channel through
  // a different path than the test above. A message larger than the channel's buffers is on top
  // of that still being written when the child dies.
  it.concurrent.each([
    ["a short message", "never read"],
    ["a message larger than the channel's buffers", Buffer.alloc(4 * 1024 * 1024, "x").toString()],
  ])("onDisconnect runs before onExit when the child dies with %s unread", async (_label, message) => {
    const events: string[] = [];
    const disconnected = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [bunExe(), "-e", `console.log("ready"); setInterval(() => {}, 1000);`],
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
      serialization: mode,
      ipc() {},
      onDisconnect() {
        events.push("disconnect");
        disconnected.resolve();
      },
      onExit() {
        events.push("exit");
        exited.resolve();
      },
    });
    await child.stdout.getReader().read();
    child.send(message);
    expect(await killAndReportOrder(child, events, Promise.all([disconnected.promise, exited.promise]))).toEqual([
      "disconnect",
      "exit",
    ]);
  });
});

// The waiter thread is the Linux fallback for kernels and sandboxes without pidfd. It hands the
// exit to the loop as a task, which runs before the loop so much as polls the channel, so the order
// cannot come from which of the two the loop sees first. Reruns the ordering tests above that way.
it.skipIf(!isLinux || Boolean(process.env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD))(
  "onDisconnect runs before onExit when the exit is reported by the waiter thread",
  async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "test",
        import.meta.path,
        "-t",
        "ipc mode json onDisconnect runs before onExit when the child dies",
      ],
      // Only honored together with BUN_GARBAGE_COLLECTOR_LEVEL, which bunEnv sets.
      env: { ...bunEnv, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout + stderr).toContain(" 3 pass");
    expect(exitCode).toBe(0);
  },
);

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

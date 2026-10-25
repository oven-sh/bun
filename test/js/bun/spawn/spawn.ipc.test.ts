import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isLinux, isWindows, shellExe, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

function blockUntil(what: string, condition: () => boolean) {
  const deadline = Date.now() + 30_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    Bun.sleepSync(1);
  }
}

// Returns once a child that was killed, or is exiting on its own, is dead, without touching the
// event loop, so that its exit is pending at the same time as whatever its death did to the
// channel. On Linux the child is dead once /proc shows it as a zombie with no other threads left
// (the last thread to go is the one that closes its descriptors and signals the exit; a debug build
// takes ~15ms to get there), or once it is gone from /proc (already reaped by the waiter thread).
// Elsewhere such a child is gone within a few milliseconds.
function blockUntilDead(pid: number) {
  if (!isLinux) {
    Bun.sleepSync(100);
    return;
  }
  blockUntil("the child to die", () => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
      return stat[stat.lastIndexOf(")") + 2] === "Z" && readdirSync(`/proc/${pid}/task`).length === 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
      return true;
    }
  });
}

function killAndBlockUntilDead(child: Bun.Subprocess) {
  child.kill("SIGKILL");
  blockUntilDead(child.pid);
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

  // Closing the channel when the child exits must not discard what the child sent last. On Windows
  // the exit reaches the loop ahead of that message when the child wrote it, and exited, while an
  // `ipc` handler was running.
  it.concurrent("delivers what the child sent right before exiting while an ipc handler was running", async () => {
    using dir = tempDir("ipc-last-message", {});
    const parentIsBusy = path.join(String(dir), "parent-is-busy");
    const received: unknown[] = [];
    const disconnected = Promise.withResolvers<void>();
    await using child = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { existsSync } = require("node:fs");
        process.send("first");
        // The last message goes out only once the parent handles the first, and the exit follows
        // once that message has left (Windows writes it from the event loop).
        const deadline = Date.now() + 30_000;
        const timer = setInterval(() => {
          if (Date.now() > deadline) process.exit(1);
          if (!existsSync(${JSON.stringify(parentIsBusy)})) return;
          clearInterval(timer);
          process.send("last", () => process.exit(0));
        }, 1);`,
      ],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      serialization: mode,
      ipc(message, subprocess) {
        received.push(message);
        if (message === "first") {
          writeFileSync(parentIsBusy, "");
          blockUntilDead(subprocess.pid);
        }
      },
      onDisconnect: () => disconnected.resolve(),
    });
    await disconnected.promise;
    expect(received).toEqual(["first", "last"]);
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

  // A process that inherited the child's end of the channel can still write to it once the child
  // is gone. When that input and the exit are pending together, with the exit first, the close that
  // the exit brings must wait for the loop to read the input.
  it.concurrent.skipIf(isWindows)(
    "does not close the channel over input that is unread when the child exits",
    async () => {
      using dir = tempDir("ipc-unread-at-exit", {});
      const exitNow = path.join(String(dir), "exit-now");
      const writeNow = path.join(String(dir), "write-now");
      const written = path.join(String(dir), "written");
      const received: unknown[] = [];
      const disconnected = Promise.withResolvers<void>();
      await using child = spawn({
        // fd 3 is the shell's end of the channel. The background subshell inherits it, outlives the
        // shell, and writes one JSON message to it when told to. Both give up after 30 seconds.
        cmd: [
          shellExe(),
          "-c",
          `(i=0; while [ ! -e "$2" ] && [ $i -lt 3000 ]; do sleep 0.01; i=$((i+1)); done
          echo '"written after the exit"' >&3; : > "$3") >/dev/null 2>&1 &
        echo ready
        i=0; while [ ! -e "$1" ] && [ $i -lt 3000 ]; do sleep 0.01; i=$((i+1)); done`,
          "sh",
          exitNow,
          writeNow,
          written,
        ],
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
        serialization: "json",
        ipc: message => void received.push(message),
        onDisconnect: () => disconnected.resolve(),
      });
      await child.stdout.getReader().read();
      // A few turns of the loop with the channel idle. Without them the channel is still queued
      // from its first writable event, ahead of the exit.
      for (let i = 0; i < 3; i++) await new Promise<void>(resolve => setImmediate(resolve));
      writeFileSync(exitNow, "");
      blockUntilDead(child.pid);
      writeFileSync(writeNow, "");
      blockUntil("the write to the channel", () => existsSync(written));
      await disconnected.promise;
      expect(received).toEqual(["written after the exit"]);
    },
  );
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

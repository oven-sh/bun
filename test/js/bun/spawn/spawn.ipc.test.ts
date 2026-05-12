import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick } from "harness";
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

import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, tempDir } from "harness";
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
    using dir = tempDir("ipc-advanced-overflow", {
      "child.js": `
        const fs = require("fs");
        // type = SerializedMessage (0x02), length = 0xFFFFFFFB (little-endian).
        // header_length (5) + 0xFFFFFFFB wraps to 0 in u32.
        fs.writeSync(3, Buffer.from([0x02, 0xfb, 0xff, 0xff, 0xff]));
        process.exit(0);
      `,
    });

    let receivedMessage: unknown;
    await using child = spawn({
      cmd: [bunExe(), "child.js"],
      env: bunEnv,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "pipe"],
      serialization: "advanced",
      ipc(msg) {
        receivedMessage = msg;
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(receivedMessage).toBeUndefined();
    expect(exitCode).toBe(0);
  });
});

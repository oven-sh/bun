import { $ } from "bun";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

test("child_process ipc", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc_fixture.js`.text();
  // node (v23.4.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "Parent received: {"status":"Child process started"}
    Child process exited with code 0
    send returned false
    uncaughtException ERR_IPC_CHANNEL_CLOSED
    cb ERR_IPC_CHANNEL_CLOSED
    "
  `);
});

// The child writes a well-formed advanced-serialization frame header
// (type=2 SerializedMessage, u32-LE length) with a body that is not a valid
// structured-clone payload. The parent must surface that as its own
// uncaughtException (Node raises one too: deserialize errors propagate out of
// the channel read) and must not leave the exception pending on the VM, which
// aborts ASSERT-enabled builds at the next microtask drain.
// Writing raw bytes to the channel fd only reaches the decoder on POSIX
// (Windows IPC is a named pipe); the decode path under test is shared.
const badFrameFixture = `
  import { fork } from "node:child_process";
  import fs from "node:fs";
  if (process.argv[2] === "child") {
    process.on("disconnect", () => process.exit(0));
    const frame = Buffer.concat([Buffer.from([2, 16, 0, 0, 0]), Buffer.alloc(16, 0x41)]);
    fs.writeSync(3, frame); // fork() places the IPC channel at fd 3
    setInterval(() => {}, 1000); // stay alive until the parent side closes the channel
  } else {
    if (process.argv[2] === "handler") {
      process.on("uncaughtException", e => console.log("PARENT uncaughtException: " + e.message));
    }
    const c = fork(import.meta.filename, ["child"], { serialization: "advanced" });
    c.on("exit", code => {
      console.log("child exited " + code);
      process.exit(0);
    });
  }
`;

describe.concurrent.skipIf(isWindows)("advanced serialization: undeserializable frame from peer", () => {
  test("parent with an uncaughtException handler survives", async () => {
    using dir = tempDir("ipc-bad-frame", { "bad-frame-fixture.mjs": badFrameFixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "bad-frame-fixture.mjs", "handler"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "PARENT uncaughtException: Unable to deserialize data.\nchild exited 0\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("parent without a handler dies from the uncaught exception", async () => {
    using dir = tempDir("ipc-bad-frame", { "bad-frame-fixture.mjs": badFrameFixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "bad-frame-fixture.mjs", "nohandler"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unable to deserialize data.");
    expect(exitCode).toBe(1);
  });
});

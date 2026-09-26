import { $ } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";

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

// A throwing "message" listener on a ChildProcess is a fatal uncaught
// exception, as in node (the channel's onread runs via MakeCallback).
// Previously it was reported but the child and channel refs kept the event
// loop alive, so the parent hung.
test("a throwing 'message' listener is a fatal uncaught exception", async () => {
  using dir = tempDir("cp-message-throw", {
    "parent.js": `
      const { fork } = require("node:child_process");
      const cp = fork(require("node:path").join(__dirname, "child.js"), {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      cp.on("message", () => { throw new Error("cp-message-boom"); });
    `,
    "child.js": `
      process.send("hi");
      // Holds refs so a keep-alive (non-fatal) report would hang the parent;
      // exits when the parent's death closes the channel.
      process.on("disconnect", () => process.exit(0));
      setInterval(() => {}, 100);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "",
    stderr: expect.stringContaining("cp-message-boom"),
    exitCode: 1,
  });
});

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

test("advanced serialization: malformed frame from child does not crash parent", async () => {
  using dir = tempDir("ipc-advanced-malformed", {
    "fixture.mjs": `
      import { fork } from "node:child_process";
      import fs from "node:fs";
      if (process.env.ROLE === "child") {
        // IPCMessageType.SerializedMessage (2), u32-LE length = 4, then 4 bytes that are
        // not a valid structured-clone blob.
        fs.writeSync(3, Buffer.from([2, 4, 0, 0, 0, 0xde, 0xad, 0xbe, 0xef]));
        process.exit(0);
      } else {
        process.on("uncaughtException", err => {
          console.error("uncaughtException: " + err.message);
          process.exit(1);
        });
        const cp = fork(new URL(import.meta.url).pathname, [], {
          serialization: "advanced",
          env: { ...process.env, ROLE: "child" },
        });
        cp.on("message", m => console.log("message: " + JSON.stringify(m)));
        cp.on("exit", code => {
          console.log("child exit " + code);
          console.log("parent still alive");
        });
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Unable to deserialize data");
  expect(stderr).not.toContain("uncaughtException");
  expect(stdout).toContain("child exit 0");
  expect(stdout).toContain("parent still alive");
  expect(exitCode).toBe(0);
});

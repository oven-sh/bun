import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunExe } from "harness";
import path from "path";

// Verify that the parent process handles internal-format IPC messages
// gracefully when the subprocess was not spawned via cluster.fork().
// Previously, receiving such messages could cause the parent to crash
// because the internal message handler assumed cluster state was initialized.

it("parent handles internal-format IPC message in json mode without crashing", async () => {
  const { promise, resolve } = Promise.withResolvers<string>();

  const child = spawn([bunExe(), path.join(__dirname, "fixtures", "ipc-internal-msg-child-json.js")], {
    ipc: message => {
      resolve(String(message));
    },
    stdio: ["inherit", "inherit", "inherit"],
    serialization: "json",
  });

  const message = await promise;
  expect(message).toBe("normal_after_internal");

  child.kill();
  await child.exited;
});

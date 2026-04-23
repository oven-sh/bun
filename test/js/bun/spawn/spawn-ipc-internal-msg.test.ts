import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import path from "path";

// Verify that the parent process handles internal-format IPC messages
// gracefully when the subprocess was not spawned via cluster.fork().
// Previously, receiving such messages could cause the parent to crash
// because the internal message handler assumed cluster state was initialized.

// The child fixture writes raw bytes (0x02 prefix) directly to fd 3, which
// only works on Unix where IPC uses a socketpair. On Windows, IPC uses named
// pipes and fd 3 is not the IPC channel.
it.skipIf(isWindows)("parent handles internal-format IPC message in json mode without crashing", async () => {
  const { promise, resolve } = Promise.withResolvers<string>();

  await using child = spawn([bunExe(), path.join(__dirname, "fixtures", "ipc-internal-msg-child-json.js")], {
    ipc: message => {
      resolve(String(message));
    },
    stdio: ["inherit", "inherit", "inherit"],
    serialization: "json",
    env: bunEnv,
  });

  const message = await promise;
  expect(message).toBe("normal_after_internal");
  expect(await child.exited).toBe(0);
});

import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
import fs from "node:fs/promises";
import path from "path";

it.todoIf(isWindows)("spawning a bun package script should inherit the ipc fd", async () => {
  const x = tmpdirSync();
  await fs.writeFile(
    path.join(x, "package.json"),
    JSON.stringify({
      scripts: {
        test: `${bunExe()} -e 'process.send("hello")'`,
      },
    }),
  );

  let testMessage;

  const child = spawn([bunExe(), "run", "test"], {
    ipc: message => {
      testMessage = message;
    },
    stdio: ["inherit", "inherit", "inherit"],
    cwd: x,
  });

  await child.exited;
  expect(testMessage).toBe("hello");
});

it.skipIf(isWindows)("bun exec doesn't pass NODE_CHANNEL_FD to a command that doesn't inherit the ipc fd", async () => {
  await using proc = spawn({
    // Print the variables from sh, because bun and node delete them at startup.
    cmd: [bunExe(), "exec", `sh -c 'echo "[$NODE_CHANNEL_FD] [$NODE_CHANNEL_SERIALIZATION_MODE]"'`],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ipc() {},
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "[] []\n", stderr: "", exitCode: 0 });
});

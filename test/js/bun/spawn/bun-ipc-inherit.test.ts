import { spawn, spawnSync, env } from "bun";
import fs from "node:fs/promises";
import { describe, expect, it } from "bun:test";
import { bunExe, isWindows } from "harness";
import path from "path";

it.todoIf(isWindows)("spawning a bun package script should inherit the ipc fd", async () => {
  await fs.writeFile(
    path.join(process.cwd(), "package.json"),
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
  });

  await child.exited;
  expect(testMessage).toBe("hello");
});

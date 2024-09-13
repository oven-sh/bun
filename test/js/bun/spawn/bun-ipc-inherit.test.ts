import { spawn, spawnSync, env } from "bun";
import fs from "node:fs/promises";
import { describe, expect, it } from "bun:test";
import { bunExe } from "harness";
import path from "path";

it("spawning a bun package script should inherit the ipc fd", async () => {
  await fs.writeFile(
    path.join(process.cwd(), "package.json"),
    JSON.stringify({
      scripts: {
        test: `${bunExe()} -e 'process.send("hello")'`,
      },
    }),
  );

  const child = spawn([bunExe(), "run", "test"], {
    ipc: message => {
      expect(message).toBe("hello");
    },
    stdio: ["inherit", "inherit", "inherit"],
  });

  await child.exited;
});

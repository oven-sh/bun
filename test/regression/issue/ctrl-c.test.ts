import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";

test.skipIf(isWindows)("verify that we forward SIGINT from parent to child in bun run", () => {
  const dir = tempDirWithFiles("ctrlc", {
    "index.js": `
      let count = 0;
      process.exitCode = 1;
      process.once("SIGINT", () => {
        process.kill(process.pid, "SIGKILL");
      });
      setTimeout(() => {}, 999999)
      process.kill(process.ppid, "SIGINT");
  `,
    "package.json": `
    {
      "name": "ctrlc",
      "scripts": {
        "start": "${bunExe()} index.js"
      }
    }
  `,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "start"],
    cwd: dir,
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(result.exitCode).toBe(null);
  expect(result.signalCode).toBe("SIGKILL");
});

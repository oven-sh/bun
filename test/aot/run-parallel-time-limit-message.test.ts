import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

test.skipIf(!isLinux || !isCanary)(
  "the time limit message of run-parallel.ts reports CPU time and thread states",
  async () => {
    using dir = tempDir("run-parallel-time-limit-message", {
      "tsconfig.json": "{}",
      "sleeps.js": `console.log("begun");\nawait Bun.sleep(600_000);\n`,
      "spins.js": `console.log("begun");\nfor (let i = 0; ; i++) if (i === process.argv.length - 100) break;\n`,
    });
    const root = String(dir);
    const files = ["sleeps.js", "spins.js"].map(name => join(root, name));
    const { stdout, exitCode } = await run(
      [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=2", "--seconds=8", ...files],
      root,
      bunEnv,
    );
    const messages = Object.fromEntries(
      stdout
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .filter(({ state }) => state === "fail")
        .map(({ file, message }) => [file.slice(root.length + 1), message as string]),
    );
    const message = /^it ended by SIGKILL: it ran over 8 s \(CPU time (\d+\.\d) s; threads: (.+)\)$/;
    const [sleeps, spins] = [message.exec(messages["sleeps.js"]), message.exec(messages["spins.js"])];
    expect(messages).toEqual({
      "sleeps.js": expect.stringMatching(message),
      "spins.js": expect.stringMatching(message),
    });
    expect(Number(sleeps![1])).toBeLessThan(2);
    expect(Number(spins![1])).toBeGreaterThan(Number(sleeps![1]));
    expect(spins![2]).toMatch(/\b\d+ R\b/);
    expect(exitCode).toBe(1);
  },
  120_000,
);

import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// Bun.spawn / Bun.spawnSync with no `env:` option must inherit the *live*
// process.env, including runtime mutations, not the startup snapshot.
describe("default env inherits live process.env", () => {
  const printEnv = isWindows
    ? `[process.execPath, "-e", "process.stdout.write((process.env.BUN_TEST_SPAWN_ENV_SET ?? '[unset]') + ',' + (process.env.BUN_TEST_SPAWN_ENV_DEL ?? '[unset]'))"]`
    : `["/bin/sh", "-c", "printf '%s,%s' \\"\${BUN_TEST_SPAWN_ENV_SET-[unset]}\\" \\"\${BUN_TEST_SPAWN_ENV_DEL-[unset]}\\""]`;

  for (const [label, call] of [
    ["Bun.spawnSync({cmd})", `Bun.spawnSync({ cmd: ${printEnv} }).stdout.toString()`],
    ["Bun.spawnSync([cmd])", `Bun.spawnSync(${printEnv}).stdout.toString()`],
    ["Bun.spawn({cmd})", `await (await Bun.spawn({ cmd: ${printEnv} }).stdout).text()`],
  ] as const) {
    test.concurrent(label, async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `process.env.BUN_TEST_SPAWN_ENV_SET = "runtime-value";
           delete process.env.BUN_TEST_SPAWN_ENV_DEL;
           process.stdout.write(${call});`,
        ],
        env: { ...bunEnv, BUN_TEST_SPAWN_ENV_DEL: "startup-value" },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr).toBe("");
      expect(stdout).toBe("runtime-value,[unset]");
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent.skipIf(isWindows)("PATH mutation is used for argv0 lookup and Bun.which", async () => {
    using dir = tempDir("spawn-env-path", {
      "bun_test_spawn_env_tool": "#!/bin/sh\nprintf found-the-tool\n",
    });
    const toolDir = String(dir);
    chmodSync(join(toolDir, "bun_test_spawn_env_tool"), 0o755);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.env.PATH = ${JSON.stringify(toolDir)} + ":" + process.env.PATH;
         console.log(Bun.which("bun_test_spawn_env_tool") !== null);
         console.log(Bun.spawnSync({ cmd: ["bun_test_spawn_env_tool"] }).stdout.toString());
         console.log(Bun.spawnSync(["bun_test_spawn_env_tool"]).stdout.toString());`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true\nfound-the-tool\nfound-the-tool\n");
    expect(exitCode).toBe(0);
  });
});

test("spawn env", async () => {
  const env = {};
  Object.defineProperty(env, "LOL", {
    get() {
      throw new Error("Bad!!");
    },
    configurable: false,
    enumerable: true,
  });

  // This was the minimum to reliably cause a crash in Bun < v1.1.42
  for (let i = 0; i < 1024 * 10; i++) {
    try {
      const result = spawn({
        env,
        cmd: [bunExe(), "-e", "console.log(process.env.LOL)"],
      });
    } catch (e) {}
  }
});

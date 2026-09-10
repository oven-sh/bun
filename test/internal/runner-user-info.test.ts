/**
 * scripts/runner.node.mjs sets USER and HOME for every `bun test` it spawns.
 * spawnBun used to call os.userInfo() per test file for that, and the call
 * throws (`uv_os_get_passwd returned ENOENT`) on a macOS agent whose host has
 * begun to shut down, which ended the whole shard with exit 1. The runner now
 * looks the user up once (getUserInfo() in scripts/utils.mjs) and falls back
 * to the environment when the lookup fails.
 *
 * This runs a copy of the runner under node, as CI does, over one test file.
 * A --import preload replaces os.userInfo with one that throws and counts.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dir, "..", "..");
// The runner, the modules it imports by relative path, and the LeakSanitizer
// suppressions file it points the spawned `bun test` at.
const runnerFiles = [
  "scripts/runner.node.mjs",
  "scripts/utils.mjs",
  "scripts/p-limit.mjs",
  "scripts/yocto-queue.mjs",
  "test/docker/prestart-map.mjs",
  "test/leaksan.supp",
];
const node = nodeExe();

test.skipIf(!node)("a failed passwd lookup does not end the run: USER and HOME come from the environment", async () => {
  using repo = tempDir("runner-user-info", {
    ...Object.fromEntries(runnerFiles.map(file => [file, readFileSync(join(repoRoot, file), "utf8")])),
    "preload.mjs": `
      import { syncBuiltinESMExports } from "node:module";
      import os from "node:os";
      let calls = 0;
      os.userInfo = () => {
        calls++;
        const error = new Error("A system error occurred: uv_os_get_passwd returned ENOENT (no such file or directory)");
        error.code = "ERR_SYSTEM_ERROR";
        throw error;
      };
      syncBuiltinESMExports();
      process.on("exit", () => console.error("os.userInfo() calls: " + calls));
    `,
    "test/user-info.test.ts": `
      import { test } from "bun:test";
      test("prints the USER and HOME the runner set", () => {
        console.error(JSON.stringify({ USER: process.env.USER, HOME: process.env.HOME }));
      });
    `,
    "home": {},
  });
  const root = String(repo);
  const home = join(root, "home");

  // The copy takes the runner's local code paths: no buildkite-agent, no
  // annotations, no retries. --quiet skips the `bun install` steps.
  const env: Record<string, string | undefined> = { ...bunEnv, USER: "user-from-env", HOME: home };
  for (const name of ["CI", "BUILDKITE", "GITHUB_ACTIONS"]) delete env[name];
  await using proc = Bun.spawn({
    cmd: [
      node!,
      `--import=${pathToFileURL(join(root, "preload.mjs")).href}`,
      join(root, "scripts", "runner.node.mjs"),
      `--exec-path=${bunExe()}`,
      "--quiet",
    ],
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = Bun.stripANSI(stdout + stderr);

  expect(output).toContain("os.userInfo() failed, using USER and HOME from the environment instead");
  expect(output).toContain(JSON.stringify({ USER: "user-from-env", HOME: home }));
  expect(output).toContain("os.userInfo() calls: 1\n");
  expect(exitCode).toBe(0);
});

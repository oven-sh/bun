/**
 * scripts/runner.node.mjs sets USER and HOME for every `bun test` it spawns.
 * spawnBun used to call os.userInfo() per test file for that, and the call
 * throws (`uv_os_get_passwd returned ENOENT`) on a macOS agent whose host has
 * begun to shut down, which ended the whole shard with exit 1. The runner now
 * looks the user up once (getUserInfo() in scripts/utils.mjs) and falls back
 * to the environment when the lookup fails.
 *
 * This runs a copy of the runner under node, as CI does, over two test files.
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

/** A test file that prints the USER and HOME the runner gave its process. */
const fixture = (file: string) => `
  import { test } from "bun:test";
  test("prints USER and HOME", () => {
    console.error(JSON.stringify({ file: ${JSON.stringify(file)}, USER: process.env.USER, HOME: process.env.HOME }));
  });
`;

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
    // Two files, so that spawnBun runs twice and the call count below tells a
    // cached lookup (1) from a per-file one (2).
    "test/first.test.ts": fixture("first"),
    "test/second.test.ts": fixture("second"),
    "home": {},
  });
  const root = String(repo);
  const home = join(root, "home");
  const expected = (file: string) => JSON.stringify({ file, USER: "user-from-env", HOME: home });

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
  expect(output).toContain(expected("first"));
  expect(output).toContain(expected("second"));
  expect(output).toContain("os.userInfo() calls: 1\n");
  expect(exitCode).toBe(0);
});

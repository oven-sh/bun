/**
 * scripts/runner.node.mjs runs one step per test file through runTest(), which
 * retries and reports a step whose result says it failed. An exception thrown
 * from the step path is not a result: it left runTests() and ended the shard
 * with no summary for the files that had run. Two per-file sync calls in that
 * path threw when a macOS agent wiped its checkout under a live job:
 *
 * - spawnBun called os.userInfo() for every test file to set USER and HOME for
 *   the child. The lookup goes through opendirectoryd, which answered ENOENT.
 *   The runner now resolves the user once per process, through getUserInfo()
 *   in scripts/utils.mjs, and falls back to the environment when the lookup
 *   fails.
 * - runOneTest read a node test file (test/js/node/test/parallel/...) before
 *   its step began. A file that is gone by then is now a failed step.
 *
 * Each case runs a copy of the runner from a temporary repository layout. The
 * copy runs under node, as in CI, with bunExe() as the bun under test. A module
 * preloaded with --import replaces os.userInfo: it counts the calls, writes the
 * count to a file when the process exits, and either throws the ENOENT error
 * or forwards to the real function.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir, type DirectoryTree } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dir, "..", "..");

// The runner and the files it imports relative to itself. The `bun test`
// processes it spawns read leaksan.supp from <cwd>/test/.
const runnerFiles = [
  "scripts/runner.node.mjs",
  "scripts/utils.mjs",
  "scripts/p-limit.mjs",
  "scripts/yocto-queue.mjs",
  "test/docker/prestart-map.mjs",
  "test/leaksan.supp",
];

const node = nodeExe();

type UserInfo = { username: string; homedir: string };

// The user in the runner process's environment. HOME is the `home` directory
// of the repository layout. When the passwd lookup works, the runner replaces
// both with the passwd values.
const environmentUser = (repo: string): UserInfo => ({ username: "runner-user", homedir: join(repo, "home") });

/** A test file that asserts the USER and HOME the runner gave its process. */
const testFile = (expected: UserInfo) => `
  import { expect, test } from "bun:test";
  test("USER and HOME come from the runner", () => {
    expect({ username: process.env.USER, homedir: process.env.HOME }).toEqual(${JSON.stringify(expected)});
  });
`;

/** Replaces os.userInfo for the whole runner process, the runner's ESM import of it included. */
const preload = (fails: boolean) => `
  import { writeFileSync } from "node:fs";
  import { syncBuiltinESMExports } from "node:module";
  import os from "node:os";
  const real = os.userInfo;
  let calls = 0;
  os.userInfo = options => {
    calls++;
    if (${fails}) {
      const error = new Error("A system error occurred: uv_os_get_passwd returned ENOENT (no such file or directory)");
      error.code = "ERR_SYSTEM_ERROR";
      throw error;
    }
    return real(options);
  };
  syncBuiltinESMExports();
  process.on("exit", () => writeFileSync(process.env.USERINFO_CALLS_PATH, String(calls)));
`;

/** The passwd entry as node reports it, which is what the runner passes on when the lookup works. */
async function nodeUserInfo(): Promise<UserInfo> {
  await using proc = Bun.spawn({
    cmd: [node!, "-p", "JSON.stringify(require('node:os').userInfo())"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`node -p os.userInfo() exited with ${exitCode}:\n${stderr}`);
  const { username, homedir } = JSON.parse(stdout);
  return { username, homedir };
}

/**
 * Runs a copy of the runner over the test files in `files`, with os.userInfo
 * failing or working. Returns the steps the runner logged, its exit code, the
 * number of os.userInfo() calls it made, and its stderr.
 */
async function runRunner(fails: boolean, files: DirectoryTree) {
  using repo = tempDir("runner-step-errors", {
    ...Object.fromEntries(runnerFiles.map(file => [file, readFileSync(join(repoRoot, file))])),
    "preload.mjs": preload(fails),
    "home": {},
    ...files,
  });
  const callsPath = join(String(repo), "userinfo-calls.txt");
  await using proc = Bun.spawn({
    cmd: [
      node!,
      `--import=${pathToFileURL(join(String(repo), "preload.mjs")).href}`,
      join(String(repo), "scripts", "runner.node.mjs"),
      `--exec-path=${bunExe()}`,
      "--quiet",
    ],
    cwd: String(repo),
    env: {
      ...bunEnv,
      // The copy has to take the runner's local code paths: no docker
      // coordinator, no buildkite-agent, and --retries defaults to 0.
      CI: undefined,
      BUILDKITE: undefined,
      GITHUB_ACTIONS: undefined,
      USER: environmentUser(String(repo)).username,
      HOME: environmentUser(String(repo)).homedir,
      USERINFO_CALLS_PATH: callsPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The runner logs "[n/total] <title>" when it starts a step and
  // "[n/total] <title> - <error>" when the step fails.
  const steps = Bun.stripANSI(stdout)
    .split("\n")
    .map(line => /^\s*\[\d+\/\d+\] (.*)$/.exec(line)?.[1])
    .filter((step): step is string => step !== undefined);
  if (steps.length === 0) throw new Error(`the runner ran no step:\n${stdout}${stderr}`);
  return { steps, exitCode, userInfoCalls: Number(readFileSync(callsPath, "utf8")), stderr };
}

/** Two test files that expect `expected(repo)` as their USER and HOME. */
const userInfoFiles = (expected: (repo: string) => UserInfo): DirectoryTree => ({
  "test/first.test.ts": ({ root }) => testFile(expected(root)),
  "test/second.test.ts": ({ root }) => testFile(expected(root)),
});

describe.skipIf(!node)("runner.node.mjs step errors", () => {
  test.concurrent(
    "a failed passwd lookup does not end the shard: the test files run with USER and HOME from the environment",
    async () => {
      const { steps, exitCode, userInfoCalls, stderr } = await runRunner(true, userInfoFiles(environmentUser));

      expect(stderr).toContain("os.userInfo() failed, using the environment instead");
      expect({ steps, exitCode, userInfoCalls }).toEqual({
        steps: ["test/first.test.ts", "test/second.test.ts"],
        exitCode: 0,
        userInfoCalls: 1,
      });
    },
  );

  test.concurrent("the passwd lookup runs once per process, not once per test file", async () => {
    const passwd = await nodeUserInfo();
    const { steps, exitCode, userInfoCalls, stderr } = await runRunner(
      false,
      userInfoFiles(() => passwd),
    );

    expect(stderr).not.toContain("os.userInfo() failed");
    expect({ steps, exitCode, userInfoCalls }).toEqual({
      steps: ["test/first.test.ts", "test/second.test.ts"],
      exitCode: 0,
      userInfoCalls: 1,
    });
  });

  test.concurrent(
    "a node test file that is gone by the time its step starts is a failed step, not the end of the run",
    async () => {
      // The runner lists the node test at startup. The bun test runs first (node
      // tests run in a later phase) and removes it before the runner reads it.
      const nodeTest = "test/js/node/test/parallel/test-gone.js";
      const { steps, exitCode } = await runRunner(false, {
        "test/first.test.ts": ({ root }) => `
        import { test } from "bun:test";
        import { unlinkSync } from "node:fs";
        test("removes the node test file", () => unlinkSync(${JSON.stringify(join(root, nodeTest))}));
      `,
        [nodeTest]: `console.log("never runs");`,
      });

      expect({ steps, exitCode }).toEqual({
        steps: ["test/first.test.ts", nodeTest, `${nodeTest} - read error: ENOENT`],
        exitCode: 1,
      });
    },
  );
});

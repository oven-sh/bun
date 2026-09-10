/**
 * scripts/runner.node.mjs sets USER and HOME for every `bun test` it spawns.
 * It used to call os.userInfo() per test file for that, and the call throws
 * (`uv_os_get_passwd returned ENOENT`) on a macOS agent whose host has begun
 * to shut down, which ended the whole shard with exit 1 instead of one test.
 * getUserInfo() in scripts/utils.mjs does the lookup once and falls back to
 * the environment when it fails. The runner runs under node in CI, so this
 * does too: a --import preload replaces os.userInfo before utils.mjs loads.
 */
import { expect, test } from "bun:test";
import { bunEnv, nodeExe, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const utilsUrl = pathToFileURL(join(import.meta.dir, "..", "..", "scripts", "utils.mjs")).href;
const node = nodeExe();

test.skipIf(!node)("getUserInfo() falls back to USER and HOME when the passwd lookup fails, once", async () => {
  using dir = tempDir("runner-user-info", {
    "preload.mjs": `
      import { syncBuiltinESMExports } from "node:module";
      import os from "node:os";
      globalThis.userInfoCalls = 0;
      os.userInfo = () => {
        globalThis.userInfoCalls++;
        const error = new Error("A system error occurred: uv_os_get_passwd returned ENOENT (no such file or directory)");
        error.code = "ERR_SYSTEM_ERROR";
        throw error;
      };
      syncBuiltinESMExports();
    `,
    "main.mjs": `
      import { getUserInfo, getUsername } from ${JSON.stringify(utilsUrl)};
      const first = getUserInfo();
      const second = getUserInfo();
      const username = getUsername();
      console.log(JSON.stringify({ first, cached: first === second, username, calls: globalThis.userInfoCalls }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [node!, `--import=${pathToFileURL(join(String(dir), "preload.mjs")).href}`, "main.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, USER: "user-from-env", HOME: "/home/from/env" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("os.userInfo() failed, using USER and HOME from the environment instead");
  expect(JSON.parse(stdout)).toEqual({
    first: { username: "user-from-env", homedir: "/home/from/env" },
    cached: true,
    username: "user-from-env",
    calls: 1,
  });
  expect(exitCode).toBe(0);
});

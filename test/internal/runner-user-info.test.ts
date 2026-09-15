/**
 * scripts/runner.node.mjs sets USER and HOME for every `bun test` it spawns
 * from getUserInfo() in scripts/utils.mjs. spawnBun used to call os.userInfo()
 * per test file instead, and that call throws (`uv_os_get_passwd returned
 * ENOENT`) on a macOS agent whose host has begun to shut down, which ended the
 * whole shard with exit 1. getUserInfo() looks the user up once and falls back
 * to the environment when the lookup fails.
 */
import { expect, mock, test } from "bun:test";
import * as os from "node:os";
import { getUserInfo, getUsername } from "../../scripts/utils.mjs";

test("getUserInfo() falls back to USER and HOME when os.userInfo() throws, and looks the user up once", () => {
  const real = { ...os };
  let calls = 0;
  mock.module("node:os", () => ({
    ...real,
    userInfo: () => {
      calls++;
      throw new Error("A system error occurred: uv_os_get_passwd returned ENOENT (no such file or directory)");
    },
  }));
  try {
    const { env } = process;
    const expected = { username: env.USER || env.LOGNAME || env.USERNAME, homedir: env.HOME || env.USERPROFILE };

    const first = getUserInfo();
    expect(first).toEqual(expected);
    expect(getUserInfo()).toBe(first);
    expect(getUsername()).toBe(expected.username);
    expect(calls).toBe(1);
  } finally {
    mock.module("node:os", () => real);
  }
});

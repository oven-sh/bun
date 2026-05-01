import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import { join } from "node:path";

describe("HTTP server with proxy-style absolute URLs", () => {
  test("tests should run on node.js", async () => {
    await using process = Bun.spawn({
      cmd: [nodeExe(), "--test", join(import.meta.dir, "node-http-proxy-url.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  });
  test("tests should run on bun", async () => {
    await using process = Bun.spawn({
      cmd: [bunExe(), "test", join(import.meta.dir, "node-http-proxy-url.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  });
});

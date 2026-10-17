import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// The S3 client does not honor NO_PROXY, so an inherited proxy would hijack the
// request to the stub server.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

describe("S3 SigV4 signed header Trimall", () => {
  test("signed header values are whitespace-canonicalized", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "s3-sigv4-header-trimall-fixture.ts")],
      env: envWithoutProxy,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      control: "ok",
      cd_run: "ok",
      cd_run_wire: true,
      cd_outer: "ok",
      ce_trailing: "ok",
      token_trailing: "ok",
      ce_tab: "ok",
    });
    expect(exitCode).toBe(0);
  });
});

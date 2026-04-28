import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// HTTPContext.onHandshake used to touch `client` after checkServerIdentity()
// returned false — but that path has already run closeAndFail → fail →
// result callback, which frees the ThreadlocalAsyncHTTP that owns the client.
// ASAN catches the stale read-modify-write of client.flags as use-after-poison
// on the HTTP thread.
test("https request rejected by checkServerIdentity doesn't UAF in onHandshake", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-https-checkServerIdentity-uaf-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

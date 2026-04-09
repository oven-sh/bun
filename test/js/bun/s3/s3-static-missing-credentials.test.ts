import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// S3Client.presign (and friends) used to double-free the path string when
// signing failed after the internal blob had already taken ownership of it.
// In debug builds this trips bun.assert(self.hasAtLeastOneRef()) inside
// WTFStringImpl.deref; release builds over-deref silently, so this can only
// be verified against a debug/ASAN binary.
test.skipIf(!isDebug)("S3Client.presign without credentials throws instead of crashing", async () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(bunEnv)) {
    if (k.startsWith("AWS_") || k.startsWith("S3_")) continue;
    if (typeof v === "string") env[k] = v;
  }

  const src = `
    let code;
    try {
      Bun.S3Client.presign("some/key");
    } catch (e) {
      code = e?.code;
    }
    if (code !== "ERR_S3_MISSING_CREDENTIALS") {
      console.error("unexpected result:", code);
      process.exit(1);
    }
    Bun.gc(true);
    console.log("ok");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "ok", stderr: expect.any(String) });
  expect(exitCode).toBe(0);
});

// Verifies that consumers of memfd_create degrade gracefully when the syscall
// is unavailable (kernel < 3.17, or seccomp-filtered). bun.sys.memfd_create
// returns ENOSYS when BUN_FEATURE_FLAG_DISABLE_MEMFD is set, exercising the
// same fallback paths an old kernel would hit.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

const env = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" };

test.skipIf(process.platform !== "linux")("Bun.spawn stdin from Blob falls back when memfd is disabled", async () => {
  const payload = Buffer.alloc(64 * 1024, "x").toString();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
          stdin: new Blob([${JSON.stringify(payload)}]),
          stdout: "pipe",
        });
        const out = await proc.stdout.text();
        console.log(out.length, out === ${JSON.stringify(payload)});
        process.exit(await proc.exited);
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toBe(`${payload.length} true`);
  expect(exitCode).toBe(0);
});

test.skipIf(process.platform !== "linux")("large Response body Blob falls back when memfd is disabled", async () => {
  // LinuxMemFdAllocator.shouldUse triggers at ≥ 1 MiB (smol) / larger otherwise;
  // sending a body well past that ensures the memfd path is attempted.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const body = Buffer.alloc(8 * 1024 * 1024, 0x61);
        const blob = await new Response(body).blob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        if (buf.length !== body.length) throw new Error("length mismatch: " + buf.length);
        for (let i = 0; i < buf.length; i += 4096) {
          if (buf[i] !== 0x61) throw new Error("byte mismatch at " + i);
        }
        console.log("ok", buf.length);
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toBe("ok 8388608");
  expect(exitCode).toBe(0);
});

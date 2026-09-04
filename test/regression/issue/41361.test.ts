import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// simdutf picks its SIMD kernel by CPUID at first use. When no compiled-in
// kernel matches (QEMU's default CPU model hides SSE4.2), it installs a stub
// whose every call returns 0 or false. SIMDUTF_FORCE_IMPLEMENTATION with an
// unknown name installs the same stub on any machine. Bun used to spin forever
// in a Latin-1 to UTF-8 loop on the first ASCII string longer than 32 bytes,
// which is the entry point path, before it opened the entry file.
test("bun starts when simdutf finds no supported kernel", async () => {
  using dir = tempDir("simdutf-no-supported-kernel", {
    "entry-file-with-a-name-longer-than-thirty-two-bytes.mjs": `console.log("ok");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), `${dir}/entry-file-with-a-name-longer-than-thirty-two-bytes.mjs`],
    env: { ...bunEnv, SIMDUTF_FORCE_IMPLEMENTATION: "bogus" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("ok\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

// Heap image round-trip: the fixture snapshots itself at idle, a fresh process restores it and continues.
const env = { ...bunEnv, MIMALLOC_DETERMINISTIC_HINT: "1", BUN_IMAGE_JIT_ADDR: "0x3c0000000", BUN_JSC_useBaselineJIT: "0", BUN_JSC_useFTLJIT: "0" };
const hasImages = typeof Bun.unsafe.snapshot === "function" && (isLinux || isMacOS);

for (const fixture of ["smoke-fixture.js", "heavy-fixture.js"]) {
  test.skipIf(!hasImages)(`image round-trip: ${fixture}`, async () => {
    using dir = tempDir("bun-image", {});
    const img = join(String(dir), "app.img");
    const build = Bun.spawnSync({ cmd: [bunExe(), join(import.meta.dir, fixture)], env: { ...env, BUN_IMAGE_OUT: img }, stderr: "pipe", stdout: "pipe" });
    expect(build.stderr.toString()).toContain("[image] wrote");
    await using proc = Bun.spawn({ cmd: [bunExe(), join(import.meta.dir, fixture)], env: { ...env, BUN_IMAGE_IN: img }, stderr: "pipe", stdout: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("[image] restored");
    expect(stdout).toContain("epoch 1");
    if (fixture === "heavy-fixture.js") {
      expect(stdout).toContain("fetch -> hello from restored server");
      expect(stdout).toContain("fs -> written after restore");
    } else expect(stdout).toContain("[js] tick 3");
    expect(exitCode).toBe(0);
  });
}

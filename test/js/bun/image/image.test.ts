import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

// Heap image round-trip: the fixture snapshots itself at idle, a fresh process restores it and continues.
const env = { ...bunEnv, MIMALLOC_DETERMINISTIC_HINT: "1", BUN_IMAGE_JIT_ADDR: "0x3c0000000", BUN_JSC_useBaselineJIT: "0", BUN_JSC_useFTLJIT: "0" };
const buildEnv = env;
const restoreEnv = { ...env, MIMALLOC_HINT_FLOOR: "0x21000000000" }; // a restoring process keeps its own early heap above where image regions get mapped
const hasImages = typeof Bun.unsafe.snapshot === "function" && (isLinux || isMacOS);

for (const fixture of ["smoke-fixture.js", "heavy-fixture.js"]) {
  test.skipIf(!hasImages)(`image round-trip: ${fixture}`, async () => {
    using dir = tempDir("bun-image", {});
    const img = join(String(dir), "app.img");
    const build = Bun.spawnSync({ cmd: [bunExe(), join(import.meta.dir, fixture)], env: { ...buildEnv, BUN_IMAGE_OUT: img }, stderr: "pipe", stdout: "pipe" });
    expect(build.stderr.toString()).toContain("[image] wrote");
    await using proc = Bun.spawn({ cmd: [bunExe(), join(import.meta.dir, fixture)], env: { ...restoreEnv, BUN_IMAGE_IN: img }, stderr: "pipe", stdout: "pipe" });
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

test.skipIf(!hasImages)("bun build --compile --compile-image embeds the image; the single file restores from itself with no env", async () => {
  using dir = tempDir("bun-image-compile", {});
  const exe = join(String(dir), "heavy");
  const build = Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "--compile-image", join(import.meta.dir, "heavy-fixture.js"), "--outfile", exe], env: bunEnv, stderr: "pipe", stdout: "pipe" });
  const buildOut = build.stderr.toString() + build.stdout.toString();
  expect(buildOut).toContain("[image] wrote");
  expect(buildOut).toContain("embedded");
  // Nothing beside the executable: the image lives in its __BUN/.bun section.
  expect(require("fs").readdirSync(String(dir)).sort()).toEqual(["heavy"]);
  for (const run of [1, 2]) {
    await using proc = Bun.spawn({ cmd: [exe], env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH! }, stderr: "pipe", stdout: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("[image] restored");
    expect(stdout).toContain("epoch 1");
    expect(stdout).toContain("fetch -> hello from restored server");
    expect(exitCode).toBe(0);
  }
  // Opt out boots normally.
  const plain = Bun.spawnSync({ cmd: [exe], env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, BUN_IMAGE: "0" }, stderr: "pipe", stdout: "pipe" });
  expect(plain.stdout.toString()).toContain("epoch 0");
  expect(plain.exitCode).toBe(0);
  // Debugging: an explicit image file still wins (BUN_IMAGE_KEEP_SIDECAR keeps <exe>.img next to it at build time).
  const dbg = join(String(dir), "dbg");
  const b2 = Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "--compile-image", join(import.meta.dir, "heavy-fixture.js"), "--outfile", dbg], env: { ...bunEnv, BUN_IMAGE_KEEP_SIDECAR: "1" }, stderr: "pipe", stdout: "pipe" });
  expect(b2.exitCode).toBe(0);
  expect(Bun.file(dbg + ".img").size).toBeGreaterThan(1024 * 1024);
  const viaFile = Bun.spawnSync({ cmd: [dbg], env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, BUN_IMAGE_IN: dbg + ".img" }, stderr: "pipe", stdout: "pipe" });
  expect(viaFile.stdout.toString()).toContain("epoch 1");
  expect(viaFile.exitCode).toBe(0);
}, 60_000);

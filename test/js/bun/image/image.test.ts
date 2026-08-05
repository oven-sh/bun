import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

// Heap image round-trip: the fixture snapshots itself at idle, a fresh process restores it and continues.
const env = { ...bunEnv, MIMALLOC_DETERMINISTIC_HINT: "1", BUN_IMAGE_JIT_ADDR: "0x3c0000000", BUN_JSC_useBaselineJIT: "0", BUN_JSC_useFTLJIT: "0" };
const buildEnv = { ...env, MIMALLOC_HINT_FLOOR: "0x28000000000" }; // the builder's heap (which becomes the image) lives above where a restoring process allocates early on
const restoreEnv = env;
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

test.skipIf(!hasImages)("bun build --compile --compile-image writes <exe>.img and the exe restores from it with no env", async () => {
  using dir = tempDir("bun-image-compile", {});
  const exe = join(String(dir), "heavy");
  const build = Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "--compile-image", join(import.meta.dir, "heavy-fixture.js"), "--outfile", exe], env: bunEnv, stderr: "pipe", stdout: "pipe" });
  expect(build.stderr.toString() + build.stdout.toString()).toContain("[image] wrote");
  expect(Bun.file(exe + ".img").size).toBeGreaterThan(1024 * 1024);
  // No image env at all: the sibling .img is discovered and the process re-execs itself with what it needs.
  await using proc = Bun.spawn({ cmd: [exe], env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH! }, stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("[image] restored");
  expect(stdout).toContain("epoch 1");
  expect(stdout).toContain("fetch -> hello from restored server");
  expect(exitCode).toBe(0);
  // Opt out.
  const plain = Bun.spawnSync({ cmd: [exe], env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, BUN_IMAGE: "0" }, stderr: "pipe", stdout: "pipe" });
  expect(plain.stdout.toString()).toContain("epoch 0");
  expect(plain.exitCode).toBe(0);
  // Ship only the compressed image: first run inflates it into XDG_CACHE_HOME and restores from there.
  expect(Bun.file(exe + ".img.zst").size).toBeGreaterThan(1024);
  require("fs").unlinkSync(exe + ".img");
  const cache = join(String(dir), "cache");
  for (const run of [1, 2]) {
    const z = Bun.spawnSync({ cmd: [exe], env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, XDG_CACHE_HOME: cache }, stderr: "pipe", stdout: "pipe" });
    expect(z.stderr.toString()).toContain("[image] restored");
    expect(z.stdout.toString()).toContain("epoch 1");
    expect(z.exitCode).toBe(0);
  }
  expect(require("fs").readdirSync(join(cache, "bun", "images")).filter((f: string) => f.endsWith(".img")).length).toBe(1);
}, 30_000); // a compile plus five process launches (two of them inflating the .zst)


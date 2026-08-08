import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

// Heap image round-trip: the fixture snapshots itself at idle, a fresh process restores it and continues.
const env = { ...bunEnv, MIMALLOC_DETERMINISTIC_HINT: "1", BUN_IMAGE_JIT_ADDR: "0x3c0000000" };
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

test("launch context (argv, env, cwd, HOME) comes from the restoring process, not the builder", async () => {
  using dir = tempDir("bun-image-launchctx", { a: { ".keep": "" }, b: { ".keep": "" }, homeA: { ".keep": "" }, homeB: { ".keep": "" } });
  const img = join(String(dir), "ctx.img");
  const fixture = join(import.meta.dir, "launchctx-fixture.js");
  {
    await using p = Bun.spawn({ cmd: [bunExe(), fixture, "built-arg"], env: { ...buildEnv, BUN_IMAGE_OUT: img, LAUNCH_MARKER: "builder", HOME: join(String(dir), "homeA") }, cwd: join(String(dir), "a"), stdout: "pipe", stderr: "pipe" });
    const [out, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(out).toContain('"marker":"builder"');
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({ cmd: [bunExe(), fixture, "restored-arg", "--flag"], env: { ...restoreEnv, BUN_IMAGE_IN: img, LAUNCH_MARKER: "restorer", HOME: join(String(dir), "homeB") }, cwd: join(String(dir), "b"), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  const line = out.split("\n").find(l => l.startsWith("[js] restored "));
  expect(line, err.slice(-2000)).toBeDefined();
  const got = JSON.parse(line!.slice("[js] restored ".length));
  expect(got.argv).toEqual(["restored-arg", "--flag"]);
  expect(got.bunArgv).toEqual(["restored-arg", "--flag"]);
  expect(got.marker).toBe("restorer");
  expect(got.home).toBe(join(String(dir), "homeB"));
  expect(got.cwd.endsWith("/b")).toBe(true);
  expect(code).toBe(0);
}, 60000);

test("full GC right after restore is not stalled by the builder's parked threads", async () => {
  using dir = tempDir("bun-image-gctime", {});
  const img = join(String(dir), "gct.img");
  const fixture = join(import.meta.dir, "gctime-fixture.js");
  {
    await using p = Bun.spawn({ cmd: [bunExe(), fixture], env: { ...buildEnv, BUN_IMAGE_OUT: img }, stdout: "pipe", stderr: "pipe" });
    await p.exited;
  }
  await using p = Bun.spawn({ cmd: [bunExe(), fixture], env: { ...restoreEnv, BUN_IMAGE_IN: img }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  const m = out.match(/full gc #2 (\d+) ms; #3 (\d+) ms/);
  expect(m, err.slice(-1000)).not.toBeNull();
  // was 10_000 ms (AutomaticThread timeout) before ParkingLot entries were dropped at restore
  expect(Number(m![1])).toBeLessThan(2000);
  expect(Number(m![2])).toBeLessThan(2000);
  expect(code).toBe(0);
}, 60000);

test("keepTimers: timers armed before the snapshot keep running after restore, re-based on the new clock; stdin still delivers", async () => {
  using dir = tempDir("bun-image-keeptimers", {});
  const img = join(String(dir), "kt.img");
  const fixture = join(import.meta.dir, "keeptimers-fixture.js");
  {
    await using p = Bun.spawn({ cmd: [bunExe(), fixture], env: { ...buildEnv, BUN_IMAGE_OUT: img, KEEP: "1" }, terminal: { cols: 80, rows: 24, data() {} } });
    await p.exited;
  }
  let out = "";
  await using p = Bun.spawn({ cmd: [bunExe(), fixture], env: { ...restoreEnv, BUN_IMAGE_IN: img }, terminal: { cols: 80, rows: 24, data(_t, d) { out += new TextDecoder().decode(d); } } });
  const deadline = Date.now() + 20000;
  while (!/post-restore timer fired; interval ticks since restore=(\d+)/.test(out) && Date.now() < deadline) await Bun.sleep(50);
  const ticks = Number(/interval ticks since restore=(\d+)/.exec(out)?.[1] ?? -1);
  expect(ticks).toBeGreaterThanOrEqual(2); // 100 ms interval over ~500 ms; 0 would mean the pre-snapshot interval died
  expect(ticks).toBeLessThan(50); // not a burst of catch-up fires from un-rebased deadlines
  p.terminal!.write("q");
  expect(await p.exited).toBe(0);
  expect(out).toContain('stdin data: "q"');
}, 60000);

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
    const build = Bun.spawnSync({
      cmd: [bunExe(), join(import.meta.dir, fixture)],
      env: { ...buildEnv, BUN_IMAGE_OUT: img },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).toContain("[image] wrote");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, fixture)],
      env: { ...restoreEnv, BUN_IMAGE_IN: img },
      stderr: "pipe",
      stdout: "pipe",
    });
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

test.skipIf(!hasImages)(
  "bun build --compile --compile-image embeds the image; the single file restores from itself with no env",
  async () => {
    using dir = tempDir("bun-image-compile", {});
    const exe = join(String(dir), "heavy");
    const build = Bun.spawnSync({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--format=esm",
        "--compile-image",
        join(import.meta.dir, "heavy-fixture.js"),
        "--outfile",
        exe,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const buildOut = build.stderr.toString() + build.stdout.toString();
    expect(buildOut).toContain("[image] wrote");
    expect(buildOut).toContain("compressed heap image");
    // Nothing beside the executable: the (compressed) image lives in its __BUN/.bun section.
    expect(require("fs").readdirSync(String(dir)).sort()).toEqual(["heavy"]);
    const rawSize = Number(/\[image\] wrote .*?: \d+ regions, ([\d.]+)MB/.exec(buildOut)?.[1]);
    expect(Bun.file(exe).size).toBeLessThan(Bun.file(bunExe()).size + rawSize * 1048576 * 0.5); // the payload is a fraction of the raw image
    const cache = join(String(dir), "cache");
    for (const run of [1, 2]) {
      await using proc = Bun.spawn({
        cmd: [exe],
        env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, XDG_CACHE_HOME: cache, BUN_IMAGE_VERBOSE: "1" },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (run === 1)
        expect(stderr).toContain("inflating the embedded image"); // first launch fills the cache ...
      else expect(stderr).not.toContain("inflating"); // ... later launches map the cached file directly
      // A compiled executable that is not building keeps its own early heap above image space, so whatever the inflater
      // (or libc) allocated before the restore is not overlaid by it.
      const probeHex = /pre-restore heap probe=0x([0-9a-f]+)/.exec(stderr)?.[1];
      expect(probeHex).toBeDefined();
      expect(BigInt("0x" + probeHex!)).toBeGreaterThanOrEqual(0x21000000000n);
      expect(stderr).toContain("[image] restored");
      expect(stdout).toContain("epoch 1");
      expect(stdout).toContain("fetch -> hello from restored server");
      expect(exitCode).toBe(0);
    }
    expect(
      require("fs")
        .readdirSync(join(cache, "bun", "images"))
        .filter((f: string) => f.endsWith(".img")),
    ).toHaveLength(1); // one inflated image, no leftover .tmp
    // Opt out boots normally.
    const plain = Bun.spawnSync({
      cmd: [exe],
      env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, BUN_IMAGE: "0" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(plain.stdout.toString()).toContain("epoch 0");
    expect(plain.exitCode).toBe(0);
    // Debugging: an explicit image file still wins (BUN_IMAGE_KEEP_SIDECAR keeps <exe>.img next to it at build time).
    const dbg = join(String(dir), "dbg");
    const b2 = Bun.spawnSync({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--format=esm",
        "--compile-image",
        join(import.meta.dir, "heavy-fixture.js"),
        "--outfile",
        dbg,
      ],
      env: { ...bunEnv, BUN_IMAGE_KEEP_SIDECAR: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(b2.exitCode).toBe(0);
    expect(Bun.file(dbg + ".img").size).toBeGreaterThan(1024 * 1024);
    const viaFile = Bun.spawnSync({
      cmd: [dbg],
      env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, BUN_IMAGE_IN: dbg + ".img" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(viaFile.stdout.toString()).toContain("epoch 1");
    expect(viaFile.exitCode).toBe(0);
  },
  60_000,
);

test("launch context (argv, env, cwd, HOME) comes from the restoring process, not the builder", async () => {
  using dir = tempDir("bun-image-launchctx", {
    a: { ".keep": "" },
    b: { ".keep": "" },
    homeA: { ".keep": "" },
    homeB: { ".keep": "" },
  });
  const img = join(String(dir), "ctx.img");
  const fixture = join(import.meta.dir, "launchctx-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture, "built-arg"],
      env: { ...buildEnv, BUN_IMAGE_OUT: img, LAUNCH_MARKER: "builder", HOME: join(String(dir), "homeA") },
      cwd: join(String(dir), "a"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(out).toContain('"marker":"builder"');
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture, "restored-arg", "--flag"],
    env: { ...restoreEnv, BUN_IMAGE_IN: img, LAUNCH_MARKER: "restorer", HOME: join(String(dir), "homeB") },
    cwd: join(String(dir), "b"),
    stdout: "pipe",
    stderr: "pipe",
  });
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
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_IMAGE_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    await p.exited;
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_IMAGE_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  const m = out.match(/full gc #2 (\d+) ms; #3 (\d+) ms/);
  expect(m, err.slice(-1000)).not.toBeNull();
  // was 10_000 ms (AutomaticThread timeout) before ParkingLot entries were dropped at restore
  expect(Number(m![1])).toBeLessThan(2000);
  expect(Number(m![2])).toBeLessThan(2000);
  expect(code).toBe(0);
}, 60000);

test("timers: \"keep\" — timers armed before the snapshot keep running after restore, re-based on the new clock; stdin still delivers", async () => {
  using dir = tempDir("bun-image-keeptimers", {});
  const img = join(String(dir), "kt.img");
  const fixture = join(import.meta.dir, "keeptimers-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_IMAGE_OUT: img, TIMERS: "keep" },
      terminal: { cols: 80, rows: 24, data() {} },
    });
    await p.exited;
  }
  let out = "";
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_IMAGE_IN: img },
    terminal: {
      cols: 80,
      rows: 24,
      data(_t, d) {
        out += new TextDecoder().decode(d);
      },
    },
  });
  const deadline = Date.now() + 20000;
  while (!/remaining-time timer fired (\d+)ms after restore/.test(out) && Date.now() < deadline) await Bun.sleep(50);
  const ticks = Number(/interval ticks since restore=(\d+)/.exec(out)?.[1] ?? -1);
  expect(ticks).toBeGreaterThanOrEqual(2); // 100 ms interval over ~500 ms; 0 would mean the pre-snapshot interval died
  expect(ticks).toBeLessThan(50); // not a burst of catch-up fires from un-rebased deadlines
  // The one-shot had ~1.5 s left at the freeze; it must still have ~1.5 s left after restore (an un-rebased deadline
  // would be long past and fire immediately). Upper bound is loose for slow (debug/ASAN) runners.
  const remaining = Number(/remaining-time timer fired (\d+)ms after restore/.exec(out)![1]);
  expect(remaining).toBeGreaterThanOrEqual(1000);
  expect(remaining).toBeLessThan(5000);
  p.terminal!.write("q");
  expect(await p.exited).toBe(0);
  expect(out).toContain('stdin data: "q"');
}, 60000);

test("spawnSync used before the snapshot still works after restore (isolated spawnSync loop is rebuilt)", async () => {
  using dir = tempDir("bun-image-spawnsync", {});
  const img = join(String(dir), "ss.img");
  const fixture = join(import.meta.dir, "spawnsync-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_IMAGE_OUT: img, BUN_IMAGE_IO_WARN: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await p.stdout.text();
    await p.exited;
    expect(out).toContain('[js] build default: status=0 stdout="out\\n"');
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_IMAGE_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  for (const variant of ["default", "stdio-ignore-pipe-pipe", "shell+ignore", "shell+pipe-in"]) {
    expect(out, err.slice(-600)).toContain(`[js] restored ${variant}: status=0 stdout="out\\n" stderr="err\\n"`);
  }
  expect(code).toBe(0);
}, 60000);

test("random sources and time bases are fresh in every process restored from the same image", async () => {
  using dir = tempDir("bun-image-rng", {});
  const img = join(String(dir), "rng.img");
  const fixture = join(import.meta.dir, "rng-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_IMAGE_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    await p.exited;
  }
  const runs: any[] = [];
  for (let i = 0; i < 2; i++) {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_IMAGE_IN: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    const line = out.split("\n").find(l => l.startsWith("[js] "));
    expect(line, err.slice(-600)).toBeDefined();
    runs.push(JSON.parse(line!.slice(5)));
    expect(code).toBe(0);
  }
  const [a, b] = runs;
  expect(a.math).not.toEqual(b.math); // Math.random (JSGlobalObject WeakRandom)
  expect(a.webcrypto).not.toBe(b.webcrypto); // crypto.getRandomValues (entropy cache)
  expect(a.uuid).not.toBe(b.uuid); // crypto.randomUUID
  expect(a.randomBytes).not.toBe(b.randomBytes); // BoringSSL RAND_bytes
  expect(Number(a.uptime)).toBeLessThan(5); // counts from this launch, not the builder's
  expect(a.now).toBeLessThan(5000);
  expect(b.timeOrigin).toBeGreaterThanOrEqual(a.timeOrigin);
}, 60000);

test("DNS answers cached by the builder are not served after restore; keep-alive pool recovers", async () => {
  using dir = tempDir("bun-image-dns", {});
  const img = join(String(dir), "dns.img");
  const fixture = join(import.meta.dir, "dns-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_IMAGE_OUT: img, BUN_IMAGE_IO_WARN: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await p.stdout.text();
    await p.exited;
    expect(JSON.parse(out.match(/\[js\] build (.*)/)![1]).size).toBeGreaterThan(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_IMAGE_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  const m = out.match(/\[js\] restored (.*)/);
  expect(m, err.slice(-600)).not.toBeNull();
  const r = JSON.parse(m![1]);
  expect(r.before.size).toBe(0); // flushed at restore
  expect(r.after.cacheHitsCompleted).toBe(0); // the post-restore lookup was a miss, i.e. asked this machine
  expect(r.status).toBe(200);
  expect(r.body).toBe("ok2");
  expect(code).toBe(0);
}, 60000);

test.skipIf(process.platform !== "darwin")(
  "restore: 'restore' precedes any poll delivery; a stdio poll follows the re-seated fd; dns works again",
  async () => {
    using dir = tempDir("bun-image-polls", {});
    const img = join(String(dir), "polls.img");
    const fixture = join(import.meta.dir, "polls-fixture.js");
    {
      await using p = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...buildEnv, BUN_IMAGE_OUT: img, BUN_IMAGE_IO_WARN: "1" },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      await p.exited; // stdin pipe deliberately left open and unread-to-EOF
    }
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_IMAGE_IN: img },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    p.stdin.write("hello\n");
    await p.stdin.flush();
    const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    const m = out.match(/\[js\] (.*)/);
    expect(m, err.slice(-800)).not.toBeNull();
    const events = JSON.parse(m![1]) as string[];
    expect(events[0]).toBe("restore");
    expect(events).toContain("dns-ok");
    expect(events).toContain("stdin:hello"); // the builder's fd-0 poll was re-armed on this process's stdin
    expect(code).toBe(0);
  },
  60000,
);

test.skipIf(process.platform !== "darwin")(
  "fs.watch works in a restored process even though the builder had an FSEvents loop",
  async () => {
    using dir = tempDir("bun-image-fswatch", { a: { ".keep": "" }, b: { ".keep": "" } });
    const img = join(String(dir), "w.img");
    const fixture = join(import.meta.dir, "fswatch-fixture.js");
    {
      await using p = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...buildEnv, BUN_IMAGE_OUT: img, BUN_IMAGE_IO_WARN: "1", WATCH_DIR: join(String(dir), "a") },
        stdout: "pipe",
        stderr: "pipe",
      });
      await p.exited;
    }
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_IMAGE_IN: img, WATCH_DIR2: join(String(dir), "b") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    const m = out.match(/\[js\] (.*)/);
    expect(m, err.slice(-600)).not.toBeNull();
    expect(JSON.parse(m![1]).some((e: string) => e.endsWith(":touched.txt"))).toBe(true);
    expect(code).toBe(0);
  },
  60000,
);

test("envGate: the image is only restored when the gated environment variables agree with the build", async () => {
  using dir = tempDir("bun-image-envgate", {});
  const img = join(String(dir), "g.img");
  const fixture = join(import.meta.dir, "envgate-fixture.js");
  {
    const b = Bun.spawnSync({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_IMAGE_OUT: img },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(b.stderr.toString()).toContain("[image] wrote");
  }
  const run = (extra: Record<string, string>) =>
    Bun.spawnSync({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_IMAGE_IN: img, ...extra },
      stderr: "pipe",
      stdout: "pipe",
    });
  expect(run({}).stdout.toString()).toContain("[js] restored APP_MODE=<unset>"); // same environment as the build: restored
  const gated = run({ APP_MODE: "special" });
  expect(gated.stdout.toString()).toContain("[js] plain boot APP_MODE=special"); // a gated variable differs: normal boot
  expect(gated.stderr.toString()).not.toContain("[image] restored");
  const other = run({ SOME_OTHER_VAR: "1" });
  expect(other.stdout.toString()).toContain("[js] restored"); // ungated variables don't matter
}, 60000);

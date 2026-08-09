import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

// Snapshot round-trip: the fixture snapshots itself at idle, a fresh process restores it and continues.
const env = { ...bunEnv, MIMALLOC_DETERMINISTIC_HINT: "1", BUN_SNAPSHOT_JIT_ADDR: "0x3c0000000" };
const buildEnv = env;
const restoreEnv = { ...env, MIMALLOC_HINT_FLOOR: "0x21000000000", BUN_SNAPSHOT_VERBOSE: "1" }; // a restoring process keeps its own early heap above where snapshot regions get mapped
const hasSnapshots = typeof Bun.startupSnapshot?.take === "function" && (isLinux || isMacOS);

for (const fixture of ["smoke-fixture.js", "heavy-fixture.js"]) {
  test.skipIf(!hasSnapshots)(`snapshot round-trip: ${fixture}`, async () => {
    using dir = tempDir("bun-snapshot", {});
    const img = join(String(dir), "app.snapshot");
    const build = Bun.spawnSync({
      cmd: [bunExe(), join(import.meta.dir, fixture)],
      env: { ...buildEnv, BUN_SNAPSHOT_OUT: img },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).toContain("[snapshot] wrote");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, fixture)],
      env: { ...restoreEnv, BUN_SNAPSHOT_IN: img },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("[snapshot] restored");
    expect(stdout).toContain("epoch 1");
    if (fixture === "heavy-fixture.js") {
      expect(stdout).toContain("fetch -> hello from restored server");
      expect(stdout).toContain("fs -> written after restore");
    } else expect(stdout).toContain("[js] tick 3");
    expect(exitCode).toBe(0);
  });
}

test.skipIf(!hasSnapshots)(
  "bun build --compile --snapshot embeds the snapshot; the single file restores from itself with no env",
  async () => {
    using dir = tempDir("bun-snapshot-compile", {});
    const exe = join(String(dir), "heavy");
    const build = Bun.spawnSync({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--format=esm",
        "--snapshot=manual",
        join(import.meta.dir, "heavy-fixture.js"),
        "--outfile",
        exe,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const buildOut = build.stderr.toString() + build.stdout.toString();
    expect(buildOut).toContain("[snapshot] wrote");
    expect(buildOut).toContain("MB snapshot into the executable");
    // Nothing beside the executable: the snapshot is in its __BUN/.bun section, and a launch maps the executable itself.
    expect(require("fs").readdirSync(String(dir)).sort()).toEqual(["heavy"]);
    const rawMB = Number(/\[snapshot\] wrote .*?: \d+ regions, ([\d.]+)MB/.exec(buildOut)?.[1]);
    expect(rawMB).toBeGreaterThan(1);
    expect(Bun.file(exe).size).toBeGreaterThan(Bun.file(bunExe()).size + rawMB * 1048576 * 0.9); // embedded as is
    for (const run of [1, 2]) {
      await using proc = Bun.spawn({
        cmd: [exe],
        env: { HOME: String(dir), PATH: bunEnv.PATH!, BUN_SNAPSHOT_VERBOSE: "1" },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // A compiled executable that is not taking a snapshot keeps its own early heap above snapshot space, so whatever libc
      // allocated before the restore is not overlaid by it.
      const probeHex = /pre-restore heap probe=0x([0-9a-f]+)/.exec(stderr)?.[1];
      expect(probeHex).toBeDefined();
      expect(BigInt("0x" + probeHex!)).toBeGreaterThanOrEqual(0x21000000000n);
      expect(stderr).toContain("[snapshot] restored");
      expect(stdout).toContain("epoch 1");
      expect(stdout).toContain("fetch -> hello from restored server");
      expect(exitCode).toBe(0);
    }
    expect(require("fs").readdirSync(String(dir)).sort()).toEqual(["heavy"]); // launches wrote nothing anywhere (HOME is this dir)
    // Opt out boots normally.
    const plain = Bun.spawnSync({
      cmd: [exe],
      env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, BUN_SNAPSHOT: "0" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(plain.stdout.toString()).toContain("epoch 0");
    expect(plain.exitCode).toBe(0);
    // Debugging: an explicit snapshot file still wins (BUN_SNAPSHOT_KEEP_SIDECAR keeps <exe>.snapshot next to it at build time).
    const dbg = join(String(dir), "dbg");
    const b2 = Bun.spawnSync({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--format=esm",
        "--snapshot",
        join(import.meta.dir, "heavy-fixture.js"),
        "--outfile",
        dbg,
      ],
      env: { ...bunEnv, BUN_SNAPSHOT_KEEP_SIDECAR: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(b2.exitCode).toBe(0);
    expect(Bun.file(dbg + ".snapshot").size).toBeGreaterThan(1024 * 1024);
    const viaFile = Bun.spawnSync({
      cmd: [dbg],
      env: { HOME: bunEnv.HOME!, PATH: bunEnv.PATH!, BUN_SNAPSHOT_IN: dbg + ".snapshot" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(viaFile.stdout.toString()).toContain("epoch 1");
    expect(viaFile.exitCode).toBe(0);
  },
  60_000,
);

test("launch context (argv, env, cwd, HOME) comes from the restoring process, not the builder", async () => {
  using dir = tempDir("bun-snapshot-launchctx", {
    a: { ".keep": "" },
    b: { ".keep": "" },
    homeA: { ".keep": "" },
    homeB: { ".keep": "" },
  });
  const img = join(String(dir), "ctx.snapshot");
  const fixture = join(import.meta.dir, "launchctx-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture, "built-arg"],
      env: { ...buildEnv, BUN_SNAPSHOT_OUT: img, LAUNCH_MARKER: "builder", HOME: join(String(dir), "homeA") },
      cwd: join(String(dir), "a"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(out).toContain('"marker":"builder"');
    // The build names what was read from process.env before the freeze (and that it was copied wholesale once).
    expect(err).toContain("values read from process.env before the freeze are baked into the snapshot");
    expect(err).toContain("process.env was enumerated or copied 1 time");
    expect(err).toMatch(/1 copy from:\n\s+at .*launchctx-fixture\.js/); // attributed to the fixture's spread
    expect(err).not.toMatch(/\n  (?!process\.env was )\S/); // a copy covers every name: no per-name list
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture, "restored-arg", "--flag"],
    env: { ...restoreEnv, BUN_SNAPSHOT_IN: img, LAUNCH_MARKER: "restorer", HOME: join(String(dir), "homeB") },
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
  expect(got.viaCapturedRef).toBe("restorer");
  expect(got.viaCopy).toBe("builder");
  expect(got.home).toBe(join(String(dir), "homeB"));
  expect(got.cwd.endsWith("/b")).toBe(true);
  expect(code).toBe(0);
}, 60000);

test("full GC right after restore is not stalled by the builder's parked threads", async () => {
  using dir = tempDir("bun-snapshot-gctime", {});
  const img = join(String(dir), "gct.snapshot");
  const fixture = join(import.meta.dir, "gctime-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    await p.exited;
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_SNAPSHOT_IN: img },
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

test('timers: "keep" — timers armed before the snapshot keep running after restore, re-based on the new clock; stdin still delivers', async () => {
  using dir = tempDir("bun-snapshot-keeptimers", {});
  const img = join(String(dir), "kt.snapshot");
  const fixture = join(import.meta.dir, "keeptimers-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_SNAPSHOT_OUT: img, TIMERS: "keep" },
      terminal: { cols: 80, rows: 24, data() {} },
    });
    await p.exited;
  }
  let out = "";
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_SNAPSHOT_IN: img },
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
  using dir = tempDir("bun-snapshot-spawnsync", {});
  const img = join(String(dir), "ss.snapshot");
  const fixture = join(import.meta.dir, "spawnsync-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_SNAPSHOT_OUT: img, BUN_SNAPSHOT_IO: "local" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await p.stdout.text();
    await p.exited;
    expect(out).toContain('[js] build default: status=0 stdout="out\\n"');
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_SNAPSHOT_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  for (const variant of ["default", "stdio-ignore-pipe-pipe", "shell+ignore", "shell+pipe-in"]) {
    expect(out, err.slice(-600)).toContain(`[js] restored ${variant}: status=0 stdout="out\\n" stderr="err\\n"`);
  }
  expect(code).toBe(0);
}, 60000);

test("random sources and time bases are fresh in every process restored from the same snapshot", async () => {
  using dir = tempDir("bun-snapshot-rng", {});
  const img = join(String(dir), "rng.snapshot");
  const fixture = join(import.meta.dir, "rng-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    await p.exited;
  }
  const runs: any[] = [];
  for (let i = 0; i < 2; i++) {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_SNAPSHOT_IN: img },
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
  using dir = tempDir("bun-snapshot-dns", {});
  const img = join(String(dir), "dns.snapshot");
  const fixture = join(import.meta.dir, "dns-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_SNAPSHOT_OUT: img, BUN_SNAPSHOT_IO: "network" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await p.stdout.text();
    await p.exited;
    expect(JSON.parse(out.match(/\[js\] build (.*)/)![1]).size).toBeGreaterThan(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_SNAPSHOT_IN: img },
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
    using dir = tempDir("bun-snapshot-polls", {});
    const img = join(String(dir), "polls.snapshot");
    const fixture = join(import.meta.dir, "polls-fixture.js");
    {
      await using p = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...buildEnv, BUN_SNAPSHOT_OUT: img, BUN_SNAPSHOT_IO: "local" },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      await p.exited; // stdin pipe deliberately left open and unread-to-EOF
    }
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_SNAPSHOT_IN: img },
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
    using dir = tempDir("bun-snapshot-fswatch", { a: { ".keep": "" }, b: { ".keep": "" } });
    const img = join(String(dir), "w.snapshot");
    const fixture = join(import.meta.dir, "fswatch-fixture.js");
    {
      await using p = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...buildEnv, BUN_SNAPSHOT_OUT: img, BUN_SNAPSHOT_IO: "local", WATCH_DIR: join(String(dir), "a") },
        stdout: "pipe",
        stderr: "pipe",
      });
      await p.exited;
    }
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_SNAPSHOT_IN: img, WATCH_DIR2: join(String(dir), "b") },
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

test("envGate: the snapshot is only restored when the gated environment variables agree with the build", async () => {
  using dir = tempDir("bun-snapshot-envgate", {});
  const img = join(String(dir), "g.snapshot");
  const fixture = join(import.meta.dir, "envgate-fixture.js");
  {
    const b = Bun.spawnSync({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_SNAPSHOT_OUT: img, UNGATED_VAR: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const err = b.stderr.toString();
    expect(err).toContain("[snapshot] wrote");
    // The report lists what was read by name before the freeze, minus the gated names.
    expect(err).toMatch(/values read from process.env before the freeze[^\n]*\n(?:[^\n]*\n)?  [^\n]*\bUNGATED_VAR\b/);
    expect(err).not.toMatch(/\n  [^\n]*\bAPP_MODE\b/);
  }
  const run = (extra: Record<string, string>) =>
    Bun.spawnSync({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_SNAPSHOT_IN: img, ...extra },
      stderr: "pipe",
      stdout: "pipe",
    });
  expect(run({}).stdout.toString()).toContain("[js] restored APP_MODE=<unset>"); // same environment as the build: restored
  const gated = run({ APP_MODE: "special" });
  expect(gated.stdout.toString()).toContain("[js] plain boot APP_MODE=special"); // a gated variable differs: normal boot
  expect(gated.stderr.toString()).not.toContain("[snapshot] restored");
  const other = run({ SOME_OTHER_VAR: "1" });
  expect(other.stdout.toString()).toContain("[js] restored"); // ungated variables don't matter
}, 60000);

const runEnv = () => ({ HOME: bunEnv.HOME!, PATH: bunEnv.PATH! });
function build(args: string[]) {
  const r = Bun.spawnSync({ cmd: [bunExe(), "build", ...args], env: bunEnv, stderr: "pipe", stdout: "pipe" });
  return { out: r.stderr.toString() + r.stdout.toString(), code: r.exitCode };
}
function runExe(exe: string, extraEnv: Record<string, string> = {}) {
  const r = Bun.spawnSync({ cmd: [exe], env: { ...runEnv(), ...extraEnv }, stderr: "pipe", stdout: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode };
}

test("--snapshot (auto): an app with no snapshot call gets its snapshot once startup drains", () => {
  using dir = tempDir("bun-snapshot-auto", {});
  const exe = join(String(dir), "app");
  const b = build(["--compile", "--snapshot", join(import.meta.dir, "auto-fixture.js"), "--outfile", exe]);
  expect(b.out).toContain("[snapshot] embedded");
  expect(b.code).toBe(0);
  const r = runExe(exe);
  expect(r.stdout).toContain("[js] restored epoch 1 rows 20000");
  expect(r.code).toBe(0);
});

test("the snapshot step runs on its own against an executable built earlier, in place, and can be re-run", () => {
  using dir = tempDir("bun-snapshot-split", {});
  const exe = join(String(dir), "app");
  const compiled = build(["--compile", join(import.meta.dir, "auto-fixture.js"), "--outfile", exe]);
  expect(compiled.code).toBe(0);
  expect(runExe(exe).stdout).toContain("[js] plain boot"); // no snapshot yet
  const sizeBefore = Bun.file(exe).size;
  const first = build(["--snapshot", "--outfile", exe]);
  expect(first.out).toContain("[snapshot] embedded");
  expect(first.code).toBe(0);
  expect(runExe(exe).stdout).toContain("[js] restored epoch 1");
  const sizeWithSnapshot = Bun.file(exe).size;
  expect(sizeWithSnapshot).toBeGreaterThan(sizeBefore);
  const again = build(["--snapshot", "--outfile", exe]);
  expect(again.out).toContain("[snapshot] embedded");
  expect(again.code).toBe(0);
  expect(runExe(exe).stdout).toContain("[js] restored epoch 1");
  // Replaced, not stacked: the second snapshot takes the place of the first (allow a page of alignment slack either way).
  expect(Math.abs(Bun.file(exe).size - sizeWithSnapshot)).toBeLessThan(sizeWithSnapshot - sizeBefore);
  // Misuse is explained.
  expect(build(["--snapshot", join(import.meta.dir, "auto-fixture.js")]).out).toContain("--snapshot needs --compile");
  expect(build(["--snapshot", "--outfile", join(String(dir), "missing")]).out).toContain("could not read");
});

test("Bun.build({ snapshot }) is the flag's equivalent; it needs compile, and bad values are rejected up front", async () => {
  using dir = tempDir("bun-snapshot-jsapi", {
    "build.ts": [
      "const [exe, entry] = process.argv.slice(2);",
      "const r = await Bun.build({ entrypoints: [entry], compile: { outfile: exe }, snapshot: true });",
      "if (!r.success) { console.error(r.logs); process.exit(2); }",
      "const bad = [",
      "  { snapshot: true },",
      "  { compile: { outfile: exe + '-bad' }, snapshot: 'yes' },",
      "  { compile: { outfile: exe + '-bad' }, snapshot: { mode: 'sometimes' } },",
      "  { compile: { outfile: exe + '-bad' }, snapshot: { io: 'everything' } },",
      "];",
      "for (const config of bad) {",
      "  try { await Bun.build({ entrypoints: [entry], ...config }); console.log('accepted', JSON.stringify(config)); }",
      "  catch (e) { console.log('rejected: ' + e.constructor.name + ': ' + e.message); }",
      "}",
    ].join("\n"),
  });
  const exe = join(String(dir), "app");
  await using p = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "build.ts"), exe, join(import.meta.dir, "auto-fixture.js")],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(stderr + stdout).toContain("[snapshot] embedded");
  expect(stdout).toContain("rejected: TypeError: snapshot requires compile");
  expect(stdout).toContain("rejected: TypeError: snapshot must be true or an object");
  expect(stdout).toContain('rejected: TypeError: snapshot.mode must be "auto" or "manual"');
  expect(stdout).toContain('rejected: TypeError: snapshot.io must be "strict", "local" or "network"');
  expect(stdout).not.toContain("accepted");
  expect(code).toBe(0);
  expect(runExe(exe).stdout).toContain("[js] restored epoch 1");
});

test("local I/O during the build is refused by default (auto mode keeps the plain executable) and reported when allowed", () => {
  using dir = tempDir("bun-snapshot-io", {});
  const strict = join(String(dir), "strict");
  const s = build(["--compile", "--snapshot", join(import.meta.dir, "io-fixture.js"), "--outfile", strict]);
  expect(s.out).toContain("node:fs is not available while building a snapshot");
  expect(s.out).toContain("left without a snapshot");
  expect(s.code).toBe(0); // the build still produced a working (plain) executable
  expect(runExe(strict).stdout).toBe(""); // boots plainly: the fixture only prints when restored
  const local = join(String(dir), "local");
  const l = build([
    "--compile",
    "--snapshot",
    "--snapshot-io=local",
    join(import.meta.dir, "io-fixture.js"),
    "--outfile",
    local,
  ]);
  expect(l.out).toContain("local I/O operations ran before the freeze");
  expect(l.out).toMatch(/node:fs x1 from:\n\s+at readFileSync/); // attributed to the call site
  expect(l.out).toContain("[snapshot] embedded");
  expect(l.code).toBe(0);
  expect(runExe(local).stdout).toMatch(/restored, exe bytes \d+/);
  // The io option is meaningless without the snapshot step, and manual mode explains itself when the app never snapshots.
  expect(
    build([
      "--compile",
      "--snapshot-io=local",
      join(import.meta.dir, "auto-fixture.js"),
      "--outfile",
      join(String(dir), "x"),
    ]).out,
  ).toContain("only applies together with --snapshot");
  const m = build([
    "--compile",
    "--snapshot=manual",
    join(import.meta.dir, "auto-fixture.js"),
    "--outfile",
    join(String(dir), "manual"),
  ]);
  expect(m.out).toContain("In manual mode the app has to call Bun.startupSnapshot.take()");
  expect(m.code).toBe(1);
});

test("Bun.startupSnapshot.main(): the program runs after restore with each launch's own argv and cwd; a snapshot taken with it accepts any invocation", () => {
  using dir = tempDir("bun-snapshot-main", { "a/.keep": "", "b/.keep": "" });
  const exe = join(String(dir), "tool");
  const b = build(["--compile", "--snapshot", join(import.meta.dir, "main-fixture.js"), "--outfile", exe]);
  expect(b.out).toContain("[js] loading only; main deferred"); // the build run loaded the program without running it
  expect(b.out).toContain("[snapshot] embedded");
  expect(b.code).toBe(0);
  for (const [args, cwd] of [
    [["format", "x.ts"], "a"],
    [[], "b"],
    [["--version"], "a"],
  ] as const) {
    const r = Bun.spawnSync({
      cmd: [exe, ...args],
      cwd: join(String(dir), cwd),
      env: { ...runEnv(), BUN_SNAPSHOT_VERBOSE: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(r.stderr.toString()).toContain("[snapshot] restored"); // any argv resumes from the snapshot
    expect(r.stdout.toString()).toContain(
      `[js] main epoch=1 args=${JSON.stringify(args)} cwd=${cwd} table=5000 calls=1`,
    );
    expect(r.exitCode).toBe(0);
  }
  // Without a snapshot, main() simply runs.
  const plain = Bun.spawnSync({
    cmd: [bunExe(), join(import.meta.dir, "main-fixture.js"), "p", "q"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(plain.stdout.toString()).toContain('[js] main epoch=0 args=["p","q"]');
});

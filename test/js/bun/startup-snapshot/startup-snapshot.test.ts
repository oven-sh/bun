import { expect } from "bun:test";
import { copyFileSync, existsSync, linkSync, realpathSync } from "fs";
import { bunExe, isLinux, tempDir, tls } from "harness";
import { join } from "path";
import { buildEnv, restoreEnv, snapshotTest, withSnapshots } from "./startup-snapshot-harness";

for (const fixture of ["smoke-fixture.js", "heavy-fixture.js"]) {
  snapshotTest(`snapshot round-trip: ${fixture}`, async () => {
    using dir = tempDir("bun-snapshot", {});
    const img = join(String(dir), "app.snapshot");
    const build = Bun.spawnSync({
      cmd: [bunExe(), join(import.meta.dir, fixture)],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).toContain("[snapshot] wrote");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, fixture)],
      env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img, HEAVY_OUT: join(String(dir), "heavy.out") },
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

snapshotTest("stdin's tty reader set up on a high descriptor number still delivers input after restore", async () => {
  using dir = tempDir("bun-snapshot-highfd", {});
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "highfd-tty-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img, BUN_STARTUP_SNAPSHOT_IO: "local" },
      terminal: { cols: 80, rows: 24, data() {} },
    });
    expect(await p.exited).toBe(0);
  }
  let out = "";
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
    terminal: {
      cols: 80,
      rows: 24,
      data(_t, d) {
        out += new TextDecoder().decode(d);
      },
    },
  });
  const deadline = Date.now() + 20_000;
  while (!out.includes("waiting for a keystroke") && Date.now() < deadline) await Bun.sleep(20);
  expect(out).toContain("waiting for a keystroke");
  expect(out).toMatch(/\[snapshot\] dup2\(\d, [4-9]\d\)/); // the record really carried a high descriptor number (engagement, not just outcome)
  p.terminal!.write("z");
  const exit = await Promise.race([p.exited, Bun.sleep(10_000).then(() => "no exit within 10s" as const)]);
  expect(exit, out).toBe(0);
  expect(out).toContain('stdin data after restore: "z"');
});

snapshotTest("an unhandled rejection in a restored process exits 1, exactly like a normal boot", async () => {
  using dir = tempDir("bun-snapshot-unhandled", {});
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "unhandled-fixture.js");
  const plain = Bun.spawnSync({
    cmd: [bunExe(), fixture],
    env: { ...buildEnv, PLAIN: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(plain.exitCode).toBe(1);
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(err).toContain("unhandled after restore");
  expect(code).toBe(plain.exitCode); // 1; a restored process used to exit 0 here
});

snapshotTest("SharedArrayBuffers from before the freeze keep working after restore, growth included", async () => {
  using dir = tempDir("bun-snapshot-sab", {});
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "sab-fixture.js");
  const plainRun = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...buildEnv, PLAIN: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [plainOut] = await Promise.all([plainRun.stdout.text(), plainRun.stderr.text(), plainRun.exited]);
  expect(plainOut).toContain("aliased=true sameBuffer=true atomicsAdd=7->12");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(err).toContain("[snapshot] restored");
  expect(out).toBe(plainOut);
  expect(code).toBe(0);
});

snapshotTest("Intl objects created before the freeze work after restore and agree with a plain run", async () => {
  using dir = tempDir("bun-snapshot-intl", {});
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "intl-fixture.js");
  const plainRun = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...buildEnv, PLAIN: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [plainOut] = await Promise.all([plainRun.stdout.text(), plainRun.stderr.text(), plainRun.exited]);
  expect(plainOut.split("\n").length).toBeGreaterThanOrEqual(13);
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [restoredOut, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(err).toContain("[snapshot] restored");
  expect(restoredOut).toBe(plainOut);
  expect(code).toBe(0);
});

snapshotTest("the frozen heap holds up under JSC's GC verifier", async () => {
  // JSC options are frozen at VM init, so they travel with the snapshot: set at build time, the verifier re-marks every collection
  // in the restored process independently of the immortal fast paths and RELEASE_ASSERTs on any disagreement. Engagement was
  // confirmed by timing (a verified full collection here takes ~40 ms against ~3 ms without); the assertion is that it stays quiet.
  using dir = tempDir("bun-snapshot-verifygc", {});
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "gctime-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img, BUN_JSC_verifyGC: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(err).toContain("[snapshot] restored");
  expect(out).toContain("; #3 "); // the third verified full collection completed
  expect(code).toBe(0);
});

const memoryTest = withSnapshots(isLinux); // RssAnon is a clean private-memory figure; macOS exposes nothing equivalent cheaply, so there the round-trips are checked functionally only
memoryTest("a restored process holds much less private memory than one that builds the same state itself", async () => {
  using dir = tempDir("bun-snapshot-private-memory", {});
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "private-memory-fixture.js");
  const anon = (out: string) => Number(/rss-anon-kb=(\d+)/.exec(out)![1]);
  const plainRun = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...buildEnv, PLAIN: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [plainOut] = await Promise.all([plainRun.stdout.text(), plainRun.stderr.text(), plainRun.exited]);
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [restoredOut, err] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(err).toContain("[snapshot] restored");
  expect(restoredOut).toContain("items=60000");
  const plain = anon(plainOut),
    restored = anon(restoredOut);
  // The graph is tens of MB private in the plain run and lives in clean snapshot pages in the restored one; the ratio has a
  // wide margin (measured ~2x on the real programs in the PR description), so this fails only if the feature stops working.
  expect(restored, `plain ${plain} KB vs restored ${restored} KB`).toBeLessThan(plain * 0.75);
});

snapshotTest(
  "process.execPath is where this launch's executable is, even when the snapshot was built at another path",
  async () => {
    // The same executable at a second path (a hard link, so it is byte-identical and the snapshot accepts it): build with one, restore with the other.
    using dir = tempDir("bun-snapshot-execpath", {});
    const other = join(String(dir), "bun-elsewhere");
    try {
      linkSync(bunExe(), other);
    } catch (e: any) {
      if (e?.code !== "EXDEV") throw e;
      copyFileSync(bunExe(), other); // tmp on another filesystem: a copy is just as byte-identical
    }
    const img = join(String(dir), "s.snapshot");
    const code = `void process.execPath; process.on("restore", () => { console.log("[js] execPath=" + process.execPath); process.exit(0); }); setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);`;
    await Bun.write(join(String(dir), "app.js"), code);
    {
      await using p = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "app.js")],
        env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, , c] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
      expect(c).toBe(0);
    }
    await using p = Bun.spawn({
      cmd: [other, join(String(dir), "app.js")],
      env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(err).toContain("[snapshot] restored");
    expect(out).toContain("[js] execPath=" + realpathSync(other));
  },
);

snapshotTest("a snapshot is refused while a worker thread is running, and says so", async () => {
  using dir = tempDir("bun-snapshot-worker", {});
  await using p = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "worker-fixture.js")],
    env: {
      ...buildEnv,
      BUN_STARTUP_SNAPSHOT_OUT: join(String(dir), "s.snapshot"),
      BUN_STARTUP_SNAPSHOT_QUIET_TIMEOUT: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(err).toContain("worker thread(s) still running");
  expect(existsSync(join(String(dir), "s.snapshot"))).toBe(false);
  expect(code).toBe(70); // the runtime's "did not become quiet" exit
});

snapshotTest("a strict build refuses servers and UDP sockets, not just listen/connect", async () => {
  using dir = tempDir("bun-snapshot-strict-servers", {});
  await using p = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "strict-servers-fixture.js")],
    env: {
      ...buildEnv,
      BUN_STARTUP_SNAPSHOT_OUT: join(String(dir), "s.snapshot"),
      CP_TARGET: join(String(dir), "copy"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(out).toContain("[js] serve refused");
  expect(out).toContain("[js] udp refused");
  for (const op of [
    "readdir",
    "cp",
    "watch",
    "readdir-async",
    "cp-async",
    "bun-write",
    "bun-file-text",
    "bun-file-exists",
  ])
    expect(out).toContain(`[js] ${op} refused`); // hand-written node:fs bindings
  for (const op of ["stdout-write", "stdin-access"]) expect(out).toContain(`[js] ${op} created`); // stdio is exempt from the gate
});

snapshotTest("Bun.enableANSIColors reified during a piped build is re-derived for a launch on a terminal", async () => {
  using dir = tempDir("bun-snapshot-colors", {});
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "colors-fixture.js");
  const outFile = join(String(dir), "colors.txt");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, NO_COLOR: undefined, BUN_STARTUP_SNAPSHOT_IN: img, COLORS_OUT: outFile }, // bunEnv sets NO_COLOR; this launch is the one that may color
    terminal: { cols: 80, rows: 24, data() {} },
  });
  expect(await p.exited).toBe(0);
  expect(await Bun.file(outFile).text()).toBe("true"); // the builder's "false" is what a stale property would carry
});

snapshotTest("an array from the snapshot can grow past its capacity after restore", async () => {
  using dir = tempDir("bun-snapshot-butterfly", {});
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "butterfly-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(err).toContain("[snapshot] restored");
  expect(out).toContain("[js] grown-after-restore ok");
  expect(code).toBe(0);
});

snapshotTest("TLS verification derived from the builder's environment is re-derived at restore", async () => {
  using dir = tempDir("bun-snapshot-tls-reject", { "cert.pem": tls.cert, "key.pem": tls.key });
  const img = join(String(dir), "s.snapshot");
  const fixture = join(import.meta.dir, "tls-reject-fixture.js");
  const files = { TLS_CERT: join(String(dir), "cert.pem"), TLS_KEY: join(String(dir), "key.pem") };
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: {
        ...buildEnv,
        ...files,
        BUN_STARTUP_SNAPSHOT_OUT: img,
        BUN_STARTUP_SNAPSHOT_IO: "network",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(out).toContain("[js] build ok 200");
    expect(code).toBe(0);
  }
  const { NODE_TLS_REJECT_UNAUTHORIZED: _unset, ...launchEnv } = {
    ...restoreEnv,
    ...files,
    BUN_STARTUP_SNAPSHOT_IN: img,
  };
  await using p = Bun.spawn({ cmd: [bunExe(), fixture], env: launchEnv, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(err).toContain("[snapshot] restored");
  expect(out).toContain("[js] restored rejected"); // the builder's "don't verify" must not be what this launch runs with
  expect(code).toBe(0);
});

snapshotTest("a snapshot built with the parent-death watchdog on does not fire it at restore", async () => {
  // The builder's watch (on the builder's parent) is in the snapshot; a restored process must watch its own parent instead of
  // acting on the inherited one. Before the fix every restored launch exited 129 on macOS.
  using dir = tempDir("bun-snapshot-no-orphans", {});
  const img = join(String(dir), "s.snapshot");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "smoke-fixture.js")],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img, BUN_FEATURE_FLAG_NO_ORPHANS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(code).toBe(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "smoke-fixture.js")],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img, BUN_FEATURE_FLAG_NO_ORPHANS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  expect(stderr).toContain("[snapshot] restored");
  expect(stdout).toContain("epoch 1");
  expect(code).toBe(0);
});

snapshotTest("launch context (argv, env, cwd, HOME) comes from the restoring process, not the builder", async () => {
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
      // BUN_OPTIONS is spliced into argv; the build has one token and the launch below has none, so argv must be re-derived, not inherited.
      env: {
        ...buildEnv,
        BUN_STARTUP_SNAPSHOT_OUT: img,
        LAUNCH_MARKER: "builder",
        HOME: join(String(dir), "homeA"),
        BUN_OPTIONS: "--silent",
      },
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
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img, LAUNCH_MARKER: "restorer", HOME: join(String(dir), "homeB") },
    cwd: join(String(dir), "b"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  const line = out.split("\n").find(l => l.startsWith("[js] restored "));
  expect(line, err.slice(-2000)).toBeDefined();
  const got = JSON.parse(line!.slice("[js] restored ".length));
  expect(got.pid).toBe(p.pid); // not the builder's, even though the builder read it
  expect(got.execPath).toBe(bunExe());
  expect(got.bunCwd.endsWith("/b")).toBe(true); // Bun.cwd was reified in "a" during the build
  // enableANSIColors is refreshed by the same loop as Bun.cwd above; telling it apart would need a pty-backed launch (both runs here are piped).
  expect(got.argv).toEqual(["restored-arg", "--flag"]);
  expect(got.bunArgv).toEqual(["restored-arg", "--flag"]);
  expect(got.marker).toBe("restorer");
  expect(got.viaCapturedRef).toBe("restorer");
  expect(got.viaCopy).toBe("builder");
  expect(got.home).toBe(join(String(dir), "homeB"));
  expect(got.cwd.endsWith("/b")).toBe(true);
  expect(code).toBe(0);
});

snapshotTest("full GC right after restore is not stalled by the builder's parked threads", async () => {
  using dir = tempDir("bun-snapshot-gctime", {});
  const img = join(String(dir), "gct.snapshot");
  const fixture = join(import.meta.dir, "gctime-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]); // drained together: a chatty build must not block on a full pipe
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
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
});

snapshotTest(
  'timers: "keep" — timers armed before the snapshot keep running after restore, re-based on the new clock; stdin still delivers',
  async () => {
    using dir = tempDir("bun-snapshot-keeptimers", {});
    const img = join(String(dir), "kt.snapshot");
    const fixture = join(import.meta.dir, "keeptimers-fixture.js");
    {
      await using p = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img, TIMERS: "keep" },
        terminal: { cols: 80, rows: 24, data() {} },
      });
      await p.exited;
    }
    let out = "";
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
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
    // The timer had 1700 ms minus however long the (possibly slow, loaded) builder took to reach take() left at the freeze;
    // an un-rebased deadline would be long past and fire within a few ms of restore, which is what the lower bound rejects.
    const remaining = Number(/remaining-time timer fired (\d+)ms after restore/.exec(out)![1]);
    expect(remaining).toBeGreaterThanOrEqual(400);
    expect(remaining).toBeLessThan(5000);
    p.terminal!.write("q");
    // On failure the output says which half broke: no "stdin data" line means the keystroke never reached the kept stream;
    // the line without an exit means process.exit() from its handler did not complete.
    const exit = await Promise.race([p.exited, Bun.sleep(10_000).then(() => "no exit within 10s" as const)]);
    expect(exit, out).toBe(0);
    expect(out).toContain('stdin data: "q"');
  },
);

snapshotTest(
  "spawnSync used before the snapshot still works after restore (isolated spawnSync loop is rebuilt)",
  async () => {
    using dir = tempDir("bun-snapshot-spawnsync", {});
    const img = join(String(dir), "ss.snapshot");
    const fixture = join(import.meta.dir, "spawnsync-fixture.js");
    {
      await using p = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img, BUN_STARTUP_SNAPSHOT_IO: "local" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
      expect(out).toContain('[js] build default: status=0 stdout="out\\n"');
    }
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(err).toMatch(/\[snapshot\] rebased [1-9]\d* timers/); // the kept interval was moved onto this process's clock (on one machine the old deadlines are merely overdue, which the tick counts cannot tell apart)
    for (const variant of ["default", "stdio-ignore-pipe-pipe", "shell+ignore", "shell+pipe-in"]) {
      expect(out, err.slice(-600)).toContain(`[js] restored ${variant}: status=0 stdout="out\\n" stderr="err\\n"`);
    }
    expect(code).toBe(0);
  },
);

snapshotTest("random sources and time bases are fresh in every process restored from the same snapshot", async () => {
  using dir = tempDir("bun-snapshot-rng", {});
  const img = join(String(dir), "rng.snapshot");
  const fixture = join(import.meta.dir, "rng-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img },
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]); // drained together: a chatty build must not block on a full pipe
  }
  const runs: any[] = [];
  for (let i = 0; i < 2; i++) {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
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
});

snapshotTest("DNS answers cached by the builder are not served after restore; keep-alive pool recovers", async () => {
  using dir = tempDir("bun-snapshot-dns", {});
  const img = join(String(dir), "dns.snapshot");
  const fixture = join(import.meta.dir, "dns-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img, BUN_STARTUP_SNAPSHOT_IO: "network" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(JSON.parse(out.match(/\[js\] build (.*)/)![1]).size).toBeGreaterThan(0);
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
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
});

snapshotTest(
  "restore: 'restore' precedes any poll delivery; a stdio poll follows the re-seated fd; dns works again",
  async () => {
    using dir = tempDir("bun-snapshot-polls", {});
    const img = join(String(dir), "polls.snapshot");
    const fixture = join(import.meta.dir, "polls-fixture.js");
    {
      await using p = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img, BUN_STARTUP_SNAPSHOT_IO: "local" },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      await p.exited; // stdin pipe deliberately left open and unread-to-EOF
    }
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img },
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
);

snapshotTest("fs.watch works in a restored process even though the builder had a watcher thread", async () => {
  using dir = tempDir("bun-snapshot-fswatch", { a: { ".keep": "" }, b: { ".keep": "" } });
  const img = join(String(dir), "w.snapshot");
  const fixture = join(import.meta.dir, "fswatch-fixture.js");
  {
    await using p = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: {
        ...buildEnv,
        BUN_STARTUP_SNAPSHOT_OUT: img,
        BUN_STARTUP_SNAPSHOT_IO: "local",
        WATCH_DIR: join(String(dir), "a"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]); // drained together: a chatty build must not block on a full pipe
  }
  await using p = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img, WATCH_DIR2: join(String(dir), "b") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  const m = out.match(/\[js\] (.*)/);
  expect(m, err.slice(-600)).not.toBeNull();
  expect(JSON.parse(m![1]).some((e: string) => e.endsWith(":touched.txt"))).toBe(true);
  expect(code).toBe(0);
});

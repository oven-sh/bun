import { expect } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "path";
import { buildEnv, restoreEnv, snapshotTest, withSnapshots } from "./startup-snapshot-harness";

const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const setarch = isLinux ? Bun.which("setarch") : null;
const canDisableAslr =
  !!setarch && Bun.spawnSync({ cmd: [setarch, arch, "-R", "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;
const overlapTest = withSnapshots(canDisableAslr);
// Statics that cache a process-specific address get baked into the snapshot; WTF's stack-bounds code on Linux caches the
// original `environ` (a stack address) and clamps the main thread's stack origin to it whenever the bounds contain it.
// Restored, that is the build process's stack address, and a launch whose stack ASLR happened to place over the same
// range died in JSC's stack sanitizer. Forced deterministically: no ASLR for both processes, and a build environment
// large enough that the builder's environ sits well below where the restored process's frames end up.
overlapTest(
  "restore: the main thread's stack bounds are this process's even when its stack overlaps where the builder's was",
  async () => {
    using dir = tempDir("bun-snapshot-stack-overlap", {});
    const exe = join(String(dir), "app");
    const padding: Record<string, string> = {};
    for (let i = 0; i < 14; i++) padding[`SNAPSHOT_TEST_PAD_${i}`] = Buffer.alloc(96 * 1024, "x").toString(); // 14 × 96 KB, each under Linux's 128 KB per-string limit
    const build = Bun.spawnSync({
      cmd: [
        setarch!,
        arch,
        "-R",
        bunExe(),
        "build",
        "--compile",
        "--snapshot=manual",
        join(import.meta.dir, "smoke-fixture.js"),
        "--outfile",
        exe,
      ],
      env: { ...buildEnv, ...padding },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString() + build.stdout.toString()).toMatch(/embedded a .* snapshot/);
    await using proc = Bun.spawn({
      cmd: [setarch!, arch, "-R", exe],
      env: restoreEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("[js] tick 3");
    expect(exitCode).toBe(0);
  },
);

snapshotTest("a stale sidecar cannot stand in for a snapshot the app failed to take", async () => {
  using dir = tempDir("bun-snapshot-stale-sidecar", { "app.js": `process.exit(3);` });
  const exe = join(String(dir), "app");
  await Bun.write(exe + ".snapshot", "left over from an earlier build");
  const build = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--snapshot", "app.js", "--outfile", exe],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(build.stderr.toString()).toContain("exited with status 3");
  expect(build.exitCode).not.toBe(0);
  expect(existsSync(exe + ".snapshot")).toBe(false);
});

snapshotTest(
  "bun build --compile --snapshot embeds the snapshot; the single file restores from itself with no env",
  async () => {
    using dir = tempDir("bun-snapshot-compile", {});
    using out = tempDir("bun-snapshot-compile-out", {}); // the fixture's own output; the launch dir below must stay untouched
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
    expect(readdirSync(String(dir)).sort()).toEqual(["heavy"]);
    const rawMB = Number(/\[snapshot\] wrote .*?: \d+ regions, ([\d.]+)MB/.exec(buildOut)?.[1]);
    expect(rawMB).toBeGreaterThan(1);
    expect(Bun.file(exe).size).toBeGreaterThan(Bun.file(bunExe()).size + rawMB * 1048576 * 0.9); // embedded as is
    for (const run of [1, 2]) {
      await using proc = Bun.spawn({
        cmd: [exe],
        env: {
          HOME: String(dir),
          PATH: bunEnv.PATH!,
          BUN_STARTUP_SNAPSHOT_VERBOSE: "1",
          HEAVY_OUT: join(String(out), "heavy.out"),
        },
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
      // What gets copied back in (as opposed to mapped) is the executable's own data segment, a few MB; the compiled
      // payload (this build ships bytecode, so tens of MB) must never be part of it — that showed up as every launch
      // touching all of it.
      const copied = Number(/([\d.]+)MB __DATA copied/.exec(stderr)?.[1]);
      expect(copied).toBeGreaterThan(0);
      expect(copied).toBeLessThan(8);
      expect(stdout).toContain("epoch 1");
      expect(stdout).toContain("fetch -> hello from restored server");
      expect(exitCode).toBe(0);
    }
    expect(readdirSync(String(dir)).sort()).toEqual(["heavy"]); // launches wrote nothing anywhere (HOME is this dir)
    // Opt out boots normally.
    const plain = Bun.spawnSync({
      cmd: [exe],
      env: {
        HOME: bunEnv.HOME!,
        PATH: bunEnv.PATH!,
        BUN_STARTUP_SNAPSHOT: "0",
        HEAVY_OUT: join(String(out), "heavy.out"),
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(plain.stdout.toString()).toContain("epoch 0");
    expect(plain.exitCode).toBe(0);
    // Debugging: an explicit snapshot file still wins (BUN_STARTUP_SNAPSHOT_KEEP_SIDECAR keeps <exe>.snapshot next to it at build time).
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
      env: { ...bunEnv, BUN_STARTUP_SNAPSHOT_KEEP_SIDECAR: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(b2.exitCode).toBe(0);
    expect(Bun.file(dbg + ".snapshot").size).toBeGreaterThan(1024 * 1024);
    const viaFile = Bun.spawnSync({
      cmd: [dbg],
      env: {
        HOME: bunEnv.HOME!,
        PATH: bunEnv.PATH!,
        BUN_STARTUP_SNAPSHOT_IN: dbg + ".snapshot",
        HEAVY_OUT: join(String(dir), "heavy.out"),
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(viaFile.stdout.toString()).toContain("epoch 1");
    expect(viaFile.exitCode).toBe(0);
  },
  60_000,
);

snapshotTest(
  "envGate: the snapshot is only restored when the gated environment variables agree with the build",
  async () => {
    using dir = tempDir("bun-snapshot-envgate", {});
    const img = join(String(dir), "g.snapshot");
    const fixture = join(import.meta.dir, "envgate-fixture.js");
    {
      const b = Bun.spawnSync({
        cmd: [bunExe(), fixture],
        env: { ...buildEnv, BUN_STARTUP_SNAPSHOT_OUT: img, UNGATED_VAR: "1" },
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
        env: { ...restoreEnv, BUN_STARTUP_SNAPSHOT_IN: img, ...extra },
        stderr: "pipe",
        stdout: "pipe",
      });
    expect(run({}).stdout.toString()).toContain("[js] restored APP_MODE=<unset>"); // same environment as the build: restored
    const gated = run({ APP_MODE: "special" });
    expect(gated.stdout.toString()).toContain("[js] plain boot APP_MODE=special"); // a gated variable differs: normal boot
    expect(gated.stderr.toString()).not.toContain("[snapshot] restored");
    const other = run({ SOME_OTHER_VAR: "1" });
    expect(other.stdout.toString()).toContain("[js] restored"); // ungated variables don't matter
  },
);

const runEnv = () => ({ HOME: bunEnv.HOME!, PATH: bunEnv.PATH! });
function build(args: string[]) {
  const r = Bun.spawnSync({ cmd: [bunExe(), "build", ...args], env: bunEnv, stderr: "pipe", stdout: "pipe" });
  return { out: r.stderr.toString() + r.stdout.toString(), code: r.exitCode };
}
function runExe(exe: string, extraEnv: Record<string, string> = {}) {
  const r = Bun.spawnSync({ cmd: [exe], env: { ...runEnv(), ...extraEnv }, stderr: "pipe", stdout: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode };
}

snapshotTest("--snapshot (auto): an app with no snapshot call gets its snapshot once startup drains", () => {
  using dir = tempDir("bun-snapshot-auto", {});
  const exe = join(String(dir), "app");
  const b = build(["--compile", "--snapshot", join(import.meta.dir, "auto-fixture.js"), "--outfile", exe]);
  expect(b.out).toContain("[snapshot] embedded");
  expect(b.code).toBe(0);
  const r = runExe(exe);
  expect(r.stdout).toContain("[js] restored epoch 1 rows 20000");
  expect(r.code).toBe(0);
});

snapshotTest(
  "the snapshot step runs on its own against an executable built earlier, in place, and can be re-run",
  () => {
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
    expect(Bun.file(exe).size - sizeWithSnapshot).toBeLessThan((sizeWithSnapshot - sizeBefore) / 2); // rewritten in place (or the block replaced): the file never accumulates superseded blocks
    // Misuse is explained.
    expect(build(["--snapshot", join(import.meta.dir, "auto-fixture.js")]).out).toContain("--snapshot needs --compile");
    expect(build(["--snapshot", "--outfile", join(String(dir), "missing")]).out).toContain("could not read");
  },
);

snapshotTest(
  "Bun.build({ snapshot }) is the flag's equivalent; it needs compile, and bad values are rejected up front",
  async () => {
    using dir = tempDir("bun-snapshot-jsapi", {
      "build.ts": [
        "const [exe, entry] = process.argv.slice(2);",
        "const r = await Bun.build({ entrypoints: [entry], compile: { outfile: exe }, snapshot: true });",
        "if (!r.success) { console.error(r.logs); process.exit(2); }",
        "const bad = [",
        "  { snapshot: true },",
        "  { compile: { outfile: exe + '-bad' }, snapshot: 'yes' },",
        "  { target: 'bun-' + process.platform + '-' + (process.arch === 'arm64' ? 'arm64' : 'x64'), snapshot: 'yes' },", // the target shorthand enables compile: this one must reach snapshot validation
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
    expect(stdout.match(/rejected: TypeError: snapshot requires compile/g)).toHaveLength(1); // only the config with neither compile nor a bun target
    expect(stdout.match(/rejected: TypeError: snapshot must be true or an object/g)).toHaveLength(2); // both with compile and with the target shorthand
    expect(stdout).toContain('rejected: TypeError: snapshot.mode must be "auto" or "manual"');
    expect(stdout).toContain('rejected: TypeError: snapshot.io must be "strict", "local" or "network"');
    expect(stdout).not.toContain("accepted");
    expect(code).toBe(0);
    expect(runExe(exe).stdout).toContain("[js] restored epoch 1");
  },
);

snapshotTest(
  "local I/O during the build is refused by default (the build fails, the executable is left as built) and reported when allowed",
  () => {
    using dir = tempDir("bun-snapshot-io", {});
    const strict = join(String(dir), "strict");
    const s = build(["--compile", "--snapshot", join(import.meta.dir, "io-fixture.js"), "--outfile", strict]);
    expect(s.out).toContain("node:fs is not available while building a snapshot");
    expect(s.out).toMatch(/exited with status \d+ while its snapshot was being taken/);
    expect(s.code).not.toBe(0); // --snapshot was asked for and there is none
    expect(runExe(strict).stdout).toBe(""); // what is left is the plain executable, which boots normally (the fixture only prints when restored)
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
    expect(m.out).toContain("with --snapshot=manual the app has to call Bun.startupSnapshot.take() before it exits");
    expect(m.code).toBe(1);
  },
);

snapshotTest(
  "Bun.startupSnapshot.main(): the program runs after restore with each launch's own argv and cwd; a snapshot taken with it accepts any invocation",
  () => {
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
        env: { ...runEnv(), BUN_STARTUP_SNAPSHOT_VERBOSE: "1" },
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
  },
);

snapshotTest(
  "stdio set up before the snapshot follows each launch's descriptors: replaced when their kind changed, kept and resized when a terminal is a terminal again",
  async () => {
    using dir = tempDir("bun-snapshot-stdio", {});
    const exe = join(String(dir), "tool");
    const b = build(["--compile", "--snapshot", join(import.meta.dir, "stdio-fixture.js"), "--outfile", exe]); // built with piped stdio
    expect(b.out).toContain("process.stdin/stdout/stderr were set up before the freeze");
    expect(b.out).toMatch(/process\.stdout from:\n\s+at \/\$bunfs\/root\/tool:\d+:\d+/); // compiled modules are named after the executable
    expect(b.code).toBe(0);
    // pipe at build time -> file at launch: replaced (the build's stream silently lost these bytes before).
    const outFile = join(String(dir), "out.txt");
    const toFile = Bun.spawnSync({ cmd: [exe], env: runEnv(), stdout: Bun.file(outFile), stderr: "pipe" });
    expect(await Bun.file(outFile).text()).toBe(
      "epoch=1 builtWithTTY=false nowTTY=false colors=false sameObject=false columns=undefined\n",
    );
    expect(toFile.exitCode).toBe(0);
    const onTerminal = async (cmd: string[], cols: number) => {
      let seen = "";
      await using proc = Bun.spawn({
        cmd,
        env: { ...runEnv(), TERM: "xterm-256color" },
        terminal: {
          cols,
          rows: 24,
          data(_t, d) {
            seen += new TextDecoder().decode(d);
          },
        },
      });
      await proc.exited;
      return seen;
    };
    // pipe at build time -> terminal at launch: replaced by a terminal stream; Bun's own color decision follows the launch too.
    expect(await onTerminal([exe], 80)).toContain(
      "epoch=1 builtWithTTY=false nowTTY=true colors=true sameObject=false columns=80",
    );
    // terminal at build time -> terminal at launch: the object the app captured is kept, with this terminal's size.
    const exe2 = join(String(dir), "tool2");
    const built = await onTerminal(
      [bunExe(), "build", "--compile", "--snapshot", join(import.meta.dir, "stdio-fixture.js"), "--outfile", exe2],
      60,
    );
    expect(built).toMatch(/embedded a [\d.]+ MB snapshot/); // colored on a terminal, so not matched as one string
    expect(await onTerminal([exe2], 100)).toContain(
      "epoch=1 builtWithTTY=true nowTTY=true colors=true sameObject=true columns=100",
    );
  },
);

snapshotTest("signal listeners registered before the snapshot are installed again in a restored launch", () => {
  using dir = tempDir("bun-snapshot-signal", {});
  const exe = join(String(dir), "tool");
  const b = build(["--compile", "--snapshot", join(import.meta.dir, "signal-fixture.js"), "--outfile", exe]);
  expect(b.out).toContain("[snapshot] embedded");
  expect(b.code).toBe(0);
  const r = Bun.spawnSync({ cmd: [exe], env: runEnv(), stdout: "pipe", stderr: "pipe" });
  expect(r.stdout.toString()).toContain("[js] SIGUSR1 handled in epoch 1"); // unfixed: the process dies of the signal
  expect(r.exitCode).toBe(0);
});

snapshotTest("WebAssembly instantiated before the snapshot works after restore, including traps", () => {
  using dir = tempDir("bun-snapshot-wasm", {});
  const exe = join(String(dir), "tool");
  const b = build(["--compile", "--snapshot", join(import.meta.dir, "wasm-fixture.js"), "--outfile", exe]);
  expect(b.out).toContain("[snapshot] embedded");
  expect(b.code).toBe(0);
  const r = Bun.spawnSync({ cmd: [exe], env: runEnv(), stdout: "pipe", stderr: "pipe" });
  expect(r.stdout.toString()).toContain("[js] epoch=1 load(0)=7 out-of-bounds=RuntimeError"); // unfixed: the launch crashes on the trap
  expect(r.exitCode).toBe(0);
});

snapshotTest("wasm tier-up compilations in flight when the snapshot is taken are quiesced first", () => {
  using dir = tempDir("bun-snapshot-wasm-tierup", {});
  const exe = join(String(dir), "tool");
  const b = build(["--compile", "--snapshot", join(import.meta.dir, "wasm-tierup-fixture.js"), "--outfile", exe]);
  expect(b.out).not.toContain("executable memory changed while the snapshot was being written");
  expect(b.out).toContain("[snapshot] embedded");
  expect(b.code).toBe(0);
  const r = Bun.spawnSync({ cmd: [exe], env: runEnv(), stdout: "pipe", stderr: "pipe" });
  expect(r.stdout.toString()).toContain("[js] epoch=1 warmed=300000 sum=2000 bump=100001");
  expect(r.exitCode).toBe(0);
});

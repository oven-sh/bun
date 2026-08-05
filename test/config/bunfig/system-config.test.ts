import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Feature #28726: system-wide bunfig.toml support via `BUN_SYSTEM_CONFIG`
// or platform default (/etc/bunfig.toml on POSIX, %ALLUSERSPROFILE%\bunfig.toml
// on Windows). Merge order is system → home → project; later overrides earlier.
//
// Every subtest passes `BUN_SYSTEM_CONFIG` explicitly so none of them read the
// real `/etc/bunfig.toml` on the CI host, and every subtest uses a freshly-
// allocated tempDir to avoid cross-test bleed.

describe("system-wide bunfig.toml", () => {
  test("system config preload is applied via BUN_SYSTEM_CONFIG", async () => {
    using dir = tempDir("system-bunfig-preload", {
      "system-bunfig.toml": `preload = ["./preload.ts"]`,
      "preload.ts": `(globalThis as any).SYSTEM_PRELOADED = true;`,
      "index.ts": `console.log("preloaded:" + !!(globalThis as any).SYSTEM_PRELOADED);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("preloaded:true");
    expect(exitCode).toBe(0);
  });

  test("project bunfig overrides system bunfig preload completely", async () => {
    // system-preload writes a marker file as an irreversible side effect.
    // If project bunfig truly replaces the preload list, the marker must not exist.
    using dir = tempDir("system-bunfig-override", {
      "system-bunfig.toml": `preload = ["./system-preload.ts"]`,
      "bunfig.toml": `preload = ["./project-preload.ts"]`,
      "system-preload.ts": `require("fs").writeFileSync(require("path").join(process.cwd(), "system-ran.txt"), "yes");`,
      "project-preload.ts": `(globalThis as any).FROM = "project";`,
      "index.ts": `console.log("from:" + (globalThis as any).FROM);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("from:project");
    // The system preload must NOT have run — project bunfig replaced it
    expect(existsSync(join(String(dir), "system-ran.txt"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("explicit BUN_SYSTEM_CONFIG with bad path fails loudly", async () => {
    using dir = tempDir("system-bunfig-bad", {
      "index.ts": `console.log("should not run");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/nonexistent.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Explicit override should error, not silently ignore
    expect(stderr.length).toBeGreaterThan(0);
    expect(exitCode).not.toBe(0);
  });

  test("malformed BUN_SYSTEM_CONFIG fails loudly and prints the path", async () => {
    // Two regressions in one:
    //  1. Policy typos must fail loudly (`loadSystemBunfig` turns ctx.log.errors
    //     into Global.exit(1) when BUN_SYSTEM_CONFIG is explicit). Previously
    //     the TOML parse error was logged but the process exited 0, which
    //     silently disables the admin policy.
    //  2. loadBunfig used to stash the caller's PathBuffer slice in ctx.log
    //     (via Source.path.text), and the later error print read freed stack
    //     memory after the frame was gone — stack-use-after-return on ASAN.
    //     Under ASAN (bun bd) the bad path showed up as poison/garbage bytes
    //     where the filename should be. The fix dupes the config path onto
    //     the allocator so the log-borrowed pointer stays valid.
    using dir = tempDir("system-bunfig-malformed", {
      // Unclosed TOML section header makes TOML.parse log a caret-style
      // error referencing source.path.text — the exact UAF trigger.
      "system-bunfig.toml": `[install\n`,
      "index.ts": `console.log("ran");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Script must not run — admin policy typos can't be allowed to pass through.
    expect(stdout).not.toContain("ran");
    // The readable path must appear in stderr after the caret diagnostic.
    // Before the UAF fix, the `at <path>:line:col` line printed whatever bytes
    // remained on the freed stack where the PathBuffer used to live — ASAN
    // poison or random values (pointers, stale heap) following the frame.
    // Asserting the exact filename:line:col shape rejects all of those while
    // accepting the clean output produced by the fix.
    expect(stderr).toMatch(/at [^\n]*system-bunfig\.toml:1:\d+/);
    expect(stderr).toContain("failed to parse BUN_SYSTEM_CONFIG");
    expect(exitCode).not.toBe(0);
  });

  test("system config define is applied", async () => {
    using dir = tempDir("system-bunfig-define", {
      "system-bunfig.toml": `
[define]
"process.env.SYSTEM_DEFINED" = "'from-system-config'"
`,
      "index.ts": `console.log("val:" + process.env.SYSTEM_DEFINED);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("val:from-system-config");
    expect(exitCode).toBe(0);
  });

  test("bun run loads project bunfig.toml even when system config is set", async () => {
    // Regression test for loaded_bunfig poisoning: system config loading must not
    // set ctx.debug.loaded_bunfig, which is used as a guard in run_command.rs
    // (RunCommand::boot_standalone) to load project bunfig.toml. If system config
    // incorrectly poisons loaded_bunfig, `bun run script.ts` silently skips the
    // project bunfig.toml, inverting the documented config priority (system < project).
    using dir = tempDir("system-bunfig-run-priority", {
      "system-bunfig.toml": `
[define]
"globalThis.TIER" = "'system'"
`,
      "bunfig.toml": `
[define]
"globalThis.TIER" = "'project'"
`,
      "script.ts": `console.log("tier:" + (globalThis as any).TIER);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "script.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: `${dir}/system-bunfig.toml` },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Project bunfig.toml must override system config.
    // If loaded_bunfig is poisoned, stdout would be "tier:system".
    expect(stdout).toContain("tier:project");
    expect(exitCode).toBe(0);
  });

  test("BUN_SYSTEM_CONFIG rejects relative paths", async () => {
    using dir = tempDir("system-bunfig-relative", {
      "index.ts": `console.log("should not run");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: "./relative-bunfig.toml" },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("absolute path");
    expect(exitCode).not.toBe(0);
  });

  test("BUN_SYSTEM_CONFIG empty string is treated as unset", async () => {
    // Smoke test: BUN_SYSTEM_CONFIG="" must not trigger the "must be an
    // absolute path" error (it would if loadSystemBunfig treated "" as set).
    using dir = tempDir("system-bunfig-empty", {
      "index.ts": `console.log("works");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: "" },
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("works");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isWindows)(
    "BUN_SYSTEM_CONFIG='' does not enable auto-discovery for non-package-manager commands",
    async () => {
      // Load-bearing regression test for the `.getNotEmpty()` check at
      // loadConfig: if BUN_SYSTEM_CONFIG="" were treated as set (i.e.
      // replacing the check with .get()), the gate `has_explicit_system_config
      // or readGlobalConfig()` would enable system-config auto-discovery for
      // commands that should not probe it (AutoCommand, RunCommand, TestCommand).
      // The loadSystemBunfig call would reach getSystemConfigPath, fall through
      // to the platform default, and load %ALLUSERSPROFILE%\bunfig.toml.
      //
      // To actually detect this regression we need a sentinel the system
      // config can set and a way to observe it. [install].cache + `bun pm
      // cache` would be ideal, but pm cache is a PackageManagerCommand which
      // already probes the system path through the readGlobalConfig() branch.
      // Instead we use `[define]`, applied during AutoCommand parse, and
      // run `bun index.ts` which prints the defined value. If "" were
      // treated as set on AutoCommand, the define from the sentinel bunfig
      // would apply and stdout would show "sentinel"; with the fix it must
      // show "undefined".
      //
      // Only runs on Windows because ALLUSERSPROFILE is env-overridable there;
      // POSIX hardcodes /etc/bunfig.toml which isn't writeable from tests.
      using dir = tempDir("system-bunfig-empty-sentinel", {
        "allusers/bunfig.toml": `[define]\n"globalThis.SENTINEL_SYSTEM_LOADED" = "'sentinel'"\n`,
        "project/index.ts": `console.log("SENTINEL=" + (globalThis as any).SENTINEL_SYSTEM_LOADED);`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.ts"],
        env: {
          ...bunEnv,
          BUN_SYSTEM_CONFIG: "",
          ALLUSERSPROFILE: join(String(dir), "allusers"),
          USERPROFILE: join(String(dir), "no-home"),
          HOME: join(String(dir), "no-home"),
          XDG_CONFIG_HOME: join(String(dir), "no-home"),
        },
        cwd: join(String(dir), "project"),
        stderr: "pipe",
      });

      const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The sentinel define must NOT have been applied — AutoCommand should
      // never probe the system bunfig on its own, and BUN_SYSTEM_CONFIG="" is
      // not an opt-in.
      expect(stdout.trim()).toBe("SENTINEL=undefined");
      expect(exitCode).toBe(0);
    },
  );

  test("package-manager command merges system + home bunfigs (readGlobalConfig path)", async () => {
    // Package-manager commands (InstallCommand/BunxCommand/etc.) have
    // readGlobalConfig() == true, so loadConfig() dispatches through
    // loadGlobalBunfig() which loads the system config first and then the
    // home config on top. Every other surviving test either runs through
    // AutoCommand/RunCommand (readGlobalConfig() == false) or has no home
    // config — so without this test the readGlobalConfig-true branch at
    // bunfig/arguments.rs::load_config and load_global_bunfig's system→home
    // ordering have zero coverage.
    //
    // We verify the ordering by giving each tier a distinct `[install] cache`
    // directory and reading it back with `bun pm cache`, which prints the
    // resolved cache path without hitting the network. Cache dirs live
    // inside the tempDir so they:
    //   - are absolute on every platform (hardcoded `/tmp/...` would be
    //     drive-relative on Windows and symlink-aliased on macOS)
    //   - get cleaned up with the tempDir instead of polluting the host
    using dir = tempDir("system-bunfig-pkg-merge", {
      "package.json": `{"name": "test", "version": "1.0.0"}`,
    });
    const sysCachePath = join(String(dir), "sys-cache");
    const homeCachePath = join(String(dir), "home-cache");
    await Bun.write(join(String(dir), "sys.toml"), `[install]\ncache = ${JSON.stringify(sysCachePath)}\n`);
    await Bun.write(join(String(dir), "xdg", ".bunfig.toml"), `[install]\ncache = ${JSON.stringify(homeCachePath)}\n`);

    // System + home: home wins (matches documented "later overrides earlier").
    // Explicitly unset `BUN_INSTALL_CACHE_DIR` and `BUN_INSTALL` — the test
    // runner sets the former to a shared tempdir, and both short-circuit the
    // bunfig `[install].cache` lookup in fetchCacheDirectoryPath. Undefined
    // values drop the var from the spawn env.
    await using mergeProc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: undefined,
        BUN_INSTALL: undefined,
        BUN_SYSTEM_CONFIG: join(String(dir), "sys.toml"),
        XDG_CONFIG_HOME: join(String(dir), "xdg"),
      },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [mergeOut, _mergeErr, mergeExit] = await Promise.all([
      mergeProc.stdout.text(),
      mergeProc.stderr.text(),
      mergeProc.exited,
    ]);
    // Basename is sufficient: if home config wasn't read, mergeOut would
    // contain `sys-cache` (or the platform default like `.bun/install/cache`).
    expect(mergeOut).toContain("home-cache");
    expect(mergeOut).not.toContain("sys-cache");
    expect(mergeExit).toBe(0);

    // System only (XDG points nowhere): system config applies, proving
    // loadSystemBunfig ran through the readGlobalConfig branch.
    await using sysOnlyProc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: undefined,
        BUN_INSTALL: undefined,
        BUN_SYSTEM_CONFIG: join(String(dir), "sys.toml"),
        XDG_CONFIG_HOME: join(String(dir), "nonexistent"),
      },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [sysOut, _sysErr, sysExit] = await Promise.all([
      sysOnlyProc.stdout.text(),
      sysOnlyProc.stderr.text(),
      sysOnlyProc.exited,
    ]);
    expect(sysOut).toContain("sys-cache");
    expect(sysExit).toBe(0);
  });

  test.skipIf(!isWindows)("auto-discovered system bunfig with validation error warns but does not crash", async () => {
    // Auto-discovered /etc/bunfig.toml (POSIX) / %ALLUSERSPROFILE%\bunfig.toml
    // (Windows) must not hard-crash every package-manager invocation when the
    // sysadmin typos it — the feature is opt-in via BUN_SYSTEM_CONFIG, and the
    // default-path probe stays best-effort. Only the Windows default-path is
    // overridable via env (ALLUSERSPROFILE); on POSIX the path is hardcoded
    // /etc/bunfig.toml, so this only runs on Windows.
    //
    // The system bunfig lives in `allusers/bunfig.toml` (pointed at by
    // ALLUSERSPROFILE); the project dir uses a separate subdirectory with its
    // own package.json so auto-loaded project bunfig.toml lookup in cwd
    // doesn't re-load the same broken file and re-trigger the failure path.
    using dir = tempDir("system-bunfig-auto-broken", {
      "allusers/bunfig.toml": `[install]\nauto = "bogus-value"\n`,
      "project/package.json": `{"name": "test", "version": "1.0.0"}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: undefined,
        BUN_INSTALL: undefined,
        // No BUN_SYSTEM_CONFIG — forces the auto-discovered path via
        // %ALLUSERSPROFILE%\bunfig.toml.
        BUN_SYSTEM_CONFIG: undefined,
        ALLUSERSPROFILE: join(String(dir), "allusers"),
        // Neutralise home config lookup so only the system path is stressed.
        // bun.env_var.HOME resolves to USERPROFILE on Windows, so override
        // both in case getHomeConfigPath changes its precedence order later.
        XDG_CONFIG_HOME: join(String(dir), "no-home"),
        USERPROFILE: join(String(dir), "no-home"),
        HOME: join(String(dir), "no-home"),
      },
      cwd: join(String(dir), "project"),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Auto-discovered: we warn about the broken file but still run.
    expect(stderr).toContain("aborted parsing auto-discovered system bunfig");
    // `bun pm cache` printed *some* cache directory — i.e. the process
    // continued past the broken bunfig.
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  });

  // A compiled standalone binary runs through `boot_standalone`, a different
  // code path than the normal CLI dispatch the other tests exercise. It must
  // still honor an explicit BUN_SYSTEM_CONFIG (docs promise system config is
  // applied "on every command path, including compiled standalone binaries").
  // The binary is built without a preload; the system config's preload runs
  // only because boot_standalone loaded it at runtime.
  // Higher per-test timeout because `bun build --compile` copies + rewrites the
  // entire bun binary (~1GB under debug+ASAN), which blows the 5s default.
  test("compiled standalone binary honors BUN_SYSTEM_CONFIG", async () => {
    using dir = tempDir("system-bunfig-standalone", {
      "system-bunfig.toml": `preload = ["./sys-preload.ts"]`,
      "sys-preload.ts": `console.log("SYSTEM_PRELOAD_RAN");`,
      "app.ts": `console.log("app ran");`,
    });
    const out = join(String(dir), "app" + (isWindows ? ".exe" : ""));

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.ts", "--outfile", out],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error:");
    expect(buildExit).toBe(0);

    await using proc = Bun.spawn({
      cmd: [out],
      env: { ...bunEnv, BUN_SYSTEM_CONFIG: join(String(dir), "system-bunfig.toml") },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Preload from the system config ran before the app, proving boot_standalone
    // loaded and applied BUN_SYSTEM_CONFIG for the standalone binary.
    expect(stdout).toContain("SYSTEM_PRELOAD_RAN");
    expect(stdout).toContain("app ran");
    expect(exitCode).toBe(0);
  }, 60_000);
});

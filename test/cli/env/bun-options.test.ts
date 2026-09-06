import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";

describe("BUN_OPTIONS environment variable", () => {
  test("basic usage - passes options to bun command", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "--print='BUN_OPTIONS WAS A SUCCESS'",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("BUN_OPTIONS WAS A SUCCESS");
  });

  test("multiple options - passes all options to bun command", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "--print='MULTIPLE OPTIONS' --quiet",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("MULTIPLE OPTIONS");
  });

  test("options with quotes - properly handles quoted options", () => {
    const result = spawnSync({
      cmd: [bunExe()],
      env: {
        ...bunEnv,
        BUN_OPTIONS: '--print="QUOTED OPTIONS"',
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("QUOTED OPTIONS");
  });

  test("priority - environment options go before command line options", () => {
    // First BUN_OPTIONS arg should be inserted before command line args
    const result = spawnSync({
      cmd: [bunExe(), "--print='COMMAND LINE'"],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "--quiet",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("COMMAND LINE");
  });

  test("bare flag before flag with value is recognized", () => {
    // Bare flags (no =) that aren't the last option must not get a
    // trailing space appended. --cpu-prof is a bare flag; --cpu-prof-dir
    // uses = syntax. If --cpu-prof isn't recognized, no profile is written.
    using dir = tempDir("bun-options-cpu-prof", {});

    const result = spawnSync({
      cmd: [bunExe(), "-e", "1"],
      env: {
        ...bunEnv,
        BUN_OPTIONS: `--cpu-prof --cpu-prof-dir=${dir}`,
      },
    });

    expect(result.exitCode).toBe(0);

    // --cpu-prof should have produced a .cpuprofile file in the dir
    const files = readdirSync(String(dir));
    const cpuProfiles = files.filter((f: string) => f.endsWith(".cpuprofile"));
    expect(cpuProfiles.length).toBeGreaterThanOrEqual(1);
  });

  // `bun build --compile` plus running the resulting standalone executable
  // means two full Bun process lifecycles. Under sanitizer builds (ASAN/LSan)
  // each exit pass + symbolization is slow enough that the pair blows past the
  // default 5s test timeout, so give this test extra headroom.
  test("bare flag before flag with value is recognized (standalone executable)", () => {
    // Same test as above but with a compiled standalone executable.
    using dir = tempDir("bun-options-cpu-prof-compile", {
      "entry.ts": "console.log('ok');",
    });

    const exePath = String(dir) + "/app";
    const profDir = String(dir) + "/profiles";

    // Compile
    const build = spawnSync({
      cmd: [bunExe(), "build", "--compile", String(dir) + "/entry.ts", "--outfile", exePath],
      env: bunEnv,
    });
    expect(build.exitCode).toBe(0);

    // Run with BUN_OPTIONS
    const result = spawnSync({
      cmd: [exePath],
      env: {
        ...bunEnv,
        BUN_OPTIONS: `--cpu-prof --cpu-prof-dir=${profDir}`,
      },
    });

    expect(result.stdout.toString()).toContain("ok");
    expect(result.exitCode).toBe(0);

    const files = readdirSync(profDir);
    const cpuProfiles = files.filter((f: string) => f.endsWith(".cpuprofile"));
    expect(cpuProfiles.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  test("empty BUN_OPTIONS - should work normally", () => {
    const result = spawnSync({
      cmd: [bunExe(), "--print='NORMAL'"],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("NORMAL");
  });
});

describe("BUN_OPTIONS contributes flags, not the subcommand", () => {
  const files = {
    "package.json": JSON.stringify({ name: "t", scripts: { hello: "echo SCRIPT-RAN" } }),
    "app.ts": `console.log("FILE-RAN", process.argv.slice(2))`,
    "pre.ts": `console.log("PRELOAD")`,
    "a.test.ts": `import { test } from "bun:test"; test("a", () => {});`,
  };

  function run(dir: string, cmd: string[], BUN_OPTIONS: string) {
    const result = spawnSync({ cmd: [bunExe(), ...cmd], cwd: dir, env: { ...bunEnv, BUN_OPTIONS } });
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
  }

  // The tokens are spliced into argv after argv[0]. A bare word there used
  // to be read as the subcommand: BUN_OPTIONS=test turned `bun app.ts` into
  // `bun test app.ts`, and BUN_OPTIONS=build printed the bundled source.
  test.concurrent.each([
    ["test", ["app.ts"]],
    ["build", ["app.ts"]],
    ["foo", ["run", "hello"]],
    ["--smol foo", ["test"]],
    ["./pre.ts", ["test"]],
  ])("a bare word (BUN_OPTIONS=%p) is an error, not the subcommand: bun %p", (options, cmd) => {
    using dir = tempDir("bun-options-bare-word", files);
    const { stdout, stderr, exitCode } = run(String(dir), cmd, options);
    const word = options.split(" ").at(-1);
    expect(stdout).toBe("");
    expect(stderr).toContain(`error: BUN_OPTIONS may only contain flags, found "${word}"`);
    expect(exitCode).toBe(1);
  });

  // A value given with a space is the flag's value, not the subcommand.
  test.concurrent.each([
    ["--shell bun", ["app.ts"], "FILE-RAN"],
    ["-r ./pre.ts", ["app.ts"], "PRELOAD\nFILE-RAN"],
    ["--cwd .", ["app.ts"], "FILE-RAN"],
    ["-r ./pre.ts", ["run", "hello"], "SCRIPT-RAN"],
    ["--shell bun", ["run", "hello"], "SCRIPT-RAN"],
    ["--cwd .", ["test"], "1 pass"],
  ])("BUN_OPTIONS=%p bun %p", (options, cmd, expected) => {
    using dir = tempDir("bun-options-space-value", files);
    const { stdout, stderr, exitCode } = run(String(dir), cmd, options);
    expect(stdout + stderr).toContain(expected);
    expect(exitCode).toBe(0);
  });
});

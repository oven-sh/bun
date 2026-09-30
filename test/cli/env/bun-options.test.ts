import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
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

  // `--lint` makes `bun` and `bun run` check their files and run none of them. It is refused in BUN_OPTIONS.
  describe("--lint", () => {
    // Run, this file writes the marker.
    const files = { "x.ts": `import { writeFileSync } from "node:fs";\nwriteFileSync("marker.txt", "ran");\n` };

    /** Runs `bun <command>` in `cwd` with `env` over `bunEnv`. */
    function bun(cwd: string, command: string, env: NodeJS.Dict<string>) {
      const result = spawnSync({ cmd: [bunExe(), ...command.split(" ")], env: { ...bunEnv, ...env }, cwd });
      return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
    }

    test.each([
      ["--lint", "x.ts"],
      ["--lint", "run x.ts"],
      ["--smol --lint", "x.ts"],
      ["--lint", "--lint x.ts"],
    ])("BUN_OPTIONS='%s' is refused and `bun %s` runs nothing", (options, command) => {
      using dir = tempDir("bun-options-lint", files);
      const refused = { stdout: "", stderr: "error: --lint cannot be set in BUN_OPTIONS\n", exitCode: 1 };
      // The refusal does not depend on the variable that turns `--lint` on.
      for (const variable of ["1", undefined]) {
        const env = { BUN_OPTIONS: options, BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: variable };
        expect(bun(String(dir), command, env)).toEqual(refused);
      }
      expect(existsSync(`${dir}/marker.txt`)).toBe(false);
    });

    test("another option in BUN_OPTIONS does not refuse --lint on the command line", () => {
      using dir = tempDir("bun-options-lint-other", files);
      const env = { BUN_OPTIONS: "--smol", BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1" };
      // The file is checked and not run.
      expect(bun(String(dir), "--lint x.ts", env)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect(existsSync(`${dir}/marker.txt`)).toBe(false);
    });
  });
});

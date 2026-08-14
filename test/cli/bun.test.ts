import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import { tmpdir } from "node:os";

describe("bun", () => {
  describe("NO_COLOR", () => {
    for (const value of ["1", "0", "foo", " "]) {
      test(`respects NO_COLOR=${JSON.stringify(value)} to disable color`, () => {
        const { stdout } = spawnSync({
          cmd: [bunExe()],
          env: {
            NO_COLOR: value,
          },
        });
        expect(stdout.toString()).not.toMatch(/\u001b\[\d+m/);
      });
    }
    for (const value of ["", undefined]) {
      // TODO: need a way to fake a tty in order to test this,
      // and cannot use FORCE_COLOR since that will always override NO_COLOR.
      test.todo(`respects NO_COLOR=${JSON.stringify(value)} to enable color`, () => {
        const { stdout } = spawnSync({
          cmd: [bunExe()],
          env:
            value === undefined
              ? {}
              : {
                  NO_COLOR: value,
                },
        });
        expect(stdout.toString()).toMatch(/\u001b\[\d+m/);
      });
    }
  });

  describe("revision", () => {
    test("revision generates version numbers correctly", () => {
      var { stdout, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "--version"],
        env: bunEnv,
        stderr: "inherit",
      });
      var version = stdout.toString().trim();

      var { stdout, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "--revision"],
        env: bunEnv,
        stderr: "inherit",
      });
      var revision = stdout.toString().trim();

      expect(exitCode).toBe(0);
      expect(revision).toStartWith(version);
      // https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
      expect(revision).toMatch(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
      );
    });
  });
  describe("getcompletes", () => {
    test("getcompletes should not panic and should not be empty", () => {
      const { stdout, exitCode } = spawnSync({
        cmd: [bunExe(), "getcompletes"],
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      expect(stdout.toString()).not.toBeEmpty();
    });

    // https://github.com/oven-sh/bun/issues/30086
    test("getcompletes keeps scripts whose names start with 'pre'/'post' when no sibling script exists", () => {
      using dir = tempDir("getcompletes-pre-post", {
        "package.json": JSON.stringify({
          name: "test",
          scripts: {
            // standalone scripts — nothing named `ttier`, `pare-release`, `gres`, `css`, `view`
            "prettier": "echo prettier",
            "prettier:fix": "echo prettier:fix",
            "prepare-release": "echo prepare-release",
            "postgres": "echo postgres",
            "postcss": "echo postcss",
            "preview": "echo preview",
            // plain scripts
            "build": "echo build",
            "dev": "echo dev",
            "lint": "echo lint",
            "lint:fix": "echo lint:fix",
            "fix": "echo fix",
            "test": "echo test",
            // real lifecycle hooks — these SHOULD be hidden (sibling exists)
            "prebuild": "echo prebuild",
            "postbuild": "echo postbuild",
            "pretest": "echo pretest",
          },
        }),
      });

      for (const filter of ["s", "i", "r", "g", "z"]) {
        const { stdout, exitCode } = spawnSync({
          cmd: [bunExe(), "getcompletes", filter],
          env: bunEnv,
          cwd: String(dir),
        });
        const lines = stdout
          .toString()
          .split("\n")
          .map(l => l.split("\t")[0]) // "z" filter emits "name\tdescription"
          .filter(Boolean);

        // standalone pre/post-prefixed scripts must be present
        expect(lines).toContain("prettier");
        expect(lines).toContain("prettier:fix");
        expect(lines).toContain("prepare-release");
        expect(lines).toContain("postgres");
        expect(lines).toContain("postcss");
        expect(lines).toContain("preview");

        // real npm lifecycle hooks (sibling `build`/`test` exists) must still be hidden
        expect(lines).not.toContain("prebuild");
        expect(lines).not.toContain("postbuild");
        expect(lines).not.toContain("pretest");

        expect(exitCode).toBe(0);
      }
    });
  });
  describe("--help preserves <placeholder> text", () => {
    const env = { ...bunEnv, NO_COLOR: "1" };
    const usage: [string, string][] = [
      ["install", "bun install [flags] <name>@<version>"],
      ["add", "bun add [flags] <package><@version>"],
      ["remove", "bun remove [flags] [<packages>]"],
      ["update", "bun update [flags] <name>@<version>"],
      ["link", "bun link [flags] [<packages>]"],
      ["patch", "bun patch [flags or options] <package>@<version>"],
      ["patch-commit", "bun patch-commit [flags or options] <directory>"],
      ["info", "bun info [flags] <package>[@<version>]"],
    ];
    test.concurrent.each(usage)("bun %s --help usage line", async (cmd, expected) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), cmd, "--help"], env, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = (stdout + stderr).split(/\r?\n/).find(l => l.startsWith("Usage:")) ?? "";
      expect(line).toBe(`Usage: ${expected}`);
      expect(exitCode).toBe(0);
    });

    const flags: [string, string, string][] = [
      ["audit", "--audit-level", "greater than or equal to <level> (low,"],
      ["test", "--rerun-each", "Re-run each test file <NUMBER> times"],
      ["test", "--bail", "Exit the test suite after <NUMBER> failures"],
      ["build", "--allow-unresolved", "Use '<empty>' for opaque specifiers"],
    ];
    test.concurrent.each(flags)("bun %s --help keeps placeholder in %s description", async (cmd, flag, expected) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), cmd, "--help"], env, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = (stdout + stderr).split(/\r?\n/).find(l => l.includes(flag)) ?? "";
      expect(line).toContain(expected);
      expect(exitCode).toBe(0);
    });

    test("bun add --help usage line is intact with FORCE_COLOR=1", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "add", "--help"],
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = stdout + stderr;
      // <blue>\<package\><r> renders to \x1b[34m<package>\x1b[0m, not \x1b[34m\x1b[0m
      expect(out).toContain("\x1b[34m<package>\x1b[0m");
      // raw tag markup must not leak through
      expect(out).not.toContain("<blue>");
      expect(exitCode).toBe(0);
    });
  });

  describe("test command line arguments", () => {
    test("test --config, issue #4128", () => {
      const path = `${tmpdir()}/bunfig-${Date.now()}.toml`;
      fs.writeFileSync(path, "[debug]");

      const p = Bun.spawnSync({
        cmd: [bunExe(), "--config=" + path],
        env: {},
        stderr: "inherit",
      });
      try {
        expect(p.exitCode).toBe(0);
      } finally {
        fs.unlinkSync(path);
      }
    });
  });
});

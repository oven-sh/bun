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

// `Command::which()` scans argv for the first non-dash token to pick the
// subcommand. It must step past the value of `--cwd` / `--env-file` so that
// value isn't misread as the subcommand name.
describe.concurrent("global flag before subcommand", () => {
  async function run(cwd: string, argv: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...argv],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const files = {
    "package.json": JSON.stringify({ name: "p", scripts: { greet: "echo hello-from-script" } }),
    "app.ts": `console.log("ran:" + (process.env.FROM_ENV_FILE ?? "unset"));`,
    "pass.test.ts": `import {test,expect} from "bun:test"; test("t", () => expect(1).toBe(1));`,
    "my.env": "FROM_ENV_FILE=loaded\n",
    "sub/package.json": JSON.stringify({
      name: "sub",
      scripts: { greet: "echo hello-from-sub" },
      dependencies: {},
    }),
  };

  for (const pre of [
    ["--cwd", "."],
    ["--env-file", "my.env"],
    ["--cwd", ".", "--env-file", "my.env"],
  ] as const) {
    test(`bun ${pre.join(" ")} run <script> dispatches RunCommand`, async () => {
      using dir = tempDir("which-run", files);
      const { stdout, stderr, exitCode } = await run(String(dir), [...pre, "run", "greet"]);
      expect(stderr).not.toContain("Script not found");
      // Misroute to AutoCommand prints the `bun run` help with exit 0.
      expect(stdout).not.toContain("Usage:");
      expect(stdout).toContain("hello-from-script");
      expect(exitCode).toBe(0);
    });

    test(`bun ${pre.join(" ")} test <file> dispatches TestCommand`, async () => {
      using dir = tempDir("which-test", files);
      const { stderr, exitCode } = await run(String(dir), [...pre, "test", "pass.test.ts"]);
      expect(stderr).not.toContain("Script not found");
      expect(stderr).toContain("1 pass");
      expect(exitCode).toBe(0);
    });
  }

  test("bun --env-file my.env run app.ts loads the env file", async () => {
    using dir = tempDir("which-env", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--env-file", "my.env", "run", "app.ts"]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ran:loaded\n", stderr: "", exitCode: 0 });
  });

  test("bun --cwd sub run <script> resolves scripts from the --cwd dir", async () => {
    using dir = tempDir("which-cwd", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--cwd", "sub", "run", "greet"]);
    expect(stderr).not.toContain("Script not found");
    expect(stdout).not.toContain("Usage:");
    expect(stdout).toContain("hello-from-sub");
    expect(exitCode).toBe(0);
  });

  test("bun --cwd sub install dispatches InstallCommand (not add 'sub')", async () => {
    using dir = tempDir("which-install", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--cwd", "sub", "install", "--dry-run"]);
    expect(stderr).not.toContain("Script not found");
    // A misroute to `bun add` would print "installed <pkg>" / hit the registry;
    // a misroute to AutoCommand would print "Script not found".
    expect(stdout + stderr).not.toMatch(/\badd\b.*\binstall\b/);
    expect(stdout + stderr).not.toContain('"sub"');
    expect(exitCode).toBe(0);
  });

  test("bun --env-file my.env install does not treat the path as a package", async () => {
    using dir = tempDir("which-install-env", files);
    const { stdout, stderr, exitCode } = await run(String(dir), [
      "--env-file",
      "my.env",
      "install",
      "--dry-run",
      "--cwd",
      "sub",
    ]);
    // Regression guard for the #34983 revert: `.env` must not leak as a
    // positional and `install` must not be treated as a package name.
    expect(stdout + stderr).not.toContain("my.env");
    expect(stderr).not.toContain("Script not found");
    expect(exitCode).toBe(0);
  });

  test("bun --cwd target init -y -m dispatches InitCommand in target", async () => {
    using dir = tempDir("which-init", { "target/.gitkeep": "" });
    const { stderr, exitCode } = await run(String(dir), ["--cwd", "target", "init", "-y", "-m"]);
    expect(stderr).not.toContain("Script not found");
    expect(fs.existsSync(`${dir}/target/package.json`)).toBe(true);
    expect(fs.existsSync(`${dir}/package.json`)).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("bun --cwd . exec <cmd> dispatches ExecCommand", async () => {
    using dir = tempDir("which-exec", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--cwd", ".", "exec", "echo from-exec"]);
    expect(stderr).not.toContain("Script not found");
    expect(stdout).toContain("from-exec");
    expect(exitCode).toBe(0);
  });

  test("bun --cwd . build app.ts dispatches BuildCommand", async () => {
    using dir = tempDir("which-build", files);
    const { stdout, stderr, exitCode } = await run(String(dir), ["--cwd", ".", "build", "./app.ts"]);
    expect(stderr).not.toContain("Script not found");
    expect(stdout).toContain("FROM_ENV_FILE");
    expect(exitCode).toBe(0);
  });

  test("bun --cwd sub add --dry-run does not misread 'sub' as a package", async () => {
    using dir = tempDir("which-add", files);
    const { stdout, stderr } = await run(String(dir), ["--cwd", "sub", "add", "--dry-run"]);
    expect(stdout + stderr).not.toMatch(/GET .*\/(sub|add)\b/);
    expect(stderr).not.toContain("Script not found");
    // Dispatching AddCommand with zero positionals prints this diagnostic;
    // any other route (AutoCommand, or 'sub'/'add' leaking as a package name)
    // would not.
    expect(stderr).toContain("no package specified to add");
  });
});

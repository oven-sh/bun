// Locks in per-subcommand CLI argument parsing behavior for the package
// manager commands. `CommandLineArguments.parse` now takes `subcommand`
// as a runtime parameter and dispatches to a per-subcommand param table
// for the streaming parser, so these tests verify that short-flag
// resolution stays subcommand-specific.
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

// `CommandLineArguments.parse` used to be instantiated once per Subcommand
// (16×) because `subcommand` was a comptime parameter and each variant fed a
// different comptime params table into `clap.parse`. It now takes `subcommand`
// at runtime and should compile to a single instance. This guards against it
// silently fanning back out (e.g. someone reintroducing `inline else`).
//
// Debug-only: release binaries are stripped. Linux/macOS-only: uses `nm`.
test.skipIf(isWindows || !isDebug)(
  "CommandLineArguments.parse is instantiated once",
  async () => {
    // Zig mangles as `install.PackageManager.CommandLineArguments.parse__<hash>`
    // (and `parse__anon_<n>__<hash>` for each comptime-specialized copy). The
    // debug binary is large, so filter inside the pipeline rather than pulling
    // the whole symbol table into JS.
    const needle = "install.PackageManager.CommandLineArguments.parse__";
    const { stdout, exitCode } = await Bun.$`nm --defined-only ${bunExe()} | grep -F ${needle}`.nothrow().quiet();
    const text = stdout.toString("utf8");
    const matches = text.split("\n").filter(line => line.includes(needle));
    // If the toolchain ever stops emitting this symbol name the test becomes a
    // no-op, so require at least one match.
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // Previously 16 copies (one per Subcommand). Keep it at one.
    expect(matches.length).toBe(1);
    // grep exits 0 when it finds matches.
    expect(exitCode).toBe(0);
  },
  60_000,
);

async function run(cwd: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("package manager CLI args", () => {
  describe("--help shows only each subcommand's own flags", () => {
    test.each([
      // [subcommand, flag that SHOULD appear, flag that must NOT appear]
      ["add", "-d, --dev", "--latest"],
      ["install", "--filter", "--tag"],
      ["update", "--latest", "--dev"],
      ["remove", "--global", "--dev"],
      ["outdated", "-F, --filter", "--dev"],
      ["publish", "--tag", "--dev"],
      ["pm", "bun pm pack", "--latest"],
      ["audit", "--audit-level", "--dev"],
      ["why", "--top", "--dev"],
      ["link", "--save", "--dev"],
      ["patch", "--commit", "--dev"],
    ] as const)("%s", async (subcommand, mustContain, mustNotContain) => {
      using dir = tempDir("pm-cli-help", {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
      });
      const { stdout, exitCode } = await run(String(dir), [subcommand, "--help"]);
      expect(stdout).toContain(mustContain);
      expect(stdout).not.toContain(mustNotContain);
      expect(exitCode).toBe(0);
    });
  });

  describe("unknown short flags are rejected per subcommand", () => {
    // These short flags exist for OTHER subcommands but not the one under test.
    // The streaming parser should reject them with InvalidArgument, not silently
    // accept them via the shared superset result struct.
    test.each([
      ["remove", "-d"], // -d is add/install only
      ["remove", "-E"], // -E is add/install only
      ["install", "-F"], // -F is outdated only (install has --filter long-only)
      ["install", "-i"], // -i is update only
      ["add", "-r"], // -r is update/outdated only
      ["link", "-d"], // -d is add/install only
      ["why", "-a"], // -a is add/install/pm only
    ] as const)("bun %s %s", async (subcommand, short) => {
      using dir = tempDir("pm-cli-short-reject", {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
      });
      const { stdout, stderr, exitCode } = await run(String(dir), [subcommand, short, "pkg"]);
      const combined = stdout + stderr;
      expect(combined).toContain(`Invalid Argument '${short}'`);
      expect(exitCode).toBe(1);
    });
  });

  test("bun add -d adds to devDependencies (short flag maps to --dev)", async () => {
    using dir = tempDir("pm-cli-add-dev", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
      "pkg/package.json": JSON.stringify({ name: "localpkg", version: "1.0.0" }),
    });
    const { stderr, exitCode } = await run(String(dir), ["add", "-d", "file:./pkg"]);
    expect(stderr).not.toContain("Invalid Argument");
    expect(exitCode).toBe(0);
    const pkgJson = await Bun.file(`${dir}/package.json`).json();
    expect(pkgJson.devDependencies).toEqual({ localpkg: "file:./pkg" });
    expect(pkgJson.dependencies).toBeUndefined();
  });

  test("bun add -E adds exact version (short flag maps to --exact)", async () => {
    using dir = tempDir("pm-cli-add-exact", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
      "pkg/package.json": JSON.stringify({ name: "localpkg", version: "2.3.4" }),
    });
    const { stderr, exitCode } = await run(String(dir), ["add", "-E", "file:./pkg"]);
    expect(stderr).not.toContain("Invalid Argument");
    expect(exitCode).toBe(0);
    const pkgJson = await Bun.file(`${dir}/package.json`).json();
    expect(pkgJson.dependencies).toEqual({ localpkg: "file:./pkg" });
  });

  test("bun update --latest is recognized", async () => {
    using dir = tempDir("pm-cli-update-latest", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["update", "--latest"]);
    const combined = stdout + stderr;
    expect(combined).not.toContain("Invalid Argument");
    // update on an empty project succeeds with nothing to do
    expect(exitCode).toBe(0);
  });

  test("bun remove --latest is silently ignored (unknown long flag)", async () => {
    // StreamingClap skips unrecognized long flags; --latest is update-only so
    // remove should proceed as if it weren't passed (and fail on the missing
    // package rather than on the flag).
    using dir = tempDir("pm-cli-remove-latest", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
    });
    const { stdout, stderr } = await run(String(dir), ["remove", "--latest", "nonexistent"]);
    const combined = stdout + stderr;
    expect(combined).not.toContain("Invalid Argument '--latest'");
    expect(combined).not.toMatch(/--latest.*does not take a value|requires a value/);
  });

  test("bun publish --tag recognizes subcommand-specific option", async () => {
    using dir = tempDir("pm-cli-publish-tag", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0", private: true }),
    });
    const { stdout, stderr } = await run(String(dir), ["publish", "--tag", "beta", "--dry-run"]);
    const combined = stdout + stderr;
    // --tag takes a value; if parsing were wrong we'd get "does not take a value" or "Invalid Argument"
    expect(combined).not.toContain("Invalid Argument '--tag'");
    expect(combined).not.toContain("does not take a value");
  });

  test("bun pm parses --message and --preid (pm-only options)", async () => {
    using dir = tempDir("pm-cli-pm-version", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0" }),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), [
      "pm",
      "version",
      "--no-git-tag-version",
      "--preid",
      "beta",
      "--message",
      "msg",
      "prerelease",
    ]);
    const combined = stdout + stderr;
    expect(combined).not.toContain("Invalid Argument");
    expect(combined).not.toContain("does not take a value");
    expect(exitCode).toBe(0);
    const pkgJson = await Bun.file(`${dir}/package.json`).json();
    expect(pkgJson.version).toBe("1.0.1-beta.0");
  });

  test("bun pm ls --depth recognizes pm-only option with value", async () => {
    using dir = tempDir("pm-cli-pm-depth", {
      "package.json": JSON.stringify({ name: "test", version: "1.0.0", dependencies: { localpkg: "file:./pkg" } }),
      "pkg/package.json": JSON.stringify({ name: "localpkg", version: "1.0.0" }),
    });
    await run(String(dir), ["install"]);
    const { stdout, stderr, exitCode } = await run(String(dir), ["pm", "ls", "--depth", "1"]);
    const combined = stdout + stderr;
    expect(combined).not.toContain("Invalid Argument '--depth'");
    expect(combined).not.toContain("invalid depth value");
    expect(combined).not.toContain("requires a value");
    expect(exitCode).toBe(0);
  });
});

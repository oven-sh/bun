import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/29308
// `bunfig.toml` at the project root was ignored when running `bun` from a
// subdirectory, which broke `preload` (and every other config entry) in
// monorepos where commands are invoked from inside a package directory.
test.each([
  { label: "bun file.ts", argv: ["src/index.ts"] },
  { label: "bun run file.ts", argv: ["run", "src/index.ts"] },
])("preload in bunfig.toml is respected from a subdirectory ($label)", async ({ argv }) => {
  using dir = tempDir("bun-issue-29308", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
    "packages/pkg1/src/index.ts": `console.log("hello from pkg1");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...argv],
    env: bunEnv,
    cwd: join(String(dir), "packages", "pkg1"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from pkg1\n");
  expect(exitCode).toBe(0);
});

test("bunfig.toml preload with relative path works from project root", async () => {
  using dir = tempDir("bun-issue-29308-root", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "src/index.ts": `console.log("hello from root");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from root\n");
  expect(exitCode).toBe(0);
});

// A --preload flag on the CLI must be merged with, not replaced by, preload
// entries the ancestor bunfig.toml contributes. Before the append-fix in
// loadPreload, the secondary loadConfig call from run_command.zig clobbered
// CLI preloads when a parent bunfig.toml also had preload entries.
test("CLI --preload is merged with ancestor bunfig.toml preload entries", async () => {
  using dir = tempDir("bun-issue-29308-merge", {
    "bunfig.toml": `preload = ["./setup.ts"]\n`,
    "setup.ts": `console.log("setup from bunfig");\n`,
    "trace.ts": `console.log("trace from cli");\n`,
    "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
    "packages/pkg1/src/index.ts": `console.log("hello from pkg1");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--preload", join(String(dir), "trace.ts"), "src/index.ts"],
    env: bunEnv,
    cwd: join(String(dir), "packages", "pkg1"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Bunfig preloads run before CLI preloads, then the script.
  expect(stdout).toBe("setup from bunfig\ntrace from cli\nhello from pkg1\n");
  expect(exitCode).toBe(0);
});

// The walk must not escape a nested project into an unrelated parent: a
// directory with its own lockfile or .git is that project's root, and a
// bunfig.toml beyond it (e.g. in a repo that vendors the project) must not
// apply. Covers both marker kinds.
test.each([
  { label: "lockfile", marker: { "vendor/app/bun.lock": "" } },
  { label: ".git", marker: { "vendor/app/.git/HEAD": "" } },
])("ancestor walk stops at a nested project boundary ($label)", async ({ marker }) => {
  using dir = tempDir("bun-issue-29308-boundary", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "vendor/app/package.json": `{"name":"app","version":"0.0.0"}\n`,
    "vendor/app/index.ts": `console.log("hello from app");\n`,
    ...marker,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: join(String(dir), "vendor", "app"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("hello from app\n");
  expect(exitCode).toBe(0);
});

// A lockfile at the project root must not hide a bunfig.toml sitting next to
// it: within one directory the bunfig check wins over the boundary check.
test("bunfig.toml next to the lockfile at the project root still applies", async () => {
  using dir = tempDir("bun-issue-29308-root-lock", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "bun.lock": "",
    "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
    "packages/pkg1/src/index.ts": `console.log("hello from pkg1");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: join(String(dir), "packages", "pkg1"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from pkg1\n");
  expect(exitCode).toBe(0);
});

// Guard against the ancestor walk stopping at a DIRECTORY named bunfig.toml.
// Without the regular-file check, the walk would treat the directory as a hit
// and the real bunfig.toml higher in the tree would be silently skipped.
test("directory named bunfig.toml in an ancestor does not short-circuit the walk", async () => {
  using dir = tempDir("bun-issue-29308-dir-named-bunfig", {
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "middle/packages/pkg1/src/index.ts": `console.log("hello from pkg1");\n`,
  });

  // Put a directory literally named `bunfig.toml` between cwd and the real one.
  mkdirSync(join(String(dir), "middle", "bunfig.toml"), { recursive: true });
  writeFileSync(join(String(dir), "middle", "bunfig.toml", "placeholder"), "");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "src/index.ts"],
    env: bunEnv,
    cwd: join(String(dir), "middle", "packages", "pkg1"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("preload script executed!\nhello from pkg1\n");
  expect(exitCode).toBe(0);
});

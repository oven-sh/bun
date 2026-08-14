import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/29308
// An auto-loaded bunfig.toml is discovered by walking up from cwd, bounded at
// the project root the way `--filter` finds it: the nearest package.json, or
// the workspace root whose `workspaces` globs claim it.

async function runIn(cwd: string, argv: string[]): Promise<[string, string, number]> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...argv],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

const workspaceFiles = (workspaces: string[]) => ({
  "package.json": JSON.stringify({ name: "root", workspaces }) + "\n",
  "bunfig.toml": `preload = ["./preload.ts"]\n`,
  "preload.ts": `console.log("preload script executed!");\n`,
  "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
  "packages/pkg1/src/index.ts": `console.log("hello from pkg1");\n`,
});

// Accepted workspaces spellings all claim the member (install accepts the
// "./" prefix and a trailing slash; a negated glob for another dir is inert).
test.concurrent.each([
  { label: "bun file.ts", argv: ["src/index.ts"], workspaces: ["packages/*"] },
  { label: "bun run file.ts", argv: ["run", "src/index.ts"], workspaces: ["packages/*"] },
  { label: "./ prefix", argv: ["src/index.ts"], workspaces: ["./packages/*"] },
  { label: "trailing slash", argv: ["src/index.ts"], workspaces: ["packages/*/"] },
  { label: "inert negation", argv: ["src/index.ts"], workspaces: ["packages/*", "!packages/other"] },
])("workspace member finds the root bunfig.toml ($label)", async ({ argv, workspaces }) => {
  using dir = tempDir("bunfig-walk", workspaceFiles(workspaces));

  const [stdout, stderr, exitCode] = await runIn(join(String(dir), "packages", "pkg1"), argv);

  expect(stdout).toBe("preload script executed!\nhello from pkg1\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// A negated glob excludes the member; a negated glob for an unrelated path
// must not turn an outside directory into a member.
test.concurrent.each([
  { label: "negated member", workspaces: ["packages/*", "!packages/app"], dir: ["packages", "app"] },
  { label: "outsider with negation present", workspaces: ["packages/*", "!packages/internal"], dir: ["vendor", "app"] },
])("does not inherit: $label", async ({ workspaces, dir: sub }) => {
  using dir = tempDir("bunfig-walk-negation", {
    "package.json": JSON.stringify({ name: "root", workspaces }) + "\n",
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    [`${sub.join("/")}/package.json`]: `{"name":"nested","version":"0.0.0"}\n`,
    [`${sub.join("/")}/index.ts`]: `console.log("hello from nested");\n`,
  });

  const [stdout, stderr, exitCode] = await runIn(join(String(dir), ...sub), ["index.ts"]);

  expect(stdout).toBe("hello from nested\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("subdirectory without its own package.json inherits", async () => {
  using dir = tempDir("bunfig-walk-plain", {
    "package.json": `{"name":"root"}\n`,
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "src/deep/index.ts": `console.log("hello");\n`,
  });

  const [stdout, stderr, exitCode] = await runIn(join(String(dir), "src", "deep"), ["index.ts"]);

  expect(stdout).toBe("preload script executed!\nhello\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/29109
test.concurrent("bun test from a workspace member applies root [test] config", async () => {
  using dir = tempDir("bunfig-walk-test", {
    "package.json": `{"name":"root","workspaces":["packages/*"]}\n`,
    "bunfig.toml": `[test]\npreload = ["./test-setup.ts"]\n`,
    "test-setup.ts": `console.log("test setup executed!");\n`,
    "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
    "packages/pkg1/basic.test.ts": `import { test, expect } from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n`,
  });

  const [stdout, stderr, exitCode] = await runIn(join(String(dir), "packages", "pkg1"), ["test", "basic.test.ts"]);

  expect(stdout).toContain("test setup executed!");
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});

test.concurrent("bun build from a workspace member applies root define", async () => {
  using dir = tempDir("bunfig-walk-build", {
    "package.json": `{"name":"root","workspaces":["packages/*"]}\n`,
    "bunfig.toml": `define = {BUILD_MARK = "\\"from-bunfig\\""}\n`,
    "packages/pkg1/package.json": `{"name":"pkg1","version":"0.0.0"}\n`,
    "packages/pkg1/index.ts": `console.log(BUILD_MARK);\n`,
  });

  const [stdout, stderr, exitCode] = await runIn(join(String(dir), "packages", "pkg1"), ["build", "index.ts"]);

  expect(stdout).toContain("from-bunfig");
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
});

test.concurrent("a nested project outside the workspaces globs does not inherit", async () => {
  using dir = tempDir("bunfig-walk-boundary", {
    "package.json": `{"name":"root","workspaces":["packages/*"]}\n`,
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "vendor/app/package.json": `{"name":"app","version":"0.0.0"}\n`,
    "vendor/app/index.ts": `console.log("hello from app");\n`,
  });

  const [stdout, stderr, exitCode] = await runIn(join(String(dir), "vendor", "app"), ["index.ts"]);

  expect(stdout).toBe("hello from app\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("a cwd inside node_modules does not inherit", async () => {
  using dir = tempDir("bunfig-walk-nm", {
    "package.json": `{"name":"root"}\n`,
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "node_modules/dep/package.json": `{"name":"dep","version":"0.0.0"}\n`,
    "node_modules/dep/postinstall.ts": `console.log("postinstall ran");\n`,
  });

  const [stdout, stderr, exitCode] = await runIn(join(String(dir), "node_modules", "dep"), ["postinstall.ts"]);

  expect(stdout).toBe("postinstall ran\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// --cwd may carry a trailing separator (shell tab-completion).
test.concurrent("run --cwd with a trailing slash still walks", async () => {
  using dir = tempDir("bunfig-walk-cwd-slash", workspaceFiles(["packages/*"]));

  const [stdout, stderr, exitCode] = await runIn(String(dir), ["run", "--cwd", "packages/pkg1/", "src/index.ts"]);

  expect(stdout).toBe("preload script executed!\nhello from pkg1\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// Guard against the walk stopping at a DIRECTORY named bunfig.toml: without
// the regular-file check it would be treated as a hit and the real file
// higher up silently skipped.
test.concurrent("directory named bunfig.toml does not short-circuit the walk", async () => {
  using dir = tempDir("bunfig-walk-dir-named", {
    "package.json": `{"name":"root"}\n`,
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "middle/sub/index.ts": `console.log("hello");\n`,
  });

  mkdirSync(join(String(dir), "middle", "bunfig.toml"), { recursive: true });
  writeFileSync(join(String(dir), "middle", "bunfig.toml", "placeholder"), "");

  const [stdout, stderr, exitCode] = await runIn(join(String(dir), "middle", "sub"), ["index.ts"]);

  expect(stdout).toBe("preload script executed!\nhello\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("a compiled executable reads config from its run directory only", async () => {
  using dir = tempDir("bunfig-walk-compile", {
    "package.json": `{"name":"root"}\n`,
    "bunfig.toml": `preload = ["./preload.ts"]\n`,
    "preload.ts": `console.log("preload script executed!");\n`,
    "app.ts": `console.log("compiled app");\n`,
    "sub/.keep": "",
  });
  const exe = join(String(dir), "sub", process.platform === "win32" ? "app.exe" : "app");

  const [, buildErr, buildCode] = await runIn(String(dir), ["build", "--compile", "app.ts", "--outfile", exe]);
  expect(buildErr).not.toContain("error");
  expect(buildCode).toBe(0);

  // Run from `sub`, which has no bunfig.toml; the parent one must not apply.
  await using proc = Bun.spawn({
    cmd: [exe],
    env: bunEnv,
    cwd: join(String(dir), "sub"),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("compiled app\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

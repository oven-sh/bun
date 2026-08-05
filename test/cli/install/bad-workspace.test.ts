import { spawnSync } from "bun";
import { beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { join } from "path";

let cwd: string;

setDefaultTimeout(1000 * 60 * 5);

beforeEach(() => {
  cwd = tmpdirSync();
});

test("bad workspace path", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "hey",
        workspaces: ["i-dont-exist"],
      },
      null,
      2,
    ),
  );
  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  expect(text).toContain('Workspace not found "i-dont-exist"');

  expect(exitCode).toBe(1);
});

test("non-string workspaces entry prints the error without literal markup", async () => {
  using dir = tempDir("bad-workspace-non-string", {
    "package.json": JSON.stringify({ name: "hey", workspaces: [123] }),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(
    'Workspaces expects an array of strings, like:\n  "workspaces": [\n    "path/to/package"\n  ]',
  );
  // Pretty-markup tags ("<r>", "<green>") must not leak into the message.
  expect(stdout + stderr).not.toContain("<r>");
  expect(exitCode).toBe(1);
});

// https://github.com/oven-sh/bun/pull/34275 (`*` is not a valid filename character on Windows)
test.skipIf(isWindows)("workspace glob with an escaped token followed by an unescaped one is expanded", async () => {
  using dir = tempDir("workspace-escaped-glob", {
    "package.json": JSON.stringify({ name: "root", workspaces: ["\\*x*"] }),
    "*xpkg/package.json": JSON.stringify({ name: "xpkg", version: "1.0.0" }),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Workspace not found");
  const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
  expect(lockfile).toContain('"*xpkg"');
  expect(lockfile).toContain('"xpkg@workspace:');
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
});

test("workspace with ./ should not crash", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "my-app",
        version: "1.0.0",
        workspaces: ["./", "some-workspace"],
        devDependencies: {
          "@eslint/js": "^9.28.0",
        },
      },
      null,
      2,
    ),
  );
  mkdirSync(`${cwd}/some-workspace`);
  writeFileSync(
    `${cwd}/some-workspace/package.json`,
    JSON.stringify(
      {
        name: "some-workspace",
        version: "1.0.0",
      },
      null,
      2,
    ),
  );
  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  // Should not crash, should succeed
  expect(exitCode).toBe(0);
  expect(text).not.toContain("panic");
  expect(text).not.toContain("Internal assertion failure");
});

test("workspace with .\\ should not crash", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "my-app",
        version: "1.0.0",
        workspaces: [".\\", "some-workspace"],
        devDependencies: {
          "@eslint/js": "^9.28.0",
        },
      },
      null,
      2,
    ),
  );
  mkdirSync(`${cwd}/some-workspace`);
  writeFileSync(
    `${cwd}/some-workspace/package.json`,
    JSON.stringify(
      {
        name: "some-workspace",
        version: "1.0.0",
      },
      null,
      2,
    ),
  );
  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  // Should not crash, should succeed
  expect(exitCode).toBe(0);
  expect(text).not.toContain("panic");
  expect(text).not.toContain("Internal assertion failure");
});

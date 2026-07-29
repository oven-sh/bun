// https://github.com/oven-sh/bun/issues/18906
// Bumping a workspace's "version" in its package.json and then running `bun install`
// (or `bun install --lockfile-only`) must update that workspace's version entry in bun.lock.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

function workspaceEntry(lockfileText: string, path: string): string {
  const start = lockfileText.indexOf(`"${path}": {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lockfileText.indexOf("}", start);
  return lockfileText
    .slice(start, end + 1)
    .split("\n")
    .map(l => l.trim())
    .join(" ");
}

async function runInstall(cwd: string, extra: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...extra],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("bun.lock workspace version tracks package.json version", () => {
  async function setup(prefix: string, pkgAVersion = "1.0.0") {
    const dir = tempDir(prefix, {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: pkgAVersion,
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: { "pkg-a": "workspace:*" },
      }),
    });
    try {
      const cwd = String(dir);

      const { stderr, exitCode } = await runInstall(cwd);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(join(cwd, "bun.lock")).text();
      expect(workspaceEntry(lockfile, "packages/pkg-a")).toBe(
        `"packages/pkg-a": { "name": "pkg-a", "version": "${pkgAVersion}", }`,
      );

      return dir;
    } catch (e) {
      dir[Symbol.dispose]();
      throw e;
    }
  }

  for (const extra of [["--lockfile-only"], []]) {
    test(`"bun install${extra.length ? " " + extra.join(" ") : ""}" after bumping a workspace package.json version`, async () => {
      using dir = await setup(`issue-18906-bump${extra.length ? "-lfo" : ""}`);
      const cwd = String(dir);

      await Bun.write(
        join(cwd, "packages", "pkg-a", "package.json"),
        JSON.stringify({ name: "pkg-a", version: "2.0.0" }),
      );

      const { stderr, exitCode } = await runInstall(cwd, extra);
      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("Saved lockfile");
      expect(exitCode).toBe(0);

      const lockfile = await Bun.file(join(cwd, "bun.lock")).text();
      expect(workspaceEntry(lockfile, "packages/pkg-a")).toBe(
        `"packages/pkg-a": { "name": "pkg-a", "version": "2.0.0", }`,
      );
      expect(workspaceEntry(lockfile, "packages/pkg-b")).toBe(
        `"packages/pkg-b": { "name": "pkg-b", "version": "1.0.0", "dependencies": { "pkg-a": "workspace:*", }`,
      );
    });
  }

  test(`"bun install" after changing only build metadata`, async () => {
    using dir = await setup("issue-18906-build", "1.0.0+build.1");
    const cwd = String(dir);

    await Bun.write(
      join(cwd, "packages", "pkg-a", "package.json"),
      JSON.stringify({ name: "pkg-a", version: "1.0.0+build.2" }),
    );

    const { stderr, exitCode } = await runInstall(cwd);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    const lockfile = await Bun.file(join(cwd, "bun.lock")).text();
    expect(workspaceEntry(lockfile, "packages/pkg-a")).toBe(
      `"packages/pkg-a": { "name": "pkg-a", "version": "1.0.0+build.2", }`,
    );
  });

  test(`"bun install" after adding a version where there was none`, async () => {
    using dir = tempDir("issue-18906-add-version", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({ name: "pkg-a" }),
    });
    const cwd = String(dir);

    {
      const { stderr, exitCode } = await runInstall(cwd);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    let lockfile = await Bun.file(join(cwd, "bun.lock")).text();
    expect(workspaceEntry(lockfile, "packages/pkg-a")).toBe(`"packages/pkg-a": { "name": "pkg-a", }`);

    await Bun.write(
      join(cwd, "packages", "pkg-a", "package.json"),
      JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
    );

    const { stderr, exitCode } = await runInstall(cwd);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    lockfile = await Bun.file(join(cwd, "bun.lock")).text();
    expect(workspaceEntry(lockfile, "packages/pkg-a")).toBe(
      `"packages/pkg-a": { "name": "pkg-a", "version": "1.0.0", }`,
    );
  });

  test(`"bun install" with no version change is still a no-op`, async () => {
    using dir = await setup("issue-18906-noop");
    const cwd = String(dir);

    const { stdout, stderr, exitCode } = await runInstall(cwd);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("Saved lockfile");
    expect(stdout).toContain("no changes");
    expect(exitCode).toBe(0);
  });
});

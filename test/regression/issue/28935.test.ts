// https://github.com/oven-sh/bun/issues/28935
// `bun pm version` did not update the workspace's entry in bun.lock, so a
// sibling workspace depending on it via `workspace:*` would pack with the
// stale version.
import { spawn, spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "node:path";

async function run(cmd: string[], cwd: string) {
  await using proc = spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("bun pm version updates bun.lock for workspace packages", async () => {
  const dir = tempDirWithFiles("issue-28935-minor", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/first/package.json": JSON.stringify({
      name: "first",
      version: "1.0.0",
    }),
    "packages/second/package.json": JSON.stringify({
      name: "second",
      version: "1.0.0",
      dependencies: { first: "workspace:*" },
    }),
  });

  {
    const { exitCode } = await run([bunExe(), "install"], dir);
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, exitCode } = await run(
      [bunExe(), "pm", "version", "minor", "--no-git-tag-version"],
      join(dir, "packages", "first"),
    );
    expect(stdout.trim().split("\n").at(-1)).toBe("v1.1.0");
    expect(exitCode).toBe(0);
  }

  // packages/first's package.json is the bumped one
  const firstPkg = await Bun.file(join(dir, "packages", "first", "package.json")).json();
  expect(firstPkg.version).toBe("1.1.0");

  // bun.lock must reflect the bumped workspace version for "first",
  // otherwise packing `second` would emit a stale specifier.
  const lockfile = await Bun.file(join(dir, "bun.lock")).text();
  const firstEntry = lockfile.slice(lockfile.indexOf('"packages/first"'));
  expect(firstEntry).toMatch(/"name":\s*"first"[\s\S]*?"version":\s*"1\.1\.0"/);

  // `bun pm pack` in the sibling workspace should substitute the new version
  // for the `workspace:*` range.
  const secondDir = join(dir, "packages", "second");
  {
    const { exitCode } = await run([bunExe(), "pm", "pack", "--quiet"], secondDir);
    expect(exitCode).toBe(0);
  }

  const { stdout: tarList } = spawnSync({
    cmd: ["tar", "-xOzf", join(secondDir, "second-1.0.0.tgz"), "package/package.json"],
  });
  const packed = JSON.parse(tarList.toString());
  expect(packed.dependencies).toEqual({ first: "1.1.0" });
});

test.concurrent("bun pm version updates bun.lock for prerelease with long tag", async () => {
  // Pre-release identifiers longer than 8 chars force the version into the
  // lockfile's string pool — exercises the StringBuilder code path.
  const dir = tempDirWithFiles("issue-28935-pre", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/first/package.json": JSON.stringify({
      name: "first",
      version: "1.0.0",
    }),
    "packages/second/package.json": JSON.stringify({
      name: "second",
      version: "1.0.0",
      dependencies: { first: "workspace:*" },
    }),
  });

  {
    const { exitCode } = await run([bunExe(), "install"], dir);
    expect(exitCode).toBe(0);
  }

  {
    const { stdout, exitCode } = await run(
      [bunExe(), "pm", "version", "2.0.0-beta-super-long-tag.3", "--no-git-tag-version"],
      join(dir, "packages", "first"),
    );
    expect(stdout.trim().split("\n").at(-1)).toBe("v2.0.0-beta-super-long-tag.3");
    expect(exitCode).toBe(0);
  }

  const lockfile = await Bun.file(join(dir, "bun.lock")).text();
  const firstEntry = lockfile.slice(lockfile.indexOf('"packages/first"'));
  expect(firstEntry).toMatch(/"name":\s*"first"[\s\S]*?"version":\s*"2\.0\.0-beta-super-long-tag\.3"/);

  const secondDir = join(dir, "packages", "second");
  {
    const { exitCode } = await run([bunExe(), "pm", "pack", "--quiet"], secondDir);
    expect(exitCode).toBe(0);
  }

  const { stdout: tarList } = spawnSync({
    cmd: ["tar", "-xOzf", join(secondDir, "second-1.0.0.tgz"), "package/package.json"],
  });
  const packed = JSON.parse(tarList.toString());
  expect(packed.dependencies).toEqual({ first: "2.0.0-beta-super-long-tag.3" });
});

test.concurrent("bun pm version in a non-workspace project with a lockfile does not crash", async () => {
  // Regression guard: the updateLockfileWorkspaceVersion helper must no-op
  // when the bumped package isn't tracked in `workspace_versions` (here the
  // root of a plain, non-workspace project).
  const dir = tempDirWithFiles("issue-28935-root", {
    "package.json": JSON.stringify({
      name: "standalone",
      version: "1.0.0",
    }),
  });

  {
    const { exitCode } = await run([bunExe(), "install"], dir);
    expect(exitCode).toBe(0);
  }

  // Some environments leave the lockfile out when there are no deps —
  // create a stub that matches the on-disk text format so we can exercise
  // the "root package, no workspace entry" code path.
  await Bun.write(
    join(dir, "bun.lock"),
    JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: { "": { name: "standalone" } },
        packages: {},
      },
      null,
      2,
    ) + "\n",
  );

  const { stdout, exitCode } = await run([bunExe(), "pm", "version", "patch", "--no-git-tag-version"], dir);
  expect(stdout.trim().split("\n").at(-1)).toBe("v1.0.1");
  expect(exitCode).toBe(0);

  const pkg = await Bun.file(join(dir, "package.json")).json();
  expect(pkg.version).toBe("1.0.1");
});

// https://github.com/oven-sh/bun/issues/28935
// `bun pm version` did not update the workspace's entry in bun.lock, so a
// sibling workspace depending on it via `workspace:*` would pack with the
// stale version.
import { spawn, spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

async function run(cmd: string[], cwd: string) {
  await using proc = spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("bun pm version updates bun.lock for workspace packages", async () => {
  using dir = tempDir("issue-28935-minor", {
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
  const firstIdx = lockfile.indexOf('"packages/first"');
  expect(firstIdx).toBeGreaterThanOrEqual(0);
  expect(lockfile.slice(firstIdx)).toMatch(/"name":\s*"first"[\s\S]*?"version":\s*"1\.1\.0"/);

  // `bun pm pack` in the sibling workspace should substitute the new version
  // for the `workspace:*` range.
  const secondDir = join(dir, "packages", "second");
  {
    const { exitCode } = await run([bunExe(), "pm", "pack", "--quiet"], secondDir);
    expect(exitCode).toBe(0);
  }

  const tarResult = spawnSync({
    cmd: ["tar", "-xOzf", join(secondDir, "second-1.0.0.tgz"), "package/package.json"],
  });
  expect(tarResult.stderr.toString()).toBe("");
  expect(tarResult.exitCode).toBe(0);
  const packed = JSON.parse(tarResult.stdout.toString());
  expect(packed.dependencies).toEqual({ first: "1.1.0" });
});

test.concurrent("bun pm version updates bun.lock for prerelease with long tag", async () => {
  // Pre-release identifiers longer than 8 chars force the version into the
  // lockfile's string pool — exercises the StringBuilder code path.
  using dir = tempDir("issue-28935-pre", {
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
  const firstIdx = lockfile.indexOf('"packages/first"');
  expect(firstIdx).toBeGreaterThanOrEqual(0);
  expect(lockfile.slice(firstIdx)).toMatch(/"name":\s*"first"[\s\S]*?"version":\s*"2\.0\.0-beta-super-long-tag\.3"/);

  const secondDir = join(dir, "packages", "second");
  {
    const { exitCode } = await run([bunExe(), "pm", "pack", "--quiet"], secondDir);
    expect(exitCode).toBe(0);
  }

  const tarResult = spawnSync({
    cmd: ["tar", "-xOzf", join(secondDir, "second-1.0.0.tgz"), "package/package.json"],
  });
  expect(tarResult.stderr.toString()).toBe("");
  expect(tarResult.exitCode).toBe(0);
  const packed = JSON.parse(tarResult.stdout.toString());
  expect(packed.dependencies).toEqual({ first: "2.0.0-beta-super-long-tag.3" });
});

// Skipped on Windows: the test spawns `git init`/`commit`/`tag` with
// `HOME=""` / `XDG_CONFIG_HOME=""` / `USERPROFILE=""` to isolate from
// system git config. Windows git requires a valid `USERPROFILE` for some
// internal operations and the disposable tempDir cleanup races with
// still-open git handles (rmdir on open files fails on NTFS).
test.concurrent.skipIf(isWindows)(
  "bun pm version from a workspace subdir stages and commits bun.lock alongside package.json",
  async () => {
    // Exercises the `saved_lockfile_path` → `gitCommitAndTag()` plumbing
    // from a workspace subdirectory where `.git` lives at the repo root.
    // `verifyGit` now walks up looking for `.git`, so `--git-tag-version`
    // (the default) actually runs and must stage the updated lockfile
    // together with `package.json`.
    using dir = tempDir("issue-28935-git", {
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

    const gitEnv = {
      ...bunEnv,
      // Isolate from user/system git config so CI machines with
      // `commit.gpgsign = true`, signing hooks, or other surprises don't
      // break the test. Matches the pattern used in
      // test/js/bun/patch/patch.test.ts.
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: "",
      XDG_CONFIG_HOME: "",
      USERPROFILE: "",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    for (const argv of [
      ["git", "init", "-q"],
      ["git", "add", "."],
      ["git", "commit", "-q", "-m", "init"],
    ]) {
      // stdout is `ignore` (not `pipe`) because nothing in the loop reads
      // it — git could otherwise fill the OS pipe buffer (~64KB) and block
      // on its own stdout write while we await stderr/exited, deadlocking
      // the test.
      await using gitProc = spawn({
        cmd: argv,
        cwd: dir,
        env: gitEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const stderr = await gitProc.stderr.text();
      const code = await gitProc.exited;
      if (code !== 0) throw new Error(`${argv.join(" ")} failed: ${stderr}`);
    }

    // No --no-git-tag-version: should commit and tag. Drain stdout and
    // stderr concurrently via `Promise.all` so neither pipe can fill and
    // block the subprocess on its own write while we wait on the other.
    await using versionProc = spawn({
      cmd: [bunExe(), "pm", "version", "minor"],
      cwd: join(dir, "packages", "first"),
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [versionStdout, , versionCode] = await Promise.all([
      versionProc.stdout.text(),
      versionProc.stderr.text(),
      versionProc.exited,
    ]);
    expect(versionStdout.trim().split("\n").at(-1)).toBe("v1.1.0");
    expect(versionCode).toBe(0);

    // Working tree must be clean — both package.json AND bun.lock were
    // committed as part of the version bump. stderr is `ignore` on these
    // three verification procs because nothing reads it, matching the
    // pattern used for the git setup loop above.
    await using statusProc = spawn({
      cmd: ["git", "status", "--porcelain"],
      cwd: dir,
      env: gitEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    expect(await statusProc.stdout.text()).toBe("");
    expect(await statusProc.exited).toBe(0);

    // HEAD commit must include `packages/first/package.json` and `bun.lock`.
    await using showProc = spawn({
      cmd: ["git", "show", "--name-only", "--pretty=format:", "HEAD"],
      cwd: dir,
      env: gitEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    const changed = (await showProc.stdout.text()).trim().split("\n").filter(Boolean).sort();
    expect(changed).toEqual(["bun.lock", "packages/first/package.json"]);
    expect(await showProc.exited).toBe(0);

    // v1.1.0 tag must exist.
    await using tagProc = spawn({
      cmd: ["git", "tag", "-l", "v1.1.0"],
      cwd: dir,
      env: gitEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    expect((await tagProc.stdout.text()).trim()).toBe("v1.1.0");
    expect(await tagProc.exited).toBe(0);
  },
);

test.concurrent("bun pm version in a non-workspace project with a lockfile does not crash", async () => {
  // Regression guard: the updateLockfileWorkspaceVersion helper must no-op
  // when the bumped package isn't tracked in `workspace_versions` (here the
  // root of a plain, non-workspace project).
  using dir = tempDir("issue-28935-root", {
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

test.concurrent("bun pm version does not silently migrate yarn.lock / package-lock.json to bun.lock", async () => {
  // Regression guard: the lockfile update path must NOT trigger
  // foreign-lockfile migration as a side effect of a version bump.
  // A project that ships a `yarn.lock` (or `package-lock.json` /
  // `pnpm-lock.yaml`) and has no `bun.lock` should keep its lockfile
  // format untouched after `bun pm version`.
  using dir = tempDir("issue-28935-no-migrate", {
    "package.json": JSON.stringify({
      name: "yarn-project",
      version: "1.0.0",
    }),
    // Minimal valid yarn v1 lockfile — empty dependency set.
    "yarn.lock": "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n# yarn lockfile v1\n\n",
  });

  const { stdout, exitCode } = await run([bunExe(), "pm", "version", "patch", "--no-git-tag-version"], dir);
  expect(stdout.trim().split("\n").at(-1)).toBe("v1.0.1");
  expect(exitCode).toBe(0);

  // package.json bump applied.
  const pkg = await Bun.file(join(dir, "package.json")).json();
  expect(pkg.version).toBe("1.0.1");

  // yarn.lock is still there, untouched.
  expect(await Bun.file(join(dir, "yarn.lock")).exists()).toBe(true);

  // CRITICAL: no bun.lock / bun.lockb was materialized. The version
  // bump must not convert the project's lockfile manager.
  expect(await Bun.file(join(dir, "bun.lock")).exists()).toBe(false);
  expect(await Bun.file(join(dir, "bun.lockb")).exists()).toBe(false);
});

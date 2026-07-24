// Tests for installing git dependencies that live in ONE repository as
// multiple branches (issue #35420), plus `git+file://` dependencies.
// Everything is local: a bare repo on disk, served over git's dumb HTTP
// protocol by Bun.serve when an http URL is needed.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";

const gitEnv = {
  ...bunEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]) {
  const res = Bun.spawnSync({ cmd: ["git", ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
  if (!res.success) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${res.stderr.toString()}`);
  }
  return res.stdout.toString();
}

interface BranchPackage {
  name: string;
  branch: string;
  dependencies?: Record<string, string>;
}

// Creates `<root>/shared-repo.git`, a bare repo with one orphan branch per
// package, and prepares it for serving over dumb HTTP.
function makeSharedRepo(root: string, packages: BranchPackage[]): string {
  const bare = join(root, "shared-repo.git");
  const work = join(root, "work");
  git(root, "init", "-q", "--bare", "shared-repo.git");
  mkdirSync(work);
  git(work, "init", "-q");
  for (const pkg of packages) {
    git(work, "checkout", "-q", "--orphan", pkg.branch);
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({ name: pkg.name, version: "1.0.0", dependencies: pkg.dependencies }, null, 2),
    );
    writeFileSync(join(work, "index.js"), `module.exports = ${JSON.stringify(pkg.branch)};\n`);
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", pkg.branch, "--no-gpg-sign");
    git(work, "push", "-q", bare, pkg.branch);
  }
  // dumb HTTP clients read the static files this generates
  git(bare, "update-server-info");
  return bare;
}

function serveDumbHttp(root: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const file = Bun.file(join(root, new URL(req.url).pathname));
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
}

async function runInstall(cwd: string, cacheDir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: { ...gitEnv, BUN_INSTALL_CACHE_DIR: cacheDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function installedVersionOf(dir: string, name: string): Promise<string | null> {
  const file = Bun.file(join(dir, "node_modules", name, "index.js"));
  if (!(await file.exists())) return null;
  const text = await file.text();
  return JSON.parse(text.slice(text.indexOf("=") + 1, text.lastIndexOf(";")));
}

// issue #35420 bug 1: with no lockfile and a cold cache, dependencies that
// appear both directly and transitively (same repo URL + committish) raced
// against the shared clone/checkout tasks and failed with "failed to resolve".
test.concurrent(
  "installs every git dependency when many branches of one repo appear directly and transitively",
  async () => {
    const letters = "abcdefghijklmnop".split("");
    using dir = tempDir("git-dep-dup", {});
    const root = String(dir);

    await using server = serveDumbHttp(root);
    const repoUrl = `git+http://localhost:${server.port}/shared-repo.git`;

    // pkg-a re-declares 11 of its siblings as its own dependencies, so those
    // specs appear both directly (from the project) and transitively.
    const transitive = Object.fromEntries(letters.slice(1, 12).map(l => [`@scope/pkg-${l}`, `${repoUrl}#pkg-${l}`]));
    makeSharedRepo(
      root,
      letters.map(l => ({
        name: `@scope/pkg-${l}`,
        branch: `pkg-${l}`,
        dependencies: l === "a" ? transitive : undefined,
      })),
    );

    const project = join(root, "project");
    mkdirSync(project);
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "project",
        version: "1.0.0",
        dependencies: Object.fromEntries(letters.map(l => [`@scope/pkg-${l}`, `${repoUrl}#pkg-${l}`])),
      }),
    );

    // the race depends on threadpool scheduling; two fresh-cache attempts to
    // make the failure reliable on the unfixed code
    for (let attempt = 0; attempt < 2; attempt++) {
      await Bun.$`rm -rf ${join(project, "node_modules")} ${join(project, "bun.lock")} ${join(root, "cache-" + attempt)}`;
      const { stderr, exitCode } = await runInstall(project, join(root, `cache-${attempt}`));
      expect(stderr).not.toContain("failed to resolve");
      expect(stderr).not.toContain("error:");
      for (const l of letters) {
        expect(await installedVersionOf(project, `@scope/pkg-${l}`)).toBe(`pkg-${l}`);
      }
      expect(exitCode).toBe(0);
    }
  },
);

// issue #35420 bug 2: installing from a complete lockfile with a cold cache
// only checked out the single dependency stored on the shared clone task; the
// other branches of the same repo were silently skipped with exit code 0.
test.concurrent("installs every git dependency from a lockfile on a cold cache when deps share one repo", async () => {
  using dir = tempDir("git-dep-lockfile", {});
  const root = String(dir);

  await using server = serveDumbHttp(root);
  const repoUrl = `git+http://localhost:${server.port}/shared-repo.git`;
  makeSharedRepo(root, [
    { name: "@scope/pkg-m", branch: "pkg-m" },
    { name: "@scope/pkg-n", branch: "pkg-n" },
  ]);

  const project = join(root, "project");
  mkdirSync(project);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({
      name: "project",
      version: "1.0.0",
      dependencies: {
        "@scope/pkg-m": `${repoUrl}#pkg-m`,
        "@scope/pkg-n": `${repoUrl}#pkg-n`,
      },
    }),
  );

  // fresh install to produce a complete lockfile
  {
    const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"));
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await installedVersionOf(project, "@scope/pkg-m")).toBe("pkg-m");
    expect(await installedVersionOf(project, "@scope/pkg-n")).toBe("pkg-n");
  }

  // simulate a fresh machine: keep bun.lock, drop node_modules + cache
  await Bun.$`rm -rf ${join(project, "node_modules")}`;
  const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), "--frozen-lockfile");
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "@scope/pkg-m")).toBe("pkg-m");
  expect(await installedVersionOf(project, "@scope/pkg-n")).toBe("pkg-n");
  expect(exitCode).toBe(0);
});

// issue #35420 bug 3: `git+file://` dependencies never cloned at all — the
// clone task recognized neither an https nor an ssh URL and finished without
// running git, leaving a poisoned repo handle behind.
test.concurrent("installs a git+file:// dependency", async () => {
  using dir = tempDir("git-dep-file", {});
  const root = String(dir);
  const bare = makeSharedRepo(root, [{ name: "@scope/pkg-b", branch: "pkg-b" }]);

  const project = join(root, "project");
  mkdirSync(project);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({
      name: "project",
      version: "1.0.0",
      dependencies: {
        "@scope/pkg-b": `git+${pathToFileURL(bare)}#pkg-b`,
      },
    }),
  );

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"));
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "@scope/pkg-b")).toBe("pkg-b");
  expect(exitCode).toBe(0);
});

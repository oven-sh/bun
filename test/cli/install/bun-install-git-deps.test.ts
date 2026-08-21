// Tests for installing git dependencies that live in ONE repository as
// multiple branches (issue #35420), `git+file://` dependencies, and
// tarball-URL / `github:` dependencies that appear both directly and
// transitively (issues #10915, #8501, #11348, #28284). Everything is local:
// a bare repo on disk (served over git's dumb HTTP protocol by Bun.serve
// when an http URL is needed) or static tarballs.
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

async function run(cwd: string, cmd: string[], what: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: gitEnv, stdout: "ignore", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`${what} failed in ${cwd}:\n${stderr}`);
  }
}

function git(cwd: string, ...args: string[]) {
  return run(cwd, ["git", ...args], `git ${args.join(" ")}`);
}

interface BranchPackage {
  name: string;
  branch: string;
  dependencies?: Record<string, string>;
}

// Creates `<root>/shared-repo.git`, a bare repo with one orphan branch per
// package, and prepares it for serving over dumb HTTP.
async function makeSharedRepo(root: string, packages: BranchPackage[]): Promise<string> {
  const bare = join(root, "shared-repo.git");
  const work = join(root, "work");
  await git(root, "init", "-q", "--bare", "shared-repo.git");
  mkdirSync(work);
  await git(work, "init", "-q");
  for (const pkg of packages) {
    await git(work, "checkout", "-q", "--orphan", pkg.branch);
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({ name: pkg.name, version: "1.0.0", dependencies: pkg.dependencies }, null, 2),
    );
    writeFileSync(join(work, "index.js"), `module.exports = ${JSON.stringify(pkg.branch)};\n`);
    await git(work, "add", "-A");
    await git(work, "commit", "-q", "-m", pkg.branch, "--no-gpg-sign");
    await git(work, "push", "-q", bare, pkg.branch);
  }
  // dumb HTTP clients read the static files this generates
  await git(bare, "update-server-info");
  return bare;
}

function serveStatic(root: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const file = Bun.file(join(root, new URL(req.url).pathname));
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
}

async function runInstall(cwd: string, cacheDir: string, extraEnv: Record<string, string>, ...args: string[]) {
  const env = { ...gitEnv, ...extraEnv, BUN_INSTALL_CACHE_DIR: cacheDir };
  // Set on ASAN CI lanes; it arms a subreaper around internal git spawns that
  // SIGKILLs concurrent clone tasks (see #33982). This test exercises install
  // task bookkeeping, not orphan reaping.
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env,
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

    await using server = serveStatic(root);
    const repoUrl = `git+http://localhost:${server.port}/shared-repo.git`;

    // pkg-a re-declares 11 of its siblings as its own dependencies, so those
    // specs appear both directly (from the project) and transitively.
    const transitive = Object.fromEntries(letters.slice(1, 12).map(l => [`@scope/pkg-${l}`, `${repoUrl}#pkg-${l}`]));
    await makeSharedRepo(
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
      const { stderr, exitCode } = await runInstall(project, join(root, `cache-${attempt}`), {});
      expect(stderr).not.toContain("failed to resolve");
      expect(stderr).not.toContain("error:");
      for (const l of letters) {
        expect(await installedVersionOf(project, `@scope/pkg-${l}`)).toBe(`pkg-${l}`);
      }
      expect(exitCode).toBe(0);
    }
  },
  30_000,
);

// same mechanism as above but for tarball-URL dependencies (issues #10915,
// #8501): a dependency enqueued after its tarball's extract task already
// completed and drained its callback queue was parked forever and failed
// with "failed to resolve".
test.concurrent(
  "installs every tarball-URL dependency that appears directly and transitively",
  async () => {
    const letters = "abcdefghijklmnop".split("");
    using dir = tempDir("tarball-dep-dup", {});
    const root = String(dir);
    const tarballs = join(root, "tarballs");
    mkdirSync(tarballs);

    await using server = serveStatic(tarballs);
    const urlOf = (l: string) => `http://localhost:${server.port}/pkg-${l}.tgz`;

    // pkg-a re-declares 11 of its siblings as its own dependencies, so those
    // tarball specs appear both directly (from the project) and transitively.
    const transitive = Object.fromEntries(letters.slice(1, 12).map(l => [`@scope/pkg-${l}`, urlOf(l)]));
    for (const l of letters) {
      const pkgDir = join(root, `work-${l}`, "package");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: `@scope/pkg-${l}`,
          version: "1.0.0",
          dependencies: l === "a" ? transitive : undefined,
        }),
      );
      writeFileSync(join(pkgDir, "index.js"), `module.exports = ${JSON.stringify(`pkg-${l}`)};\n`);
      await run(root, ["tar", "-czf", join(tarballs, `pkg-${l}.tgz`), "-C", join(root, `work-${l}`), "package"], "tar");
    }

    const project = join(root, "project");
    mkdirSync(project);
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "project",
        version: "1.0.0",
        dependencies: Object.fromEntries(letters.map(l => [`@scope/pkg-${l}`, urlOf(l)])),
      }),
    );

    // the race depends on threadpool scheduling; two fresh-cache attempts to
    // make the failure reliable on the unfixed code
    for (let attempt = 0; attempt < 2; attempt++) {
      await Bun.$`rm -rf ${join(project, "node_modules")} ${join(project, "bun.lock")} ${join(root, "cache-" + attempt)}`;
      const { stderr, exitCode } = await runInstall(project, join(root, `cache-${attempt}`), {});
      expect(stderr).not.toContain("failed to resolve");
      expect(stderr).not.toContain("error:");
      for (const l of letters) {
        expect(await installedVersionOf(project, `@scope/pkg-${l}`)).toBe(`pkg-${l}`);
      }
      expect(exitCode).toBe(0);
    }
  },
  30_000,
);

// issue #11348: same mechanism for `github:` dependencies. The root and a
// transitive `github:` dependency both request the same `github:owner/repo`
// spec; the late enqueue lands after the shared extract task already drained
// its callback queue and was parked forever with "failed to resolve".
test.concurrent(
  "installs every github: dependency that appears directly and transitively",
  async () => {
    const letters = "abcdefgh".split("");
    using dir = tempDir("github-dep-dup", {});
    const root = String(dir);
    const tarballs = join(root, "tarballs");
    mkdirSync(tarballs);

    // pkg-a re-declares its siblings as its own dependencies, so those
    // `github:` specs appear both directly (from the project) and transitively.
    const transitive = Object.fromEntries(letters.slice(1).map(l => [`@scope/pkg-${l}`, `github:scope/pkg-${l}`]));
    for (const l of letters) {
      // GitHub tarballs have a top-level `<owner>-<repo>-<sha>` directory; the
      // extractor reads it as the resolved tag and it becomes the cache key.
      const top = `scope-pkg-${l}-0000000`;
      const pkgDir = join(root, `work-${l}`, top);
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: `@scope/pkg-${l}`,
          version: "1.0.0",
          dependencies: l === "a" ? transitive : undefined,
        }),
      );
      writeFileSync(join(pkgDir, "index.js"), `module.exports = ${JSON.stringify(`pkg-${l}`)};\n`);
      await run(root, ["tar", "-czf", join(tarballs, `pkg-${l}.tgz`), "-C", join(root, `work-${l}`), top], "tar");
    }

    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const match = /^\/repos\/scope\/(pkg-[a-z])\/tarball\/?$/.exec(new URL(req.url).pathname);
        if (match) return new Response(Bun.file(join(tarballs, `${match[1]}.tgz`)));
        return new Response("not found", { status: 404 });
      },
    });

    const project = join(root, "project");
    mkdirSync(project);
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "project",
        version: "1.0.0",
        dependencies: Object.fromEntries(letters.map(l => [`@scope/pkg-${l}`, `github:scope/pkg-${l}`])),
      }),
    );

    // the race depends on threadpool scheduling; two fresh-cache attempts to
    // make the failure reliable on the unfixed code
    for (let attempt = 0; attempt < 2; attempt++) {
      await Bun.$`rm -rf ${join(project, "node_modules")} ${join(project, "bun.lock")} ${join(root, "cache-" + attempt)}`;
      const { stderr, exitCode } = await runInstall(project, join(root, `cache-${attempt}`), {
        GITHUB_API_URL: `http://localhost:${server.port}`,
      });
      expect(stderr).not.toContain("failed to resolve");
      expect(stderr).not.toContain("error:");
      for (const l of letters) {
        expect(await installedVersionOf(project, `@scope/pkg-${l}`)).toBe(`pkg-${l}`);
      }
      expect(exitCode).toBe(0);
    }
  },
  30_000,
);

// issue #35420 bug 2: installing from a complete lockfile with a cold cache
// only checked out the single dependency stored on the shared clone task; the
// other branches of the same repo were silently skipped with exit code 0.
test.concurrent(
  "installs every git dependency from a lockfile on a cold cache when deps share one repo",
  async () => {
    using dir = tempDir("git-dep-lockfile", {});
    const root = String(dir);

    await using server = serveStatic(root);
    const repoUrl = `git+http://localhost:${server.port}/shared-repo.git`;
    await makeSharedRepo(root, [
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
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), {});
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await installedVersionOf(project, "@scope/pkg-m")).toBe("pkg-m");
      expect(await installedVersionOf(project, "@scope/pkg-n")).toBe("pkg-n");
    }

    // simulate a fresh machine: keep bun.lock, drop node_modules + cache
    await Bun.$`rm -rf ${join(project, "node_modules")}`;
    const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, "--frozen-lockfile");
    expect(stderr).not.toContain("error:");
    expect(await installedVersionOf(project, "@scope/pkg-m")).toBe("pkg-m");
    expect(await installedVersionOf(project, "@scope/pkg-n")).toBe("pkg-n");
    expect(exitCode).toBe(0);
  },
  30_000,
);

// With the isolated linker, a cold-cache frozen install re-enqueues each
// dependency after the shared clone completes; the checkout id was derived
// from the branch committish's current tip instead of the lockfile's pinned
// SHA, so a branch that moved after the lockfile was written installed the
// wrong commit and stranded the install context. The hoisted linker had the
// same mismatch in its clone-completion waiter loop.
for (const linker of ["hoisted", "isolated"] as const) {
  test.concurrent(
    `${linker} linker installs the locked commit from a cold cache after the branch moves`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-moved`, {});
      const root = String(dir);

      await using server = serveStatic(root);
      const repoUrl = `git+http://localhost:${server.port}/shared-repo.git`;
      const bare = await makeSharedRepo(root, [
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
        const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), {}, `--linker=${linker}`);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
      }

      // move pkg-m past the locked commit
      const work = join(root, "work");
      await git(work, "checkout", "-q", "pkg-m");
      writeFileSync(join(work, "index.js"), `module.exports = "pkg-m-v2";\n`);
      await git(work, "commit", "-aqm", "v2", "--no-gpg-sign");
      await git(work, "push", "-q", bare, "pkg-m");
      await git(bare, "update-server-info");

      // cold cache from the lockfile: must install the locked commit, not the tip
      await Bun.$`rm -rf ${join(project, "node_modules")}`;
      const { stderr, exitCode } = await runInstall(
        project,
        join(root, "cache-cold"),
        {},
        "--frozen-lockfile",
        `--linker=${linker}`,
      );
      expect(stderr).not.toContain("error:");
      expect(await installedVersionOf(project, "@scope/pkg-m")).toBe("pkg-m");
      expect(await installedVersionOf(project, "@scope/pkg-n")).toBe("pkg-n");
      expect(exitCode).toBe(0);
    },
    30_000,
  );
}

// issue #35420 bug 3: `git+file://` dependencies never cloned at all — the
// clone task recognized neither an https nor an ssh URL and finished without
// running git, leaving a poisoned repo handle behind.
test.concurrent("installs a git+file:// dependency", async () => {
  using dir = tempDir("git-dep-file", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "@scope/pkg-b", branch: "pkg-b" }]);

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

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "@scope/pkg-b")).toBe("pkg-b");
  expect(exitCode).toBe(0);
});

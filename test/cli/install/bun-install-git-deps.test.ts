// Tests for installing git dependencies that live in ONE repository as
// multiple branches (issue #35420), `git+file://` dependencies,
// tarball-URL / `github:` dependencies that appear both directly and
// transitively (issues #10915, #8501, #11348, #28284), and git / tarball
// packages whose own package.json declares `file:` folder dependencies.
// Everything is local: a bare repo on disk (served over git's dumb HTTP
// protocol by Bun.serve when an http URL is needed) or static tarballs.
import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { lstat, readdir, readlink } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join, resolve } from "path";
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
  /** Files committed next to package.json; an `index.js` entry replaces the default one. */
  files?: Record<string, string>;
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
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: pkg.name, version: "1.0.0", dependencies: pkg.dependencies }, null, 2),
      "index.js": `module.exports = ${JSON.stringify(pkg.branch)};\n`,
      ...pkg.files,
    };
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), contents);
    }
    await git(work, "add", "-A");
    await git(work, "commit", "-q", "-m", pkg.branch, "--no-gpg-sign");
    await git(work, "push", "-q", bare, pkg.branch);
    // `checkout --orphan` keeps the working tree, so the next branch would
    // otherwise inherit this one's files.
    for (const path of Object.keys(files)) rmSync(join(work, path), { force: true });
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

// A git or tarball package whose own package.json declares `file:` folder
// dependencies (the shape registry packages publish too, see
// registry/packages/file-dep). The paths are relative to the package, which is
// extracted into the cache, so resolving them against the project dir turned
// them into paths into the cache that were then rejected for escaping the
// declaring package:
//   error: Could not find package.json for "file:../<cache>/@T@.../sub" dependency "sub"
//   error: sub@file:./sub failed to resolve
// Registry packages keep the path as declared; git and tarball packages must too.
const FILE_DEPS_NAME = "has-file-deps";

// `file:` folder dependencies on a subfolder, on the package itself, and on a
// folder that is not part of the package.
const fileDepsManifest = {
  name: FILE_DEPS_NAME,
  version: "1.0.0",
  dependencies: {
    "sub": "file:./sub",
    [`${FILE_DEPS_NAME}-self`]: "file:.",
    "gone": "file:./not-in-package",
  },
};

const fileDepsFiles = {
  "index.js": `module.exports = require("sub");\n`,
  "sub/package.json": JSON.stringify({ name: "sub", version: "1.0.0" }),
  "sub/index.js": `module.exports = "sub-ok";\n`,
};

// Writes `<root>/work/package/` and packs it into `tarball`, a `.tgz` path.
async function packTarball(root: string, tarball: string, manifest: object, files: Record<string, string>) {
  const pkgDir = join(root, "work", "package");
  for (const [path, contents] of Object.entries({ "package.json": JSON.stringify(manifest), ...files })) {
    mkdirSync(dirname(join(pkgDir, path)), { recursive: true });
    writeFileSync(join(pkgDir, path), contents);
  }
  mkdirSync(dirname(tarball), { recursive: true });
  await run(root, ["tar", "-czf", tarball, "-C", join(root, "work"), "package"], "tar");
}

function writeProject(root: string, dependencies: Record<string, string>): string {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "project", version: "1.0.0", dependencies }));
  return project;
}

async function linkedJson(link: string) {
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
  return Bun.file(resolve(dirname(link), await readlink(link))).json();
}

async function expectFileDepsInstalled(project: string) {
  const name = FILE_DEPS_NAME;
  const nested = join(project, "node_modules", name, "node_modules");
  const lockfile = await Bun.file(join(project, "bun.lock")).text();
  expect(lockfile).toContain(`"${name}/sub": ["sub@file:./sub", {}]`);
  expect(lockfile).toContain(`"${name}/${name}-self": ["${name}-self@file:.", {}]`);
  expect(lockfile).toContain(`"${name}/gone": ["gone@file:./not-in-package", {}]`);

  // Transitive folder dependencies are not hoisted: each one is linked file by
  // file into the declaring package's own node_modules, relative to that
  // package. The folder missing from the package is skipped, as it is for a
  // registry package.
  expect((await readdir(nested)).sort()).toEqual([`${name}-self`, "sub"]);
  expect(await linkedJson(join(nested, "sub", "package.json"))).toEqual({ name: "sub", version: "1.0.0" });
  expect(await linkedJson(join(nested, `${name}-self`, "package.json"))).toEqual(fileDepsManifest);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log(require(${JSON.stringify(name)}))`],
    cwd: project,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "sub-ok\n", stderr: "", exitCode: 0 });
}

for (const spec of ["file: path", "http url"] as const) {
  test.concurrent(`installs the file: folder dependencies declared by a tarball package (${spec})`, async () => {
    using dir = tempDir("tarball-file-deps", {});
    const root = String(dir);
    const tarballs = join(root, "tarballs");
    await packTarball(root, join(tarballs, `${FILE_DEPS_NAME}.tgz`), fileDepsManifest, fileDepsFiles);
    await using server = serveStatic(tarballs);
    const project = writeProject(root, {
      [FILE_DEPS_NAME]:
        spec === "file: path"
          ? `file:../tarballs/${FILE_DEPS_NAME}.tgz`
          : `http://localhost:${server.port}/${FILE_DEPS_NAME}.tgz`,
    });

    const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await expectFileDepsInstalled(project);

    // The stub rows written to bun.lock install again without re-resolving.
    rmSync(join(project, "node_modules"), { recursive: true });
    const frozen = await runInstall(project, join(root, "cache"), {}, "--frozen-lockfile");
    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
    await expectFileDepsInstalled(project);
  });
}

test.concurrent(
  "installs the file: folder dependencies declared by a git dependency",
  async () => {
    using dir = tempDir("git-dep-file-deps", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [
      { name: FILE_DEPS_NAME, branch: "main", dependencies: fileDepsManifest.dependencies, files: fileDepsFiles },
    ]);
    const project = writeProject(root, { [FILE_DEPS_NAME]: `git+${pathToFileURL(bare)}#main` });

    const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await expectFileDepsInstalled(project);
  },
  30_000,
);

test.concurrent("rejects a file: folder dependency of a tarball package that points outside of it", async () => {
  using dir = tempDir("tarball-escaping-file-dep", {
    "outside/package.json": JSON.stringify({ name: "outside", version: "1.0.0" }),
  });
  const root = String(dir);
  const tarball = join(root, "tarballs", "escaping.tgz");
  await packTarball(
    root,
    tarball,
    { name: "escaping", version: "1.0.0", dependencies: { outside: "file:../outside" } },
    {},
  );
  const project = writeProject(root, { escaping: `file:../tarballs/escaping.tgz` });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(stderr).toContain('error: Could not find package.json for "file:../outside" dependency "outside"');
  expect(stderr).toContain("error: outside@file:../outside failed to resolve");
  expect(await Bun.file(join(project, "node_modules", "outside", "package.json")).exists()).toBe(false);
  expect(
    await Bun.file(join(project, "node_modules", "escaping", "node_modules", "outside", "package.json")).exists(),
  ).toBe(false);
  expect(exitCode).toBe(1);
});

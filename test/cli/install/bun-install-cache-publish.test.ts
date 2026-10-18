// A package is extracted (or patched) in a directory of its own under the install's
// temp dir and renamed into the cache once it is complete. The first writer of a
// cache entry wins: an install that finds the entry taken keeps what is there,
// unless that is incomplete, and deletes its own copy. Whatever happens, nothing
// stays in the temp dir.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, readdirSorted, tempDir } from "harness";
import { rm } from "node:fs/promises";
import { join } from "node:path";

type Tarball = { tgz: Uint8Array; integrity: string };

function withIntegrity(tgz: Uint8Array): Tarball {
  return { tgz, integrity: `sha512-${new Bun.CryptoHasher("sha512").update(tgz).digest("base64")}` };
}

// `fileCount` files make extracting and linking the package take long enough for
// concurrent installs to meet in them.
async function packageTarball(name: string, fileCount: number): Promise<Tarball> {
  const entries: Record<string, string> = { "package/package.json": JSON.stringify({ name, version: "1.0.0" }) };
  for (let i = 0; i < fileCount; i++) entries[`package/files/f${i}.txt`] = `${name} ${i}\n`;
  return withIntegrity(await new Bun.Archive(entries, { compress: "gzip" }).bytes());
}

// Version 1.0.0 of each package: the packument at /<name>, the tarball at /<name>.tgz.
function serveRegistry(packages: Record<string, Tarball>) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const { origin, pathname } = new URL(req.url);
      const name = pathname.slice(1).replace(/\.tgz$/, "");
      const pkg = packages[name];
      if (!pkg) return new Response("not found", { status: 404 });
      if (pathname.endsWith(".tgz")) return new Response(pkg.tgz);
      const dist = { tarball: `${origin}/${name}.tgz`, integrity: pkg.integrity };
      return Response.json({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name, version: "1.0.0", dist } },
      });
    },
  });
}

// `<root>/proj<i>` for each i below `projects`, all with the same package.json, plus
// the `cache` and `tmp` directories that they share.
function scaffold(
  prefix: string,
  registry: URL,
  packageJson: object,
  projects = 1,
  files: Record<string, string> = {},
) {
  const tree: Record<string, string> = { "tmp/.keep": "", "cache/.keep": "" };
  for (let i = 0; i < projects; i++) {
    tree[`proj${i}/package.json`] = JSON.stringify({ name: "proj", version: "1.0.0", ...packageJson });
    tree[`proj${i}/bunfig.toml`] = `[install]\nregistry = "${registry}"\n`;
    for (const [path, contents] of Object.entries(files)) tree[`proj${i}/${path}`] = contents;
  }
  const dir = tempDir(prefix, tree);
  const root = String(dir);
  return {
    [Symbol.dispose]: () => dir[Symbol.dispose](),
    projects: Array.from({ length: projects }, (_, i) => join(root, `proj${i}`)),
    cache: join(root, "cache"),
    tmp: join(root, "tmp"),
  };
}

async function install(cwd: string, { cache, tmp }: { cache: string; tmp: string }, env: NodeJS.Dict<string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted", "--backend=copyfile"],
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache, BUN_TMPDIR: tmp, ...env },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

const ok = { stderr: expect.not.stringContaining("error:"), exitCode: 0 };

// Several rounds of `s.projects.length` installs that start together with an empty cache.
async function raceInstalls(s: ReturnType<typeof scaffold>, rounds: number, env: NodeJS.Dict<string> = {}) {
  for (let round = 0; round < rounds; round++) {
    await Promise.all([
      rm(s.cache, { recursive: true, force: true }),
      ...s.projects.flatMap(project => [
        rm(join(project, "node_modules"), { recursive: true, force: true }),
        rm(join(project, "bun.lock"), { force: true }),
      ]),
    ]);
    expect(await Promise.all(s.projects.map(project => install(project, s, env)))).toEqual(s.projects.map(() => ok));
  }
}

// issues #33977, #28062
test.concurrent("concurrent installs that share a cache all succeed and leave nothing in the temp dir", async () => {
  const packages: Record<string, Tarball> = {};
  for (let i = 0; i < 6; i++) packages[`raced-${i}`] = await packageTarball(`raced-${i}`, 60);
  await using server = serveRegistry(packages);
  const dependencies = Object.fromEntries(Object.keys(packages).map(name => [name, "1.0.0"]));
  using s = scaffold("cache-publish-race", server.url, { dependencies }, 3);

  await raceInstalls(s, 3);
  expect(await readdirSorted(s.tmp)).toEqual([".keep"]);
});

test.concurrent("a tarball that fails to extract leaves nothing in the temp dir", async () => {
  // The integrity holds, so what fails is the extraction, after the directory was made.
  await using server = serveRegistry({ corrupt: withIntegrity(Buffer.from("this is not a gzipped tarball")) });
  using s = scaffold("cache-publish-corrupt", server.url, { dependencies: { corrupt: "1.0.0" } });

  const { stderr, exitCode } = await install(s.projects[0], s);
  expect(stderr).toContain("corrupt");
  expect(await readdirSorted(s.tmp)).toEqual([".keep"]);
  expect(exitCode).toBe(1);
});

test.concurrent("a patch that fails to apply leaves nothing in the temp dir", async () => {
  await using server = serveRegistry({ patched: await packageTarball("patched", 3) });
  using s = scaffold(
    "cache-publish-patch",
    server.url,
    { dependencies: { patched: "1.0.0" }, patchedDependencies: { "patched@1.0.0": "patches/patched.patch" } },
    1,
    {
      // Parses, but names a file that the package does not have.
      "patches/patched.patch": [
        "diff --git a/missing.txt b/missing.txt",
        "index 0000000..1111111 100644",
        "--- a/missing.txt",
        "+++ b/missing.txt",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    },
  );

  const { stderr, exitCode } = await install(s.projects[0], s);
  expect(stderr).toContain("failed applying patch file");
  expect(await readdirSorted(s.tmp)).toEqual([".keep"]);
  expect(exitCode).toBe(1);
});

test.concurrent("concurrent installs that apply the same patch leave nothing in the temp dir", async () => {
  await using server = serveRegistry({ patched: await packageTarball("patched", 60) });
  using s = scaffold(
    "cache-publish-patch-race",
    server.url,
    { dependencies: { patched: "1.0.0" }, patchedDependencies: { "patched@1.0.0": "patches/patched.patch" } },
    3,
    {
      "patches/patched.patch": [
        "diff --git a/files/f0.txt b/files/f0.txt",
        "--- a/files/f0.txt",
        "+++ b/files/f0.txt",
        "@@ -1 +1 @@",
        "-patched 0",
        "+changed",
        "",
      ].join("\n"),
    },
  );

  await raceInstalls(s, 3);
  for (const project of s.projects) {
    expect(await Bun.file(join(project, "node_modules", "patched", "files", "f0.txt")).text()).toBe("changed\n");
  }
  expect(await readdirSorted(s.tmp)).toEqual([".keep"]);
});

test.concurrent("an incomplete cache entry is replaced, not kept", async () => {
  await using server = serveRegistry({ healed: await packageTarball("healed", 3) });
  using s = scaffold("cache-publish-heal", server.url, { dependencies: { healed: "1.0.0" } });
  const [project] = s.projects;
  expect(await install(project, s)).toEqual(ok);

  const [entry] = (await readdirSorted(s.cache)).filter(name => name.startsWith("healed@"));
  await Promise.all([
    rm(join(s.cache, entry, "package.json")),
    Bun.write(join(s.cache, entry, "stale.txt"), "not in the tarball"),
    rm(join(project, "node_modules"), { recursive: true }),
  ]);

  expect(await install(project, s)).toEqual(ok);
  expect(await readdirSorted(join(s.cache, entry))).toEqual(["files", "package.json"]);
  expect(await readdirSorted(join(project, "node_modules", "healed"))).toEqual(["files", "package.json"]);
  expect(await readdirSorted(s.tmp)).toEqual([".keep"]);
});

// issue #36227. NFS and FUSE have no renameat2(RENAME_EXCHANGE). An install that found
// its entry taken then deleted the entry in place, under the install that was copying it
// into node_modules: "ENOENT: failed copying files from cache to destination".
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
// bun-musl is statically linked: LD_PRELOAD cannot load the shim.
const canShim = isLinux && !isMusl && !!cc;
let shimDir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!canShim) return;
  shimDir = tempDir("cache-publish-shim", {
    // Covers glibc's wrapper and `syscall()`, which bun calls.
    "shim.c": /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <sys/syscall.h>
#include <unistd.h>

#define RENAME_EXCHANGE_FLAG (1 << 1)

long syscall(long number, ...) {
  static long (*real_syscall)(long, ...);
  if (!real_syscall) real_syscall = (long (*)(long, ...))dlsym(RTLD_NEXT, "syscall");
  va_list ap;
  va_start(ap, number);
  long a = va_arg(ap, long), b = va_arg(ap, long), c = va_arg(ap, long);
  long d = va_arg(ap, long), e = va_arg(ap, long), f = va_arg(ap, long);
  va_end(ap);
  if (number == SYS_renameat2 && (e & RENAME_EXCHANGE_FLAG)) {
    errno = EOPNOTSUPP;
    return -1;
  }
  return real_syscall(number, a, b, c, d, e, f);
}

int renameat2(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, unsigned int flags) {
  return (int)syscall(SYS_renameat2, (long)olddirfd, (long)oldpath, (long)newdirfd, (long)newpath, (long)flags);
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
    cwd: String(shimDir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`compiling the shim failed: ${stderr}`);
});

afterAll(() => shimDir?.[Symbol.dispose]());

test.skipIf(!canShim)("concurrent installs that share a cache succeed without RENAME_EXCHANGE", async () => {
  await using server = serveRegistry({ raced: await packageTarball("raced", 600) });
  using s = scaffold("cache-publish-nfs", server.url, { dependencies: { raced: "1.0.0" } }, 4);

  const shim = join(String(shimDir), "shim.so");
  await raceInstalls(s, 3, { LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim });
  expect(await readdirSorted(s.tmp)).toEqual([".keep"]);
});

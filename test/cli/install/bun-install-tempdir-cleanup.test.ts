// https://github.com/oven-sh/bun/issues/33977
// `bun install` must not leave package-extraction temp directories behind in
// the install temp dir ($BUN_TMPDIR / $TMPDIR): neither when two concurrent
// installs race the same cache entry (the RENAME_EXCHANGE fallback used to
// strand the loser's copy), nor when extraction or patching fails partway.

import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isLinux, readdirSorted, tempDir } from "harness";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

setDefaultTimeout(1000 * 60 * 5);

// ---------------------------------------------------------------------------
// Minimal in-process tarball + registry helpers (no binary fixtures).
// ---------------------------------------------------------------------------

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function tarHeader(name: string, size: number, type: "0" | "5"): Buffer {
  const buf = Buffer.alloc(512, 0);
  buf.write(name, 0, 100, "utf8");
  buf.write(octal(0o644, 8), 100); // mode
  buf.write(octal(0, 8), 108); // uid
  buf.write(octal(0, 8), 116); // gid
  buf.write(octal(size, 12), 124); // size
  buf.write(octal(0, 12), 136); // mtime
  buf.fill(" ", 148, 156); // checksum placeholder
  buf.write(type, 156);
  buf.write("ustar\0", 257);
  buf.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(octal(sum, 8), 148);
  return buf;
}

function pad512(len: number): Buffer {
  return Buffer.alloc((512 - (len % 512)) % 512, 0);
}

function buildTarball(entries: { path: string; body: Buffer }[]): { tgz: Buffer; integrity: string } {
  const blocks: Buffer[] = [];
  for (const { path, body } of entries) {
    blocks.push(tarHeader(`package/${path}`, body.length, "0"), body, pad512(body.length));
  }
  blocks.push(Buffer.alloc(1024, 0)); // end-of-archive
  const tgz = gzipSync(Buffer.concat(blocks));
  return { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") };
}

// A package with enough files that extraction takes long enough for two
// concurrent installs to reliably race the same cache entry.
function makePackageTarball(name: string, fileCount: number) {
  const entries = [{ path: "package.json", body: Buffer.from(JSON.stringify({ name, version: "1.0.0" }) + "\n") }];
  for (let i = 0; i < fileCount; i++) {
    // Incompressible content so gzip can't collapse the files away.
    const body = Buffer.alloc(1024);
    let seed = createHash("sha256").update(`${name}-${i}`).digest();
    for (let off = 0; off < body.length; off += 32) {
      seed.copy(body, off);
      seed = createHash("sha256").update(seed).digest();
    }
    entries.push({ path: `files/f${i}.bin`, body });
  }
  return buildTarball(entries);
}

// Serves packuments at /<name> and tarballs at /<name>/-/<name>-1.0.0.tgz.
function makeRegistry(packages: Record<string, { tgz: Buffer; integrity: string }>) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      for (const [name, { tgz, integrity }] of Object.entries(packages)) {
        if (pathname === `/${name}`) {
          return Response.json({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name,
                version: "1.0.0",
                dist: {
                  integrity,
                  tarball: `${server.url}${name}/-/${name}-1.0.0.tgz`,
                },
              },
            },
          });
        }
        if (pathname === `/${name}/-/${name}-1.0.0.tgz`) {
          return new Response(tgz);
        }
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

async function runInstall(
  cwd: string,
  cacheDir: string,
  tmpDir: string,
  extraArgs: string[] = ["--no-save"],
  wrapper: string[] = [],
) {
  await using proc = Bun.spawn({
    cmd: [...wrapper, bunExe(), "install", "--linker=hoisted", ...extraArgs],
    cwd,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: cacheDir,
      BUN_TMPDIR: tmpDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("concurrent installs sharing a cache do not leak temp directories", async () => {
  const packageCount = 8;
  const packages: Record<string, { tgz: Buffer; integrity: string }> = {};
  for (let i = 0; i < packageCount; i++) {
    packages[`leaky-pkg-${i}`] = makePackageTarball(`leaky-pkg-${i}`, 150);
  }
  using server = makeRegistry(packages);

  const dependencies = Object.fromEntries(Object.keys(packages).map(name => [name, "1.0.0"]));
  const files: Record<string, string> = { "tmp/.keep": "", "cache/.keep": "" };
  for (const proj of ["proj1", "proj2"]) {
    files[`${proj}/package.json`] = JSON.stringify({ name: proj, version: "1.0.0", dependencies });
    files[`${proj}/bunfig.toml`] = `[install]\nregistry = "${server.url}"\n`;
  }
  using dir = tempDir("tempdir-leak", files);
  const tmpDir = join(String(dir), "tmp");
  const cacheDir = join(String(dir), "cache");

  for (let iteration = 0; iteration < 5; iteration++) {
    // Evict the cache so both installs extract (and race) every package again.
    await Promise.all([
      rm(cacheDir, { recursive: true, force: true }),
      rm(join(String(dir), "proj1", "node_modules"), { recursive: true, force: true }),
      rm(join(String(dir), "proj2", "node_modules"), { recursive: true, force: true }),
    ]);

    const [r1, r2] = await Promise.all([
      runInstall(join(String(dir), "proj1"), cacheDir, tmpDir),
      runInstall(join(String(dir), "proj2"), cacheDir, tmpDir),
    ]);
    expect({ stderr: r1.stderr, exitCode: r1.exitCode }).toMatchObject({ exitCode: 0 });
    expect({ stderr: r2.stderr, exitCode: r2.exitCode }).toMatchObject({ exitCode: 0 });
  }

  expect(await readdirSorted(tmpDir)).toEqual([".keep"]);
});

// usage: fail-renameat2 <errno> <flags|always> <cmd> [args...]
// Installs a seccomp filter that fails renameat2() with <errno>, then execs
// <cmd>. "flags": only calls with a flag set fail. "always": every call fails.
// renameat() and rename() are not filtered. Exit code 77: the filter could not
// be installed.
const failRenameat2Src = /* c */ `
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
  #define MY_AUDIT_ARCH 0
#endif

int main(int argc, char **argv) {
  if (argc < 4) return 2;
  if (MY_AUDIT_ARCH == 0) return 77;
  unsigned int err = (unsigned int)atoi(argv[1]);
  /* 1: a call with flags == 0 fails too */
  unsigned char always = strcmp(argv[2], "always") == 0;

  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_renameat2, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    /* flags: fifth argument, low word (both arches are little-endian) */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[4])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, always, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (err & SECCOMP_RET_DATA)),
  };
  struct sock_fprog prog = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = filter,
  };

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return 77;
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) != 0) return 77;
  /* Without the filter this fails with ENOENT (empty paths). */
  if (syscall(__NR_renameat2, AT_FDCWD, "", AT_FDCWD, "", 1) != -1 || errno != (int)err) return 77;

  execvp(argv[3], &argv[3]);
  perror("execvp");
  return 127;
}
`;

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Linux errno values, the same on x86_64 and aarch64.
const renameat2Failures = [
  // A filesystem whose rename handler takes no flags: NFS, 9p, FUSE without FUSE_RENAME2.
  ["EINVAL", 22, "flags"],
  // A kernel older than 3.15 has no renameat2.
  ["ENOSYS", 38, "always"],
  // A seccomp profile older than the call.
  ["EPERM", 1, "always"],
] as const;

test.skipIf(!isLinux || !cc).concurrent.each(renameat2Failures)(
  "concurrent installs sharing a cache all succeed when renameat2 fails with %s",
  async (_name, errno, scope) => {
    const fileCount = 20;
    const packages: Record<string, { tgz: Buffer; integrity: string }> = {};
    for (let i = 0; i < 4; i++) {
      packages[`noflags-pkg-${i}`] = makePackageTarball(`noflags-pkg-${i}`, fileCount);
    }
    using server = makeRegistry(packages);

    const projects = ["proj1", "proj2", "proj3", "proj4"];
    const dependencies = Object.fromEntries(Object.keys(packages).map(name => [name, "1.0.0"]));
    const files: Record<string, string> = {
      "tmp/.keep": "",
      "cache/.keep": "",
      "fail-renameat2.c": failRenameat2Src,
    };
    for (const proj of projects) {
      files[`${proj}/package.json`] = JSON.stringify({ name: proj, version: "1.0.0", dependencies });
      files[`${proj}/bunfig.toml`] = `[install]\nregistry = "${server.url}"\n`;
    }
    using dir = tempDir("tempdir-renameat2", files);
    const tmpDir = join(String(dir), "tmp");
    const cacheDir = join(String(dir), "cache");
    const helper = join(String(dir), "fail-renameat2");

    {
      await using compile = Bun.spawn({
        cmd: [cc!, "-O0", "-o", helper, join(String(dir), "fail-renameat2.c")],
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([compile.stderr.text(), compile.exited]);
      // No kernel headers on this host: nothing to run.
      if (exitCode !== 0 && /linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return;
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }

    for (let iteration = 0; iteration < 2; iteration++) {
      await Promise.all([
        rm(cacheDir, { recursive: true, force: true }),
        ...projects.map(proj => rm(join(String(dir), proj, "node_modules"), { recursive: true, force: true })),
      ]);

      const results = await Promise.all(
        projects.map(proj =>
          runInstall(join(String(dir), proj), cacheDir, tmpDir, ["--no-save"], [helper, String(errno), scope]),
        ),
      );
      // The sandbox does not allow a seccomp filter: nothing to run.
      if (results.some(r => r.exitCode === 77)) return;

      for (const { stderr, exitCode } of results) {
        expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
      }
      // An install that read a cache entry while another install deleted it
      // can exit 0 with files missing.
      for (const proj of projects) {
        for (const name of Object.keys(packages)) {
          const installed = join(String(dir), proj, "node_modules", name);
          expect(await readdirSorted(installed)).toEqual(["files", "package.json"]);
          expect(await readdirSorted(join(installed, "files"))).toHaveLength(fileCount);
        }
      }
    }

    expect(await readdirSorted(tmpDir)).toEqual([".keep"]);
  },
);

test.concurrent("a tarball that fails to extract does not leak its temp directory", async () => {
  // Valid integrity (computed over the bytes) but not a gzip stream, so the
  // failure happens during extraction, after the temp dir was created.
  const tgz = Buffer.from("this is definitely not a gzipped tarball");
  using server = makeRegistry({
    "corrupt-pkg": { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") },
  });

  using dir = tempDir("tempdir-leak-corrupt", {
    "proj/package.json": JSON.stringify({
      name: "proj",
      version: "1.0.0",
      dependencies: { "corrupt-pkg": "1.0.0" },
    }),
    "proj/bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
    "tmp/.keep": "",
    "cache/.keep": "",
  });
  const tmpDir = join(String(dir), "tmp");

  const { stderr, exitCode } = await runInstall(join(String(dir), "proj"), join(String(dir), "cache"), tmpDir);
  expect(stderr).toContain("corrupt-pkg");

  expect(await readdirSorted(tmpDir)).toEqual([".keep"]);
  expect(exitCode).not.toBe(0);
});

test.concurrent("a patch that fails to apply does not leak its temp directory", async () => {
  using server = makeRegistry({ "patched-pkg": makePackageTarball("patched-pkg", 3) });

  // Parses fine, but targets a file the package doesn't contain.
  const patch = [
    "diff --git a/missing.txt b/missing.txt",
    "index 0000000..1111111 100644",
    "--- a/missing.txt",
    "+++ b/missing.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  using dir = tempDir("tempdir-leak-patch", {
    "proj/package.json": JSON.stringify({
      name: "proj",
      version: "1.0.0",
      dependencies: { "patched-pkg": "1.0.0" },
      patchedDependencies: { "patched-pkg@1.0.0": "patches/patched-pkg.patch" },
    }),
    "proj/patches/patched-pkg.patch": patch,
    "proj/bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
    "tmp/.keep": "",
    "cache/.keep": "",
  });
  const tmpDir = join(String(dir), "tmp");

  const { stderr, exitCode } = await runInstall(join(String(dir), "proj"), join(String(dir), "cache"), tmpDir);
  expect(stderr).toContain("failed applying patch file");

  expect(await readdirSorted(tmpDir)).toEqual([".keep"]);
  expect(exitCode).not.toBe(0);
});

test.concurrent("re-extracting replaces an invalid cache entry", async () => {
  using server = makeRegistry({ "heal-pkg": makePackageTarball("heal-pkg", 3) });

  using dir = tempDir("tempdir-leak-heal", {
    "proj/package.json": JSON.stringify({
      name: "proj",
      version: "1.0.0",
      dependencies: { "heal-pkg": "1.0.0" },
    }),
    "proj/bunfig.toml": `[install]\nregistry = "${server.url}"\n`,
    "tmp/.keep": "",
    "cache/.keep": "",
  });
  const tmpDir = join(String(dir), "tmp");
  const cacheDir = join(String(dir), "cache");
  const proj = join(String(dir), "proj");

  // Save a lockfile: with one, the reinstall below skips re-resolution and
  // relies on the package.json-exists cache check that triggers re-extract.
  const first = await runInstall(proj, cacheDir, tmpDir, []);
  expect(first.exitCode).toBe(0);

  const [cacheEntry] = (await readdirSorted(cacheDir)).filter(name => name.startsWith("heal-pkg@"));
  expect(cacheEntry).toBeDefined();

  // A cache entry without package.json is invalid; a reinstall whose
  // node_modules copy also fails verification must replace it, not keep it.
  await Promise.all([
    rm(join(cacheDir, cacheEntry, "package.json")),
    rm(join(proj, "node_modules", "heal-pkg", "package.json")),
  ]);

  const second = await runInstall(proj, cacheDir, tmpDir, []);
  expect(await readdirSorted(join(cacheDir, cacheEntry))).toContain("package.json");
  expect(await readdirSorted(join(proj, "node_modules", "heal-pkg"))).toContain("package.json");
  expect(await readdirSorted(tmpDir)).toEqual([".keep"]);
  expect(second.exitCode).toBe(0);
});

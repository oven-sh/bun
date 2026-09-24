import { expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isMacOS, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";

// Linux returns EPERM from unlink for a file of another user in a sticky
// directory, and for an immutable file. Both need privileges to set up, so an
// LD_PRELOAD shim returns it for every name that contains "held".
// bun-musl is statically linked, so LD_PRELOAD cannot intercept unlinkat there.
const cc = isLinux && !isMusl ? Bun.which("cc") || Bun.which("gcc") || Bun.which("clang") : null;
const shimC = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <string.h>

int unlinkat(int dirfd, const char *path, int flags) {
  const char *base = strrchr(path, '/');
  base = base ? base + 1 : path;
  if (flags == 0 && strstr(base, "held")) {
    errno = EPERM;
    return -1;
  }
  int (*real)(int, const char *, int) = dlsym(RTLD_NEXT, "unlinkat");
  return real(dirfd, path, flags);
}
`;

async function envWithUnlinkShim(dir: string): Promise<NodeJS.Dict<string>> {
  writeFileSync(join(dir, "shim.c"), shimC);
  await using compile = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
  if (exitCode !== 0) throw new Error(`shim compile failed: ${out}${err}`);
  return { ...bunEnv, LD_PRELOAD: [join(dir, "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":") };
}

// When `bun install` replaces a package, it renames node_modules/<pkg> to
// .old-<hex> and removes that directory on a worker thread. A file in it that
// unlink cannot remove (EPERM) must fail the removal, not hang the install.
// Windows: the last hard link of a running executable. macOS: a `uchg` file.
test.skipIf(!isWindows && !isMacOS && !cc)(
  "bun install finishes when the replaced package holds a file that cannot be unlinked",
  async () => {
    using dir = tempDir("issue-43831", {
      "dep-v1/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "dep-v2/package.json": JSON.stringify({ name: "dep", version: "2.0.0" }),
      "proj/package.json": JSON.stringify({ name: "proj", dependencies: { dep: "file:../dep-v1" } }),
    });
    const proj = join(String(dir), "proj");
    const nodeModules = join(proj, "node_modules");

    // The unfixed install never exits, so the test runner's timeout fails it.
    async function install(env = bunEnv): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: proj,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const first = await install();
    expect(first.stderr).not.toContain("error");
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(nodeModules, "dep", "package.json"), "utf8")).version).toBe("1.0.0");

    const held = join(nodeModules, "dep", isWindows ? "held.exe" : "held");
    let heldProc: Bun.Subprocess | undefined;
    try {
      if (isWindows) {
        // A copy has one hard link. While it runs, NTFS refuses to delete it.
        // `pause` blocks on stdin until the pipe closes.
        copyFileSync(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe", held);
        heldProc = Bun.spawn({
          cmd: [held, "/c", "pause"],
          cwd: String(dir),
          env: bunEnv,
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        });
      } else {
        writeFileSync(held, "locked");
        if (isMacOS) expect(spawnSync("chflags", ["uchg", held]).status).toBe(0);
      }

      await Bun.write(
        join(proj, "package.json"),
        JSON.stringify({ name: "proj", dependencies: { dep: "file:../dep-v2" } }),
      );

      const second = await install(isLinux ? await envWithUnlinkShim(String(dir)) : bunEnv);
      if (heldProc) expect(heldProc.exitCode).toBeNull();
      expect(second.stderr).not.toContain("error");
      expect(second.stdout).toContain("dep@../dep-v2");
      expect(second.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(join(nodeModules, "dep", "package.json"), "utf8")).version).toBe("2.0.0");
      expect(readFileSync(join(proj, "bun.lock"), "utf8")).toContain("dep-v2");
      // The removal stopped at the locked file instead of spinning on it.
      const old = readdirSync(nodeModules).filter(name => name.startsWith(".old-"));
      expect(old).toHaveLength(1);
      expect(existsSync(join(nodeModules, old[0], isWindows ? "held.exe" : "held"))).toBe(true);
    } finally {
      if (heldProc) {
        heldProc.kill();
        await heldProc.exited;
      }
      if (isMacOS) {
        // Unlock the file wherever it ended up, so the temp dir can be removed.
        for (const name of readdirSync(nodeModules)) {
          if (name === "dep" || name.startsWith(".old-")) {
            spawnSync("chflags", ["nouchg", join(nodeModules, name, "held")]);
          }
        }
      }
    }
  },
);

// The install above fails on an entry inside the tree. `bun pm cache rm` passes
// each `bunx-<uid>-*` name in TMPDIR to delete_tree as the top-level path, which
// is a separate unlink-then-open loop.
test.skipIf(!isMacOS && !cc)("bun pm cache rm reports a bunx entry that cannot be unlinked", async () => {
  const name = `bunx-${process.getuid!()}-held`;
  using dir = tempDir("issue-43831-top-level", {
    "package.json": JSON.stringify({ name: "proj", version: "1.0.0" }),
    "cache/cached.txt": "cached",
    [`tmp/${name}`]: "locked",
  });
  const held = join(String(dir), "tmp", name);
  if (isMacOS) expect(spawnSync("chflags", ["uchg", held]).status).toBe(0);
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "cache", "rm"],
      cwd: String(dir),
      env: {
        ...(isLinux ? await envWithUnlinkShim(String(dir)) : bunEnv),
        BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
        TMPDIR: join(String(dir), "tmp"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(`EPERM: Operation not permitted: Could not delete ${name}`);
    expect(stdout).toContain("Cleared 'bun install' cache");
    expect(existsSync(held)).toBe(true);
    expect(exitCode).toBe(1);
  } finally {
    if (isMacOS) spawnSync("chflags", ["nouchg", held]);
  }
});

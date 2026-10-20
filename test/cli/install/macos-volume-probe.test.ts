// TEMPORARY. Runs `bun install` on real HFS+ and exFAT disk images with the cache on the same volume, and counts the
// clonefileat calls of an install. This file does not stay: it mounts disk images.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("clang");

// Writes one line to CLONE_LOG for each clonefileat call: "cloned" or "failed" for a real call, and with
// REFUSE_CLONEFILEAT set "refused" (ENOTSUP) or "early" (the lookup answered first, as in the kernel).
const countC = /* c */ `
  #include <errno.h>
  #include <fcntl.h>
  #include <limits.h>
  #include <stdint.h>
  #include <stdio.h>
  #include <stdlib.h>
  #include <string.h>
  #include <sys/clonefile.h>
  #include <sys/stat.h>
  #include <unistd.h>

  static int note(const char *what, int rc, int error) {
    const char *log = getenv("CLONE_LOG");
    int fd = log ? open(log, O_WRONLY | O_CREAT | O_APPEND, 0644) : -1;
    if (fd >= 0) {
      dprintf(fd, "%s\\n", what);
      close(fd);
    }
    errno = error;
    return rc;
  }

  static int counting_clonefileat(int src_dirfd, const char *src, int dst_dirfd, const char *dst, uint32_t flags) {
    struct stat st;
    char parent[PATH_MAX];
    const char *slash = strrchr(dst, '/');
    if (!getenv("REFUSE_CLONEFILEAT")) {
      int rc = clonefileat(src_dirfd, src, dst_dirfd, dst, flags);
      return note(rc == 0 ? "cloned" : "failed", rc, errno);
    }
    if (fstatat(src_dirfd, src, &st, AT_SYMLINK_NOFOLLOW) != 0) return note("early", -1, errno);
    if (fstatat(dst_dirfd, dst, &st, AT_SYMLINK_NOFOLLOW) == 0) return note("early", -1, EEXIST);
    if (slash && slash != dst && (size_t)(slash - dst) < sizeof(parent)) {
      memcpy(parent, dst, slash - dst);
      parent[slash - dst] = 0;
      if (fstatat(dst_dirfd, parent, &st, 0) != 0) return note("early", -1, errno);
    }
    return note("refused", -1, ENOTSUP);
  }

  __attribute__((used, section("__DATA,__interpose"))) static const struct {
    const void *replacement, *original;
  } interpose[] = {
    {(const void *)counting_clonefileat, (const void *)clonefileat},
  };
`;

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(!isMacOS)(
  "installs on volumes that cannot clone, and the clonefileat calls of an install",
  async () => {
    expect(cc).toBeTruthy();
    using dir = tempDir("volume-probe", { "count.c": countC });
    const root = String(dir);
    const arch = process.arch === "arm64" ? "arm64" : "x86_64";
    expect((await run([cc!, "-arch", arch, "-dynamiclib", "-o", "count.dylib", "count.c"], root)).exitCode).toBe(0);

    // 20 packages, each a tarball that is installed from the cache.
    const packages: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      const name = `p${i}`;
      const source = join(root, "pkgs", name);
      mkdirSync(join(source, "package"), { recursive: true });
      writeFileSync(join(source, "package", "package.json"), JSON.stringify({ name, version: "1.0.0" }));
      writeFileSync(join(source, "package", "index.js"), `module.exports = "${name}";`);
      packages[name] = join(root, "pkgs", `${name}.tgz`);
      const packed = await run(["tar", "-czf", packages[name], "-C", source, "package"], root, {
        ...bunEnv,
        COPYFILE_DISABLE: "1",
      });
      expect(packed.exitCode).toBe(0);
    }
    const baz = { baz: join(import.meta.dir, "baz-0.0.3.tgz") };

    let runs = 0;
    /** Installs `tarballs` (name to path) in a new project in `parent`, with the cache next to it. */
    async function install(
      parent: string,
      linker: string,
      tarballs: Record<string, string>,
      env: Record<string, string> = {},
    ) {
      const id = runs++;
      const projectDir = join(parent, `project-${id}`);
      const log = join(root, `clone-${id}.log`);
      const names = Object.keys(tarballs);
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        join(projectDir, "package.json"),
        JSON.stringify({
          name: "app",
          dependencies: Object.fromEntries(names.map(name => [name, `file:./${name}.tgz`])),
        }),
      );
      for (const name of names) cpSync(tarballs[name], join(projectDir, `${name}.tgz`));
      const { stdout, stderr, exitCode } = await run([bunExe(), "install", `--linker=${linker}`], projectDir, {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(parent, `cache-${id}`),
        DYLD_INSERT_LIBRARIES: join(root, "count.dylib"),
        CLONE_LOG: log,
        ...env,
      });
      console.log(`--- ${projectDir} (${linker}, ${names.length} packages) exit ${exitCode}\n${stdout}\n${stderr}`);
      const calls: Record<string, number> = {};
      for (const line of existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) {
        calls[line] = (calls[line] ?? 0) + 1;
      }
      const installed = join(projectDir, "node_modules", names[0], "index.js");
      const bin = lstatSync(join(projectDir, "node_modules", ".bin", "baz-run"), { throwIfNoEntry: false });
      return {
        exitCode,
        messages: (stderr + "\n" + stdout)
          .split("\n")
          .filter(line => /error|warn|fail/i.test(line))
          .map(line => line.replaceAll(projectDir, "<project>").replaceAll(root, "<root>").trim()),
        nlink: existsSync(installed) ? statSync(installed).nlink : null,
        bin: !bin ? null : bin.isSymbolicLink() ? "symlink" : "file",
        calls,
      };
    }
    type Installed = Awaited<ReturnType<typeof install>>;

    // Real volumes: the kernel refuses the clone.
    const volumes: Record<string, { hoisted: Installed; isolated: Installed } | { error: string }> = {};
    const detach: (() => Promise<unknown>)[] = [];
    try {
      for (const [name, fs] of [
        ["hfs", "HFS+"],
        ["exfat", "ExFAT"],
      ] as const) {
        const volume = join(root, name);
        mkdirSync(volume);
        const image = join(root, `${name}.dmg`);
        const created = await run(
          ["hdiutil", "create", "-size", "48m", "-fs", fs, "-volname", "BUNPROBE", image],
          root,
        );
        const attached =
          created.exitCode === 0
            ? await run(["hdiutil", "attach", image, "-nobrowse", "-mountpoint", volume], root)
            : created;
        if (attached.exitCode !== 0) {
          volumes[name] = { error: `${attached.stdout}${attached.stderr}`.trim() };
          continue;
        }
        detach.push(() => run(["hdiutil", "detach", volume, "-force"], root));
        volumes[name] = {
          hoisted: await install(volume, "hoisted", baz),
          isolated: await install(volume, "isolated", baz),
        };
      }
    } finally {
      for (const fn of detach) await fn();
    }

    // APFS: how many clonefileat calls an install makes, refused and not.
    const apfs = join(root, "apfs");
    mkdirSync(apfs);
    const one = { p0: packages.p0 };
    const refuse = { REFUSE_CLONEFILEAT: "1" };
    const counts: Record<string, { refused1: Installed; refused20: Installed; cloned20: Installed }> = {};
    for (const linker of ["hoisted", "isolated"]) {
      counts[linker] = {
        refused1: await install(apfs, linker, one, refuse),
        refused20: await install(apfs, linker, packages, refuse),
        cloned20: await install(apfs, linker, packages),
      };
    }

    console.log(`macOS ${release()} ${process.arch}\n${JSON.stringify({ volumes, counts }, null, 2)}`);

    const outcome = (result: Installed | undefined) =>
      result && { exitCode: result.exitCode, messages: result.messages, nlink: result.nlink, bin: result.bin };
    expect({
      hfsHoisted: outcome((volumes.hfs as any).hoisted),
      hfsIsolated: outcome((volumes.hfs as any).isolated),
      exfatHoisted: outcome((volumes.exfat as any).hoisted),
      exfatIsolated: outcome((volumes.exfat as any).isolated),
    }).toEqual({
      // A copy.
      hfsHoisted: { exitCode: 0, messages: [], nlink: 1, bin: "symlink" },
      // A hard link to the cache.
      hfsIsolated: { exitCode: 0, messages: [], nlink: 2, bin: "symlink" },
      exfatHoisted: { exitCode: 0, messages: [], nlink: 1, bin: "symlink" },
      // exFAT has no hard links, and the hard link gate does not list ENOTSUP.
      exfatIsolated: {
        exitCode: 1,
        messages: [
          "ENOTSUP: Operation not supported: failed to link package: baz@./baz.tgz (link)",
          "Failed to install 1 package",
        ],
        nlink: null,
        bin: null,
      },
    });
    for (const linker of ["hoisted", "isolated"]) {
      const { refused1, refused20, cloned20 } = counts[linker];
      expect({ linker, exitCodes: [refused1.exitCode, refused20.exitCode, cloned20.exitCode] }).toEqual({
        linker,
        exitCodes: [0, 0, 0],
      });
      expect({ linker, refused: refused1.calls.refused }).toEqual({ linker, refused: 1 });
      // Every thread that starts before the first refusal is stored is refused once.
      expect(refused20.calls.refused).toBeGreaterThanOrEqual(1);
      expect(refused20.calls.refused).toBeLessThanOrEqual(20);
      // A clone that fails with ENOENT and is made again after the parent exists is counted as "failed".
      expect({ linker, cloned: cloned20.calls.cloned }).toEqual({ linker, cloned: 20 });
    }
  },
  300_000,
);

// TEMPORARY. Records the errno that real macOS volumes report for the operations the install backends use, and what
// `bun install` does on those volumes before the fix. This file does not stay: it mounts disk images.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { cpSync, existsSync, lstatSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("clang");

const probeC = /* c */ `
  #include <copyfile.h>
  #include <errno.h>
  #include <fcntl.h>
  #include <stdio.h>
  #include <sys/clonefile.h>
  #include <sys/stat.h>
  #include <unistd.h>

  static void touch(const char *path) {
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) {
      (void)write(fd, "x", 1);
      close(fd);
    }
  }

  #define ERRNO_OF(call) ((call) == 0 ? 0 : errno)

  int main(int argc, char **argv) {
    if (argc < 2 || chdir(argv[1]) != 0) {
      perror("chdir");
      return 1;
    }
    touch("src");
    touch("other");
    mkdir("srcdir", 0755);
    touch("srcdir/file");

    int clonefile_file = ERRNO_OF(clonefile("src", "clone", 0));
    int clonefileat_dir = ERRNO_OF(clonefileat(AT_FDCWD, "srcdir", AT_FDCWD, "clonedir", 0));
    int clonefileat_exists = ERRNO_OF(clonefileat(AT_FDCWD, "src", AT_FDCWD, "other", 0));
    int clonefileat_no_parent = ERRNO_OF(clonefileat(AT_FDCWD, "src", AT_FDCWD, "missing/clone", 0));
    int hardlink = ERRNO_OF(link("src", "hardlink"));
    int symlink_ = ERRNO_OF(symlink("src", "symlink"));
    int rename_excl_free = ERRNO_OF(renameatx_np(AT_FDCWD, "src", AT_FDCWD, "moved", RENAME_EXCL));
    const char *src = rename_excl_free == 0 ? "moved" : "src";
    int rename_excl_taken = ERRNO_OF(renameatx_np(AT_FDCWD, src, AT_FDCWD, "other", RENAME_EXCL));
    int rename_swap = ERRNO_OF(renameatx_np(AT_FDCWD, src, AT_FDCWD, "other", RENAME_SWAP));
    int rename_swap_free = ERRNO_OF(renameatx_np(AT_FDCWD, src, AT_FDCWD, "nothing", RENAME_SWAP));

    int fds[2];
    int fcopyfile_pipe = -1;
    if (pipe(fds) == 0) {
      (void)write(fds[1], "x", 1);
      close(fds[1]);
      int out = open("out", O_WRONLY | O_CREAT | O_TRUNC, 0644);
      fcopyfile_pipe = ERRNO_OF(fcopyfile(fds[0], out, NULL, COPYFILE_DATA));
      close(out);
      close(fds[0]);
    }

    printf("{\\"clonefile_file\\":%d,\\"clonefileat_dir\\":%d,\\"clonefileat_exists\\":%d,\\"clonefileat_no_parent\\":%d,"
           "\\"hardlink\\":%d,\\"symlink\\":%d,\\"rename_excl_free\\":%d,\\"rename_excl_taken\\":%d,\\"rename_swap\\":%d,"
           "\\"rename_swap_free\\":%d,\\"fcopyfile_pipe\\":%d}\\n",
           clonefile_file, clonefileat_dir, clonefileat_exists, clonefileat_no_parent, hardlink, symlink_,
           rename_excl_free, rename_excl_taken, rename_swap, rename_swap_free, fcopyfile_pipe);
    return 0;
  }
`;

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const ENOENT = 2;
const EEXIST = 17;
const ENOTSUP = 45;

// What main is expected to do. Any difference shows in the failure.
const everyOperation = {
  clonefile_file: 0,
  clonefileat_dir: 0,
  clonefileat_exists: EEXIST,
  clonefileat_no_parent: ENOENT,
  hardlink: 0,
  symlink: 0,
  rename_excl_free: 0,
  rename_excl_taken: EEXIST,
  rename_swap: 0,
  rename_swap_free: ENOENT,
  fcopyfile_pipe: ENOTSUP,
};
const copied = { exitCode: 0, messages: [], nlink: 1, bin: "symlink" };
const predicted = {
  apfs: { probe: everyOperation },
  hfs: {
    mount: "hfs",
    probe: { ...everyOperation, clonefile_file: ENOTSUP, clonefileat_dir: ENOTSUP },
    sameVolumeHoisted: {
      exitCode: 1,
      messages: [
        "error: Unexpected: failed copying files from cache to destination for package baz",
        "Failed to install 1 package",
      ],
      nlink: null,
      bin: null,
    },
    sameVolumeIsolated: {
      exitCode: 1,
      messages: ["error: ENOTSUP: Operation not supported: failed to link package: baz@./baz-0.0.3.tgz (clonefile)"],
      nlink: null,
      bin: null,
    },
    cacheOnApfsHoisted: copied,
    cacheOnApfsIsolated: copied,
  },
  exfat: {
    mount: "exfat",
    probe: {
      ...everyOperation,
      clonefile_file: ENOTSUP,
      clonefileat_dir: ENOTSUP,
      hardlink: ENOTSUP,
      symlink: ENOTSUP,
      rename_excl_free: ENOTSUP,
      rename_swap: ENOTSUP,
    },
    sameVolumeHoisted: {
      exitCode: 1,
      messages: [
        "error: Unexpected: failed copying files from cache to destination for package baz",
        "Failed to install 1 package",
      ],
      nlink: null,
      bin: null,
    },
    sameVolumeIsolated: {
      exitCode: 1,
      messages: ["error: ENOTSUP: Operation not supported: failed to link package: baz@./baz-0.0.3.tgz (clonefile)"],
      nlink: null,
      bin: null,
    },
    cacheOnApfsHoisted: { exitCode: 1, messages: ["error: ENOTSUP: failed to link baz"], nlink: 1, bin: null },
    cacheOnApfsIsolated: { exitCode: 1, messages: ["error: ENOTSUP"], nlink: null, bin: null },
  },
};

test.skipIf(!isMacOS)(
  "what macOS volumes report, and what bun install does on them",
  async () => {
    expect(cc).toBeTruthy();
    using dir = tempDir("volume-probe", { "probe.c": probeC });
    const root = String(dir);
    expect((await run([cc!, "-o", "probe", "probe.c"], root)).exitCode).toBe(0);

    async function install(projectDir: string, cacheDir: string, linker: string) {
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        join(projectDir, "package.json"),
        JSON.stringify({ name: "app", dependencies: { baz: "file:./baz-0.0.3.tgz" } }),
      );
      cpSync(join(import.meta.dir, "baz-0.0.3.tgz"), join(projectDir, "baz-0.0.3.tgz"));
      const { stdout, stderr, exitCode } = await run([bunExe(), "install", `--linker=${linker}`], projectDir, {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      });
      console.log(`--- ${projectDir} (${linker}) exit ${exitCode}\n${stdout}\n${stderr}`);
      const installed = join(projectDir, "node_modules", "baz", "index.js");
      const bin = lstatSync(join(projectDir, "node_modules", ".bin", "baz-run"), { throwIfNoEntry: false });
      return {
        exitCode,
        messages: (stderr + "\n" + stdout)
          .split("\n")
          .filter(line => /error|warn|fail/i.test(line))
          .map(line => line.replaceAll(projectDir, "<project>").replaceAll(root, "<root>").trim()),
        nlink: existsSync(installed) ? statSync(installed).nlink : null,
        bin: !bin ? null : bin.isSymbolicLink() ? "symlink" : "file",
      };
    }

    const report: Record<string, unknown> = {};
    const detach: (() => Promise<unknown>)[] = [];
    try {
      for (const [name, fs] of [
        ["apfs", null],
        ["hfs", "HFS+"],
        ["exfat", "ExFAT"],
      ] as const) {
        const volume = join(root, name);
        mkdirSync(volume);
        let mount: string | undefined;
        if (fs) {
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
            report[name] = { error: `${attached.stdout}${attached.stderr}`.trim() };
            continue;
          }
          detach.push(() => run(["hdiutil", "detach", volume, "-force"], root));
          // "/dev/disk4s1 on /private/var/... (hfs, local, ...)"
          mount = (await run(["mount"], root)).stdout
            .split("\n")
            .find(line => line.includes(` on ${volume} (`))
            ?.match(/\((\w+)/)?.[1];
        }

        mkdirSync(join(volume, "probe"));
        const probed = await run([join(root, "probe"), join(volume, "probe")], root);
        const entry: Record<string, unknown> = {
          ...(fs ? { mount } : {}),
          probe: probed.exitCode === 0 ? JSON.parse(probed.stdout) : probed,
        };
        if (fs) {
          entry.sameVolumeHoisted = await install(join(volume, "hoisted"), join(volume, "cache-hoisted"), "hoisted");
          entry.sameVolumeIsolated = await install(
            join(volume, "isolated"),
            join(volume, "cache-isolated"),
            "isolated",
          );
          entry.cacheOnApfsHoisted = await install(
            join(volume, "cross-hoisted"),
            join(root, `cache-${name}-h`),
            "hoisted",
          );
          entry.cacheOnApfsIsolated = await install(
            join(volume, "cross-isolated"),
            join(root, `cache-${name}-i`),
            "isolated",
          );
        }
        report[name] = entry;
      }
    } finally {
      for (const fn of detach) await fn();
    }

    console.log(`macOS ${release()} ${process.arch}\n${JSON.stringify(report, null, 2)}`);
    expect(report).toEqual(predicted);
  },
  300_000,
);

import { Glob } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import * as fs from "node:fs";
import * as path from "node:path";

// usage: keep-open <fd> <cmd> [args...]. Runs the command under a seccomp filter that makes
// close(<fd>) fail with EINTR. The descriptor stays open. Exits 77 where it cannot do that.
const keepOpenSource = /* c */ `
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
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
  if (argc < 3) return 2;
  if (MY_AUDIT_ARCH == 0) return 77;
  unsigned int fd = (unsigned int)atoi(argv[1]);
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_close, 0, 3),
    /* the low word of the first argument (little-endian) */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, fd, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EINTR),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = filter,
  };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return 77;
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) != 0) return 77;
  execvp(argv[2], &argv[2]);
  perror("execvp");
  return 127;
}
`;

let keepOpenDir: Disposable | undefined;
afterAll(() => keepOpenDir?.[Symbol.dispose]());

// The path of the helper. `undefined` where this machine cannot run it: not Linux, no C compiler,
// no kernel headers, or a kernel that does not take the filter.
async function buildKeepOpen(): Promise<string | undefined> {
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  if (!isLinux || !cc) return undefined;
  const dir = tempDir("glob-scan-symlink-keep-open", { "keep-open.c": keepOpenSource });
  keepOpenDir = dir;
  const helper = path.join(String(dir), "keep-open");
  await using compile = Bun.spawn({
    cmd: [cc, "-o", helper, path.join(String(dir), "keep-open.c")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, compileErrors, compiled] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
  if (compiled !== 0) {
    if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(compileErrors)) return undefined;
    throw new Error(`the compiler failed on keep-open.c:\n${compileErrors}`);
  }
  await using probe = Bun.spawn({ cmd: [helper, "63", "true"], env: bunEnv, stdout: "ignore", stderr: "pipe" });
  const [probeErrors, probed] = await Promise.all([probe.stderr.text(), probe.exited]);
  if (probed === 77) return undefined;
  if (probed !== 0) throw new Error(`keep-open exited with code ${probed}:\n${probeErrors}`);
  return helper;
}
const keepOpen = await buildKeepOpen();

// The walker opens the directory that a followed symbolic link leads to. These tests are about a
// link that does not open. POSIX only: Windows has no `ulimit` and no mode that forbids a
// listing, and the walker there handles every link that does not open as a broken link.
describe.skipIf(isWindows)("a followed link that does not open", () => {
  // Each row is a scan of `cwd`, or the error that the scan throws.
  const scanRows = /* js */ `
    const row = scan => {
      try {
        return scan().sort();
      } catch (e) {
        return { code: e.code, syscall: e.syscall, path: e.path };
      }
    };
    const scan = (cwd, pattern, options) => row(() => [...new Bun.Glob(pattern).scanSync({ cwd, ...options })]);
    const everything = { followSymlinks: true, onlyFiles: false };
  `;

  // `ulimit -n` caps the descriptors of the child. The fixture opens /dev/null until none is left
  // and closes one, which the walker takes for the directory it scans. The open of a link then
  // fails with EMFILE whatever the link leads to.
  test("no descriptor left: a directory that has to be listed fails the scan", async () => {
    using dir = tempDir("glob-scan-symlink-emfile", {
      "scan/plain.txt": "",
      "target/file.txt": "",
    });
    const scanned = path.join(String(dir), "scan");
    fs.symlinkSync("../target", path.join(scanned, "link"));
    fs.symlinkSync("plain.txt", path.join(scanned, "flink"));
    fs.symlinkSync("../nope", path.join(scanned, "dangling"));
    // ENOTDIR, with or without a descriptor: the walker takes this link for a file.
    fs.symlinkSync("plain.txt/sub", path.join(scanned, "via"));

    const fixture = /* js */ `
      const fs = require("fs");
      ${scanRows}
      const rows = async () => ({
        "**/* through links": scan("scan", "**/*", { followSymlinks: true }),
        "**/* through links, async": await Array.fromAsync(
          new Bun.Glob("**/*").scan({ cwd: "scan", followSymlinks: true }),
        ).then(
          paths => paths.sort(),
          e => ({ code: e.code, syscall: e.syscall, path: e.path }),
        ),
        "link/* names the link": scan("scan", "link/*", {}),
        "* files": scan("scan", "*", { followSymlinks: true }),
        "* everything": scan("scan", "*", everything),
        "*/ directories": scan("scan", "*/", everything),
        "* everything, throw on broken": scan("scan", "*", { ...everything, throwErrorOnBrokenSymlink: true }),
      });
      const free = await rows();
      const held = [];
      for (;;) {
        try {
          held.push(fs.openSync("/dev/null", "r"));
        } catch (e) {
          if (e.code !== "EMFILE") throw e;
          break;
        }
      }
      fs.closeSync(held.pop());
      const exhausted = await rows();
      // LeakSanitizer reads /proc/self/task at exit, which needs a free descriptor.
      for (const fd of held) fs.closeSync(fd);
      console.log(JSON.stringify({ free, exhausted }));
    `;
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), "-e", fixture],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const emfile = { code: "EMFILE", syscall: "open", path: "link" };
    // Nothing below a link is asked for: a stat, which needs no descriptor, says what each leads to.
    const leaves = {
      "* files": ["flink", "plain.txt", "via"],
      "* everything": ["dangling", "flink", "link", "plain.txt", "via"],
      "*/ directories": ["link"],
    };
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      free: {
        "**/* through links": ["flink", "link/file.txt", "plain.txt", "via"],
        "**/* through links, async": ["flink", "link/file.txt", "plain.txt", "via"],
        "link/* names the link": ["link/file.txt"],
        ...leaves,
        "* everything, throw on broken": { code: "ENOENT", syscall: "open", path: "dangling" },
      },
      exhausted: {
        "**/* through links": emfile,
        "**/* through links, async": emfile,
        "link/* names the link": emfile,
        ...leaves,
        // The stat shows that only this link is broken.
        "* everything, throw on broken": { code: "ENOENT", syscall: "fstatat", path: "dangling" },
      },
    });
    expect(exitCode).toBe(0);
  });

  // `l` is a link to the directory that holds it, so the walk lists `l` and does not list `l/l`
  // again. `ulimit` alone cannot fail the open of `l/l` only: the walker closes the directory of
  // `l` before that open. The helper installs a seccomp filter that fails `close` of the last
  // descriptor without closing it. The directory of `l` stays open there, and the open of `l/l`
  // gets EMFILE.
  test.skipIf(!keepOpen).each([
    ["", {}],
    [", also with throwErrorOnBrokenSymlink", { throwErrorOnBrokenSymlink: true }],
  ])("no descriptor left: a link back to a followed directory does not fail the scan%s", async (_, options) => {
    using dir = tempDir("glob-scan-symlink-cycle", { "scan/plain.txt": "" });
    fs.symlinkSync(".", path.join(String(dir), "scan", "l"));

    const last = 63;
    const fixture = /* js */ `
        const fs = require("fs");
        ${scanRows}
        const rows = () => scan("scan", "**/*", { ...everything, ...${JSON.stringify(options)} });
        const isOpen = fd => {
          try {
            fs.fstatSync(fd);
            return true;
          } catch {
            return false;
          }
        };
        const free = rows();
        // Every descriptor below the last one, then one of them back for the directory that is scanned.
        const held = [];
        do held.push(fs.openSync("/dev/null", "r"));
        while (held.at(-1) !== ${last} - 1);
        fs.closeSync(held.pop());
        const keptOpen = [isOpen(${last})];
        const exhausted = rows();
        keptOpen.push(isOpen(${last}));
        for (const fd of held) fs.closeSync(fd);
        console.log(JSON.stringify({ free, keptOpen, exhausted }));
      `;
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        `ulimit -n ${last + 1} && exec "$@"`,
        "sh",
        keepOpen!,
        String(last),
        bunExe(),
        "-e",
        fixture,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const list = ["l", "l/l", "l/plain.txt", "plain.txt"];
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      free: list,
      // The last descriptor is free before the scan, and holds the directory of `l` after it.
      keptOpen: [false, true],
      exhausted: list,
    });
    expect(exitCode).toBe(0);
  });

  // Mode 000: the directory is there and the scan has no permission to list it. Not concurrent:
  // `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  test("no permission: a link to the directory is passed over, and matches where the pattern ends at it", async () => {
    using dir = tempDir("glob-scan-symlink-eacces", {
      "linked/plain.txt": "",
      "direct/plain.txt": "",
      "direct/closed/file.txt": "",
      "unknown/plain.txt": "",
      "secret/file.txt": "",
      "locked/inner/file.txt": "",
    });
    const root = String(dir);
    fs.symlinkSync("../secret", path.join(root, "linked", "link"));
    // The stat of this link fails too, so the walker cannot learn what it leads to.
    fs.symlinkSync("../locked/inner", path.join(root, "unknown", "link"));
    const closed = [path.join(root, "secret"), path.join(root, "direct", "closed"), path.join(root, "locked")];

    using unprivileged = unprivilegedSpawnOptions(root);
    for (const directory of closed) fs.chmodSync(directory, 0o000);
    try {
      const fixture = /* js */ `
        ${scanRows}
        const orThrow = { ...everything, throwErrorOnBrokenSymlink: true };
        console.log(JSON.stringify({
          linked: {
            "*": scan("linked", "*", everything),
            "*/": scan("linked", "*/", everything),
            "* throw on broken": scan("linked", "*", orThrow),
            "link/*": scan("linked", "link/*", {}),
            "link/* throw on broken": scan("linked", "link/*", { throwErrorOnBrokenSymlink: true }),
            "**/*": scan("linked", "**/*", { followSymlinks: true }),
          },
          direct: {
            "*": scan("direct", "*", { onlyFiles: false }),
            "closed/*": scan("direct", "closed/*", {}),
          },
          unknown: {
            "*": scan("unknown", "*", everything),
            "* throw on broken": scan("unknown", "*", orThrow),
            "**/*": scan("unknown", "**/*", { followSymlinks: true }),
          },
        }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        ...unprivileged,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const eacces = (name: string) => ({ code: "EACCES", syscall: "open", path: name });
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        linked: {
          // The link leads to a directory, so it is not a broken link.
          "*": ["link", "plain.txt"],
          "*/": ["link"],
          "* throw on broken": ["link", "plain.txt"],
          "link/*": [],
          "link/* throw on broken": eacces("link"),
          "**/*": ["plain.txt"],
        },
        // The directory itself fails the scan.
        direct: {
          "*": ["closed", "plain.txt"],
          "closed/*": eacces("closed"),
        },
        unknown: {
          "*": ["link", "plain.txt"],
          "* throw on broken": eacces("link"),
          "**/*": ["plain.txt"],
        },
      });
      expect(exitCode).toBe(0);
    } finally {
      for (const directory of closed) fs.chmodSync(directory, 0o755);
    }
  });

  test.each([
    ["has no target", "nope", "ENOENT"],
    ["is a loop", "link", "ELOOP"],
    ["names a target too long to exist", Buffer.alloc(300, "a").toString(), "ENAMETOOLONG"],
  ])("a link that %s is passed over, and thrown with throwErrorOnBrokenSymlink", (_, target, code) => {
    using dir = tempDir("glob-scan-symlink-broken", { "plain.txt": "" });
    fs.symlinkSync(target, path.join(String(dir), "link"));
    const scan = (options: { onlyFiles?: boolean; throwErrorOnBrokenSymlink?: boolean }) =>
      [...new Glob("**/*").scanSync({ cwd: String(dir), followSymlinks: true, ...options })].sort();

    expect(scan({})).toEqual(["plain.txt"]);
    expect(scan({ onlyFiles: false })).toEqual(["link", "plain.txt"]);
    expect(() => scan({ throwErrorOnBrokenSymlink: true })).toThrow(
      expect.objectContaining({ code, syscall: "open", path: "link" }),
    );
  });
});

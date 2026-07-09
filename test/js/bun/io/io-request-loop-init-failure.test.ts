import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// The lazily-initialized IO request loop (src/io/lib.rs) backs
// Bun.file(<fifo|pipe|chardev>).text() and friends. Its init issues
// epoll_create1 + epoll_ctl(EPOLL_CTL_ADD, waker). Both can fail on a healthy
// kernel with ENOMEM or ENOSPC (fs.epoll.max_user_watches exhausted, a per-uid
// limit). Since init is lazy, a transient kernel failure on that one syscall
// hours into a long-lived process used to panic and abort the whole process
// instead of rejecting the single read that triggered it.
//
// We install a seccomp filter at runtime (after the main event loop has set
// up its own epoll) that forces epoll_ctl(EPOLL_CTL_ADD) to fail, then
// trigger the lazy init by reading a fifo.
describe.skipIf(!isLinux)("IO request loop: recoverable init failure", () => {
  // Shared library: install a seccomp filter (synced to all threads) that
  // returns `err` for every epoll_ctl(_, EPOLL_CTL_ADD, ...). Called from
  // inside the bun subprocess via bun:ffi, so the main event loop's own
  // epoll registrations are untouched.
  const soSrc = `
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
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

#ifndef SECCOMP_FILTER_FLAG_TSYNC
#define SECCOMP_FILTER_FLAG_TSYNC 1
#endif

#define EPOLL_CTL_ADD 1

int install_epoll_ctl_add_fault(int err) {
  if (MY_AUDIT_ARCH == 0) return 77;
  struct sock_filter filter[] = {
    /* arch check */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    /* syscall nr == epoll_ctl ? */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_epoll_ctl, 0, 3),
    /* arg1 (op) == EPOLL_CTL_ADD ? */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, EPOLL_CTL_ADD, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (err & SECCOMP_RET_DATA)),
    /* allow */
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = filter,
  };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return 77;
  /* TSYNC: the IO request loop is initialized on a WorkPool thread. */
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_TSYNC, &prog) != 0) return 77;
  return 0;
}
`;

  const tryBuild = (): { dir: string; so: string } | null => {
    const dir = tempDirWithFiles("io-loop-init-fault", {
      "fault.c": soSrc,
    });
    const src = join(dir, "fault.c");
    const so = join(dir, "fault.so");
    const compile = spawnSync("cc", ["-O0", "-shared", "-fPIC", "-o", so, src], { stdio: "pipe" });
    if ((compile.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    if (compile.status !== 0) {
      const stderr = compile.stderr?.toString() ?? "";
      if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return null;
      throw new Error(`failed to compile seccomp helper:\n${stderr}`);
    }
    if (!existsSync(so)) throw new Error("helper compiled but output .so is missing");
    return { dir, so };
  };

  const built = tryBuild();

  const readFixture = (so: string, fifo: string, errno: number) => `
    const { dlopen } = require("bun:ffi");
    const fs = require("node:fs");
    const { install_epoll_ctl_add_fault } = dlopen(${JSON.stringify(so)}, {
      install_epoll_ctl_add_fault: { args: ["i32"], returns: "i32" },
    }).symbols;

    const rc = install_epoll_ctl_add_fault(${errno});
    if (rc === 77) { console.log("SKIP"); process.exit(77); }
    if (rc !== 0) { console.log("SETUP_FAIL:" + rc); process.exit(1); }

    // Hold a writer so O_RDONLY|O_NONBLOCK open() and poll() behave; the
    // read never reaches the data because init fails first.
    const wfd = fs.openSync(${JSON.stringify(fifo)}, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    try {
      const s = await Bun.file(${JSON.stringify(fifo)}).text();
      console.log("READ:" + s);
    } catch (e) {
      console.log("REJECTED:" + (e?.code ?? e?.name) + ":" + (e?.syscall ?? ""));
    } finally {
      fs.closeSync(wfd);
    }
  `;

  async function run(fixture: string, expected: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode === 77) {
      console.warn("SKIP io-loop-init-fault: seccomp not permitted in this environment");
      return;
    }
    expect({
      stdout: stdout.trim(),
      stderr: stderr.includes("panic") ? stderr : "",
      signalCode: proc.signalCode,
    }).toEqual({
      stdout: expected,
      stderr: "",
      signalCode: null,
    });
    expect(exitCode).toBe(0);
  }

  function makeFifo(tag: string) {
    const fifo = join(built!.dir, `fifo-${tag}`);
    const mk = spawnSync("mkfifo", [fifo]);
    if (mk.status !== 0) throw new Error("mkfifo failed: " + mk.stderr?.toString());
    return fifo;
  }

  const errnos = [
    { name: "ENOMEM", value: 12 },
    { name: "ENOSPC", value: 28 },
  ];

  for (const { name, value } of errnos) {
    // built == null when cc or linux/seccomp.h are unavailable on the host.
    test.skipIf(built == null)(
      `Bun.file(fifo).text() rejects (not aborts) when epoll_ctl(ADD) returns ${name}`,
      async () => {
        const fifo = makeFifo(`r-${name}`);
        await run(readFixture(built!.so, fifo, value), `REJECTED:${name}:epoll_ctl`);
      },
    );
  }
});

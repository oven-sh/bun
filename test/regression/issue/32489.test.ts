import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDirWithFiles } from "harness";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/32489
//
// Android's per-app seccomp policy does not whitelist epoll_pwait2, and on
// some shimmed-glibc setups the blocked syscall faults inside libc's
// syscall(2) error path instead of returning ENOSYS to the runtime fallback
// in epoll_kqueue.c. BUN_FEATURE_FLAG_DISABLE_EPOLL_PWAIT2 forces the loop to
// use epoll_pwait(2) so epoll_pwait2 is never issued.
//
// This test installs a seccomp filter that kills the process if epoll_pwait2
// is ever called, sets the feature flag, and exercises both event loops that
// use bun_epoll_pwait2: a timer on the main loop and a fetch() on the HTTP
// thread. If the flag is honored, neither loop attempts the blocked syscall
// and the process exits 0.
describe.skipIf(!isLinux)("epoll_pwait2 disable gate", () => {
  const helperSrc = `
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
  #define MY_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
  #define MY_AUDIT_ARCH 0
#endif

#ifndef __NR_epoll_pwait2
#define __NR_epoll_pwait2 441
#endif

#ifndef SECCOMP_RET_KILL_PROCESS
#define SECCOMP_RET_KILL_PROCESS 0x80000000U
#endif

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  if (MY_AUDIT_ARCH == 0) return 77; /* unsupported arch, skip */

  /* The control run is deliberately killed by SIGSYS below; suppress the
   * core file so the CI runner does not flag it as a crash. RLIMIT_CORE
   * survives execvp. */
  struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &no_core) != 0) {
    perror("setrlimit(RLIMIT_CORE)");
    return 77;
  }

  struct sock_filter filter[] = {
    /* arch check */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, MY_AUDIT_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    /* load syscall nr */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    /* if nr == __NR_epoll_pwait2 -> kill the whole process */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_epoll_pwait2, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    /* else -> allow */
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = filter,
  };

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("prctl(PR_SET_NO_NEW_PRIVS)");
    return 77; /* cannot install filter, skip */
  }
  if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) != 0) {
    perror("seccomp");
    return 77; /* cannot install filter, skip */
  }

  execvp(argv[1], &argv[1]);
  perror("execvp");
  return 127;
}
`;

  // Compile the seccomp helper once. Returns the binary path, or null if
  // the host genuinely can't build it (no cc, missing kernel headers).
  // Any other compile failure throws so a source regression isn't silently
  // hidden as a skip.
  const tryBuild = (): string | null => {
    const dir = tempDirWithFiles("epoll-pwait2-seccomp", {
      "kill_epoll_pwait2.c": helperSrc,
    });
    const src = join(dir, "kill_epoll_pwait2.c");
    const bin = join(dir, "kill_epoll_pwait2");
    const compile = spawnSync("cc", ["-O0", "-o", bin, src], { stdio: "pipe" });

    // compiler not on PATH — expected skip
    if ((compile.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;

    if (compile.status !== 0) {
      const stderr = compile.stderr?.toString() ?? "";
      // missing linux/*.h on the host — expected skip
      if (/linux\/(seccomp|filter|audit)\.h|sys\/prctl\.h/.test(stderr)) return null;
      throw new Error(`failed to compile seccomp helper:\n${stderr}`);
    }
    if (!existsSync(bin)) {
      throw new Error("seccomp helper compiled successfully but output binary is missing");
    }
    return bin;
  };

  const helperBin = tryBuild();

  // Run `snippet` in a bun subprocess guarded by the seccomp helper.
  // Returns null if the environment refused to install the seccomp filter
  // (skip).
  async function runUnderSeccomp(bin: string, snippet: string, disableEpollPwait2: boolean) {
    await using proc = Bun.spawn({
      cmd: [bin, bunExe(), "-e", snippet],
      env: {
        ...bunEnv,
        BUN_FEATURE_FLAG_DISABLE_EPOLL_PWAIT2: disableEpollPwait2 ? "1" : undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode === 77) return null;
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  const cases: Array<{ name: string; snippet: string; expected: string }> = [
    {
      name: "main loop",
      // The setTimeout forces us_loop_run_bun_tick to wait on the epoll fd
      // with a finite timeout, exercising bun_epoll_pwait2 on the main loop.
      snippet: `await new Promise(r => setTimeout(r, 50));
                console.log("timer-ok");`,
      expected: "timer-ok",
    },
    {
      name: "HTTP thread loop",
      // fetch() runs on the dedicated HTTP thread, which owns its own
      // us_loop_t; this exercises bun_epoll_pwait2 on that loop as well
      // (the frame the issue reported faulting: HTTPThread.rs ->
      // us_loop_run_bun_tick).
      snippet: `await using server = Bun.serve({ port: 0, fetch: () => new Response("pong") });
                const res = await fetch(server.url);
                console.log("http-thread-ok:" + await res.text() + ":" + res.status);`,
      expected: "http-thread-ok:pong:200",
    },
  ];

  for (const c of cases) {
    test(`BUN_FEATURE_FLAG_DISABLE_EPOLL_PWAIT2 gates the ${c.name}`, async () => {
      if (helperBin == null) {
        console.warn("SKIP epoll_pwait2 seccomp: cc or seccomp headers not available");
        return;
      }

      // Control run: same snippet WITHOUT the flag. Proves the seccomp
      // filter is live and this path actually issues epoll_pwait2 on this
      // host (kernel >= 5.11, not Android). If the control is not killed,
      // the gate under test is already disabled by a different condition
      // and the flagged run below would pass for the wrong reason.
      const control = await runUnderSeccomp(helperBin, c.snippet, false);
      if (control == null) {
        console.warn("SKIP epoll_pwait2 seccomp: seccomp not permitted in this environment");
        return;
      }
      if (control.signalCode !== "SIGSYS") {
        console.warn(
          `SKIP epoll_pwait2 seccomp: control run was not killed ` +
            `(signal=${control.signalCode} exit=${control.exitCode}); ` +
            `epoll_pwait2 is already disabled on this host`,
        );
        return;
      }

      const out = await runUnderSeccomp(helperBin, c.snippet, true);
      if (out == null) {
        console.warn("SKIP epoll_pwait2 seccomp: seccomp not permitted in this environment");
        return;
      }

      expect({ stdout: out.stdout.trim(), signalCode: out.signalCode }).toEqual({
        stdout: c.expected,
        signalCode: null,
      });
      if (out.exitCode !== 0) expect(out.stderr).toBe("");
      expect(out.exitCode).toBe(0);
    });
  }
});

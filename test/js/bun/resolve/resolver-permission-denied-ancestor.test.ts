import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, rmSync } from "fs";
import { bunEnv, bunExe, isArm64, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";

// An ancestor directory the process may traverse but not read (mode 0o111 —
// common on shared hosts and in sandboxes) must not abort module resolution
// for readable subtrees: the resolver treats it as an opaque, empty
// directory. Previously the whole walk failed with "error loading current
// directory". Root bypasses permission checks, so skip there.
describe.skipIf(isWindows || process.getuid?.() === 0)("resolver with unreadable ancestor", () => {
  test("bun run works under an execute-only ancestor", () => {
    using dir = tempDir("xonly-ancestor", {
      "outer/project/package.json": JSON.stringify({
        name: "p",
        scripts: { start: "bun index.js" },
      }),
      "outer/project/index.js": `console.log("XONLY-OK", require("./dep.js"));`,
      "outer/project/dep.js": `module.exports = 42;`,
    });
    const outer = join(dir, "outer");
    chmodSync(outer, 0o111);
    try {
      const proc = Bun.spawnSync({
        cmd: [bunExe(), "run", "start"],
        cwd: join(outer, "project"),
        env: bunEnv,
      });
      if (proc.exitCode !== 0) console.error("stderr:", proc.stderr.toString());
      expect(proc.stdout.toString()).toContain("XONLY-OK 42");
      expect(proc.exitCode).toBe(0);
    } finally {
      chmodSync(outer, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("errors on the requested directory itself stay fatal", () => {
    using dir = tempDir("unreadable-cwd", {
      "project/package.json": JSON.stringify({ name: "p", scripts: { start: "echo should-not-run" } }),
    });
    const project = join(dir, "project");
    // Execute-only: chdir succeeds, but `bun run` must read the requested
    // directory for script discovery, which is denied -- unlike ancestors,
    // this stays fatal ("error loading current directory").
    chmodSync(project, 0o111);
    try {
      const proc = Bun.spawnSync({
        cmd: [bunExe(), "run", "start"],
        cwd: project,
        env: bunEnv,
      });
      expect(proc.exitCode).not.toBe(0);
      expect(proc.stderr.toString()).toContain("error loading current directory");
      expect(proc.stdout.toString()).not.toContain("should-not-run");
    } finally {
      chmodSync(project, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// On Android shared storage, `openat("/storage/emulated/", O_DIRECTORY)`
// fails with ENOENT while `/storage/emulated/0/<project>` opens fine (#44565).
// The resolver walks from the root down, so that ancestor must not end the
// walk before it reaches the requested directory. Linux has no mount that
// behaves this way, so the test runs bun under a ptrace tracer that fails
// every open() of one directory with ENOENT and leaves its children alone.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// OPEN_ENOENT_DIR=<dir>   every open()/openat() of <dir> (with or without a trailing slash) fails
// OPEN_ENOENT_ERRNO=<n>   the errno to return (default ENOENT)
// A seccomp filter stops the tracee only for open syscalls, so the rest of the program runs at speed.
// Exit 90 means the tracer could not set itself up (ptrace or seccomp is not available).
const TRACER_C = /* c */ `
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/elf.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(__x86_64__)
#define ARCH_NR AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define ARCH_NR AUDIT_ARCH_AARCH64
#else
#error "unsupported architecture"
#endif

static const char *target;
static size_t target_len;

static int install_filter(void) {
  struct sock_filter filter[] = {
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 1, 0),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_openat, 2, 0),
#ifdef SYS_open
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_open, 1, 0),
#else
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_openat, 1, 0),
#endif
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_TRACE),
  };
  struct sock_fprog prog = {.len = sizeof(filter) / sizeof(filter[0]), .filter = filter};
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
  return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog);
}

static int matches(pid_t tid, unsigned long addr) {
  char procmem[64], buf[4096];
  snprintf(procmem, sizeof procmem, "/proc/%d/mem", (int)tid);
  int fd = open(procmem, O_RDONLY);
  if (fd < 0) return 0;
  ssize_t n = pread(fd, buf, sizeof buf - 1, (off_t)addr);
  close(fd);
  if (n <= 0) return 0;
  buf[n] = 0;
  size_t len = strlen(buf);
  if (len == target_len + 1 && buf[target_len] == '/') len--;
  return len == target_len && memcmp(buf, target, len) == 0;
}

static int skip_syscall(pid_t tid) {
#if defined(__x86_64__)
  struct user_regs_struct regs;
  struct iovec iov = {.iov_base = &regs, .iov_len = sizeof regs};
  if (ptrace(PTRACE_GETREGSET, tid, NT_PRSTATUS, &iov) != 0) return -1;
  regs.orig_rax = (unsigned long long)-1;
  return (int)ptrace(PTRACE_SETREGSET, tid, NT_PRSTATUS, &iov);
#else
  int nr = -1;
  struct iovec iov = {.iov_base = &nr, .iov_len = sizeof nr};
  return (int)ptrace(PTRACE_SETREGSET, tid, NT_ARM_SYSTEM_CALL, &iov);
#endif
}

static int set_return(pid_t tid, long value) {
  struct user_regs_struct regs;
  struct iovec iov = {.iov_base = &regs, .iov_len = sizeof regs};
  if (ptrace(PTRACE_GETREGSET, tid, NT_PRSTATUS, &iov) != 0) return -1;
#if defined(__x86_64__)
  regs.rax = (unsigned long long)value;
#else
  regs.regs[0] = (unsigned long long)value;
#endif
  return (int)ptrace(PTRACE_SETREGSET, tid, NT_PRSTATUS, &iov);
}

int main(int argc, char **argv) {
  target = getenv("OPEN_ENOENT_DIR");
  if (!target || argc < 2) return 90;
  target_len = strlen(target);
  const char *errno_env = getenv("OPEN_ENOENT_ERRNO");
  long inject_errno = errno_env ? atol(errno_env) : ENOENT;

  pid_t child = fork();
  if (child < 0) return 90;
  if (child == 0) {
    if (ptrace(PTRACE_TRACEME, 0, 0, 0) != 0 || install_filter() != 0) _exit(90);
    raise(SIGSTOP);
    execvp(argv[1], argv + 1);
    _exit(127);
  }

  int status;
  if (waitpid(child, &status, 0) < 0 || !WIFSTOPPED(status)) return 90;
  if (ptrace(PTRACE_SETOPTIONS, child, 0,
             PTRACE_O_TRACESECCOMP | PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACECLONE |
                 PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_EXITKILL) != 0) {
    kill(child, SIGKILL);
    return 90;
  }
  ptrace(PTRACE_CONT, child, 0, 0);

  int exit_code = 90;
  for (;;) {
    pid_t tid = waitpid(-1, &status, __WALL);
    if (tid < 0) break;
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      if (tid == child) exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
      continue;
    }
    if (!WIFSTOPPED(status)) continue;

    int sig = WSTOPSIG(status);
    int event = status >> 16;
    int request = PTRACE_CONT;
    int deliver = 0;

    if (sig == SIGTRAP && event == PTRACE_EVENT_SECCOMP) {
      struct __ptrace_syscall_info info;
      long n = ptrace(PTRACE_GET_SYSCALL_INFO, tid, sizeof info, &info);
      if (n > 0 && info.op == PTRACE_SYSCALL_INFO_SECCOMP) {
        unsigned long path = 0;
        if (info.seccomp.nr == SYS_openat) path = info.seccomp.args[1];
#ifdef SYS_open
        else if (info.seccomp.nr == SYS_open) path = info.seccomp.args[0];
#endif
        if (path && matches(tid, path) && skip_syscall(tid) == 0) request = PTRACE_SYSCALL;
      }
    } else if (sig == (SIGTRAP | 0x80)) {
      struct __ptrace_syscall_info info;
      long n = ptrace(PTRACE_GET_SYSCALL_INFO, tid, sizeof info, &info);
      if (n > 0 && info.op == PTRACE_SYSCALL_INFO_ENTRY) {
        request = PTRACE_SYSCALL;
      } else {
        set_return(tid, -inject_errno);
      }
    } else if (sig == SIGTRAP || sig == SIGSTOP) {
      // exec, a new traced thread or child, or a clone/fork event
    } else {
      deliver = sig;
    }
    ptrace(request, tid, 0, deliver);
  }
  return exit_code;
}
`;

// Compile the tracer once and check that this machine lets it trace. A runner
// that denies PTRACE_TRACEME or PR_SET_SECCOMP makes the tracer exit 90, and
// then the tests below skip instead of failing.
function buildTracer(): { dir: ReturnType<typeof tempDir>; tracer: string } | undefined {
  if (!isLinux || !cc || !(process.arch === "x64" || isArm64)) return undefined;
  const dir = tempDir("enoent-ancestor", {
    "tracer.c": TRACER_C,
    "storage/emulated/0/project/package.json": JSON.stringify({
      name: "p",
      scripts: { start: "bun index.js" },
    }),
    "storage/emulated/0/project/index.js": `console.log("ENOENT-ANCESTOR-OK", require("./dep.js"));`,
    "storage/emulated/0/project/dep.js": `module.exports = 42;`,
  });
  const tracer = join(String(dir), "tracer");
  const compile = Bun.spawnSync({
    cmd: [cc, "-O1", "-o", tracer, join(String(dir), "tracer.c")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (compile.exitCode !== 0) {
    throw new Error(`tracer compile failed: ${compile.stderr.toString() || compile.stdout.toString()}`);
  }
  const probe = Bun.spawnSync({
    cmd: [tracer, bunExe(), "-e", "0"],
    env: { ...bunEnv, OPEN_ENOENT_DIR: "/nonexistent", ...tracedSanitizerEnv() },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (probe.exitCode === 90) {
    dir[Symbol.dispose]();
    return undefined;
  }
  return { dir, tracer };
}

// LeakSanitizer attaches to its own threads with ptrace at exit. That fails
// in a process that is already traced, so turn it off for the traced child.
function tracedSanitizerEnv() {
  return {
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    LSAN_OPTIONS: "detect_leaks=0",
  };
}

const traced = buildTracer();

describe.skipIf(!traced)("resolver with an ancestor that opens as ENOENT", () => {
  const { dir, tracer } = traced!;
  const project = join(String(dir), "storage", "emulated", "0", "project");
  const hidden = join(String(dir), "storage", "emulated");

  afterAll(() => {
    dir[Symbol.dispose]();
  });

  async function runTraced(args: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [tracer, bunExe(), ...args],
      cwd: project,
      env: { ...bunEnv, ...tracedSanitizerEnv(), OPEN_ENOENT_DIR: hidden, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("the tracer hides the ancestor and nothing else", async () => {
    const probe = await runTraced([
      "-e",
      `
      const fs = require("fs");
      const out = [];
      for (const p of process.argv.slice(1)) {
        try { fs.closeSync(fs.openSync(p, "r")); out.push("ok"); } catch (e) { out.push(e.code); }
      }
      console.log(out.join(" "));
    `,
      hidden,
      hidden + "/",
      join(hidden, "0"),
      project,
    ]);
    expect(probe.stdout).toBe("ENOENT ENOENT ok ok\n");
    expect(probe.exitCode).toBe(0);
  });

  test("bun run finds the package.json below the hidden ancestor", async () => {
    const { stdout, stderr, exitCode } = await runTraced(["run", "start"]);
    expect(stderr).toBe("$ bun index.js\n");
    expect(stdout).toBe("ENOENT-ANCESTOR-OK 42\n");
    expect(exitCode).toBe(0);
  });

  test("a script name alone works too", async () => {
    const { stdout, stderr, exitCode } = await runTraced(["start"]);
    expect(stderr).toBe("$ bun index.js\n");
    expect(stdout).toBe("ENOENT-ANCESTOR-OK 42\n");
    expect(exitCode).toBe(0);
  });

  test("the requested directory itself stays fatal", async () => {
    const { stdout, stderr, exitCode } = await runTraced(["run", "start"], { OPEN_ENOENT_DIR: project });
    expect(stderr).toContain("error loading current directory");
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });
});

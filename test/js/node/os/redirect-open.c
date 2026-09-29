// Runs a command under ptrace and makes its opens of a few absolute paths
// relative to its current directory: openat(AT_FDCWD, "/proc/stat") becomes
// openat(AT_FDCWD, "proc/stat"). Only the path register changes, so a path in
// read-only memory works too. Bun opens files with raw syscalls on Linux, so
// LD_PRELOAD cannot do this.
//
// Usage: redirect-open <path>... -- <cmd> [args...]
// A <path> that ends in '/' matches every path below it. Any other <path>
// matches that exact path.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

// The register fields are unsigned long in musl and unsigned long long in glibc.
#if defined(__x86_64__)
typedef struct user_regs_struct regs_t;
static long reg_nr(regs_t *r) { return (long)r->orig_rax; }
static uint64_t reg_path(regs_t *r) { return (uint64_t)r->rsi; }
static void reg_set_path(regs_t *r, uint64_t v) { r->rsi = v; }
static int get_regs(pid_t t, regs_t *r) { return ptrace(PTRACE_GETREGS, t, 0, r); }
static int set_regs(pid_t t, regs_t *r) { return ptrace(PTRACE_SETREGS, t, 0, r); }
#elif defined(__aarch64__)
#include <linux/elf.h>
typedef struct user_regs_struct regs_t;
static long reg_nr(regs_t *r) { return (long)r->regs[8]; }
static uint64_t reg_path(regs_t *r) { return (uint64_t)r->regs[1]; }
static void reg_set_path(regs_t *r, uint64_t v) { r->regs[1] = v; }
static int get_regs(pid_t t, regs_t *r) {
  struct iovec io = { r, sizeof(*r) };
  return ptrace(PTRACE_GETREGSET, t, (void *)NT_PRSTATUS, &io);
}
static int set_regs(pid_t t, regs_t *r) {
  struct iovec io = { r, sizeof(*r) };
  return ptrace(PTRACE_SETREGSET, t, (void *)NT_PRSTATUS, &io);
}
#else
#error unsupported arch
#endif

// One entry per thread that is inside a syscall.
#define MAX_TIDS 4096
static pid_t tid_tab[MAX_TIDS];
static unsigned char in_call[MAX_TIDS];
static uint64_t saved_path[MAX_TIDS];
static unsigned char has_saved[MAX_TIDS];

static int slot(pid_t t) {
  int free_i = -1;
  for (int i = 0; i < MAX_TIDS; i++) {
    if (tid_tab[i] == t) return i;
    if (tid_tab[i] == 0 && free_i < 0) free_i = i;
  }
  if (free_i < 0) {
    fprintf(stderr, "redirect-open: more than %d threads\n", MAX_TIDS);
    exit(2);
  }
  tid_tab[free_i] = t;
  return free_i;
}

static void drop(pid_t t) {
  for (int i = 0; i < MAX_TIDS; i++) {
    if (tid_tab[i] == t) {
      tid_tab[i] = 0;
      in_call[i] = 0;
      has_saved[i] = 0;
    }
  }
}

// Copies the NUL-terminated string at `addr` in the tracee. Returns 0 when the
// string does not end within `cap` bytes or the memory cannot be read. It reads
// aligned words, so a read never goes into the page after the one with the NUL.
static int read_string(pid_t t, uint64_t addr, char *out, size_t cap) {
  uint64_t word_addr = addr & ~(uint64_t)(sizeof(long) - 1);
  size_t skip = (size_t)(addr - word_addr);
  size_t n = 0;
  while (n < cap) {
    errno = 0;
    long word = ptrace(PTRACE_PEEKDATA, t, (void *)(uintptr_t)word_addr, 0);
    if (word == -1 && errno != 0) return 0;
    for (size_t i = skip; i < sizeof(word) && n < cap; i++, n++) {
      out[n] = (char)((unsigned long)word >> (8 * i));
      if (out[n] == 0) return 1;
    }
    skip = 0;
    word_addr += sizeof(long);
  }
  return 0;
}

static int matches(const char *path, char **patterns, int count) {
  for (int i = 0; i < count; i++) {
    size_t len = strlen(patterns[i]);
    if (len > 0 && patterns[i][len - 1] == '/') {
      if (strncmp(path, patterns[i], len) == 0) return 1;
    } else if (strcmp(path, patterns[i]) == 0) {
      return 1;
    }
  }
  return 0;
}

int main(int argc, char **argv) {
  int sep = 0;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--") == 0) {
      sep = i;
      break;
    }
  }
  if (sep < 2 || sep + 1 >= argc) {
    fprintf(stderr, "usage: %s <path>... -- <cmd> [args...]\n", argv[0]);
    return 2;
  }
  char **patterns = &argv[1];
  int pattern_count = sep - 1;
  char **cmd = &argv[sep + 1];
  for (int i = 0; i < pattern_count; i++) {
    if (patterns[i][0] != '/') {
      fprintf(stderr, "redirect-open: %s is not an absolute path\n", patterns[i]);
      return 2;
    }
  }

  pid_t child = fork();
  if (child < 0) {
    perror("fork");
    return 2;
  }
  if (child == 0) {
    if (ptrace(PTRACE_TRACEME, 0, 0, 0) != 0) {
      perror("PTRACE_TRACEME");
      _exit(126);
    }
    raise(SIGSTOP);
    execvp(cmd[0], cmd);
    perror("execvp");
    _exit(127);
  }

  int st;
  if (waitpid(child, &st, 0) < 0) {
    perror("waitpid");
    return 2;
  }
  // 126: the child could not ask for a tracer.
  if (WIFEXITED(st)) return WEXITSTATUS(st);
  long opts = PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACECLONE | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK |
              PTRACE_O_TRACEEXEC | PTRACE_O_EXITKILL;
  if (ptrace(PTRACE_SETOPTIONS, child, 0, opts) != 0) {
    perror("PTRACE_SETOPTIONS");
    return 2;
  }
  if (ptrace(PTRACE_SYSCALL, child, 0, 0) != 0) {
    perror("PTRACE_SYSCALL");
    return 2;
  }

  long redirected = 0;
  int exit_code = -1;

  for (;;) {
    pid_t t = waitpid(-1, &st, __WALL);
    if (t < 0) {
      if (errno == ECHILD) break;
      if (errno == EINTR) continue;
      perror("waitpid");
      return 2;
    }
    if (WIFEXITED(st) || WIFSIGNALED(st)) {
      if (t == child) exit_code = WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
      drop(t);
      continue;
    }
    if (!WIFSTOPPED(st)) continue;

    int sig = WSTOPSIG(st);
    unsigned ev = (unsigned)(st >> 16);
    if (ev == PTRACE_EVENT_CLONE || ev == PTRACE_EVENT_FORK || ev == PTRACE_EVENT_VFORK) {
      ptrace(PTRACE_SYSCALL, t, 0, 0);
      continue;
    }
    if (ev == PTRACE_EVENT_EXEC) {
      // The syscall-exit-stop of execve follows.
      int s = slot(t);
      in_call[s] = 1;
      has_saved[s] = 0;
      ptrace(PTRACE_SYSCALL, t, 0, 0);
      continue;
    }
    if (sig == (SIGTRAP | 0x80)) {
      int s = slot(t);
      in_call[s] ^= 1;
      regs_t r;
      if (get_regs(t, &r) == 0) {
        if (in_call[s]) {
          char path[128];
          if (reg_nr(&r) == SYS_openat && read_string(t, reg_path(&r), path, sizeof(path)) &&
              matches(path, patterns, pattern_count)) {
            saved_path[s] = reg_path(&r);
            has_saved[s] = 1;
            reg_set_path(&r, saved_path[s] + 1);
            if (set_regs(t, &r) == 0) redirected++;
          }
        } else if (has_saved[s]) {
          // The syscall ABI keeps the argument registers, so the caller can still use this one.
          has_saved[s] = 0;
          reg_set_path(&r, saved_path[s]);
          set_regs(t, &r);
        }
      }
      ptrace(PTRACE_SYSCALL, t, 0, 0);
      continue;
    }
    // A new thread starts with a SIGSTOP from ptrace. Every other signal belongs to the
    // command. That includes SIGTRAP: the syscall and exec stops do not arrive as one here.
    if (sig == SIGSTOP) sig = 0;
    ptrace(PTRACE_SYSCALL, t, 0, (void *)(long)sig);
  }

  fprintf(stderr, "[redirect-open] redirected opens: %ld\n", redirected);
  return exit_code < 0 ? 1 : exit_code;
}

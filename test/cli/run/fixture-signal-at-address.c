// signal-at-address <hexadecimal address> <signal number> <program> [arguments...]
//
// Runs the program until its first thread first reaches the address, sends it the signal there as another process
// does, and prints how the program ends: "signaled <number>" or "exited <code>". Linux on x86-64 and on arm64.
#define _GNU_SOURCE
#include <elf.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/uio.h>
#include <sys/user.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(__x86_64__)
#define PC(registers) (registers).rip
// int3. It is reported with the program counter behind it.
static const unsigned long trap = 0xcc, trap_mask = 0xff, trap_length = 1;
#else
#define PC(registers) (registers).pc
// brk #0. It is reported with the program counter on it.
static const unsigned long trap = 0xd4200000, trap_mask = 0xffffffff, trap_length = 0;
#endif

static pid_t pid;

static void fail(const char *what) {
  fprintf(stderr, "signal-at-address: %s: %s\n", what, strerror(errno));
  // After a fork() that failed pid is -1, and kill() of -1 signals every process it may.
  if (pid > 0) kill(pid, SIGKILL);
  exit(1);
}

static void print_end(int status, const char *when) {
  if (WIFSIGNALED(status)) {
    printf("signaled %d%s\n", WTERMSIG(status), when);
  } else {
    printf("exited %d%s\n", WEXITSTATUS(status), when);
  }
}

int main(int argc, char **argv) {
  if (argc < 4) return 2;
  unsigned long address = strtoul(argv[1], NULL, 16);
  int signal_number = atoi(argv[2]);

  pid = fork();
  if (pid < 0) fail("fork");
  if (pid == 0) {
    // A program that never ends is gone when the test that waits for this process gives up.
    prctl(PR_SET_PDEATHSIG, SIGKILL);
    if (ptrace(PTRACE_TRACEME, 0, 0, 0) != 0) _exit(126);
    execv(argv[3], argv + 3);
    _exit(127);
  }

  int status;
  // The program stops once execv has loaded it.
  if (waitpid(pid, &status, 0) != pid) fail("waitpid");
  if (!WIFSTOPPED(status)) {
    print_end(status, " before it started");
    return 1;
  }

  errno = 0;
  unsigned long instruction = ptrace(PTRACE_PEEKTEXT, pid, (void *)address, 0);
  if (errno) fail("PTRACE_PEEKTEXT");
  const unsigned long breakpoint = (instruction & ~trap_mask) | trap;
  if (ptrace(PTRACE_POKETEXT, pid, (void *)address, (void *)breakpoint) != 0) fail("PTRACE_POKETEXT");

  struct user_regs_struct registers;
  struct iovec io = {&registers, sizeof registers};
  long pending = 0;
  for (;;) {
    if (ptrace(PTRACE_CONT, pid, 0, (void *)pending) != 0) fail("PTRACE_CONT");
    if (waitpid(pid, &status, 0) != pid) fail("waitpid");
    if (!WIFSTOPPED(status)) {
      print_end(status, " before the address");
      return 1;
    }

    if (ptrace(PTRACE_GETREGSET, pid, (void *)NT_PRSTATUS, &io) != 0) fail("PTRACE_GETREGSET");
    if (WSTOPSIG(status) == SIGTRAP && PC(registers) - trap_length == address) {
      PC(registers) = address;
      if (ptrace(PTRACE_SETREGSET, pid, (void *)NT_PRSTATUS, &io) != 0) fail("PTRACE_SETREGSET");
      if (ptrace(PTRACE_POKETEXT, pid, (void *)address, (void *)instruction) != 0) fail("PTRACE_POKETEXT");
      break;
    }
    // Any other signal is the program's own.
    pending = WSTOPSIG(status);
  }

  // The program continues at the address, and the signal is there first.
  if (ptrace(PTRACE_DETACH, pid, 0, (void *)(long)signal_number) != 0) fail("PTRACE_DETACH");
  if (waitpid(pid, &status, 0) != pid) fail("waitpid");
  print_end(status, "");
  return 0;
}

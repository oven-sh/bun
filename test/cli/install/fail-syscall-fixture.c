// fail-syscall <errno> <call,...> <pattern> <spared> <command...>
//
// Runs the command, and fails each <call> behind the first <spared> whose path matches <pattern>.
// With a minus, it is the first ones that fail.
// Its children are left alone. Exits with 77 if the kernel does not go along.
#define _GNU_SOURCE
#include <errno.h>
#include <fnmatch.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>

static const struct {
  const char *name;
  int number;
  enum { NONE, PATH, DESCRIPTOR } kind;
  int argument;
} calls[] = {
    {"access", __NR_faccessat, PATH, 1},
    {"chmod", __NR_fchmod, DESCRIPTOR, 0},
    {"getcwd", __NR_getcwd},
    {"memfd", __NR_memfd_create},
    {"mkdir", __NR_mkdirat, PATH, 1},
    {"open", __NR_openat, PATH, 1},
    {"readlink", __NR_readlinkat, PATH, 1},
    {"recv", __NR_recvfrom},
    {"rename", __NR_renameat, PATH, 1},
    {"socket", __NR_socket},
    {"stat", __NR_newfstatat, PATH, 1},
    {"symlink", __NR_symlinkat, PATH, 2},
    {"vfork", __NR_clone},
    {"wait", __NR_wait4},
    {"watch", __NR_epoll_ctl, DESCRIPTOR, 2},
    {"write", __NR_pwrite64, DESCRIPTOR, 0},
    {"write", __NR_write, DESCRIPTOR, 0},
#ifdef __NR_vfork
    {"access", __NR_access, PATH, 0},
    {"mkdir", __NR_mkdir, PATH, 0},
    {"open", __NR_open, PATH, 0},
    {"readlink", __NR_readlink, PATH, 0},
    {"stat", __NR_lstat, PATH, 0},
    {"stat", __NR_stat, PATH, 0},
    {"symlink", __NR_symlink, PATH, 1},
    {"vfork", __NR_vfork},
#endif
};
#define COUNT (sizeof calls / sizeof *calls)

static pid_t child;

static void exit_like_child(int signal) {
  int status;
  wait(&status);
  _exit(WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status));
}

static int matches(const struct seccomp_notif *call, const char *pattern) {
  if (syscall(__NR_tgkill, child, call->pid, 0) != 0) return 0;
  if (call->data.nr == __NR_clone && !(call->data.args[0] & CLONE_VFORK)) return 0;

  unsigned i = 0;
  while (calls[i].number != call->data.nr) i++;
  unsigned long at = call->data.args[calls[i].argument];
  char path[4097] = {0};
  if (calls[i].kind == PATH) {
    // The next page may not be mapped.
    unsigned long in_page = 4096 - at % 4096;
    struct iovec to = {path, 4096}, from[] = {{(void *)at, in_page}, {(void *)(at + in_page), 4096 - in_page}};
    process_vm_readv(call->pid, &to, 1, from, 2, 0);
  } else if (calls[i].kind == DESCRIPTOR) {
    char link[64];
    snprintf(link, sizeof link, "/proc/%d/fd/%d", call->pid, (int)at);
    if (readlink(link, path, 4096) < 0) return 0;
  }
  return fnmatch(pattern, path, 0) == 0;
}

int main(int argc, char **argv) {
  struct sock_filter filter[2 * COUNT + 2] = {BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr))};
  struct sock_fprog program = {1, filter};
  for (unsigned i = 0; i < COUNT; i++) {
    if (!strstr(argv[2], calls[i].name)) continue;
    filter[program.len++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, calls[i].number, 0, 1);
    filter[program.len++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF);
  }
  filter[program.len++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);

  volatile int *listener = mmap(NULL, sizeof *listener, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANONYMOUS, -1, 0);
  signal(SIGCHLD, exit_like_child);
  // The two share their file descriptors until `execvp`.
  child = syscall(__NR_clone, CLONE_FILES | SIGCHLD, 0, 0, 0, 0);
  if (child == 0) {
    setrlimit(RLIMIT_CORE, &(struct rlimit){0, 0});
    prctl(PR_SET_PDEATHSIG, SIGKILL);
    prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
    *listener = syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &program);
    if (*listener > 0) execvp(argv[5], &argv[5]);
    _exit(77);
  }
  while (*listener <= 0) sched_yield();

  for (int spared = atoi(argv[4]), seen = 0;;) {
    struct seccomp_notif call = {0};
    if (ioctl(*listener, SECCOMP_IOCTL_NOTIF_RECV, &call) != 0) continue;
    struct seccomp_notif_resp answer = {.id = call.id, .flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE};
    if (matches(&call, argv[3]) && (seen++ < abs(spared)) == (spared < 0)) {
      answer.flags = 0;
      answer.error = -atoi(argv[1]);
    }
    if (ioctl(*listener, SECCOMP_IOCTL_NOTIF_SEND, &answer) != 0 && errno == EINVAL) return 77;
  }
}

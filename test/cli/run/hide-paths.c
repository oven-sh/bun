// Test helper: run a command with some paths made to look absent.
//
//   hide-paths /bin/sh /bin/bash -- bun run start
//
// A mount namespace needs privileges that CI does not have. This uses seccomp
// user notification instead: the child's path syscalls stop in the kernel, the
// parent reads the path from the child's memory, and answers ENOENT for a
// hidden path (the path itself or anything below it) or lets the syscall
// continue. Exit code 77 means the kernel or the sandbox does not allow this.
// The path check is racy by design, which does not matter for a test.
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>

#define SKIP 77

#if defined(__x86_64__)
#define HP_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define HP_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
#define HP_AUDIT_ARCH 0
#endif

// Linux 5.0 (listener) and 5.5 (continue). Declared here so that older kernel
// headers still compile; an older kernel answers EINVAL and the helper skips.
struct hp_notif { uint64_t id; uint32_t pid; uint32_t flags; struct seccomp_data data; };
struct hp_notif_resp { uint64_t id; int64_t val; int32_t error; uint32_t flags; };
struct hp_notif_sizes { uint16_t notif, resp, data; };
#define HP_NEW_LISTENER (1UL << 3)
#define HP_GET_NOTIF_SIZES 3
#define HP_CONTINUE (1UL << 0)
#define HP_NOTIF_RECV _IOWR('!', 0, struct hp_notif)
#define HP_NOTIF_SEND _IOWR('!', 1, struct hp_notif_resp)
#ifndef SECCOMP_RET_USER_NOTIF
#define SECCOMP_RET_USER_NOTIF 0x7fc00000U
#endif
#ifndef __NR_faccessat2
#define __NR_faccessat2 439
#endif
#ifndef __NR_openat2
#define __NR_openat2 437
#endif

// Syscalls that take the path in args[0], then those that take it in args[1].
static const int path_arg0[] = {
#ifdef __NR_open
  __NR_open, __NR_stat, __NR_lstat, __NR_readlink, __NR_access,
#endif
  __NR_execve,
};
static const int path_arg1[] = {
  __NR_openat, __NR_openat2, __NR_newfstatat, __NR_statx, __NR_readlinkat, __NR_faccessat, __NR_faccessat2, __NR_execveat,
};
#define N0 ((int)(sizeof(path_arg0) / sizeof(path_arg0[0])))
#define N1 ((int)(sizeof(path_arg1) / sizeof(path_arg1[0])))

static int install_filter(void) {
  struct sock_filter f[N0 + N1 + 6];
  int n = 0, total = N0 + N1;
  f[n++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
  f[n++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, HP_AUDIT_ARCH, 1, 0);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
  for (int i = 0; i < total; i++) {
    int nr = i < N0 ? path_arg0[i] : path_arg1[i - N0];
    // On a match, jump over the remaining compares and the ALLOW to the NOTIF return.
    f[n++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, nr, total - i, 0);
  }
  f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  f[n++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF);
  struct sock_fprog prog = {.len = (unsigned short)n, .filter = f};
  return (int)syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, HP_NEW_LISTENER, &prog);
}

static int send_fd(int sock, int fd) {
  char control[CMSG_SPACE(sizeof(int))] = {0}, byte = 0;
  struct iovec io = {.iov_base = &byte, .iov_len = 1};
  struct msghdr msg = {.msg_iov = &io, .msg_iovlen = 1, .msg_control = control, .msg_controllen = sizeof(control)};
  struct cmsghdr *c = CMSG_FIRSTHDR(&msg);
  c->cmsg_level = SOL_SOCKET;
  c->cmsg_type = SCM_RIGHTS;
  c->cmsg_len = CMSG_LEN(sizeof(int));
  memcpy(CMSG_DATA(c), &fd, sizeof(int));
  return sendmsg(sock, &msg, 0) < 0 ? -1 : 0;
}

static int recv_fd(int sock) {
  char control[CMSG_SPACE(sizeof(int))] = {0}, byte;
  struct iovec io = {.iov_base = &byte, .iov_len = 1};
  struct msghdr msg = {.msg_iov = &io, .msg_iovlen = 1, .msg_control = control, .msg_controllen = sizeof(control)};
  if (recvmsg(sock, &msg, 0) <= 0) return -1;
  struct cmsghdr *c = CMSG_FIRSTHDR(&msg);
  if (!c) return -1;
  int fd;
  memcpy(&fd, CMSG_DATA(c), sizeof(int));
  return fd;
}

static int is_hidden(const char *path, char **hidden, int count) {
  for (int i = 0; i < count; i++) {
    size_t len = strlen(hidden[i]);
    if (strncmp(path, hidden[i], len) == 0 && (path[len] == 0 || path[len] == '/')) return 1;
  }
  return 0;
}

// Reads the NUL-terminated path at `addr` in the child. Returns 0, or -1 if the read is not permitted.
static int read_path(pid_t pid, uint64_t addr, char *out, size_t cap) {
  out[0] = 0;
  if (!addr) return 0;
  // Do not cross into the next page unless the string does: it may be unmapped.
  size_t first = 4096 - (size_t)(addr & 4095);
  if (first > cap - 1) first = cap - 1;
  struct iovec local = {.iov_base = out, .iov_len = first};
  struct iovec remote = {.iov_base = (void *)(uintptr_t)addr, .iov_len = first};
  ssize_t got = process_vm_readv(pid, &local, 1, &remote, 1, 0);
  if (got < 0) return errno == EPERM || errno == ENOSYS ? -1 : 0;
  if (memchr(out, 0, (size_t)got) == NULL && (size_t)got < cap - 1) {
    local.iov_base = out + got;
    remote.iov_base = (void *)(uintptr_t)(addr + (uint64_t)got);
    local.iov_len = remote.iov_len = cap - 1 - (size_t)got;
    ssize_t more = process_vm_readv(pid, &local, 1, &remote, 1, 0);
    got += more > 0 ? more : 0;
  }
  out[got] = 0;
  return 0;
}

int main(int argc, char **argv) {
  int sep = 0;
  for (int i = 1; i < argc && !sep; i++)
    if (strcmp(argv[i], "--") == 0) sep = i;
  if (sep < 2 || sep + 1 >= argc) {
    fprintf(stderr, "usage: %s <hidden path>... -- <command> [args...]\n", argv[0]);
    return 2;
  }
  if (HP_AUDIT_ARCH == 0) return SKIP;

  int pair[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair) != 0) return SKIP;
  pid_t child = fork();
  if (child < 0) return SKIP;
  if (child == 0) {
    close(pair[0]);
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) _exit(SKIP);
    int listener = install_filter();
    if (listener < 0 || send_fd(pair[1], listener) != 0) _exit(SKIP);
    close(listener);
    close(pair[1]);
    execvp(argv[sep + 1], argv + sep + 1);
    perror("execvp");
    _exit(127);
  }
  close(pair[1]);
  int listener = recv_fd(pair[0]);
  close(pair[0]);

  struct hp_notif_sizes sizes = {0};
  if (listener < 0 || syscall(__NR_seccomp, HP_GET_NOTIF_SIZES, 0, &sizes) != 0) {
    kill(child, SIGKILL);
    return SKIP;
  }
  size_t notif_size = sizes.notif > sizeof(struct hp_notif) ? sizes.notif : sizeof(struct hp_notif);
  size_t resp_size = sizes.resp > sizeof(struct hp_notif_resp) ? sizes.resp : sizeof(struct hp_notif_resp);
  struct hp_notif *req = malloc(notif_size);
  struct hp_notif_resp *resp = malloc(resp_size);

  for (;;) {
    struct pollfd pfd = {.fd = listener, .events = POLLIN};
    int ready = poll(&pfd, 1, 100);
    if (ready < 0 && errno != EINTR) break;
    if (ready <= 0 || !(pfd.revents & POLLIN)) {
      int status;
      if (waitpid(child, &status, WNOHANG) == child)
        return WIFSIGNALED(status) ? 128 + WTERMSIG(status) : WEXITSTATUS(status);
      continue;
    }
    memset(req, 0, notif_size);
    if (ioctl(listener, HP_NOTIF_RECV, req) != 0) {
      if (errno == EINTR || errno == ENOENT) continue;
      break;
    }
    int index = 1;
    for (int i = 0; i < N0; i++)
      if (path_arg0[i] == req->data.nr) index = 0;
    char path[4096];
    if (read_path((pid_t)req->pid, req->data.args[index], path, sizeof(path)) != 0) break;

    memset(resp, 0, resp_size);
    resp->id = req->id;
    if (is_hidden(path, argv + 1, sep - 1)) resp->error = -ENOENT;
    else resp->flags = HP_CONTINUE;
    if (ioctl(listener, HP_NOTIF_SEND, resp) != 0 && errno != ENOENT) break;
  }
  // The kernel or the sandbox refused a step. Do not report a result.
  kill(child, SIGKILL);
  waitpid(child, NULL, 0);
  return SKIP;
}

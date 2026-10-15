// LD_PRELOAD shim that plays a remover of directories from inside getdents64(2),
// so that the kernel itself answers the read with ENOENT, with no race. bun
// issues getdents64 through libc's syscall() wrapper, which this interposes.
// Compiled by `removedDirReaddir` in test/harness.ts. What it does to a
// directory depends on the directory's name:
//
//   vanish-before-read  removed (with its inner.txt) before its first read
//   vanish-mid-read     removed (with its inner.txt) after its first read
//                       handed out entries
//   read-fails-eio      every read fails with EIO; it is not removed
//
// Each action appends "<name> <path>" to the file $REMOVED_DIR_READDIR_LOG
// names, so a test can tell the shim saw bun's reads.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*next_syscall)(long, ...);

static void record(const char *name, const char *path) {
  const char *log = getenv("REMOVED_DIR_READDIR_LOG");
  if (!log) return;
  // Opened and closed for each line: bun can exit without running atexit handlers.
  int fd = open(log, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  if (fd < 0) return;
  dprintf(fd, "%s %s\n", name, path);
  close(fd);
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  if (nr != SYS_getdents64) return next_syscall(nr, a1, a2, a3, a4, a5, a6);

  int fd = (int)a1;
  char link[64], target[PATH_MAX];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, target, sizeof target - 1);
  if (n <= 0) return next_syscall(nr, a1, a2, a3, a4, a5, a6);
  target[n] = 0;
  const char *name = strrchr(target, '/');
  name = name ? name + 1 : target;

  if (strcmp(name, "vanish-before-read") == 0) {
    unlinkat(fd, "inner.txt", 0);
    if (rmdir(target) == 0) record(name, target);
  } else if (strcmp(name, "vanish-mid-read") == 0) {
    // After the rmdir the link reads "... (deleted)", so this branch is not
    // taken again and the next read reaches the kernel as it is.
    long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
    if (rc > 0) {
      unlinkat(fd, "inner.txt", 0);
      if (rmdir(target) == 0) record(name, target);
    }
    return rc;
  } else if (strcmp(name, "read-fails-eio") == 0) {
    record(name, target);
    errno = EIO;
    return -1;
  }
  return next_syscall(nr, a1, a2, a3, a4, a5, a6);
}

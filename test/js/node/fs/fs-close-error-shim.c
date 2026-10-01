// LD_PRELOAD shim that stands in for a file system that reports a write error
// at close(2), as NFS, SMB and FUSE can do for ENOSPC, EDQUOT and EIO.
//
// It acts on a file whose name ends with ".<errno>.close-fault", for example
// "copy.28.close-fault" for ENOSPC, through a descriptor that is open for
// writing. A close of such a descriptor releases it, as the kernel does, then
// fails with that errno and writes one line to stderr. With
// CLOSE_FAULT_READERS set, a descriptor that is open for reading counts too
// (FUSE calls flush for each close).
//
// bun closes through syscall(SYS_close, fd), so syscall() is the symbol to
// interpose. glibc only.
#define _GNU_SOURCE
#include <ctype.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#define SUFFIX ".close-fault"

static long (*next_syscall)(long, ...);

// The errno that the close of `fd` reports, or 0.
static int fault_for(int fd) {
  char link[64], target[4096];
  if (fd < 3) return 0;
  int flags = fcntl(fd, F_GETFL);
  if (flags < 0) return 0;
  if ((flags & O_ACCMODE) == O_RDONLY && !getenv("CLOSE_FAULT_READERS")) return 0;
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, target, sizeof target - 1);
  if (n <= (ssize_t)strlen(SUFFIX)) return 0;
  target[n] = 0;
  char *suffix = target + n - strlen(SUFFIX);
  if (strcmp(suffix, SUFFIX) != 0) return 0;
  char *digits = suffix;
  while (digits > target && isdigit((unsigned char)digits[-1])) digits--;
  if (digits == suffix || digits == target || digits[-1] != '.') return 0;
  return atoi(digits);
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  if (nr != SYS_close) return next_syscall(nr, a1, a2, a3, a4, a5, a6);

  int fault = fault_for((int)a1);
  long rc = next_syscall(nr, a1);
  if (fault == 0 || rc != 0) return rc;
  dprintf(2, "close-fault: errno %d\n", fault);
  errno = fault;
  return -1;
}

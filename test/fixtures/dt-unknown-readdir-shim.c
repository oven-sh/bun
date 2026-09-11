// LD_PRELOAD shim: every getdents64 record comes back with d_type == DT_UNKNOWN,
// the way FUSE, some NFS servers and XFS formatted with ftype=0 report entries.
// bun issues getdents64 through libc's syscall() wrapper, which this interposes.
// Compiled by `dtUnknownReaddir` in test/harness.ts, which defines MARKER: it is
// written to stderr the first time a record is rewritten so a test can tell the
// shim actually saw bun's readdir calls.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <stdint.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*real_syscall)(long, long, long, long, long, long, long);
static int announced;

long syscall(long number, ...) {
  va_list ap;
  long a, b, c, d, e, f;
  va_start(ap, number);
  a = va_arg(ap, long);
  b = va_arg(ap, long);
  c = va_arg(ap, long);
  d = va_arg(ap, long);
  e = va_arg(ap, long);
  f = va_arg(ap, long);
  va_end(ap);
  if (!real_syscall) {
    real_syscall = (long (*)(long, long, long, long, long, long, long))dlsym(RTLD_NEXT, "syscall");
  }
  long rc = real_syscall(number, a, b, c, d, e, f);
  if (number != SYS_getdents64 || rc <= 0) return rc;
  if (!announced) {
    announced = 1;
    static const char marker[] = MARKER "\n";
    if (write(2, marker, sizeof(marker) - 1) < 0) {
    }
  }
  // struct linux_dirent64 { u64 d_ino; s64 d_off; u16 d_reclen; u8 d_type; char d_name[]; }
  unsigned char *buf = (unsigned char *)b;
  for (long off = 0; off + 19 <= rc;) {
    uint16_t reclen;
    memcpy(&reclen, buf + off + 16, sizeof(reclen));
    if (reclen == 0) break;
    buf[off + 18] = 0; /* DT_UNKNOWN */
    off += reclen;
  }
  return rc;
}

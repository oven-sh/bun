// A syscall fails with EINTR when a signal arrives while it waits: on a FUSE
// daemon that honors interrupts, on NFS or CIFS, behind a file lease, on a pipe.
// libuv runs an fs request again on EINTR. bun_sys does the same in its wrappers.
// Most of these calls never wait on a local disk, so a preloaded shim fails one
// call of a libc function instead. A row works in a directory named
// "fault-<function>=<errno>[,<function>=<errno>]-<row>". The shim fails the
// first call of each named function on a path or fd below it with that errno,
// and writes "<directory> <function>" to $FS_FAULT_LOG as proof that it fired.
// The shim is an LD_PRELOAD library on Linux and a DYLD_INSERT_LIBRARIES
// library on macOS.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const supported = (isLinux || isMacOS) && !!cc;

const fault = /* c */ `
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
// "<directory> <function>" of each call failed so far.
static char failed[256][160];
static int nfailed;

// The errno that the "fault-..." directory of \`path\` names for \`fn\`, or 0. \`*dir\` is that directory.
static int armed(const char *fn, const char *path, const char **dir) {
  const char *slash = path ? strstr(path, "/fault-") : NULL;
  if (!slash) return 0;
  *dir = slash + 1;
  size_t n = strlen(fn);
  const char *end = *dir + strcspn(*dir, "/");
  for (const char *at = *dir + strlen("fault"); at + n + 2 < end; at++)
    if ((*at == '-' || *at == ',') && strncmp(at + 1, fn, n) == 0 && at[n + 1] == '=') return atoi(at + n + 2);
  return 0;
}

// True, with errno set, for the first call of \`fn\` on a path in a directory that names it.
static int fault(const char *fn, const char *path) {
  const char *dir;
  int error = armed(fn, path, &dir);
  if (!error) return 0;
  char key[160];
  snprintf(key, sizeof key, "%.*s %s", (int)strcspn(dir, "/"), dir, fn);
  pthread_mutex_lock(&lock);
  int i = 0;
  while (i < nfailed && strcmp(failed[i], key) != 0) i++;
  int first = i == nfailed && nfailed < 256;
  if (first) strcpy(failed[nfailed++], key);
  pthread_mutex_unlock(&lock);
  if (!first) return 0;
  int fd = open(getenv("FS_FAULT_LOG"), O_WRONLY | O_APPEND | O_CLOEXEC);
  dprintf(fd, "%s\\n", key);
  close(fd);
  errno = error;
  return 1;
}
`;

const linuxShim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <sys/ioctl.h>
#include <sys/sendfile.h>
#include <sys/syscall.h>
#include <sys/types.h>
#ifndef FICLONE
#define FICLONE _IOW(0x94, 9, int)
#endif
${fault}
static const char *fd_path(int fd, char *path) {
  char link[64];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, path, PATH_MAX - 1);
  if (n <= 0) return NULL;
  path[n] = 0;
  return path;
}

static int fault_fd(const char *fn, int fd) {
  char path[PATH_MAX];
  return fault(fn, fd_path(fd, path));
}

// The count for a sendfile from \`fd\`: at most the "sendfile_most=<bytes>" of its directory. The first cut is logged.
static size_t most(int fd, size_t count) {
  char path[PATH_MAX];
  const char *dir;
  int limit = armed("sendfile_most", fd_path(fd, path), &dir);
  if (limit <= 0 || count <= (size_t)limit) return count;
  fault("sendfile_most", path);
  return limit;
}

#define NEXT(fn) ({ static __typeof__(&fn) next; if (!next) next = dlsym(RTLD_NEXT, #fn); next; })

int unlink(const char *path) { return fault("unlink", path) ? -1 : NEXT(unlink)(path); }
int rmdir(const char *path) { return fault("rmdir", path) ? -1 : NEXT(rmdir)(path); }
int link(const char *from, const char *to) { return fault("link", from) ? -1 : NEXT(link)(from, to); }
int truncate(const char *path, off_t size) { return fault("truncate", path) ? -1 : NEXT(truncate)(path, size); }
int fsync(int fd) { return fault_fd("fsync", fd) ? -1 : NEXT(fsync)(fd); }
int fdatasync(int fd) { return fault_fd("fdatasync", fd) ? -1 : NEXT(fdatasync)(fd); }
int access(const char *path, int mode) { return fault("access", path) ? -1 : NEXT(access)(path, mode); }
char *realpath(const char *path, char *resolved) { return fault("realpath", path) ? NULL : NEXT(realpath)(path, resolved); }
// No <sys/stat.h> here: an old glibc defines stat() inline in it.
int stat(const char *path, void *buf) { return fault("stat", path) ? -1 : NEXT(stat)(path, buf); }
ssize_t sendfile(int out, int in, off_t *offset, size_t count) {
  return fault_fd("sendfile", in) ? -1 : NEXT(sendfile)(out, in, offset, most(in, count));
}

#ifdef __GLIBC__
typedef off64_t splice_offset;
// The names that glibc gives the same calls in a program built with 64-bit offsets, or against a glibc before 2.33.
int truncate64(const char *path, off64_t size) { return fault("truncate", path) ? -1 : NEXT(truncate64)(path, size); }
int stat64(const char *path, void *buf) { return fault("stat", path) ? -1 : NEXT(stat64)(path, buf); }
int __xstat(int version, const char *path, void *buf) { return fault("stat", path) ? -1 : NEXT(__xstat)(version, path, buf); }
int __xstat64(int version, const char *path, void *buf) { return fault("stat", path) ? -1 : NEXT(__xstat64)(version, path, buf); }
ssize_t sendfile64(int out, int in, off64_t *offset, size_t count) {
  return fault_fd("sendfile", in) ? -1 : NEXT(sendfile64)(out, in, offset, most(in, count));
}
#else
typedef off_t splice_offset;
#endif

ssize_t splice(int in, splice_offset *in_offset, int out, splice_offset *out_offset, size_t count, unsigned flags) {
  return fault_fd("splice", in) ? -1 : NEXT(splice)(in, in_offset, out, out_offset, count, flags);
}

char *mkdtemp(char *template) {
  if (!fault("mkdtemp", template)) return NEXT(mkdtemp)(template);
  // glibc leaves the name it tried in the template when the mkdir(2) of it fails.
  memcpy(template + strlen(template) - 6, "tried1", 6);
  return NULL;
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  char path[PATH_MAX];
  const char *dir;
  if (nr == SYS_copy_file_range && fault_fd("copy_file_range", (int)a1)) return -1;
  if (nr == SYS_sendfile) {
    if (fault_fd("sendfile", (int)a2)) return -1;
    a4 = (long)most((int)a2, (size_t)a4);
  }
  // The clone after the failed one succeeds, as on a file system that has clones. Nothing is cloned.
  if (nr == SYS_ioctl && (unsigned long)a2 == FICLONE && armed("ioctl_ficlone", fd_path((int)a1, path), &dir))
    return fault("ioctl_ficlone", path) ? -1 : 0;
  return NEXT(syscall)(nr, a1, a2, a3, a4, a5, a6);
}
`;

const macShim = /* c */ `
#include <copyfile.h>
#include <stdint.h>
#include <sys/clonefile.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/uio.h>
${fault}
static int fault_fd(const char *fn, int fd) {
  char path[PATH_MAX];
  return fcntl(fd, F_GETPATH, path) == 0 && fault(fn, path);
}

static int shim_access(const char *path, int mode) { return fault("access", path) ? -1 : access(path, mode); }
static int shim_faccessat(int dir, const char *path, int mode, int flag) {
  return fault("faccessat", path) ? -1 : faccessat(dir, path, mode, flag);
}
static int shim_clonefile(const char *from, const char *to, uint32_t flags) {
  return fault("clonefile", from) ? -1 : clonefile(from, to, flags);
}
static int shim_copyfile(const char *from, const char *to, copyfile_state_t state, copyfile_flags_t flags) {
  return fault("copyfile", from) ? -1 : copyfile(from, to, state, flags);
}
static int shim_fcopyfile(int from, int to, copyfile_state_t state, copyfile_flags_t flags) {
  return fault_fd("fcopyfile", from) ? -1 : fcopyfile(from, to, state, flags);
}
// The kernel reports in *sent the bytes that it sent before it failed.
static int shim_sendfile(int file, int to, off_t offset, off_t *sent, struct sf_hdtr *headers, int flags) {
  // The call fails before it sends a byte.
  if (fault_fd("sendfile", file)) {
    *sent = 0;
    return -1;
  }
  // The call fails after it sent 4096 bytes.
  if (fault_fd("sendfile_some", file)) {
    int error = errno;
    *sent = 4096;
    if (sendfile(file, to, offset, sent, headers, flags) == 0) errno = error;
    return -1;
  }
  off_t asked = *sent;
  int result = sendfile(file, to, offset, sent, headers, flags);
  // The call fails although it sent the whole count. XNU does so with EAGAIN when the last chunk fills the socket buffer.
  return *sent == asked && fault_fd("sendfile_sent", file) ? -1 : result;
}

__attribute__((used, section("__DATA,__interpose"))) static const struct {
  const void *replacement, *original;
} interpose[] = {
  {(const void *)shim_access, (const void *)access},
  {(const void *)shim_faccessat, (const void *)faccessat},
  {(const void *)shim_clonefile, (const void *)clonefile},
  {(const void *)shim_copyfile, (const void *)copyfile},
  {(const void *)shim_fcopyfile, (const void *)fcopyfile},
  {(const void *)shim_sendfile, (const void *)sendfile},
};
`;

/** Compiles shim.c in `dir`. Returns the path of the library. */
function buildShim(dir: string) {
  const source = join(dir, "shim.c");
  const shim = join(dir, "shim.so");
  const { exitCode, stderr } = Bun.spawnSync({
    cmd: isMacOS ? [cc!, "-dynamiclib", "-o", shim, source] : [cc!, "-shared", "-fPIC", "-o", shim, source, "-ldl"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (exitCode !== 0) throw new Error(`Failed to build the fault shim:\n${stderr}`);
  return shim;
}

describe.skipIf(!supported)("under a shim that fails a libc call once", () => {
  // This body runs when the tests are skipped too.
  const shimDir = supported ? tempDir("fs-eintr-shim", { "shim.c": isMacOS ? macShim : linuxShim }) : undefined;
  afterAll(() => shimDir?.[Symbol.dispose]());
  // Built while the tests are collected: a compiler that is not in the page cache takes seconds to start.
  const shim = shimDir ? buildShim(String(shimDir)) : "";

  /** The rows of `mode` in fs-eintr-syscalls-fixture.ts. `shim` in a row lists the libc calls that the shim failed. */
  async function run(mode: string, env: Record<string, string> = {}) {
    using dir = tempDir(`fs-eintr-${mode}`, { "shim.log": "" });
    const preload = isMacOS ? "DYLD_INSERT_LIBRARIES" : "LD_PRELOAD";
    const existing = bunEnv[preload];
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fs-eintr-syscalls-fixture.ts"), mode],
      env: {
        ...bunEnv,
        ...env,
        [preload]: existing ? `${shim}:${existing}` : shim,
        FS_FAULT_LOG: join(String(dir), "shim.log"),
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    return { rows: JSON.parse(stdout), exitCode };
  }

  // Without the clone, every copy below reaches copy_file_range on every file system.
  const noClone = { BUN_CONFIG_DISABLE_ioctl_ficlonerange: "1" };

  // One child at a time: debug builds that start together take most of the 5 seconds of a test each.
  test.skipIf(!isLinux)("a call that fails with EINTR runs again", async () => {
    const { rows, exitCode } = await run("interrupted");
    expect(rows).toEqual({
      unlinkSync: { result: [], shim: ["unlink"] },
      unlink: { result: [], shim: ["unlink"] },
      rmdirSync: { result: [], shim: ["rmdir"] },
      rmdir: { result: [], shim: ["rmdir"] },
      linkSync: { result: 2, shim: ["link"] },
      truncateSync: { result: "0123", shim: ["truncate"] },
      fsyncSync: { result: "synced", shim: ["fsync"] },
      fdatasyncSync: { result: "synced", shim: ["fdatasync"] },
      mkdtempSync: { result: 10, shim: ["mkdtemp"] },
      // existsSync asks the kernel without libc here, where the shim cannot fail it.
      // accessSync shows that a call of access() on this path does fail.
      existsSync: { result: true, shim: [] },
      accessSync: { result: "accessible", shim: ["access"] },
      which: { result: true, shim: ["stat"] },
      compileCacheDir: { result: true, shim: ["realpath"] },
    });
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("a copy that fails with EINTR runs again", async () => {
    const { rows, exitCode } = await run("interruptedCopy", noClone);
    expect(rows).toEqual({
      cpSync: { result: true, shim: ["copy_file_range"] },
      cpSyncEmpty: { result: "", shim: ["copy_file_range"] },
      cp: { result: true, shim: ["copy_file_range"] },
      copyFileSync: { result: true, shim: ["copy_file_range"] },
      bunWrite: { result: { written: 10000, same: true }, shim: ["copy_file_range"] },
      bunWriteToDevice: { result: 10000, shim: ["sendfile"] },
      bunWriteFifo: { result: { written: 10, received: "0123456789" }, shim: ["splice"] },
      fetchFile: { result: true, shim: ["sendfile"] },
      fetchFileSlice: { result: true, shim: ["sendfile"] },
      fetchFileInParts: { result: true, shim: ["sendfile_most"] },
    });
    expect(exitCode).toBe(0);
  });

  // Each row fails its first clone. The row after it shows that the failure did not turn clones off.
  test.skipIf(!isLinux)("a clone that fails with EINTR runs again", async () => {
    const { rows, exitCode } = await run("cloned");
    const cloned = { result: "cloned", shim: ["ioctl_ficlone"] };
    expect(rows).toEqual({ forced: cloned, copyFileSync: cloned, cpSync: cloned, cp: cloned, last: cloned });
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("a call that fails with another errno reports it", async () => {
    const { rows, exitCode } = await run("failed", noClone);
    expect(rows).toEqual({
      // Node names this syscall "copyfile" too, with both paths.
      copyFileSync: {
        result: { code: "ENOSPC", errno: -28, syscall: "copyfile", path: "file.txt", dest: "copy.txt" },
        shim: ["copy_file_range"],
      },
      cpSync: {
        result: { code: "ENOSPC", errno: -28, syscall: "copy_file_range", path: "copy.txt" },
        shim: ["copy_file_range"],
      },
      bunWrite: {
        result: { code: "ENOSPC", errno: -28, syscall: "copy_file_range", path: "file.txt" },
        shim: ["copy_file_range"],
      },
      // 524 is the errno of the kernel. EUNKNOWN is the name for a number that bun has no name for.
      unlinkSync: { result: { code: "EUNKNOWN", errno: -524, syscall: "unlink", path: "file.txt" }, shim: ["unlink"] },
      accessSync: { result: { code: "EUNKNOWN", errno: -524, syscall: "access", path: "file.txt" }, shim: ["access"] },
      fetchFile: { result: "EIO", shim: ["sendfile"] },
    });
    expect(exitCode).toBe(0);
  });

  // The calls that only macOS makes. The rows above run the code that both systems share.
  test.skipIf(!isMacOS)("a macOS call that fails with EINTR runs again", async () => {
    const { rows, exitCode } = await run("darwin");
    expect(rows).toEqual({
      existsSync: { result: true, shim: ["faccessat"] },
      accessSync: { result: "accessible", shim: ["access"] },
      cloneForced: { result: true, shim: ["clonefile"] },
      // The clone runs again. A copy that fell back to copyfile() would fail there.
      copyFileSync: { result: true, shim: ["clonefile"] },
      cpSync: { result: true, shim: ["clonefile"] },
      // A file system without clones: clonefile fails with ENOTSUP, and copyfile() or fcopyfile() runs again.
      copyFileWithoutClone: { result: true, shim: ["clonefile", "copyfile"] },
      bunWriteWithoutClone: { result: true, shim: ["clonefile", "fcopyfile"] },
      fetchFile: { result: true, shim: ["sendfile"] },
      fetchFileSlice: { result: true, shim: ["sendfile"] },
      // The rest of the file goes out from where the first call stopped.
      fetchFileAfterSomeBytes: { result: true, shim: ["sendfile_some"] },
      // The upload is complete. It is not an error.
      fetchFileBufferFull: { result: true, shim: ["sendfile_sent"] },
      // A count of 0 asks the kernel for the rest of the file. No call is made.
      fetchFileEmptySlice: { result: true, shim: [] },
    });
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isMacOS)("a macOS sendfile that fails with another errno reports it", async () => {
    const { rows, exitCode } = await run("darwinFailed");
    expect(rows).toEqual({ fetchFile: { result: "EIO", shim: ["sendfile"] } });
    expect(exitCode).toBe(0);
  });
});

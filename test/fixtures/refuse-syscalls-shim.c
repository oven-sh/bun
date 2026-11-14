// A dyld interposer for macOS. It makes chosen calls fail the way a file system without that operation does.
//
//   REFUSE_SYSCALLS       `call=ERRNO` entries, comma-separated: `clonefileat=ENOTSUP,linkat=EXDEV`.
//                         Calls: clonefileat, linkat, symlink, fcopyfile. ERRNO is a name from `errnos`.
//   REFUSED_SYSCALLS_LOG  a file that gets one line, the name of the call, for each refusal.
//
// The kernel looks the names up before it asks the file system, so a call that would fail with ENOENT or EEXIST
// still does. `symlink` is refused only for a link in a `.bin` directory: the isolated linker needs its other
// symlinks.

#include <copyfile.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/clonefile.h>
#include <sys/stat.h>
#include <unistd.h>

static const struct {
  const char *name;
  int value;
} errnos[] = {
  {"EACCES", EACCES},
  {"EMLINK", EMLINK},
  {"ENOSYS", ENOSYS},
  {"ENOTSUP", ENOTSUP},
  {"EOPNOTSUPP", EOPNOTSUPP},
  {"EPERM", EPERM},
  {"EXDEV", EXDEV},
};

// The errno that REFUSE_SYSCALLS names for `call`, or 0.
static int refusal(const char *call) {
  const char *entry = getenv("REFUSE_SYSCALLS");
  size_t call_len = strlen(call);
  while (entry && *entry) {
    const char *end = strchr(entry, ',');
    size_t len = end ? (size_t)(end - entry) : strlen(entry);
    if (len > call_len && entry[call_len] == '=' && strncmp(entry, call, call_len) == 0) {
      const char *name = entry + call_len + 1;
      size_t name_len = len - call_len - 1;
      for (size_t i = 0; i < sizeof(errnos) / sizeof(errnos[0]); i++) {
        if (strlen(errnos[i].name) == name_len && strncmp(errnos[i].name, name, name_len) == 0) return errnos[i].value;
      }
      fprintf(stderr, "refuse-syscalls-shim: no errno named %.*s\n", (int)name_len, name);
      abort();
    }
    entry = end ? end + 1 : NULL;
  }
  return 0;
}

static int refuse(const char *call, int error) {
  const char *log = getenv("REFUSED_SYSCALLS_LOG");
  int fd = log ? open(log, O_WRONLY | O_CREAT | O_APPEND, 0644) : -1;
  if (fd >= 0) {
    dprintf(fd, "%s\n", call);
    close(fd);
  }
  errno = error;
  return -1;
}

// `src` is NULL for a call that does not look its source up.
static int refuse_at(const char *call, int error, int src_dirfd, const char *src, int dst_dirfd, const char *dst) {
  struct stat st;
  char parent[PATH_MAX];
  const char *slash = strrchr(dst, '/');
  if (src && fstatat(src_dirfd, src, &st, AT_SYMLINK_NOFOLLOW) != 0) return -1;
  if (fstatat(dst_dirfd, dst, &st, AT_SYMLINK_NOFOLLOW) == 0) {
    errno = EEXIST;
    return -1;
  }
  if (slash && slash != dst && (size_t)(slash - dst) < sizeof(parent)) {
    memcpy(parent, dst, slash - dst);
    parent[slash - dst] = 0;
    if (fstatat(dst_dirfd, parent, &st, 0) != 0) return -1;
  }
  return refuse(call, error);
}

static int refusing_clonefileat(int src_dirfd, const char *src, int dst_dirfd, const char *dst, uint32_t flags) {
  int error = refusal("clonefileat");
  if (!error) return clonefileat(src_dirfd, src, dst_dirfd, dst, flags);
  return refuse_at("clonefileat", error, src_dirfd, src, dst_dirfd, dst);
}

static int refusing_linkat(int src_dirfd, const char *src, int dst_dirfd, const char *dst, int flags) {
  int error = refusal("linkat");
  if (!error) return linkat(src_dirfd, src, dst_dirfd, dst, flags);
  return refuse_at("linkat", error, src_dirfd, src, dst_dirfd, dst);
}

static int refusing_symlink(const char *target, const char *path) {
  int error = refusal("symlink");
  if (!error || !strstr(path, "/.bin/")) return symlink(target, path);
  return refuse_at("symlink", error, AT_FDCWD, NULL, AT_FDCWD, path);
}

// libcopyfile answers ENOTSUP for a source that is not a regular file, a directory or a symlink.
static int refusing_fcopyfile(int from, int to, copyfile_state_t state, copyfile_flags_t flags) {
  int error = refusal("fcopyfile");
  if (!error) return fcopyfile(from, to, state, flags);
  return refuse("fcopyfile", error);
}

__attribute__((used, section("__DATA,__interpose"))) static const struct {
  const void *replacement, *original;
} interpose[] = {
  {(const void *)refusing_clonefileat, (const void *)clonefileat},
  {(const void *)refusing_linkat, (const void *)linkat},
  {(const void *)refusing_symlink, (const void *)symlink},
  {(const void *)refusing_fcopyfile, (const void *)fcopyfile},
};

import { bunEnv } from "harness";
import { join } from "node:path";

// The kernel gives a process no path for its executable when /proc is not mounted. This LD_PRELOAD library fails that
// read in the child, and disables core files, which CI's runner takes for a crash. Linux only.
const source = /* c */ `
#define _GNU_SOURCE
#include <dirent.h>
#include <dlfcn.h>
#include <errno.h>
#include <string.h>
#include <sys/auxv.h>
#include <sys/resource.h>
#include <unistd.h>

__attribute__((constructor)) static void no_core(void) {
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
}

ssize_t readlink(const char *path, char *buf, size_t len) {
  static ssize_t (*real)(const char *, char *, size_t);
  if (!real) real = dlsym(RTLD_NEXT, "readlink");
  if (strcmp(path, "/proc/self/exe") == 0) {
    errno = ENOENT;
    return -1;
  }
  return real(path, buf, len);
}

#ifdef HIDE_EXECUTED_PATH
unsigned long getauxval(unsigned long type) {
  static unsigned long (*real)(unsigned long);
  if (!real) real = dlsym(RTLD_NEXT, "getauxval");
  if (type == AT_EXECFN) {
    errno = ENOENT;
    return 0;
  }
  return real(type);
}
#endif

#ifdef HIDE_OPEN_DESCRIPTORS
DIR *opendir(const char *path) {
  static DIR *(*real)(const char *);
  if (!real) real = dlsym(RTLD_NEXT, "opendir");
  if (strcmp(path, "/proc/self/fd") == 0) {
    errno = ENOENT;
    return NULL;
  }
  return real(path);
}
#endif
`;

export const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

/**
 * Compiles the library into `dir` and returns the environment of a child that cannot read the path of its executable
 * from /proc. The child still has the two names that `execve` left: the path the kernel executed and `argv[0]`.
 *
 * - `hideExecutedPath` takes the path the kernel executed away too. A child that is also started with an `argv0` that
 *   is no path has no name for its executable.
 * - `hideOpenDescriptors` takes the list of open descriptors in /proc/self/fd away too.
 */
export async function envWithoutExePath(
  dir: string,
  { hideExecutedPath = false, hideOpenDescriptors = false } = {},
): Promise<Record<string, string | undefined>> {
  const defines = [hideExecutedPath && "-DHIDE_EXECUTED_PATH", hideOpenDescriptors && "-DHIDE_OPEN_DESCRIPTORS"].filter(
    define => typeof define === "string",
  );
  const library = join(dir, `no-exe-path${defines.join("")}.so`);
  await Bun.write(join(dir, "no-exe-path.c"), source);
  await using compiler = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", ...defines, "-o", library, join(dir, "no-exe-path.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    compiler.stdout.text(),
    compiler.stderr.text(),
    compiler.exited,
  ]);
  if (exitCode !== 0) throw new Error(`cc failed: ${stderr || stdout}`);
  const existing = bunEnv.LD_PRELOAD;
  return { ...bunEnv, LD_PRELOAD: existing ? `${library}:${existing}` : library };
}

import { bunEnv } from "harness";
import { join } from "node:path";

// The kernel gives a process no path for its executable when /proc is not mounted. This LD_PRELOAD library fails that
// read in the child, and disables core files, which CI's runner takes for a crash. Linux only.
// With PROC_MOUNTED_WHEN_EXISTS it fails every link under /proc instead, until the file that the variable names exists.
const source = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <unistd.h>

__attribute__((constructor)) static void no_core(void) {
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
}

ssize_t readlink(const char *path, char *buf, size_t len) {
  static ssize_t (*real)(const char *, char *, size_t);
  if (!real) real = dlsym(RTLD_NEXT, "readlink");
  const char *mounted = getenv("PROC_MOUNTED_WHEN_EXISTS");
  int fails = mounted ? strncmp(path, "/proc/", 6) == 0 && access(mounted, F_OK) != 0
                      : strcmp(path, "/proc/self/exe") == 0;
  if (fails) {
    errno = ENOENT;
    return -1;
  }
  return real(path, buf, len);
}
`;

export const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

/**
 * Compiles the library into `dir` and returns the environment of a child that cannot read the path of its executable.
 * With `procMountedWhenExists`, the child is as a process that started before /proc was mounted: it reads no link
 * under /proc until that file exists.
 */
export async function envWithoutExePath(
  dir: string,
  procMountedWhenExists?: string,
): Promise<Record<string, string | undefined>> {
  const library = join(dir, "no-exe-path.so");
  await Bun.write(join(dir, "no-exe-path.c"), source);
  await using compiler = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", library, join(dir, "no-exe-path.c"), "-ldl"],
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
  return {
    ...bunEnv,
    LD_PRELOAD: existing ? `${library}:${existing}` : library,
    PROC_MOUNTED_WHEN_EXISTS: procMountedWhenExists,
  };
}

// Launcher that execve()s argv[1..] with an environ containing duplicate keys.
// The kernel accepts duplicate KEY= entries; libc getenv() resolves to the
// first occurrence. Used by duplicate-env.test.ts to verify bun's process.env
// agrees with libc (first-wins), matching Node.

#include <stdio.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <exe> [args...]\n", argv[0]);
    return 2;
  }
  char *env[] = {
    "BUN_DUP_KEY=/first",
    "BUN_DUP_KEY=/second",
    "NODE_TLS_REJECT_UNAUTHORIZED=1",
    "NODE_TLS_REJECT_UNAUTHORIZED=0",
    "NODE_ENV=from_first",
    "NODE_ENV=from_second",
    "PATH=/usr/bin:/bin:/usr/local/bin",
    "BUN_DEBUG_QUIET_LOGS=1",
    "NO_COLOR=1",
    0,
  };
  execve(argv[1], &argv[1], env);
  perror("execve");
  return 127;
}

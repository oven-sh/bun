#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// Launches argv[1] with argv[1..] as its argv and a hand-built envp whose first
// entry is the bare word "FOOBAR" (no '='). POSIX says environ entries are
// "name=value"; a bare name is malformed and libc getenv() ignores it.
int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <exe> [args...]\n", argv[0]);
    return 2;
  }

  const char *path = getenv("PATH");
  char path_buf[4096];
  snprintf(path_buf, sizeof(path_buf), "PATH=%s", path ? path : "/usr/bin:/bin");

  char *envp[] = {
      "FOOBAR",
      path_buf,
      "BUN_DEBUG_QUIET_LOGS=1",
      "NO_COLOR=1",
      NULL,
  };

  execve(argv[1], &argv[1], envp);
  perror("execve");
  return 127;
}

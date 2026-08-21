// LD_PRELOAD shim for thread-spawn-fail.test.ts: while the file named by
// REFUSE_THREADS_WHILE_EXISTS exists, every pthread_create fails with EAGAIN,
// the way it does at a thread or pid limit. Each refusal is logged to stderr so
// the test can count the attempts.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <unistd.h>

static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static const char *marker;

// Without the fix the child aborts. No core file, so CI does not count that as
// a crash of the test runner; RLIMIT_CORE survives exec.
__attribute__((constructor)) static void init(void) {
  struct rlimit rl = {0, 0};
  setrlimit(RLIMIT_CORE, &rl);
  marker = getenv("REFUSE_THREADS_WHILE_EXISTS");
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  if (!real_pthread_create) real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  if (marker && access(marker, F_OK) == 0) {
    static const char line[] = "shim: pthread_create refused\n";
    write(2, line, sizeof(line) - 1);
    return EAGAIN;
  }
  return real_pthread_create(thread, attr, start, arg);
}

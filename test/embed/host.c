// A small program hosting Bun through libbun's C API
// (packages/bun-embed/bun_embed.h), driven by embed.test.ts.
//
//   host <libbun.dylib> run <bun argv...>     one run; prints on_exit/exit
//   host <libbun.dylib> twice <bun argv...>   the same run twice (second is refused)
//   host <libbun.dylib> serve <bun argv...>   run; request exit 7 once $STOP_FILE exists
//   host <libbun.dylib> park <bun argv...>    a run that cannot return; wait for on_exit
#include <dlfcn.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>

#include "../../packages/bun-embed/bun_embed.h"

typedef int (*run_fn)(int, const char *const *, const char *const *, void (*)(int, void *), void *);
typedef void (*request_exit_fn)(int);
typedef const char *(*version_fn)(void);

static run_fn bun_run;
static request_exit_fn bun_request_exit;
static version_fn bun_version;
static volatile int on_exit_code = -1;

static void on_exit_cb(int code, void *user) {
  on_exit_code = code;
  printf("on_exit=%d user=%s\n", code, (const char *)user);
  fflush(stdout);
}

static void *stop_watcher(void *arg) {
  const char *stop_file = arg;
  struct stat st;
  while (stat(stop_file, &st) != 0) usleep(20 * 1000);
  bun_request_exit(7);
  return NULL;
}

struct run_args { int argc; const char *const *argv; const char *const *envp; };

static void *run_thread(void *p) {
  struct run_args *a = p;
  int code = bun_run(a->argc, a->argv, a->envp, on_exit_cb, "u");
  printf("returned=%d\n", code); // not reached in `park` mode
  fflush(stdout);
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 4) {
    fprintf(stderr, "usage: host <libbun> <mode> <bun argv...>\n");
    return 2;
  }
  // RTLD_GLOBAL: native addons resolve napi_* against the process.
  void *lib = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!lib) {
    fprintf(stderr, "dlopen: %s\n", dlerror());
    return 2;
  }
  bun_run = (run_fn)dlsym(lib, "bun_embed_run");
  bun_request_exit = (request_exit_fn)dlsym(lib, "bun_embed_request_exit");
  bun_version = (version_fn)dlsym(lib, "bun_embed_version");
  if (!bun_run || !bun_request_exit || !bun_version) {
    fprintf(stderr, "dlsym: %s\n", dlerror());
    return 2;
  }
  if (dlsym(lib, "main")) {
    fprintf(stderr, "libbun must not export main\n");
    return 2;
  }
  printf("version=%s\n", bun_version());
  fflush(stdout);

  const char *mode = argv[2];
  const char *const *bun_argv = (const char *const *)argv + 3;
  int bun_argc = argc - 3;
  const char *envp[] = {"BUN_EMBED_TEST_VAR=from-envp", NULL};

  if (strcmp(mode, "run") == 0) {
    int code = bun_run(bun_argc, bun_argv, envp, on_exit_cb, "u");
    printf("exit=%d\n", code);
    printf("host alive\n");
    return 0;
  }
  if (strcmp(mode, "twice") == 0) {
    int first = bun_run(bun_argc, bun_argv, NULL, NULL, NULL);
    int second = bun_run(bun_argc, bun_argv, NULL, NULL, NULL);
    printf("first=%d second=%d\n", first, second);
    return 0;
  }
  if (strcmp(mode, "serve") == 0) {
    pthread_t t;
    pthread_create(&t, NULL, stop_watcher, (void *)getenv("STOP_FILE"));
    int code = bun_run(bun_argc, bun_argv, NULL, on_exit_cb, "u");
    pthread_join(t, NULL);
    printf("exit=%d\n", code);
    printf("host alive\n");
    return 0;
  }
  if (strcmp(mode, "park") == 0) {
    // Runs Bun on another thread; that thread never comes back, the
    // callback is how the host learns the code.
    struct run_args a = {bun_argc, bun_argv, NULL};
    pthread_t t;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 8 << 20);
    pthread_create(&t, &attr, run_thread, &a);
    while (on_exit_code < 0) usleep(10 * 1000);
    printf("host alive\n");
    fflush(stdout);
    _exit(0);
  }
  fprintf(stderr, "unknown mode %s\n", mode);
  return 2;
}

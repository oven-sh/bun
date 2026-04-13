#include <node_api.h>

#include <signal.h>
#include <stdio.h>
#include <unistd.h>
#include <uv.h>

static void thread_entry(void *arg) {
  int *counter = (int *)arg;
  *counter = 42;
}

napi_value Init(napi_env env, napi_value exports) {
  uv_pid_t pid = uv_os_getpid();
  printf("%d\n", pid);

  // uv_thread_self + uv_thread_equal: self must equal self.
  uv_thread_t self1 = uv_thread_self();
  uv_thread_t self2 = uv_thread_self();
  if (!uv_thread_equal(&self1, &self2)) {
    printf("FAIL: uv_thread_equal(self, self)\n");
    return NULL;
  }

  // uv_thread_create + uv_thread_join: spawn a thread, join, verify it ran.
  int counter = 0;
  uv_thread_t tid;
  if (uv_thread_create(&tid, thread_entry, &counter) != 0) {
    printf("FAIL: uv_thread_create\n");
    return NULL;
  }
  if (uv_thread_join(&tid) != 0) {
    printf("FAIL: uv_thread_join\n");
    return NULL;
  }
  if (counter != 42) {
    printf("FAIL: thread did not run (counter=%d)\n", counter);
    return NULL;
  }

  // uv_thread_create_ex: with a custom stack size.
  counter = 0;
  uv_thread_options_t opts;
  opts.flags = UV_THREAD_HAS_STACK_SIZE;
  opts.stack_size = 128 * 1024;
  if (uv_thread_create_ex(&tid, &opts, thread_entry, &counter) != 0) {
    printf("FAIL: uv_thread_create_ex\n");
    return NULL;
  }
  if (uv_thread_join(&tid) != 0) {
    printf("FAIL: uv_thread_join (ex)\n");
    return NULL;
  }
  if (counter != 42) {
    printf("FAIL: uv_thread_create_ex thread did not run (counter=%d)\n",
           counter);
    return NULL;
  }

  // uv_thread_detach: spawn, detach, let it run to completion on its own.
  counter = 0;
  if (uv_thread_create(&tid, thread_entry, &counter) != 0) {
    printf("FAIL: uv_thread_create (detach)\n");
    return NULL;
  }
  if (uv_thread_detach(&tid) != 0) {
    printf("FAIL: uv_thread_detach\n");
    return NULL;
  }

  printf("THREAD_OK\n");
  return NULL;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

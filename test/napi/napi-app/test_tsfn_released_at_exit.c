// A threadsafe function released from an env cleanup hook (the usual way an
// addon tears one down) queues its last dispatch on the event loop right as
// the env is being torn down. The env's teardown used to be the loop's last
// turn, so the queued task could never run. Now an env that waits for its
// async cleanup hooks turns the loop again, and that task is dispatched: the
// threadsafe function has to stay allocated until the task has been taken off
// the loop, and be freed after that (ASAN sees either mistake).
//
// start("release"): just that. Load this addon before one that waits (the
// other env's wait dispatches the task), or in a Worker (the Worker's teardown
// releases the task unrun); either way the function is freed exactly once.
//
// start("rearm"): in addition, the function's finalizer, which teardown runs,
// registers an async cleanup hook that completes from a thread. The same env
// then waits in a second round of hooks and dispatches its own stale task.
#include <node_api.h>
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#define THREAD_RETURN DWORD WINAPI
static void thread_sleep_ms(int ms) { Sleep(ms); }
static int thread_start(LPTHREAD_START_ROUTINE body, void* arg) {
  HANDLE thread = CreateThread(NULL, 0, body, arg, 0, NULL);
  if (thread == NULL) return 0;
  CloseHandle(thread);
  return 1;
}
#else
#include <pthread.h>
#include <unistd.h>
#define THREAD_RETURN void*
static void thread_sleep_ms(int ms) { usleep(ms * 1000); }
static int thread_start(void* (*body)(void*), void* arg) {
  pthread_t thread;
  if (pthread_create(&thread, NULL, body, arg) != 0) return 0;
  pthread_detach(thread);
  return 1;
}
#endif

static void print_line(const char* line) {
  printf("%s\n", line);
  fflush(stdout);
}

static napi_threadsafe_function tsfn;
static int rearm;

static THREAD_RETURN complete_thread(void* arg) {
  thread_sleep_ms(50);
  print_line("async hook: done");
  napi_remove_async_cleanup_hook((napi_async_cleanup_hook_handle)arg);
  return 0;
}

static void async_hook(napi_async_cleanup_hook_handle handle, void* data) {
  print_line("async hook: called");
  if (!thread_start(complete_thread, handle)) {
    print_line("async hook: thread_start failed");
    napi_remove_async_cleanup_hook(handle);
  }
}

static void tsfn_finalizer(napi_env env, void* data, void* hint) {
  if (!rearm) {
    print_line("tsfn finalizer");
    return;
  }
  napi_status status = napi_add_async_cleanup_hook(env, async_hook, NULL, NULL);
  printf("tsfn finalizer: registered an async cleanup hook, status=%d\n", (int)status);
  fflush(stdout);
}

static void call_js(napi_env env, napi_value js_callback, void* context, void* data) {}

static void release_at_exit(void* data) {
  napi_status status = napi_release_threadsafe_function(tsfn, napi_tsfn_release);
  printf("released tsfn at exit: status=%d\n", (int)status);
  fflush(stdout);
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  char mode[16] = {0};
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc >= 1) {
    napi_get_value_string_utf8(env, argv[0], mode, sizeof mode, NULL);
  }
  if (strcmp(mode, "rearm") == 0) {
    rearm = 1;
  } else if (strcmp(mode, "release") != 0) {
    napi_throw_error(env, NULL, "unknown mode");
    return NULL;
  }

  napi_value name;
  napi_status status = napi_create_string_utf8(env, "released at exit", NAPI_AUTO_LENGTH, &name);
  if (status == napi_ok) {
    status = napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, NULL, tsfn_finalizer, NULL, call_js, &tsfn);
  }
  if (status == napi_ok) {
    // The function must not be what keeps the process (or Worker) running.
    status = napi_unref_threadsafe_function(env, tsfn);
  }
  if (status == napi_ok) {
    status = napi_add_env_cleanup_hook(env, release_at_exit, NULL);
  }
  printf("started: %s status=%d\n", mode, (int)status);
  fflush(stdout);
  return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &fn);
  napi_set_named_property(env, exports, "start", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

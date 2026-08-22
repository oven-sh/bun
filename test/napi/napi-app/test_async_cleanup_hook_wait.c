// Env teardown has to wait for an async cleanup hook until the addon calls
// napi_remove_async_cleanup_hook on its handle, and has to keep turning the
// event loop meanwhile, because that is how the completion gets back to the
// thread that runs the teardown (Node: Environment::CleanupHandles()). Only
// then do the env's finalizers run.
//
// arm(mode) registers two hooks. Teardown calls hooks in reverse registration
// order, so "late" runs first and defers its completion in the way `mode`
// selects, and "early" runs second and completes at once. An instance data
// finalizer then reports which hooks had completed by the time it ran. The
// lines come out in the same order under Node and Bun:
//
//   late: hook
//   early: hook
//   early: done
//   late: done
//   instance data finalizer: early done=1 late done=1
//
// A teardown that does not wait prints the finalizer line with "late done=0"
// right after "early: done", whatever the late completion does afterwards.
//
// mode "tsfn": the late hook hands its handle to a thread. The thread reports
// back through a threadsafe function the hook created, and the function's
// callback, on the env's thread, completes the hook.
//
// mode "thread": the late hook hands its handle to a thread and that thread
// completes it directly, after a short sleep so the teardown is already waiting.
//
// mode "never": the late hook never completes. A teardown that waits never
// ends (as in Node); this is for the exits that must not wait.
#include <node_api.h>
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
typedef HANDLE thread_t;
#define THREAD_RETURN DWORD WINAPI
static void thread_sleep_ms(int ms) { Sleep(ms); }
static int thread_start(thread_t* thread, LPTHREAD_START_ROUTINE body, void* arg) {
  *thread = CreateThread(NULL, 0, body, arg, 0, NULL);
  return *thread != NULL;
}
static void thread_join(thread_t thread) {
  WaitForSingleObject(thread, INFINITE);
  CloseHandle(thread);
}
#else
#include <pthread.h>
#include <unistd.h>
typedef pthread_t thread_t;
#define THREAD_RETURN void*
static void thread_sleep_ms(int ms) { usleep(ms * 1000); }
static int thread_start(thread_t* thread, void* (*body)(void*), void* arg) {
  return pthread_create(thread, NULL, body, arg) == 0;
}
static void thread_join(thread_t thread) { pthread_join(thread, NULL); }
#endif

static void print_line(const char* line) {
  printf("%s\n", line);
  fflush(stdout);
}

static int early_done = 0;
static int late_done = 0;

// The line and the flag come before the removal. In mode "thread" this runs on
// a thread that nothing joins, and the removal is what lets the teardown go on
// and end the process. The finalizer reads the flag after the removal has been
// observed, which is what orders the write before the read.
static void complete(const char* name, int* done, napi_async_cleanup_hook_handle handle) {
  printf("%s: done\n", name);
  fflush(stdout);
  *done = 1;
  napi_status status = napi_remove_async_cleanup_hook(handle);
  if (status != napi_ok) {
    printf("%s: napi_remove_async_cleanup_hook failed: status=%d\n", name, (int)status);
    fflush(stdout);
  }
}

static void early_hook(napi_async_cleanup_hook_handle handle, void* data) {
  print_line("early: hook");
  complete("early", &early_done, handle);
}

static void instance_data_finalizer(napi_env env, void* data, void* hint) {
  printf("instance data finalizer: early done=%d late done=%d\n", early_done, late_done);
  fflush(stdout);
}

struct late_state {
  napi_env env;
  napi_async_cleanup_hook_handle handle;
  napi_threadsafe_function tsfn;
  thread_t thread;
};

static struct late_state late;

// A step of the late hook's completion did not go as planned. Report it and
// complete the hook right away: the output then differs from the expected
// lines, instead of the teardown waiting forever for a completion that is not
// coming.
static void late_failed(const char* what, int status) {
  printf("late: %s failed: status=%d\n", what, status);
  fflush(stdout);
  complete("late", &late_done, late.handle);
}

// mode "tsfn"

static THREAD_RETURN tsfn_thread(void* arg) {
  napi_status status = napi_call_threadsafe_function(late.tsfn, NULL, napi_tsfn_blocking);
  if (status != napi_ok) {
    late_failed("napi_call_threadsafe_function", (int)status);
  }
  return 0;
}

static void release_tsfn(napi_threadsafe_function_release_mode mode) {
  napi_status status = napi_release_threadsafe_function(late.tsfn, mode);
  if (status != napi_ok) {
    printf("late: napi_release_threadsafe_function failed: status=%d\n", (int)status);
    fflush(stdout);
  }
}

static void tsfn_callback(napi_env env, napi_value js_callback, void* context, void* data) {
  thread_join(late.thread);
  if (env == NULL) {
    // The env was torn down with the call still queued, and is handing the
    // call's data back: the call was never made.
    late_failed("dispatch of the call", 0);
    return;
  }
  complete("late", &late_done, late.handle);
  release_tsfn(napi_tsfn_release);
}

static napi_status create_tsfn(napi_env env) {
  // A cleanup hook runs outside of any napi callback, so it has no handle
  // scope for the values it creates.
  napi_handle_scope scope;
  napi_status status = napi_open_handle_scope(env, &scope);
  if (status != napi_ok) return status;
  napi_value name;
  status = napi_create_string_utf8(env, "late", NAPI_AUTO_LENGTH, &name);
  if (status == napi_ok) {
    status = napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, NULL, NULL, NULL, tsfn_callback, &late.tsfn);
  }
  napi_close_handle_scope(env, scope);
  return status;
}

static void late_hook_tsfn(napi_async_cleanup_hook_handle handle, void* data) {
  print_line("late: hook");
  late.handle = handle;
  napi_status status = create_tsfn(late.env);
  if (status != napi_ok) {
    late_failed("create_tsfn", (int)status);
    return;
  }
  if (!thread_start(&late.thread, tsfn_thread, NULL)) {
    release_tsfn(napi_tsfn_abort);
    late_failed("thread_start", 0);
  }
}

// mode "thread"

static THREAD_RETURN complete_thread(void* arg) {
  thread_sleep_ms(100);
  complete("late", &late_done, late.handle);
  return 0;
}

static void late_hook_thread(napi_async_cleanup_hook_handle handle, void* data) {
  print_line("late: hook");
  late.handle = handle;
  // Nothing joins this thread: the process (or the worker that loaded the
  // addon) ends as soon as the hook is complete.
  if (!thread_start(&late.thread, complete_thread, NULL)) {
    late_failed("thread_start", 0);
  }
}

// mode "never"

static void late_hook_never(napi_async_cleanup_hook_handle handle, void* data) {
  print_line("late: hook");
  // Kept, as an addon that means to complete later would keep it: the handle
  // and the env it keeps alive are then not leaks to a leak checker.
  late.handle = handle;
}

static napi_value arm(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  char mode[16] = {0};
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc >= 1) {
    napi_get_value_string_utf8(env, argv[0], mode, sizeof mode, NULL);
  }

  napi_async_cleanup_hook late_hook;
  if (strcmp(mode, "tsfn") == 0) {
    late_hook = late_hook_tsfn;
  } else if (strcmp(mode, "thread") == 0) {
    late_hook = late_hook_thread;
  } else if (strcmp(mode, "never") == 0) {
    late_hook = late_hook_never;
  } else {
    napi_throw_error(env, NULL, "unknown mode");
    return NULL;
  }

  late.env = env;
  napi_async_cleanup_hook_handle early_handle;
  napi_status status = napi_set_instance_data(env, &late, instance_data_finalizer, NULL);
  if (status == napi_ok) {
    status = napi_add_async_cleanup_hook(env, early_hook, NULL, &early_handle);
  }
  if (status == napi_ok) {
    status = napi_add_async_cleanup_hook(env, late_hook, NULL, NULL);
  }
  printf("armed: %s status=%d\n", mode, (int)status);
  fflush(stdout);
  return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "arm", NAPI_AUTO_LENGTH, arm, NULL, &fn);
  napi_set_named_property(env, exports, "arm", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

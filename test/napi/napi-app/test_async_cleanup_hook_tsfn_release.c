// An async cleanup hook releases a threadsafe function, and the threadsafe
// function's finalizer (which runs later during env teardown) calls
// napi_remove_async_cleanup_hook. The handle must stay valid until the addon
// removes it; freeing it as soon as the hook returns is a use-after-free.
// See https://github.com/oven-sh/bun/issues/37201
#define NAPI_EXPERIMENTAL
#include <node_api.h>
#include <stdio.h>

// Statuses are printed (and compared against Node's output by the test), so a
// call that fails without crashing still fails the test.
#define CHECK(expr)                                  \
  do {                                               \
    napi_status status_ = (expr);                    \
    if (status_ != napi_ok) {                        \
      printf(#expr " failed: status=%d\n", status_); \
      fflush(stdout);                                \
      return NULL;                                   \
    }                                                \
  } while (0)

static napi_async_cleanup_hook_handle hook_handle;
static napi_threadsafe_function tsfn;

static void async_cleanup_hook(napi_async_cleanup_hook_handle handle, void* arg) {
  printf("async cleanup hook fired\n");
  fflush(stdout);
  napi_status status = napi_release_threadsafe_function(tsfn, napi_tsfn_release);
  printf("released tsfn: status=%d\n", status);
  fflush(stdout);
}

static void tsfn_finalize(napi_env env, void* data, void* hint) {
  printf("tsfn finalize: removing async cleanup hook\n");
  fflush(stdout);
  napi_status status = napi_remove_async_cleanup_hook(hook_handle);
  printf("async cleanup hook removed: status=%d\n", status);
  fflush(stdout);
}

static void call_js_cb(napi_env env, napi_value js_cb, void* ctx, void* data) {}

static napi_value noop(napi_env env, napi_callback_info info) {
  return NULL;
}

static napi_value start(napi_env env, napi_callback_info info) {
  napi_value name;
  CHECK(napi_create_string_utf8(env, "repro", NAPI_AUTO_LENGTH, &name));
  napi_value js_cb;
  CHECK(napi_create_function(env, "noop", NAPI_AUTO_LENGTH, noop, NULL, &js_cb));
  CHECK(napi_create_threadsafe_function(env, js_cb, NULL, name, 0, 1, NULL, tsfn_finalize, NULL, call_js_cb, &tsfn));
  CHECK(napi_unref_threadsafe_function(env, tsfn));
  CHECK(napi_add_async_cleanup_hook(env, async_cleanup_hook, NULL, &hook_handle));
  return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &fn);
  napi_set_named_property(env, exports, "start", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

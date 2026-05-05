// Regression test for https://github.com/oven-sh/bun/issues/29260:
// NAPI modules (e.g. ffi-napi) call uv_thread_self at module init. This
// addon exercises uv_thread_self + uv_thread_equal + uv_thread_create +
// uv_thread_join + uv_thread_detach + uv_thread_create_ex. If any of them
// is not polyfilled, Bun panics with "unsupported uv function".

#include <node_api.h>
#include <stdio.h>
#include <uv.h>

static void thread_entry(void *arg) {
  int *counter = (int *)arg;
  *counter = 42;
}

// For the detach sub-test: the caller returns before this runs, so we
// must NOT touch anything from the caller's stack. No-op instead.
static void thread_entry_detach(void *arg) { (void)arg; }

static napi_value fail(napi_env env, const char *msg) {
  napi_throw_error(env, NULL, msg);
  return NULL;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  // uv_thread_self + uv_thread_equal: self must equal self.
  uv_thread_t self1 = uv_thread_self();
  uv_thread_t self2 = uv_thread_self();
  if (!uv_thread_equal(&self1, &self2)) {
    return fail(env, "uv_thread_equal(self, self) returned false");
  }

  // uv_thread_create + uv_thread_join: spawn, join, verify the thread ran.
  int counter = 0;
  uv_thread_t tid;
  if (uv_thread_create(&tid, thread_entry, &counter) != 0) {
    return fail(env, "uv_thread_create failed");
  }
  if (uv_thread_join(&tid) != 0) {
    return fail(env, "uv_thread_join failed");
  }
  if (counter != 42) {
    return fail(env, "uv_thread_create: thread did not run");
  }

  // uv_thread_create_ex: no flags → default pthread stack size.
  counter = 0;
  uv_thread_options_t opts;
  opts.flags = UV_THREAD_NO_FLAGS;
  if (uv_thread_create_ex(&tid, &opts, thread_entry, &counter) != 0) {
    return fail(env, "uv_thread_create_ex failed");
  }
  if (uv_thread_join(&tid) != 0) {
    return fail(env, "uv_thread_join (after _ex) failed");
  }
  if (counter != 42) {
    return fail(env, "uv_thread_create_ex: thread did not run");
  }

  // uv_thread_detach: spawn, detach, the thread cleans up on its own.
  if (uv_thread_create(&tid, thread_entry_detach, NULL) != 0) {
    return fail(env, "uv_thread_create (detach) failed");
  }
  if (uv_thread_detach(&tid) != 0) {
    return fail(env, "uv_thread_detach failed");
  }

  napi_value result;
  if (napi_get_boolean(env, true, &result) != napi_ok) {
    return fail(env, "napi_get_boolean failed");
  }
  return result;
}

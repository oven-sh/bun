// Regression test for oven-sh/bun#36828: threadsafe function calls must keep
// dispatching while a callback blocks in a nested event loop
// (expect(promise).resolves under bun:test).

#include <js_native_api.h>
#include <node_api.h>

#include <atomic>
#include <chrono>
#include <thread>

#define NODE_API_CALL(env, call)                                               \
  do {                                                                         \
    napi_status status = (call);                                               \
    if (status != napi_ok) {                                                   \
      const napi_extended_error_info *error_info = NULL;                       \
      napi_get_last_error_info((env), &error_info);                            \
      const char *err_message = error_info->error_message;                     \
      bool is_pending;                                                         \
      napi_is_exception_pending((env), &is_pending);                           \
      if (!is_pending) {                                                       \
        const char *message =                                                  \
            (err_message == NULL) ? "empty error message" : err_message;       \
        napi_throw_error((env), NULL, message);                                \
      }                                                                        \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

static std::atomic<bool> blocked_signal{false};

// Invokes the JS callback with the integer tag passed to
// napi_call_threadsafe_function.
static void call_js(napi_env env, napi_value js_callback, void *context,
                    void *data) {
  (void)context;
  if (env == nullptr || js_callback == nullptr) {
    return;
  }
  napi_value tag;
  if (napi_create_int32(env, (int32_t)(intptr_t)data, &tag) != napi_ok) {
    return;
  }
  napi_value recv;
  if (napi_get_undefined(env, &recv) != napi_ok) {
    return;
  }
  napi_value result;
  // A pending exception (e.g. a failed expect() in the callback) is
  // surfaced by the fixture's test runner; nothing to do here.
  (void)napi_call_function(env, recv, js_callback, 1, &tag, &result);
}

static napi_status make_tsfn(napi_env env, napi_value js_callback,
                             const char *name_str,
                             napi_threadsafe_function *out) {
  napi_value name;
  napi_status status =
      napi_create_string_utf8(env, name_str, NAPI_AUTO_LENGTH, &name);
  if (status != napi_ok) {
    return status;
  }
  status = napi_create_threadsafe_function(
      env, js_callback, /* async_resource */ NULL, name,
      /* max_queue_size (unlimited) */ 0, /* initial_thread_count */ 1,
      /* thread_finalize_data */ NULL, /* thread_finalize_cb */ NULL,
      /* context */ NULL, call_js, out);
  if (status != napi_ok) {
    return status;
  }
  // Unreferenced so a deadlocked run still exits once its test times out,
  // instead of the pending call keeping the event loop alive forever.
  return napi_unref_threadsafe_function(env, *out);
}

// Pushes call 1, then once the fixture signals that call 1's callback is
// blocked in its nested wait, pushes call 2 from the addon thread.
static napi_value start_concurrent(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));

  blocked_signal.store(false);

  napi_threadsafe_function tsfn;
  NODE_API_CALL(env, make_tsfn(env, args[0], "tsfn_nested_wait_concurrent", &tsfn));

  std::thread([tsfn] {
    napi_call_threadsafe_function(tsfn, (void *)1, napi_tsfn_nonblocking);
    // Bounded wait so a broken fixture cannot spin this thread forever.
    for (int i = 0; i < 30000 && !blocked_signal.load(); i++) {
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    napi_call_threadsafe_function(tsfn, (void *)2, napi_tsfn_nonblocking);
    napi_release_threadsafe_function(tsfn, napi_tsfn_release);
  }).detach();

  return NULL;
}

// Pushes calls 1 and 2 before any dispatch can run, so call 2 is already
// queued behind call 1 when call 1's callback blocks.
static napi_value start_queued(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));

  napi_threadsafe_function tsfn;
  NODE_API_CALL(env, make_tsfn(env, args[0], "tsfn_nested_wait_queued", &tsfn));

  NODE_API_CALL(env,
                napi_call_threadsafe_function(tsfn, (void *)1, napi_tsfn_nonblocking));
  NODE_API_CALL(env,
                napi_call_threadsafe_function(tsfn, (void *)2, napi_tsfn_nonblocking));
  NODE_API_CALL(env, napi_release_threadsafe_function(tsfn, napi_tsfn_release));

  return NULL;
}

// Called by the fixture from inside call 1's callback, right before it starts
// the nested wait.
static napi_value signal_blocked(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  blocked_signal.store(true);
  return NULL;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;

  NODE_API_CALL(env, napi_create_function(env, "startConcurrent",
                                          NAPI_AUTO_LENGTH, start_concurrent,
                                          NULL, &fn));
  NODE_API_CALL(env,
                napi_set_named_property(env, exports, "startConcurrent", fn));

  NODE_API_CALL(env, napi_create_function(env, "startQueued", NAPI_AUTO_LENGTH,
                                          start_queued, NULL, &fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "startQueued", fn));

  NODE_API_CALL(env, napi_create_function(env, "signalBlocked",
                                          NAPI_AUTO_LENGTH, signal_blocked,
                                          NULL, &fn));
  NODE_API_CALL(env,
                napi_set_named_property(env, exports, "signalBlocked", fn));

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

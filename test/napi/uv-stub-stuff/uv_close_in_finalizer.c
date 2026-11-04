// An addon that uv.test.ts builds with NAPI_EXPERIMENTAL. The collector calls
// the finalizers of such an addon inside the collection. The event loop can
// run a collection after it has decided how long its next poll may block, so
// a uv_close() that a finalizer makes there must still wake that poll.
#include <node_api.h>

#include <stdlib.h>
#include <uv.h>

// A ref'd handle: it keeps the process alive until its close is finished.
static uv_async_t *target;
static napi_env on_closed_env;
static napi_ref on_closed;

static void target_async_cb(uv_async_t *handle) { (void)handle; }

// Calls the function that open() got.
static void target_close_cb(uv_handle_t *handle) {
  free(handle);
  napi_env env = on_closed_env;
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  napi_value callback, undefined;
  napi_get_reference_value(env, on_closed, &callback);
  napi_get_undefined(env, &undefined);
  napi_delete_reference(env, on_closed);
  napi_call_function(env, undefined, callback, 0, NULL, NULL);
  napi_close_handle_scope(env, scope);
}

// The finalizer of every buffer that closeWhenCollected() made. The first one
// that runs closes the handle.
static void close_target(node_api_basic_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  free(data);
  if (target == NULL)
    return;
  uv_close((uv_handle_t *)target, target_close_cb);
  target = NULL;
}

// open(onClosed) makes the handle. Its close callback calls onClosed().
static napi_value open_target(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  uv_loop_t *loop = NULL;
  napi_get_uv_event_loop(env, &loop);
  target = malloc(sizeof(*target));
  if (uv_async_init(loop, target, target_async_cb) != 0) {
    free(target);
    target = NULL;
    napi_throw_error(env, NULL, "uv_async_init failed");
    return NULL;
  }
  on_closed_env = env;
  napi_create_reference(env, args[0], 1, &on_closed);
  return NULL;
}

// closeWhenCollected() returns an ArrayBuffer of memory that the addon owns.
// The collector calls close_target() when it frees the buffer.
static napi_value close_when_collected(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value buffer = NULL;
  napi_create_external_arraybuffer(env, malloc(16), 16, close_target, NULL,
                                   &buffer);
  return buffer;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, NULL, 0, open_target, NULL, &fn);
  napi_set_named_property(env, exports, "open", fn);
  napi_create_function(env, NULL, 0, close_when_collected, NULL, &fn);
  napi_set_named_property(env, exports, "closeWhenCollected", fn);
  return exports;
}

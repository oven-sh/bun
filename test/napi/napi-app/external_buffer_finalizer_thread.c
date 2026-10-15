// NAPI_VERSION=8, so Bun defers the finalizers of these buffers out of the collection.
// Each finalizer records whether it ran on the thread that created its buffer.
#include <js_native_api.h>
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>

#ifdef _WIN32
#include <windows.h>
static uintptr_t current_thread(void) { return (uintptr_t)GetCurrentThreadId(); }
#else
#include <pthread.h>
static uintptr_t current_thread(void) { return (uintptr_t)pthread_self(); }
#endif

static uint32_t finalized = 0;
static uint32_t finalized_off_thread = 0;

static void finalize(napi_env env, void *data, void *hint) {
  (void)env;
  if ((uintptr_t)hint != current_thread()) {
    finalized_off_thread++;
  }
  finalized++;
  free(data);
}

static napi_value create(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result = NULL;
  napi_create_external_buffer(env, 8, calloc(1, 8), finalize,
                              (void *)current_thread(), &result);
  return result;
}

static napi_value stats(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value out, v;
  napi_create_object(env, &out);
  napi_create_uint32(env, finalized, &v);
  napi_set_named_property(env, out, "finalized", v);
  napi_create_uint32(env, finalized_off_thread, &v);
  napi_set_named_property(env, out, "finalizedOffThread", v);
  return out;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "create", NAPI_AUTO_LENGTH, create, NULL, &fn);
  napi_set_named_property(env, exports, "create", fn);
  napi_create_function(env, "stats", NAPI_AUTO_LENGTH, stats, NULL, &fn);
  napi_set_named_property(env, exports, "stats", fn);
  return exports;
}

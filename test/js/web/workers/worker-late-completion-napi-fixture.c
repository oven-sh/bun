// An experimental addon runs its finalizers inline during garbage collection,
// and napi_queue_async_work is one of the functions a finalizer may call.
#define NAPI_EXPERIMENTAL
#include <node_api.h>
#include <stdio.h>

static napi_async_work work;

static void execute(napi_env env, void *data) {}

static void complete(napi_env env, napi_status status, void *data) {
  napi_delete_async_work(env, work);
}

static void finalize(node_api_basic_env env, void *data, void *hint) {
  napi_status status = napi_queue_async_work(env, work);
  printf("queued from finalizer: %d\n", (int)status);
  fflush(stdout);
  if (status != napi_ok) {
    napi_delete_async_work((napi_env)env, work);
  }
}

// napi_create_async_work isn't allowed in a finalizer, so create the work here.
static napi_value queue_from_finalizer(napi_env env, napi_callback_info info) {
  napi_value name, external;
  napi_create_string_utf8(env, "late", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, execute, complete, NULL, &work);
  napi_create_external(env, NULL, finalize, NULL, &external);
  return external;
}

NAPI_MODULE_INIT() {
  napi_value function;
  napi_create_function(env, "queueFromFinalizer", NAPI_AUTO_LENGTH, queue_from_finalizer, NULL, &function);
  napi_set_named_property(env, exports, "queueFromFinalizer", function);
  return exports;
}

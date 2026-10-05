// A module built with the experimental Node-API version has its finalizers run
// synchronously from the garbage collector. napi_queue_async_work takes a
// node_api_basic_env, so such a finalizer may call it, and the queued work
// keeps the event loop alive until its complete callback has run.

#define NAPI_EXPERIMENTAL

#include <node_api.h>
#include <stdlib.h>

static int finalized = 0;
static int completed = 0;

static void execute(napi_env env, void *data) {}

static void complete(napi_env env, napi_status status, void *data) {
  napi_async_work *work = (napi_async_work *)data;
  completed++;
  napi_delete_async_work(env, *work);
  free(work);
}

static void finalize(node_api_basic_env env, void *data, void *hint) {
  finalized++;
  napi_queue_async_work(env, *(napi_async_work *)data);
}

// An object whose finalizer queues the async work created here.
static napi_value make(napi_env env, napi_callback_info info) {
  napi_value object, name;
  napi_async_work *work = malloc(sizeof(napi_async_work));
  napi_create_object(env, &object);
  napi_create_string_utf8(env, "work", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, execute, complete, work, work);
  napi_add_finalizer(env, object, work, finalize, NULL, NULL);
  return object;
}

static napi_value get_finalized(napi_env env, napi_callback_info info) {
  napi_value value;
  napi_create_int32(env, finalized, &value);
  return value;
}

static napi_value get_completed(napi_env env, napi_callback_info info) {
  napi_value value;
  napi_create_int32(env, completed, &value);
  return value;
}

NAPI_MODULE_INIT() {
  napi_value function;
  napi_create_function(env, "make", NAPI_AUTO_LENGTH, make, NULL, &function);
  napi_set_named_property(env, exports, "make", function);
  napi_create_function(env, "finalized", NAPI_AUTO_LENGTH, get_finalized, NULL,
                       &function);
  napi_set_named_property(env, exports, "finalized", function);
  napi_create_function(env, "completed", NAPI_AUTO_LENGTH, get_completed, NULL,
                       &function);
  napi_set_named_property(env, exports, "completed", function);
  return exports;
}

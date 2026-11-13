// A module built against a released Node-API version (not NAPI_EXPERIMENTAL)
// gets the finalizers of its wrapped objects run from the event loop, after
// the collection that freed the objects. One collection can leave many of
// them pending.
//
// wrap(count, throwsEvery): wraps `count` objects that only the handle scope
//   of the call keeps alive. Each keeps the reference that napi_wrap() returns
//   until its finalizer runs, as an ObjectWrap does. With `throwsEvery` > 0
//   the finalizer of each `throwsEvery`-th object throws.
// finalized(): how many finalizers ran.
// thrown(): how many of them threw.
//
// Each finalizer calls globalThis.onFinalize, when that is a function, before
// it throws.

#include <js_native_api.h>
#include <node_api.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

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

typedef struct {
  napi_ref ref;
  bool throws;
} wrapped;

static int finalized_count = 0;
static int thrown_count = 0;

static void finalize(napi_env env, void *data, void *hint) {
  (void)hint;
  wrapped *native = (wrapped *)data;
  bool throws = native->throws;
  napi_delete_reference(env, native->ref);
  free(native);
  finalized_count++;
  napi_value global, callback;
  napi_valuetype type;
  if (napi_get_global(env, &global) == napi_ok &&
      napi_get_named_property(env, global, "onFinalize", &callback) ==
          napi_ok &&
      napi_typeof(env, callback, &type) == napi_ok && type == napi_function) {
    napi_call_function(env, global, callback, 0, NULL, NULL);
  }
  if (throws) {
    thrown_count++;
    napi_throw_error(env, NULL, "thrown by a finalizer");
  }
}

static napi_value wrap(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, args, NULL, NULL));
  int32_t count = 0, throws_every = 0;
  NODE_API_CALL(env, napi_get_value_int32(env, args[0], &count));
  NODE_API_CALL(env, napi_get_value_int32(env, args[1], &throws_every));
  for (int32_t i = 0; i < count; i++) {
    napi_handle_scope scope;
    NODE_API_CALL(env, napi_open_handle_scope(env, &scope));
    napi_value object;
    NODE_API_CALL(env, napi_create_object(env, &object));
    wrapped *native = (wrapped *)calloc(1, sizeof(wrapped));
    native->throws = throws_every > 0 && i % throws_every == throws_every - 1;
    NODE_API_CALL(env,
                  napi_wrap(env, object, native, finalize, NULL, &native->ref));
    NODE_API_CALL(env, napi_close_handle_scope(env, scope));
  }
  return NULL;
}

static napi_value finalized(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  NODE_API_CALL(env, napi_create_int32(env, finalized_count, &result));
  return result;
}

static napi_value thrown(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  NODE_API_CALL(env, napi_create_int32(env, thrown_count, &result));
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  const struct {
    const char *name;
    napi_callback callback;
  } functions[] = {
      {"wrap", wrap},
      {"finalized", finalized},
      {"thrown", thrown},
  };
  for (size_t i = 0; i < sizeof functions / sizeof functions[0]; i++) {
    napi_value function;
    NODE_API_CALL(env,
                  napi_create_function(env, functions[i].name, NAPI_AUTO_LENGTH,
                                       functions[i].callback, NULL, &function));
    NODE_API_CALL(env, napi_set_named_property(env, exports, functions[i].name,
                                               function));
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

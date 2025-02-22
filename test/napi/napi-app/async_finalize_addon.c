// This is a separate addon because the main one is built with
// NAPI_VERSION_EXPERIMENTAL, which makes finalizers run synchronously during GC
// and requires node_api_post_finalizer to run functions that could affect JS
// engine state. This module's purpose is to call napi_delete_reference directly
// during a finalizer -- not during a callback scheduled with
// node_api_post_finalizer -- so it cannot use NAPI_VERSION_EXPERIMENTAL.

#include <assert.h>
#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>

// "we have static_assert at home" - MSVC
char assertion[NAPI_VERSION == 8 ? 1 : -1];

#define NODE_API_CALL_CUSTOM_RETURN(env, call, retval)                         \
  do {                                                                         \
    napi_status status = (call);                                               \
    if (status != napi_ok) {                                                   \
      const napi_extended_error_info *error_info = NULL;                       \
      napi_get_last_error_info((env), &error_info);                            \
      const char *err_message = error_info->error_message;                     \
      bool is_pending;                                                         \
      napi_is_exception_pending((env), &is_pending);                           \
      /* If an exception is already pending, don't rethrow it */               \
      if (!is_pending) {                                                       \
        const char *message =                                                  \
            (err_message == NULL) ? "empty error message" : err_message;       \
        napi_throw_error((env), NULL, message);                                \
      }                                                                        \
      return retval;                                                           \
    }                                                                          \
  } while (0)

#define NODE_API_CALL(env, call) NODE_API_CALL_CUSTOM_RETURN(env, call, NULL)
#define NODE_API_CALL_RETURN_VOID(env, call)                                   \
  NODE_API_CALL_CUSTOM_RETURN(env, call, )

typedef struct {
  napi_ref ref;
} RefHolder;

static void finalizer(napi_env env, void *data, void *hint) {
  printf("finalizer\n");
  (void)hint;
  RefHolder *ref_holder = (RefHolder *)data;
  NODE_API_CALL_RETURN_VOID(env, napi_delete_reference(env, ref_holder->ref));
  free(ref_holder);
}

static napi_value create_ref(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value object;
  NODE_API_CALL(env, napi_create_object(env, &object));
  RefHolder *ref_holder = calloc(1, sizeof *ref_holder);
  NODE_API_CALL(env, napi_wrap(env, object, ref_holder, finalizer, NULL,
                               &ref_holder->ref));
  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

/* napi_value */ NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value create_ref_function;
  NODE_API_CALL(env,
                napi_create_function(env, "create_ref", NAPI_AUTO_LENGTH,
                                     create_ref, NULL, &create_ref_function));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "create_ref",
                                             create_ref_function));
  return exports;
}

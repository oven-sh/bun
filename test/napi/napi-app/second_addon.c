#include <js_native_api.h>
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>

#define NODE_API_CALL(env, call)                                               \
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
      return NULL;                                                             \
    }                                                                          \
  } while (0)

static napi_value get_instance_data(napi_env env, napi_callback_info info) {
  void *data_ptr = NULL;
  NODE_API_CALL(env, napi_get_instance_data(env, &data_ptr));

  napi_value out;
  NODE_API_CALL(env, napi_create_int32(env, *(int32_t *)data_ptr, &out));
  return out;
}

/* napi_value */ NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value get_instance_data_function;
  NODE_API_CALL(env, napi_create_function(env, "get_instance_data",
                                          NAPI_AUTO_LENGTH, get_instance_data,
                                          NULL, &get_instance_data_function));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "get_instance_data",
                                             get_instance_data_function));

  static int32_t instance_data = 42;
  NODE_API_CALL(env, napi_set_instance_data(env, &instance_data, NULL, NULL));

  return exports;
}

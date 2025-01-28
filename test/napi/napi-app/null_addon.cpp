#include <js_native_api.h>
#include <node_api.h>

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

/* napi_value */ NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value number;
  NODE_API_CALL(env, napi_create_int32(env, 123, &number));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "number", number));

  // These defines are used by binding.gyp to compile three versions of this
  // module that return different values
#if defined(MODULE_INIT_RETURN_NULLPTR)
  // returning NULL means the exports value should be used as the return value
  // of require()
  return NULL;
#elif defined(MODULE_INIT_RETURN_NULL)
  napi_value null;
  NODE_API_CALL(env, napi_get_null(env, &null));
  return null;
#elif defined(MODULE_INIT_RETURN_UNDEFINED)
  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
#elif defined(MODULE_INIT_THROW)
  napi_throw_error(env, "CODE_OOPS", "oops!");
  return NULL;
#else
#error Define one of MODULE_INIT_RETURN_{NULLPTR,NULL,UNDEFINED} to determine what to return from NAPI_MODULE_INIT
#endif
}

#include <js_native_api.h>

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

static int instance_data;

#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#define CDECL __cdecl
#else
#define EXPORT
#define CDECL
#endif

EXPORT void CDECL set_instance_data(napi_env env, int new_data) {
  instance_data = new_data;
  NODE_API_CALL_CUSTOM_RETURN(
      env, napi_set_instance_data(env, (void *)&instance_data, NULL, NULL), );
}

EXPORT int CDECL get_instance_data(napi_env env) {
  void *data;
  NODE_API_CALL_CUSTOM_RETURN(env, napi_get_instance_data(env, &data), -1);
  return *(int *)data;
}

EXPORT const char *CDECL get_type(napi_env env, napi_value value) {
  const char *names[] = {
      [napi_undefined] = "undefined", [napi_null] = "null",
      [napi_boolean] = "boolean",     [napi_number] = "number",
      [napi_string] = "string",       [napi_symbol] = "symbol",
      [napi_object] = "object",       [napi_function] = "function",
      [napi_external] = "external",   [napi_bigint] = "bigint",
  };
  size_t len = sizeof names / sizeof names[0];
  napi_valuetype type;
  NODE_API_CALL_CUSTOM_RETURN(env, napi_typeof(env, value, &type), NULL);
  if (type < 0 || type >= len) {
    return "error";
  }
  return names[type];
}

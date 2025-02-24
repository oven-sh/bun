// Not including js_native_api.h, because this has to also be compiled by bun cc
// which won't be able to find the headers

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
typedef enum { napi_ok } napi_status;
typedef struct napi_value__ *napi_value;
typedef struct napi_env__ *napi_env;
typedef const struct napi_env__ *node_api_basic_env;
typedef struct {
  const char *error_message;
  void *engine_reserved;
  uint32_t engine_error_code;
  napi_status error_code;
} napi_extended_error_info;
typedef void (*napi_finalize)(napi_env env, void *finalize_data,
                              void *finalize_hint);
napi_status napi_get_last_error_info(node_api_basic_env env,
                                     const napi_extended_error_info **result);
napi_status napi_is_exception_pending(napi_env env, bool *result);
napi_status napi_throw_error(napi_env env, const char *code, const char *msg);
napi_status napi_set_instance_data(node_api_basic_env env, void *data,
                                   napi_finalize finalize_cb,
                                   void *finalize_hint);
napi_status napi_get_instance_data(node_api_basic_env env, void **data);

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

void set_instance_data(napi_env env, int new_data) {
  instance_data = new_data;
  NODE_API_CALL_CUSTOM_RETURN(
      env, napi_set_instance_data(env, (void *)&instance_data, NULL, NULL), );
}

int get_instance_data(napi_env env) {
  void *data;
  NODE_API_CALL_CUSTOM_RETURN(env, napi_get_instance_data(env, &data), -1);
  return *(int *)data;
}

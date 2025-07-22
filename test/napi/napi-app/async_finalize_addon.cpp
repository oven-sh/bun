// This is a separate addon because the main one is built with
// NAPI_VERSION_EXPERIMENTAL, which makes finalizers run synchronously during GC
// and requires node_api_post_finalizer to run functions that could affect JS
// engine state. This module's purpose is to call napi_delete_reference directly
// during a finalizer -- not during a callback scheduled with
// node_api_post_finalizer -- so it cannot use NAPI_VERSION_EXPERIMENTAL.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <js_native_api.h>
#include <node_api.h>
#include <thread>

static_assert(NAPI_VERSION == 8,
              "this module must be built with Node-API version 8");

static std::thread::id js_thread_id;

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
  delete ref_holder;
}

static napi_value create_ref(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value object;
  NODE_API_CALL(env, napi_create_object(env, &object));
  RefHolder *ref_holder = new RefHolder;
  NODE_API_CALL(env, napi_wrap(env, object, ref_holder, finalizer, NULL,
                               &ref_holder->ref));
  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

static int buffer_finalize_count = 0;

static void buffer_finalizer(napi_env env, void *data, void *hint) {
  (void)hint;
  if (std::this_thread::get_id() == js_thread_id) {
    printf("buffer_finalizer run from js thread\n");
  } else {
    printf("buffer_finalizer run from another thread\n");
  }
  fflush(stdout);
  free(data);
  buffer_finalize_count++;
}

static napi_value create_buffer(napi_env env, napi_callback_info info) {
  (void)info;
  static const size_t len = 1000000;
  void *data = malloc(len);
  memset(data, 5, len);
  napi_value buf;
  // JavaScriptCore often runs external ArrayBuffer finalizers off the main
  // thread. In this case, Bun needs to concurrently post a task to the main
  // thread to invoke the finalizer.
  NODE_API_CALL(env, napi_create_external_arraybuffer(
                         env, data, len, buffer_finalizer, NULL, &buf));
  return buf;
}

static napi_value get_buffer_finalize_count(napi_env env,
                                            napi_callback_info info) {
  (void)info;
  napi_value count;
  NODE_API_CALL(env, napi_create_int32(env, buffer_finalize_count, &count));
  return count;
}

/* napi_value */ NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  js_thread_id = std::this_thread::get_id();
  napi_value js_function;
  NODE_API_CALL(env, napi_create_function(env, "create_ref", NAPI_AUTO_LENGTH,
                                          create_ref, NULL, &js_function));
  NODE_API_CALL(
      env, napi_set_named_property(env, exports, "create_ref", js_function));
  NODE_API_CALL(env,
                napi_create_function(env, "create_buffer", NAPI_AUTO_LENGTH,
                                     create_buffer, NULL, &js_function));
  NODE_API_CALL(
      env, napi_set_named_property(env, exports, "create_buffer", js_function));
  NODE_API_CALL(env, napi_create_function(
                         env, "get_buffer_finalize_count", NAPI_AUTO_LENGTH,
                         get_buffer_finalize_count, NULL, &js_function));
  NODE_API_CALL(env, napi_set_named_property(env, exports,
                                             "get_buffer_finalize_count",
                                             js_function));
  return exports;
}

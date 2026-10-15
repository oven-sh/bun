// Test that napi_delete_reference can be called from a finalizer that runs
// while the garbage collector is sweeping, in a module built with the
// experimental Node-API version (experimental modules run finalizers
// synchronously from GC instead of deferring them).
//
// Node.js explicitly allows this: napi_delete_reference takes
// node_api_basic_env and performs no GC-access check, because deleting the
// reference returned by napi_wrap is documented to be done from the finalize
// callback (node-addon-api's ObjectWrap destructor does exactly this).
//
// Bun used to abort here with the message "napi_reference_unref".

#define NAPI_EXPERIMENTAL

#include <js_native_api.h>
#include <node_api.h>
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
} RefHolder;

static int finalize_count = 0;
static int delete_ok_count = 0;

static void finalize_delete_own_ref(napi_env env, void *data, void *hint) {
  (void)hint;
  RefHolder *holder = (RefHolder *)data;
  finalize_count++;

  if (holder && holder->ref) {
    // Deleting the reference from its own finalize callback is the documented
    // way to clean up the napi_ref created by napi_wrap/napi_add_finalizer.
    // This must work even though the finalizer runs during garbage
    // collection.
    napi_status status = napi_delete_reference(env, holder->ref);
    if (status == napi_ok) {
      delete_ok_count++;
    } else {
      fprintf(stderr, "napi_delete_reference returned status %d\n",
              (int)status);
    }
  }

  free(holder);
}

// Create `count` objects wrapped with napi_wrap; each finalize callback
// deletes the reference napi_wrap returned (the node-addon-api ObjectWrap
// pattern).
static napi_value create_wrapped(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));

  uint32_t count = 0;
  NODE_API_CALL(env, napi_get_value_uint32(env, argv[0], &count));

  for (uint32_t i = 0; i < count; i++) {
    napi_value obj;
    NODE_API_CALL(env, napi_create_object(env, &obj));

    RefHolder *holder = (RefHolder *)malloc(sizeof(RefHolder));
    holder->ref = NULL;
    NODE_API_CALL(env, napi_wrap(env, obj, holder, finalize_delete_own_ref,
                                 NULL, &holder->ref));
  }

  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

// Create `count` objects with napi_add_finalizer; each finalize callback
// deletes the reference napi_add_finalizer returned.
static napi_value create_with_finalizer(napi_env env,
                                        napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));

  uint32_t count = 0;
  NODE_API_CALL(env, napi_get_value_uint32(env, argv[0], &count));

  for (uint32_t i = 0; i < count; i++) {
    napi_value obj;
    NODE_API_CALL(env, napi_create_object(env, &obj));

    RefHolder *holder = (RefHolder *)malloc(sizeof(RefHolder));
    holder->ref = NULL;
    NODE_API_CALL(env, napi_add_finalizer(env, obj, holder,
                                          finalize_delete_own_ref, NULL,
                                          &holder->ref));
  }

  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

static napi_value get_stats(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  NODE_API_CALL(env, napi_create_object(env, &result));

  napi_value finalizers_called;
  NODE_API_CALL(env, napi_create_int32(env, finalize_count,
                                       &finalizers_called));
  NODE_API_CALL(env, napi_set_named_property(env, result, "finalizersCalled",
                                             finalizers_called));

  napi_value deletes_succeeded;
  NODE_API_CALL(env, napi_create_int32(env, delete_ok_count,
                                       &deletes_succeeded));
  NODE_API_CALL(env, napi_set_named_property(env, result, "deletesSucceeded",
                                             deletes_succeeded));

  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;

  NODE_API_CALL(env, napi_create_function(env, "createWrapped",
                                          NAPI_AUTO_LENGTH, create_wrapped,
                                          NULL, &fn));
  NODE_API_CALL(env,
                napi_set_named_property(env, exports, "createWrapped", fn));

  NODE_API_CALL(env, napi_create_function(env, "createWithFinalizer",
                                          NAPI_AUTO_LENGTH,
                                          create_with_finalizer, NULL, &fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports,
                                             "createWithFinalizer", fn));

  NODE_API_CALL(env, napi_create_function(env, "getStats", NAPI_AUTO_LENGTH,
                                          get_stats, NULL, &fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "getStats", fn));

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

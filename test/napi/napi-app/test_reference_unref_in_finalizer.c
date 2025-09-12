// Test that napi_reference_unref can be called from a finalizer
// This is a regression test for https://github.com/oven-sh/bun/issues/22596

#include <assert.h>
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
      return NULL;                                                           \
    }                                                                          \
  } while (0)

typedef struct {
  napi_ref ref;
  napi_env env;
} RefHolder;

static napi_ref global_ref = NULL;

static void finalizer_unref(napi_env env, void *data, void *hint) {
  (void)hint;
  (void)data;
  if (global_ref != NULL) {
    uint32_t result;
    // This should not crash even when called during GC
    napi_status status = napi_reference_unref(env, global_ref, &result);
    if (status == napi_ok) {
      printf("unref succeeded, refcount=%u\n", result);
    } else {
      printf("unref failed\n");
    }
    
    // Clean up the reference if refcount is 0
    if (result == 0) {
      napi_delete_reference(env, global_ref);
      global_ref = NULL;
    }
  }
}

static napi_value test_reference_unref_in_finalizer(napi_env env, napi_callback_info info) {
  (void)info;
  
  // Create an object to hold a reference to
  napi_value target_obj;
  NODE_API_CALL(env, napi_create_object(env, &target_obj));
  
  // Create a reference with refcount 2
  if (global_ref != NULL) {
    napi_delete_reference(env, global_ref);
  }
  NODE_API_CALL(env, napi_create_reference(env, target_obj, 2, &global_ref));
  
  // Create another object that will trigger the finalizer when GC'd
  napi_value trigger_obj;
  NODE_API_CALL(env, napi_create_object(env, &trigger_obj));
  
  // Add a finalizer that will call napi_reference_unref
  NODE_API_CALL(env, napi_add_finalizer(env, trigger_obj, NULL, finalizer_unref, NULL, NULL));
  
  printf("test setup complete\n");
  
  return trigger_obj;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value test_fn;
  NODE_API_CALL(env, napi_create_function(env, "test_reference_unref_in_finalizer", 
                                          NAPI_AUTO_LENGTH, test_reference_unref_in_finalizer, 
                                          NULL, &test_fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "test_reference_unref_in_finalizer", test_fn));
  return exports;
}

NAPI_MODULE(test_reference_unref_in_finalizer, init)
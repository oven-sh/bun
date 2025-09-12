// Test that napi_reference_unref CANNOT be called from a finalizer in experimental NAPI
// This verifies the GC check is enforced for experimental modules
// This is a regression test for https://github.com/oven-sh/bun/issues/22596

#define NAPI_VERSION NAPI_VERSION_EXPERIMENTAL
#define NAPI_EXPERIMENTAL

#include <assert.h>
#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
  int index;
} RefHolder;

static int finalizer_called_count = 0;
static int unref_failed_count = 0;
static bool test_ran = false;

// Called at exit to verify the test actually ran
static void check_test_ran(void* arg) {
  (void)arg;
  if (!test_ran) {
    fprintf(stderr, "ERROR: Test did not run properly\n");
    exit(1);
  }
  if (finalizer_called_count == 0) {
    fprintf(stderr, "ERROR: No finalizers were called\n");
    exit(1);
  }
  // For experimental version, we expect unrefs to fail
  if (unref_failed_count == 0) {
    fprintf(stderr, "ERROR: Expected napi_reference_unref to fail in experimental mode but it succeeded\n");
    exit(1);
  }
  printf("Test completed: %d finalizers called, %d unrefs failed as expected\n", 
         finalizer_called_count, unref_failed_count);
}

static void finalizer_unref(napi_env env, void *data, void *hint) {
  (void)hint;
  RefHolder* holder = (RefHolder*)data;
  finalizer_called_count++;
  
  if (holder && holder->ref) {
    uint32_t result;
    // This should FAIL for experimental NAPI versions during GC
    napi_status status = napi_reference_unref(env, holder->ref, &result);
    if (status != napi_ok) {
      unref_failed_count++;
      printf("napi_reference_unref failed as expected in experimental mode\n");
    } else {
      printf("ERROR: napi_reference_unref succeeded but should have failed!\n");
    }
    
    // Try to clean up the reference with post_finalizer if available
    // In experimental mode, we should use node_api_post_finalizer
    free(holder);
  }
}

static napi_value test_reference_unref_in_finalizer_experimental(napi_env env, napi_callback_info info) {
  (void)info;
  
  test_ran = true;
  
  // Register atexit handler on first call
  static bool atexit_registered = false;
  if (!atexit_registered) {
    napi_add_env_cleanup_hook(env, check_test_ran, NULL);
    atexit_registered = true;
  }
  
  // Create just a few objects to test - we only need to verify the behavior
  const int NUM_OBJECTS = 5;
  napi_value objects_array;
  NODE_API_CALL(env, napi_create_array_with_length(env, NUM_OBJECTS, &objects_array));
  
  for (int i = 0; i < NUM_OBJECTS; i++) {
    // Create an object to hold a reference to
    napi_value target_obj;
    NODE_API_CALL(env, napi_create_object(env, &target_obj));
    
    // Create a holder for this reference
    RefHolder* holder = (RefHolder*)malloc(sizeof(RefHolder));
    holder->index = i;
    
    // Create a reference with refcount 2
    NODE_API_CALL(env, napi_create_reference(env, target_obj, 2, &holder->ref));
    
    // Create a wrapper object that will trigger the finalizer when GC'd
    napi_value wrapper_obj;
    NODE_API_CALL(env, napi_create_object(env, &wrapper_obj));
    
    // Add a finalizer that will try to call napi_reference_unref (should fail)
    NODE_API_CALL(env, napi_add_finalizer(env, wrapper_obj, holder, finalizer_unref, NULL, NULL));
    
    // Store in array
    NODE_API_CALL(env, napi_set_element(env, objects_array, i, wrapper_obj));
  }
  
  printf("Created %d objects with finalizers (experimental mode)\n", NUM_OBJECTS);
  
  // Return the array so JS can control when to release it
  return objects_array;
}

static napi_value get_stats(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  NODE_API_CALL(env, napi_create_object(env, &result));
  
  napi_value finalizers_called;
  NODE_API_CALL(env, napi_create_int32(env, finalizer_called_count, &finalizers_called));
  NODE_API_CALL(env, napi_set_named_property(env, result, "finalizersCalled", finalizers_called));
  
  napi_value unrefs_failed;
  NODE_API_CALL(env, napi_create_int32(env, unref_failed_count, &unrefs_failed));
  NODE_API_CALL(env, napi_set_named_property(env, result, "unrefsFailed", unrefs_failed));
  
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value test_fn;
  NODE_API_CALL(env, napi_create_function(env, "test_reference_unref_in_finalizer_experimental", 
                                          NAPI_AUTO_LENGTH, test_reference_unref_in_finalizer_experimental, 
                                          NULL, &test_fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "test_reference_unref_in_finalizer_experimental", test_fn));
  
  napi_value stats_fn;
  NODE_API_CALL(env, napi_create_function(env, "get_stats", 
                                          NAPI_AUTO_LENGTH, get_stats, 
                                          NULL, &stats_fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "get_stats", stats_fn));
  
  return exports;
}

NAPI_MODULE(test_reference_unref_in_finalizer_experimental, init)
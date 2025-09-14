// Test that napi_reference_unref can be called from a finalizer
// This is a regression test for https://github.com/oven-sh/bun/issues/22596

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

#define MAX_REFS 100
typedef struct {
  napi_ref ref;
  int index;
} RefHolder;

static RefHolder* ref_holders[MAX_REFS];
static int finalizer_called_count = 0;
static int unref_succeeded_count = 0;
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
  if (unref_succeeded_count == 0) {
    fprintf(stderr, "ERROR: No napi_reference_unref calls succeeded\n");
    exit(1);
  }
  printf("Test completed: %d finalizers called, %d unrefs succeeded\n", 
         finalizer_called_count, unref_succeeded_count);
}

static void finalizer_unref(napi_env env, void *data, void *hint) {
  (void)hint;
  RefHolder* holder = (RefHolder*)data;
  finalizer_called_count++;
  
  if (holder && holder->ref) {
    uint32_t result;
    // This is the critical test - calling napi_reference_unref during GC
    // This would crash with NAPI_CHECK_ENV_NOT_IN_GC if not properly handled
    napi_status status = napi_reference_unref(env, holder->ref, &result);
    if (status == napi_ok) {
      unref_succeeded_count++;
      // Try to unref again to get to 0
      if (result > 0) {
        status = napi_reference_unref(env, holder->ref, &result);
      }
      // Clean up the reference if refcount is 0
      if (result == 0) {
        napi_delete_reference(env, holder->ref);
        holder->ref = NULL;
      }
    }
    free(holder);
  }
}

static napi_value test_reference_unref_in_finalizer(napi_env env, napi_callback_info info) {
  (void)info;
  
  test_ran = true;
  
  // Register atexit handler on first call
  static bool atexit_registered = false;
  if (!atexit_registered) {
    napi_add_env_cleanup_hook(env, check_test_ran, NULL);
    atexit_registered = true;
  }
  
  // Create many objects with finalizers that will call napi_reference_unref
  napi_value objects_array;
  NODE_API_CALL(env, napi_create_array_with_length(env, MAX_REFS, &objects_array));
  
  for (int i = 0; i < MAX_REFS; i++) {
    // Create an object to hold a reference to
    napi_value target_obj;
    NODE_API_CALL(env, napi_create_object(env, &target_obj));
    
    // Create a holder for this reference
    RefHolder* holder = (RefHolder*)malloc(sizeof(RefHolder));
    holder->index = i;
    
    // Create a reference with refcount 2 so we can unref it in the finalizer
    NODE_API_CALL(env, napi_create_reference(env, target_obj, 2, &holder->ref));
    ref_holders[i] = holder;
    
    // Create a wrapper object that will trigger the finalizer when GC'd
    napi_value wrapper_obj;
    NODE_API_CALL(env, napi_create_object(env, &wrapper_obj));
    
    // Add a finalizer that will call napi_reference_unref
    NODE_API_CALL(env, napi_add_finalizer(env, wrapper_obj, holder, finalizer_unref, NULL, NULL));
    
    // Store in array
    NODE_API_CALL(env, napi_set_element(env, objects_array, i, wrapper_obj));
  }
  
  printf("Created %d objects with finalizers\n", MAX_REFS);
  
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
  
  napi_value unrefs_succeeded;
  NODE_API_CALL(env, napi_create_int32(env, unref_succeeded_count, &unrefs_succeeded));
  NODE_API_CALL(env, napi_set_named_property(env, result, "unrefsSucceeded", unrefs_succeeded));
  
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value test_fn;
  NODE_API_CALL(env, napi_create_function(env, "test_reference_unref_in_finalizer", 
                                          NAPI_AUTO_LENGTH, test_reference_unref_in_finalizer, 
                                          NULL, &test_fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "test_reference_unref_in_finalizer", test_fn));
  
  napi_value stats_fn;
  NODE_API_CALL(env, napi_create_function(env, "get_stats", 
                                          NAPI_AUTO_LENGTH, get_stats, 
                                          NULL, &stats_fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "get_stats", stats_fn));
  
  return exports;
}

NAPI_MODULE(test_reference_unref_in_finalizer, init)
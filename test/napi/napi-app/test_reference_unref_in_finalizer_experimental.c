// Test that napi_reference_unref CANNOT be called from a finalizer in experimental NAPI
// This verifies the GC check is enforced for experimental modules
// This test is expected to CRASH/ABORT when the finalizer runs
// This is a regression test for https://github.com/oven-sh/bun/issues/22596

// NAPI_VERSION_EXPERIMENTAL is defined in binding.gyp
#define NAPI_EXPERIMENTAL

#include <assert.h>
#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Suppress core dumps when testing crashes
#if defined(__linux__) || defined(__APPLE__)
#include <sys/resource.h>
static void suppress_core_dumps() {
  if (getenv("BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT")) {
    struct rlimit rl;
    rl.rlim_cur = 0;
    rl.rlim_max = 0;
    setrlimit(RLIMIT_CORE, &rl);
  }
}
#elif defined(_WIN32)
#include <windows.h>
#include <dbghelp.h>
static void suppress_core_dumps() {
  if (getenv("BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT")) {
    // Disable Windows Error Reporting dialogs
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    // Disable the default crash handler
    SetUnhandledExceptionFilter(NULL);
  }
}
#else
static void suppress_core_dumps() {
  // No-op on unsupported platforms
}
#endif

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

static void finalizer_unref(napi_env env, void *data, void *hint) {
  (void)hint;
  RefHolder* holder = (RefHolder*)data;
  finalizer_called_count++;
  
  printf("Finalizer %d called, attempting napi_reference_unref...\n", holder->index);
  
  if (holder && holder->ref) {
    uint32_t result;
    // This call should ABORT the process for experimental NAPI versions during GC
    // The process will crash here with an assertion failure
    // This line should never return successfully
    napi_status status = napi_reference_unref(env, holder->ref, &result);
    
    // If we get here, something is wrong - the assertion should have failed
    printf("ERROR: napi_reference_unref returned status %d but should have aborted!\n", status);
    printf("ERROR: This indicates the GC check is NOT working for experimental modules!\n");
    exit(1);  // Force exit with error if the check didn't work
  }
  
  free(holder);
}

static napi_value test_reference_unref_in_finalizer_experimental(napi_env env, napi_callback_info info) {
  (void)info;
  
  printf("Starting experimental NAPI test\n");
  printf("This test is expected to CRASH when finalizers run.\n");
  printf("If you see 'SUCCESS' below, the test has FAILED.\n");
  
  // Create just a few objects to test - we only need one to trigger the crash
  const int NUM_OBJECTS = 3;
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
    
    // Add a finalizer that will call napi_reference_unref (should crash)
    NODE_API_CALL(env, napi_add_finalizer(env, wrapper_obj, holder, finalizer_unref, NULL, NULL));
    
    // Store in array
    NODE_API_CALL(env, napi_set_element(env, objects_array, i, wrapper_obj));
  }
  
  printf("Created %d objects with finalizers (experimental mode)\n", NUM_OBJECTS);
  
  // Return the array so JS can control when to release it
  return objects_array;
}

// napi_run_script CANNOT be called from a finalizer that runs during garbage
// collection either: it would run JavaScript inside the collector.
// A finalizer cannot make a string there, so it runs this one. The reference
// made for it keeps the string alive.
static napi_value script_for_finalizer;

static void finalizer_run_script(napi_env env, void *data, void *hint) {
  (void)data;
  (void)hint;
  printf("Finalizer called, attempting napi_run_script...\n");

  napi_value result;
  // This call should ABORT the process for experimental NAPI versions during GC
  napi_status status = napi_run_script(env, script_for_finalizer, &result);

  printf("ERROR: napi_run_script returned status %d but should have aborted!\n", status);
  exit(1);
}

static napi_value test_run_script_in_finalizer_experimental(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  script_for_finalizer = argv[0];
  napi_ref script_ref;
  NODE_API_CALL(env, napi_create_reference(env, argv[0], 1, &script_ref));

  napi_value wrapper_obj;
  NODE_API_CALL(env, napi_create_object(env, &wrapper_obj));
  NODE_API_CALL(env, napi_add_finalizer(env, wrapper_obj, NULL, finalizer_run_script, NULL, NULL));

  printf("Created 1 object with a finalizer (experimental mode)\n");
  return wrapper_obj;
}

static napi_value init(napi_env env, napi_value exports) {
  // Suppress core dumps when testing
  suppress_core_dumps();
  
  napi_value test_fn;
  NODE_API_CALL(env, napi_create_function(env, "test_reference_unref_in_finalizer_experimental", 
                                          NAPI_AUTO_LENGTH, test_reference_unref_in_finalizer_experimental, 
                                          NULL, &test_fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "test_reference_unref_in_finalizer_experimental", test_fn));

  NODE_API_CALL(env, napi_create_function(env, "test_run_script_in_finalizer_experimental",
                                          NAPI_AUTO_LENGTH, test_run_script_in_finalizer_experimental,
                                          NULL, &test_fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "test_run_script_in_finalizer_experimental", test_fn));
  
  return exports;
}

// Use NAPI_MODULE macro for proper registration
// The experimental version is already set via the #define at the top
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

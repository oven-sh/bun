// Test that the error-creation Node-API functions keep working inside
// finalizers that run during environment cleanup at process exit, even when a
// JS exception is pending on the VM.
//
// node-addon-api's Napi::Error::New(env) calls napi_get_last_error_info,
// napi_is_exception_pending, napi_create_string_utf8 and napi_create_error,
// and treats any non-ok status from them as fatal (NAPI_FATAL_IF_FAILED ->
// napi_fatal_error -> abort). Node.js implements these functions without a
// pending-exception check (see js_native_api_v8.cc), so they must succeed in
// this state. Bun used to fail them with napi_pending_exception, which
// aborted the process with "NAPI FATAL ERROR: Error::New napi_create_error".

// node_api_create_syntax_error requires version 9.
#define NAPI_VERSION 9

#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>
#include <string.h>

static void finalize_create_errors(napi_env env, void *data, void *hint) {
  (void)data;
  (void)hint;

  // Replicate the sequence node-addon-api's Napi::Error::New(env) performs.
  const napi_extended_error_info *info = NULL;
  napi_status get_last_error_info_status = napi_get_last_error_info(env, &info);

  bool exception_pending = false;
  napi_status is_exception_pending_status =
      napi_is_exception_pending(env, &exception_pending);

  const char *message = "Error in native callback";
  napi_value message_value = NULL;
  napi_status create_string_status = napi_create_string_utf8(
      env, message, strlen(message), &message_value);

  // Also exercise the non-ASCII path and the other encodings.
  const char *non_ascii_message = "Erreur d\xc3\xa9tect\xc3\xa9\x65";
  napi_value non_ascii_value = NULL;
  napi_status create_non_ascii_status = napi_create_string_utf8(
      env, non_ascii_message, strlen(non_ascii_message), &non_ascii_value);

  napi_value latin1_value = NULL;
  napi_status create_latin1_status = napi_create_string_latin1(
      env, message, strlen(message), &latin1_value);

  const char16_t utf16_message[] = u"Error in native callback";
  napi_value utf16_value = NULL;
  napi_status create_utf16_status = napi_create_string_utf16(
      env, utf16_message, sizeof(utf16_message) / sizeof(char16_t) - 1,
      &utf16_value);

  napi_value error = NULL;
  napi_status create_error_status =
      napi_create_error(env, NULL, message_value, &error);

  // Also cover the sibling error constructors that share the implementation.
  napi_value type_error = NULL;
  napi_status create_type_error_status =
      napi_create_type_error(env, NULL, message_value, &type_error);

  napi_value range_error = NULL;
  napi_status create_range_error_status =
      napi_create_range_error(env, NULL, message_value, &range_error);

  napi_value syntax_error = NULL;
  napi_status create_syntax_error_status =
      node_api_create_syntax_error(env, NULL, message_value, &syntax_error);

  // Napi::Error's constructor stores the error in a reference, and
  // ThrowAsJavaScriptException reads it back; Node implements the whole
  // reference family without a pending-exception check as well ("V8 calls
  // here cannot throw JS exceptions", js_native_api_v8.cc).
  napi_ref error_ref = NULL;
  napi_status create_reference_status =
      error == NULL ? napi_invalid_arg
                    : napi_create_reference(env, error, 1, &error_ref);

  napi_value ref_value = NULL;
  napi_status get_reference_value_status =
      error_ref == NULL
          ? napi_invalid_arg
          : napi_get_reference_value(env, error_ref, &ref_value);

  uint32_t refcount = 0;
  napi_status reference_ref_status =
      error_ref == NULL ? napi_invalid_arg
                        : napi_reference_ref(env, error_ref, &refcount);
  napi_status reference_unref_status =
      error_ref == NULL ? napi_invalid_arg
                        : napi_reference_unref(env, error_ref, &refcount);
  napi_status delete_reference_status =
      error_ref == NULL ? napi_invalid_arg
                        : napi_delete_reference(env, error_ref);

  fprintf(stderr,
          "create_error_in_finalizer: get_last_error_info=%d "
          "is_exception_pending=%d create_string_utf8=%d "
          "create_string_utf8_non_ascii=%d create_string_latin1=%d "
          "create_string_utf16=%d create_error=%d "
          "create_type_error=%d create_range_error=%d create_syntax_error=%d "
          "create_reference=%d get_reference_value=%d reference_ref=%d "
          "reference_unref=%d delete_reference=%d results_non_null=%d\n",
          (int)get_last_error_info_status, (int)is_exception_pending_status,
          (int)create_string_status, (int)create_non_ascii_status,
          (int)create_latin1_status, (int)create_utf16_status,
          (int)create_error_status, (int)create_type_error_status,
          (int)create_range_error_status, (int)create_syntax_error_status,
          (int)create_reference_status, (int)get_reference_value_status,
          (int)reference_ref_status, (int)reference_unref_status,
          (int)delete_reference_status,
          message_value != NULL && non_ascii_value != NULL &&
                  latin1_value != NULL && utf16_value != NULL &&
                  error != NULL && type_error != NULL &&
                  range_error != NULL && syntax_error != NULL &&
                  ref_value != NULL
              ? 1
              : 0);
  fflush(stderr);
}

static napi_ref throwing_fn_ref = NULL;

static void cleanup_hook_call_throwing_fn(void *arg) {
  napi_env env = (napi_env)arg;
  // Unlike finalizers, cleanup hooks don't run inside a handle scope.
  napi_handle_scope scope = NULL;
  if (napi_open_handle_scope(env, &scope) != napi_ok) {
    fprintf(stderr, "cleanup_hook_open_scope_failed\n");
    fflush(stderr);
    return;
  }
  napi_value fn = NULL;
  napi_value global = NULL;
  napi_value result = NULL;
  if (napi_get_reference_value(env, throwing_fn_ref, &fn) != napi_ok ||
      fn == NULL) {
    fprintf(stderr, "cleanup_hook_get_fn_failed\n");
    fflush(stderr);
    napi_close_handle_scope(env, scope);
    return;
  }
  napi_get_global(env, &global);
  // The function throws. The resulting status is napi_pending_exception, and
  // nothing handles the exception before the environment's finalizers run.
  napi_status status = napi_call_function(env, global, fn, 0, NULL, &result);
  fprintf(stderr, "cleanup_hook_call_status=%d\n", (int)status);
  fflush(stderr);
  napi_close_handle_scope(env, scope);
}

// Register an environment cleanup hook that calls the given JS function
// (which is expected to throw). Cleanup hooks run before the environment's
// finalizers, so this leaves a pending exception for the finalizers to
// observe.
static napi_value setup_throwing_cleanup_hook(napi_env env,
                                              napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_status status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (status != napi_ok || argc < 1) {
    napi_throw_error(env, NULL, "expected a function argument");
    return NULL;
  }

  status = napi_create_reference(env, argv[0], 1, &throwing_fn_ref);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "napi_create_reference failed");
    return NULL;
  }

  status = napi_add_env_cleanup_hook(env, cleanup_hook_call_throwing_fn, env);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "napi_add_env_cleanup_hook failed");
    return NULL;
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

// Wrap an object and keep it strongly referenced so its finalizer only runs
// from NapiEnv::cleanup() at process exit (the wrap_cleanup path).
static napi_value wrap_kept_alive(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_status status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (status != napi_ok || argc < 1) {
    napi_throw_error(env, NULL, "expected one object argument");
    return NULL;
  }

  napi_ref ref = NULL;
  status = napi_wrap(env, argv[0], NULL, finalize_create_errors, NULL, &ref);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "napi_wrap failed");
    return NULL;
  }

  // Make the reference strong so garbage collection never finalizes it; only
  // environment teardown will.
  uint32_t refcount = 0;
  status = napi_reference_ref(env, ref, &refcount);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "napi_reference_ref failed");
    return NULL;
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_status status = napi_create_function(
      env, "wrapKeptAlive", NAPI_AUTO_LENGTH, wrap_kept_alive, NULL, &fn);
  if (status != napi_ok) {
    return NULL;
  }
  status = napi_set_named_property(env, exports, "wrapKeptAlive", fn);
  if (status != napi_ok) {
    return NULL;
  }
  status = napi_create_function(env, "setupThrowingCleanupHook",
                                NAPI_AUTO_LENGTH, setup_throwing_cleanup_hook,
                                NULL, &fn);
  if (status != napi_ok) {
    return NULL;
  }
  status =
      napi_set_named_property(env, exports, "setupThrowingCleanupHook", fn);
  if (status != napi_ok) {
    return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

// Built twice (NAPI_VERSION=10 and NAPI_VERSION=8).
//
// A napi_wrap finalizer that runs at env teardown prints the status of every
// napi_throw* function two times: with nothing pending, and after it called a
// JS function that throws.
//
// Node runs no JS in a teardown finalizer. Every napi_throw* call fails there
// with napi_cannot_run_js (23) for a module that declares NAPI_VERSION >= 10,
// and with napi_pending_exception (10) for an older module. Nothing is left
// pending. Bun runs the JS function. The addon must see the same statuses.
//
// node-addon-api depends on this. With NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS,
// Error::ThrowAsJavaScriptException tolerates a napi_throw that fails at
// teardown only if nothing is reported pending and the status is the one
// above. It passes any other result to napi_fatal_error.
#include <node_api.h>
#include <stdio.h>

#if NAPI_VERSION < 9
// node_api.h declares this from NAPI_VERSION 9 on. The symbol exists for every
// module.
napi_status NAPI_CDECL node_api_throw_syntax_error(napi_env env,
                                                   const char *code,
                                                   const char *msg);
#endif

// Napi::Error::New(env) starts like this: it takes the exception if one is
// reported pending.
static void take_pending_exception(napi_env env) {
  bool pending = false;
  napi_value exception;
  if (napi_is_exception_pending(env, &pending) == napi_ok && pending) {
    napi_get_and_clear_last_exception(env, &exception);
  }
}

static void print_throw_statuses(napi_env env, const char *when) {
  napi_value message = NULL;
  napi_value error = NULL;
  napi_create_string_utf8(env, "error", NAPI_AUTO_LENGTH, &message);
  napi_create_error(env, NULL, message, &error);

  napi_status throw_status = napi_throw(env, error);
  take_pending_exception(env);
  napi_status error_status = napi_throw_error(env, NULL, "error");
  take_pending_exception(env);
  napi_status type_error_status = napi_throw_type_error(env, NULL, "error");
  take_pending_exception(env);
  napi_status range_error_status = napi_throw_range_error(env, NULL, "error");
  take_pending_exception(env);
  napi_status syntax_error_status = node_api_throw_syntax_error(env, NULL, "error");
  take_pending_exception(env);

  printf("%s: throw=%d throw_error=%d throw_type_error=%d throw_range_error=%d "
         "throw_syntax_error=%d\n",
         when, (int)throw_status, (int)error_status, (int)type_error_status,
         (int)range_error_status, (int)syntax_error_status);
}

// data is the napi_ref of the function to call.
static void finalize(napi_env env, void *data, void *hint) {
  (void)hint;
  napi_ref fn_ref = (napi_ref)data;

  print_throw_statuses(env, "nothing pending");

  napi_value fn = NULL;
  napi_value undefined = NULL;
  napi_value result = NULL;
  napi_get_reference_value(env, fn_ref, &fn);
  napi_get_undefined(env, &undefined);
  // Node refuses this call. Bun runs fn, and fn throws.
  napi_status call_status = napi_call_function(env, undefined, fn, 0, NULL, &result);
  take_pending_exception(env);
  printf("call_function=%s\n", call_status == napi_ok ? "ok" : "failed");

  print_throw_statuses(env, "after the call");
  fflush(stdout);

  napi_delete_reference(env, fn_ref);
}

// setup(fn): object. The finalizer of the returned object calls fn.
static napi_value setup(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value fn;
  napi_get_cb_info(env, info, &argc, &fn, NULL, NULL);

  napi_ref fn_ref;
  napi_create_reference(env, fn, 1, &fn_ref);

  napi_value wrapped;
  napi_create_object(env, &wrapped);
  napi_wrap(env, wrapped, fn_ref, finalize, NULL, NULL);
  return wrapped;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value fn;
  napi_create_function(env, "setup", NAPI_AUTO_LENGTH, setup, NULL, &fn);
  napi_set_named_property(env, exports, "setup", fn);
  return exports;
}

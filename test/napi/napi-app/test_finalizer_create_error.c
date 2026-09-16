// Regression test for oven-sh/bun#30286.
//
// node-addon-api's Napi::Error::New(env) calls napi_create_error and feeds
// any failure status to NAPI_FATAL_IF_FAILED -> napi_fatal_error:
//   "NAPI FATAL ERROR: Error::New napi_create_error"
// Two shapes of #30286 reached that abort:
//   - tree-sitter: a napi callback had called a JS function that threw, so a
//     JSC VM exception was pending when the addon built an Error to report
//     it, and Bun's napi_create_error returned napi_pending_exception. Node
//     makes napi_create_error a pure value-producing call (#22259).
//   - node-canvas: a Worker was terminate()d. JSC's TerminationException was
//     pending on the VM when NapiEnv::cleanup() reached the first wrap
//     finalizer, and the finalizer's first napi call failed on it.
//
// Two entry points reproduce them:
//   - createErrorWithPendingException(fnThatThrows): calls fn through
//     napi_call_function (it throws, the exception stays on the VM), then
//     napi_create_string_utf8 + napi_create_error, and prints the status. The
//     exception is then cleared so the process exits clean.
//   - setupSingle(): wraps one object whose finalizer runs the same
//     napi_create_string_utf8 + napi_create_error sequence and prints the
//     status. Run it in a Worker that the parent terminate()s.
// Both print "create_error_status=0" in node and in bun.

#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void print_create_error_status(napi_env env) {
  napi_value msg;
  napi_status s = napi_create_string_utf8(env, "finalizer-error", NAPI_AUTO_LENGTH, &msg);
  if (s != napi_ok) {
    printf("create_error_status=%d\n", -(100 + s));
    fflush(stdout);
    return;
  }

  napi_value err;
  printf("create_error_status=%d\n", (int)napi_create_error(env, NULL, msg, &err));
  fflush(stdout);
}

static void finalize_create_error(napi_env env, void *data, void *hint) {
  (void)data;
  (void)hint;
  print_create_error_status(env);
}

// createErrorWithPendingException(fnThatThrows: () => never): undefined
static napi_value create_error_with_pending_exception(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 1) {
    napi_throw_error(env, NULL, "needs a throwing fn");
    return NULL;
  }

  napi_value undef;
  napi_get_undefined(env, &undef);
  // fn throws. napi_call_function returns napi_pending_exception and leaves
  // the exception on the VM.
  (void)napi_call_function(env, undef, args[0], 0, NULL, NULL);

  print_create_error_status(env);

  napi_value exception;
  napi_get_and_clear_last_exception(env, &exception);
  return NULL;
}

// setupSingle(): object
static napi_value setup_single(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value obj;
  napi_create_object(env, &obj);
  napi_wrap(env, obj, NULL, finalize_create_error, NULL, NULL);
  return obj;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_property_descriptor props[] = {
      {"createErrorWithPendingException", NULL, create_error_with_pending_exception, NULL, NULL, NULL, napi_default, NULL},
      {"setupSingle", NULL, setup_single, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

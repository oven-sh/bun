// Regression test for oven-sh/bun#30286.
//
// Previously, if a NAPI finalizer left a pending JSC-VM exception behind
// (which happens in the wild when a finalizer calls a napi function
// that throws -- tree-sitter's FinalizeNode path is one example), the
// NEXT finalizer in the LIFO chain that called napi_create_error would
// fail with napi_pending_exception. When the caller was node-addon-api's
// Napi::Error::New(env) helper, that failure status fed
// NAPI_FATAL_IF_FAILED -> napi_fatal_error -> the reporter's panic:
//   "NAPI FATAL ERROR: Error::New napi_create_error"
//
// Root cause (two layers):
//   - NapiEnv::cleanup() did not clear pending exceptions between
//     finalizers. A throw from one finalizer bled into the next -- even
//     though finalizers run without a JS frame that could catch, so
//     there is no point propagating.
//   - Separately, createErrorWithNapiValues had its own
//     DECLARE_THROW_SCOPE + RETURN_IF_EXCEPTION at entry that returned
//     napi_pending_exception whenever a VM exception was live. Node.js
//     makes napi_create_error a pure value-producing call, so this was
//     a compatibility bug on its own (#22259).
//
// Reproduces the sequence without tree-sitter:
//   - Wrap two JS objects. Finalizers run LIFO during env teardown.
//   - The one that runs FIRST calls a JS function via napi_call_function
//     that throws; the throw reaches the VM throw scope and we return
//     without clearing it.
//   - The one that runs SECOND calls napi_create_error.
//       * Before the fix: returns napi_pending_exception (10).
//       * After the fix:  returns napi_ok (0).
//
// The test driver spawns bun, waits for it to exit, and asserts the
// finalizer printed "create_error_status=0".

#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Strong ref (refcount 1) so the throwing function the finalizer calls
// survives until env cleanup.
static napi_ref throw_fn_ref = NULL;
static int create_error_status = -999;

// Runs SECOND during LIFO cleanup (wrapped FIRST). At this point the
// other finalizer has already left an Error on the JSC VM scope.
static void finalize_create_error(napi_env env, void *data, void *hint) {
  (void)data;
  (void)hint;

  napi_value msg;
  napi_status s = napi_create_string_utf8(env, "finalizer-error", NAPI_AUTO_LENGTH, &msg);
  if (s != napi_ok) {
    create_error_status = -(100 + s);
    printf("create_error_status=%d\n", create_error_status);
    fflush(stdout);
    return;
  }

  napi_value err;
  // Before the fix: returns napi_pending_exception because
  // createErrorWithNapiValues's throw-scope check saw the prior
  // finalizer's VM exception.
  // After the fix: returns napi_ok.
  create_error_status = napi_create_error(env, NULL, msg, &err);

  // Emit directly from the finalizer -- cleanup hooks run BEFORE
  // finalizers, so we can't rely on a post-finalize hook.
  printf("create_error_status=%d\n", create_error_status);
  fflush(stdout);
}

// Runs FIRST during LIFO cleanup (wrapped SECOND). Calls a throwing JS
// function via napi_call_function. The throw propagates to the VM scope;
// we return without clearing it, leaving the exception pending for the
// next finalizer.
static void finalize_leak_exception(napi_env env, void *data, void *hint) {
  (void)data;
  (void)hint;

  if (!throw_fn_ref) {
    return;
  }

  napi_value fn;
  napi_status s = napi_get_reference_value(env, throw_fn_ref, &fn);
  if (s != napi_ok || !fn) {
    return;
  }

  napi_value undef;
  napi_get_undefined(env, &undef);

  // Invoke the JS function; it throws. napi_call_function returns
  // napi_pending_exception without clearing the VM scope, so the
  // exception stays live for the next finalizer's entry.
  (void)napi_call_function(env, undef, fn, 0, NULL, NULL);
}

// setup(fnThatThrows: () => never): { outer: object, inner: object }
//   fnThatThrows must be a JS function that throws when called. We hold
//   a strong ref to it so it survives to cleanup, then wrap two fresh
//   objects with the two finalizers above.
static napi_value setup(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 1) {
    napi_throw_error(env, NULL, "setup needs throwing fn");
    return NULL;
  }

  napi_create_reference(env, args[0], 1, &throw_fn_ref);

  // Outer is wrapped FIRST -> appears earlier in the finalizer list ->
  // cleanup iterates in reverse (LIFO) -> its finalizer runs SECOND,
  // after the exception has been leaked.
  napi_value outer;
  napi_create_object(env, &outer);
  napi_wrap(env, outer, NULL, finalize_create_error, NULL, NULL);

  // Inner is wrapped SECOND -> its finalizer runs FIRST and leaks the
  // pending VM exception the next finalizer will inherit.
  napi_value inner;
  napi_create_object(env, &inner);
  napi_wrap(env, inner, NULL, finalize_leak_exception, NULL, NULL);

  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "outer", outer);
  napi_set_named_property(env, result, "inner", inner);
  return result;
}

// Env cleanup hook that leaves a pending JSC VM exception behind:
// napi_throw_error schedules an env-level exception (always allowed),
// and napi_call_function's prologue (env->throwPendingException())
// promotes it to a VM-level exception before validating any argument,
// then returns napi_pending_exception with the exception still set.
// This is the same state node-canvas reaches on Worker.terminate():
// a finalizer/hook fails internally, the scheduled exception gets
// promoted to the VM, and it is still pending when NapiEnv::cleanup()
// reaches the first wrap finalizer. Without the clearing between the
// hook phase and the finalizer phase, that first finalizer's first
// napi call fails with napi_pending_exception and node-addon-api
// escalates to napi_fatal_error ("Error::Error napi_create_object").
static void leak_exception_cleanup_hook(void *arg) {
  napi_env env = (napi_env)arg;
  napi_throw_error(env, NULL, "leaked from cleanup hook");
  // Promotes the scheduled exception onto the VM and leaves it there.
  (void)napi_call_function(env, NULL, NULL, 0, NULL, NULL);
}

// setupSingle(): object
//   Registers the exception-leaking cleanup hook and wraps ONE object
//   whose finalizer immediately calls napi_create_string_utf8 +
//   napi_create_error and prints the resulting status. Hooks run before
//   wrap finalizers, so the finalizer only succeeds if cleanup clears
//   pending exceptions before entering the finalizer phase.
static napi_value setup_single(napi_env env, napi_callback_info info) {
  (void)info;

  napi_add_env_cleanup_hook(env, leak_exception_cleanup_hook, env);

  napi_value obj;
  napi_create_object(env, &obj);
  napi_wrap(env, obj, NULL, finalize_create_error, NULL, NULL);
  return obj;
}

// Regression test for oven-sh/bun#34663 (node-sqlite3's CleanQueue shape).
//
// A wrap finalizer running during env cleanup calls a JS function via
// napi_call_function and the JS throws (node-sqlite3: emitting 'error' on
// an EventEmitter with no listener). node-addon-api then does:
//   napi_is_exception_pending -> napi_get_and_clear_last_exception ->
//   napi_throw (Error::ThrowAsJavaScriptException rethrows), aborting via
//   napi_fatal_error if any step disagrees with the others.
// Before the fix the thrown exception stayed on the JSC VM, where
// napi_is_exception_pending (which skips the VM check during cleanup)
// could not see it, and the rethrow was rejected. This finalizer performs
// the same sequence with raw napi calls and prints each status.
static napi_ref rethrow_fn_ref = NULL;

static void finalize_rethrow(napi_env env, void *data, void *hint) {
  (void)data;
  (void)hint;

  napi_value fn;
  if (!rethrow_fn_ref ||
      napi_get_reference_value(env, rethrow_fn_ref, &fn) != napi_ok || !fn) {
    printf("rethrow: could not get function\n");
    fflush(stdout);
    return;
  }

  napi_value undef;
  napi_get_undefined(env, &undef);

  // The JS function throws; expect napi_pending_exception.
  napi_status call_status = napi_call_function(env, undef, fn, 0, NULL, NULL);

  // node-addon-api's Error::New(env): the exception must be visible here,
  // or it falls into the napi_create_error path and aborts.
  bool pending = false;
  napi_status pending_status = napi_is_exception_pending(env, &pending);

  napi_value exception = NULL;
  napi_status get_status =
      napi_get_and_clear_last_exception(env, &exception);

  // Error::Error(env, value) takes a reference on the exception object.
  napi_ref exception_ref = NULL;
  napi_status ref_status =
      napi_create_reference(env, exception, 1, &exception_ref);

  // Error::ThrowAsJavaScriptException rethrows; a failure here is fatal in
  // node-addon-api.
  napi_status throw_status = napi_throw(env, exception);

  printf("rethrow: call=%d is_pending=%d pending=%d get=%d ref=%d throw=%d\n",
         call_status, pending_status, pending ? 1 : 0, get_status, ref_status,
         throw_status);
  fflush(stdout);
}

// setupRethrow(fnThatThrows: () => never): object
static napi_value setup_rethrow(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc < 1) {
    napi_throw_error(env, NULL, "setupRethrow needs throwing fn");
    return NULL;
  }

  napi_create_reference(env, args[0], 1, &rethrow_fn_ref);

  napi_value obj;
  napi_create_object(env, &obj);
  napi_wrap(env, obj, NULL, finalize_rethrow, NULL, NULL);
  return obj;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_property_descriptor props[] = {
      {"setup", NULL, setup, NULL, NULL, NULL, napi_default, NULL},
      {"setupSingle", NULL, setup_single, NULL, NULL, NULL, napi_default, NULL},
      {"setupRethrow", NULL, setup_rethrow, NULL, NULL, NULL, napi_default,
       NULL},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

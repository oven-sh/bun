// Built twice (NAPI_VERSION=10 and NAPI_VERSION=8).
//
// Node tears an addon's env down at a natural exit of the main thread or of a
// Worker with can_call_into_js() false: the cleanup hooks, the finalizers of
// the live wraps, and the instance data finalizer all run there, and every
// Node-API function that starts with NAPI_PREAMBLE returns napi_cannot_run_js
// (23) for a module that declares NAPI_VERSION >= 10, or napi_pending_exception
// (10) for an older module, and does nothing. The JS function handed to
// setup() never runs. Functions that Node does not gate (value constructors,
// napi_get_instance_data, napi_create_error) keep working.
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>

static int instance_data = 42;

static void call_js(napi_env env, napi_ref fn_ref, const char *when) {
  // A cleanup hook runs without a handle scope in Node.
  napi_handle_scope scope = NULL;
  napi_open_handle_scope(env, &scope);
  napi_value fn = NULL;
  napi_value undefined = NULL;
  napi_value result = NULL;
  napi_get_reference_value(env, fn_ref, &fn);
  napi_get_undefined(env, &undefined);
  napi_status status = napi_call_function(env, undefined, fn, 0, NULL, &result);
  bool pending = true;
  napi_is_exception_pending(env, &pending);
  printf("%s: call_function=%d pending=%d\n", when, (int)status, (int)pending);
  fflush(stdout);
  napi_close_handle_scope(env, scope);
}

struct hook_data {
  napi_env env;
  napi_ref fn_ref;
};

static void cleanup_hook(void *data) {
  struct hook_data *hook = (struct hook_data *)data;
  call_js(hook->env, hook->fn_ref, "cleanup hook");
  napi_delete_reference(hook->env, hook->fn_ref);
  free(hook);
}

static void instance_data_finalizer(napi_env env, void *data, void *hint) {
  napi_ref fn_ref = (napi_ref)hint;
  printf("instance data finalizer: data=%s\n",
         data == &instance_data ? "ours" : "wrong");
  call_js(env, fn_ref, "instance data finalizer");
  napi_delete_reference(env, fn_ref);
}

// data is the napi_ref of the function to call.
static void wrap_finalizer(napi_env env, void *data, void *hint) {
  (void)hint;
  napi_ref fn_ref = (napi_ref)data;
  call_js(env, fn_ref, "wrap finalizer");

  napi_value fn = NULL;
  napi_value undefined = NULL;
  napi_value object = NULL;
  napi_value string = NULL;
  napi_value result = NULL;
  napi_get_reference_value(env, fn_ref, &fn);
  napi_get_undefined(env, &undefined);
  napi_create_object(env, &object);
  napi_create_string_utf8(env, "1 + 1", NAPI_AUTO_LENGTH, &string);

  napi_status get_named_property =
      napi_get_named_property(env, object, "x", &result);
  napi_status set_named_property =
      napi_set_named_property(env, object, "x", string);
  napi_status make_callback =
      napi_make_callback(env, NULL, undefined, fn, 0, NULL, &result);
  napi_deferred deferred = NULL;
  napi_status create_promise = napi_create_promise(env, &deferred, &result);
  napi_status create_external_buffer = napi_create_external_buffer(
      env, 4, (void *)"abcd", NULL, NULL, &result);
  napi_status run_script = napi_run_script(env, string, &result);
  napi_status throw_error = napi_throw_error(env, NULL, "error");
  bool equal = false;
  napi_status strict_equals = napi_strict_equals(env, object, object, &equal);
  printf("wrap finalizer: get_named_property=%d set_named_property=%d "
         "make_callback=%d create_promise=%d create_external_buffer=%d "
         "run_script=%d throw_error=%d strict_equals=%d\n",
         (int)get_named_property, (int)set_named_property, (int)make_callback,
         (int)create_promise, (int)create_external_buffer, (int)run_script,
         (int)throw_error, (int)strict_equals);

  // Not gated in Node: these still work.
  napi_value error = NULL;
  napi_status create_error = napi_create_error(env, NULL, string, &error);
  napi_valuetype type = napi_undefined;
  napi_status typeof_status = napi_typeof(env, error, &type);
  void *data_out = NULL;
  napi_status get_instance_data = napi_get_instance_data(env, &data_out);
  bool pending = true;
  napi_is_exception_pending(env, &pending);
  printf("wrap finalizer: create_error=%d typeof=%d is_object=%d "
         "get_instance_data=%d data=%s pending=%d\n",
         (int)create_error, (int)typeof_status, (int)(type == napi_object),
         (int)get_instance_data, data_out == &instance_data ? "ours" : "wrong",
         (int)pending);
  fflush(stdout);

  napi_delete_reference(env, fn_ref);
}

// setup(fn): object. The cleanup hook, the finalizer of the returned object,
// and the instance data finalizer each try to call fn at teardown.
static napi_value setup(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value fn;
  napi_get_cb_info(env, info, &argc, &fn, NULL, NULL);

  struct hook_data *hook = malloc(sizeof(*hook));
  hook->env = env;
  napi_create_reference(env, fn, 1, &hook->fn_ref);
  napi_add_env_cleanup_hook(env, cleanup_hook, hook);

  napi_ref instance_ref;
  napi_create_reference(env, fn, 1, &instance_ref);
  napi_set_instance_data(env, &instance_data, instance_data_finalizer,
                         instance_ref);

  napi_ref wrap_ref;
  napi_create_reference(env, fn, 1, &wrap_ref);
  napi_value wrapped;
  napi_create_object(env, &wrapped);
  napi_wrap(env, wrapped, wrap_ref, wrap_finalizer, NULL, NULL);
  return wrapped;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value fn;
  napi_create_function(env, "setup", NAPI_AUTO_LENGTH, setup, NULL, &fn);
  napi_set_named_property(env, exports, "setup", fn);
  return exports;
}

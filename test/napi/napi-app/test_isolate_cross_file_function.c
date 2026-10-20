// `bun test --isolate` gives every test file its own global object, but the
// addon is dlopen'd once per process. A napi_ref taken while one file ran
// keeps a function alive into the next file. Calling that function must open
// its handle scope on the same global the napi_* calls root into, or the
// values it creates are unrooted and a GC during the call frees them.
#include <node_api.h>
#include <stdlib.h>

static napi_ref retained_ref = NULL;
static napi_env retained_env = NULL;

static napi_value create_promise(napi_env env, napi_callback_info info) {
  napi_deferred deferred;
  napi_value promise;
  if (napi_create_promise(env, &deferred, &promise) != napi_ok) return NULL;
  napi_value v;
  napi_create_int32(env, 42, &v);
  napi_resolve_deferred(env, deferred, v);
  return promise;
}

static napi_value retain(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (retained_ref) {
    napi_delete_reference(retained_env, retained_ref);
    retained_ref = NULL;
  }
  napi_create_reference(env, argv[0], 1, &retained_ref);
  retained_env = env;
  return NULL;
}

static napi_value retained(napi_env env, napi_callback_info info) {
  napi_value out;
  if (!retained_ref) {
    napi_get_undefined(env, &out);
    return out;
  }
  napi_get_reference_value(retained_env, retained_ref, &out);
  return out;
}

// Bun.gc(true), twice.
static void full_gc(napi_env env) {
  napi_value global, bun, gc, force, result;
  napi_get_global(env, &global);
  napi_get_named_property(env, global, "Bun", &bun);
  napi_get_named_property(env, bun, "gc", &gc);
  napi_get_boolean(env, true, &force);
  for (int j = 0; j < 2; j++) {
    napi_call_function(env, bun, gc, 1, &force, &result);
  }
}

// Creates many objects into a malloc'd array that the GC does not scan, forces
// collections, then reads the objects back. Returns how many came back wrong.
// With a working handle scope every object is rooted and the result is 0.
static napi_value stress(napi_env env, napi_callback_info info) {
  enum { N = 2000 };
  napi_value* arr = (napi_value*)malloc(sizeof(napi_value) * N);
  for (int i = 0; i < N; i++) {
    napi_create_object(env, &arr[i]);
    napi_value v;
    napi_create_int32(env, i, &v);
    napi_set_named_property(env, arr[i], "i", v);
  }
  full_gc(env);
  for (int k = 0; k < 20000; k++) {
    napi_value s;
    napi_create_string_utf8(env, "some garbage string to allocate on the heap", NAPI_AUTO_LENGTH, &s);
  }
  full_gc(env);
  int bad = 0;
  for (int i = 0; i < N; i++) {
    napi_valuetype t;
    if (napi_typeof(env, arr[i], &t) != napi_ok || t != napi_object) {
      bad++;
      continue;
    }
    napi_value v;
    int32_t got = -1;
    napi_get_named_property(env, arr[i], "i", &v);
    napi_get_value_int32(env, v, &got);
    if (got != i) bad++;
  }
  free(arr);
  napi_value out;
  napi_create_int32(env, bad, &out);
  return out;
}

// Returns an object that was created inside an escapable scope and escaped
// from it. Exercises napi_open_escapable_handle_scope with a parent scope.
static napi_value escapable(napi_env env, napi_callback_info info) {
  napi_escapable_handle_scope scope;
  napi_open_escapable_handle_scope(env, &scope);
  napi_value obj, v, out;
  napi_create_object(env, &obj);
  napi_create_int32(env, 7, &v);
  napi_set_named_property(env, obj, "v", v);
  napi_escape_handle(env, scope, obj, &out);
  napi_close_escapable_handle_scope(env, scope);
  return out;
}

// Opens and closes an explicit scope nested in the implicit per-call scope.
// Returns 1 when the scope balance check passes.
static napi_value interleaved(napi_env env, napi_callback_info info) {
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  for (int i = 0; i < 100; i++) {
    napi_value tmp;
    napi_create_object(env, &tmp);
  }
  napi_status status = napi_close_handle_scope(env, scope);
  napi_value out;
  napi_create_int32(env, status == napi_ok ? 1 : 0, &out);
  return out;
}

// `new Thing(n)`: stores n on this. `get()` reads it back, `doubled` is a
// getter. Covers the construct path and the property callbacks of
// napi_define_class.
static napi_value thing_constructor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1], this_arg;
  napi_get_cb_info(env, info, &argc, argv, &this_arg, NULL);
  napi_set_named_property(env, this_arg, "n", argv[0]);
  return this_arg;
}

static napi_value thing_get(napi_env env, napi_callback_info info) {
  napi_value this_arg, out;
  napi_get_cb_info(env, info, NULL, NULL, &this_arg, NULL);
  napi_get_named_property(env, this_arg, "n", &out);
  return out;
}

static napi_value thing_doubled(napi_env env, napi_callback_info info) {
  napi_value this_arg, n, out;
  napi_get_cb_info(env, info, NULL, NULL, &this_arg, NULL);
  napi_get_named_property(env, this_arg, "n", &n);
  int32_t value = 0;
  napi_get_value_int32(env, n, &value);
  napi_create_int32(env, value * 2, &out);
  return out;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "createPromise", NAPI_AUTO_LENGTH, create_promise, NULL, &fn);
  napi_set_named_property(env, exports, "createPromise", fn);
  napi_create_function(env, "retain", NAPI_AUTO_LENGTH, retain, NULL, &fn);
  napi_set_named_property(env, exports, "retain", fn);
  napi_create_function(env, "retained", NAPI_AUTO_LENGTH, retained, NULL, &fn);
  napi_set_named_property(env, exports, "retained", fn);
  napi_create_function(env, "stress", NAPI_AUTO_LENGTH, stress, NULL, &fn);
  napi_set_named_property(env, exports, "stress", fn);
  napi_create_function(env, "escapable", NAPI_AUTO_LENGTH, escapable, NULL, &fn);
  napi_set_named_property(env, exports, "escapable", fn);
  napi_create_function(env, "interleaved", NAPI_AUTO_LENGTH, interleaved, NULL, &fn);
  napi_set_named_property(env, exports, "interleaved", fn);

  napi_property_descriptor props[] = {
      {"get", NULL, thing_get, NULL, NULL, NULL, napi_default, NULL},
      {"doubled", NULL, NULL, thing_doubled, NULL, NULL, napi_default, NULL},
  };
  napi_value thing;
  napi_define_class(env, "Thing", NAPI_AUTO_LENGTH, thing_constructor, NULL, 2, props, &thing);
  napi_set_named_property(env, exports, "Thing", thing);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

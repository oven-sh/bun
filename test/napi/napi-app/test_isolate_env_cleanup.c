// Mimics napi-rs: every load defines a class and keeps its constructor in a reference that nothing deletes,
// and creates a threadsafe function around a JS function that lives until the env is torn down.

#include <js_native_api.h>
#include <node_api.h>

static napi_value noop(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value klass;
  napi_ref klass_ref;
  napi_define_class(env, "Klass", NAPI_AUTO_LENGTH, noop, NULL, 0, NULL,
                    &klass);
  napi_create_reference(env, klass, 1, &klass_ref);
  napi_set_named_property(env, exports, "Klass", klass);

  napi_value callback, name;
  napi_threadsafe_function tsfn;
  napi_create_function(env, "callback", NAPI_AUTO_LENGTH, noop, NULL,
                       &callback);
  napi_create_string_utf8(env, "tsfn", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, callback, NULL, name, 0, 1, NULL, NULL,
                                  NULL, NULL, &tsfn);
  napi_unref_threadsafe_function(env, tsfn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

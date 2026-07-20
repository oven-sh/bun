#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>

// This addon exercises napi_module_register (the deprecated static-ctor
// registration path) and asserts that the `exports` argument passed to
// nm_register_func is module.exports, not the module object itself.

static napi_value register_cb(napi_env env, napi_value exports);

static napi_module mod = {
    1,                            // nm_version
    0,                            // nm_flags
    "exports_identity_addon.cpp", // nm_filename
    register_cb,                  // nm_register_func
    "exports_identity_addon",     // nm_modname
    NULL,                         // nm_priv
    {NULL}                        // reserved
};

class call_register {
public:
  call_register() { napi_module_register(&mod); }
};

static call_register constructor1;

static napi_value register_cb(napi_env env, napi_value exports) {
  napi_value key;
  napi_create_string_utf8(env, "exports", NAPI_AUTO_LENGTH, &key);
  bool has_own_exports = false;
  napi_has_own_property(env, exports, key, &has_own_exports);
  printf("exports_has_own_exports=%d\n", has_own_exports ? 1 : 0);
  fflush(stdout);

  napi_value marker;
  napi_create_int32(env, 1, &marker);
  napi_set_named_property(env, exports, "marker", marker);
  return exports;
}

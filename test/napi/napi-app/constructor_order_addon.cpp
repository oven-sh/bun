#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>

napi_value register_cb(napi_env env, napi_value exports);

static napi_module mod = {
    1,                           // nm_version
    0,                           // nm_flags
    "constructor_order_addon.c", // nm_filename
    register_cb,                 // nm_register_func
    "constructor_order_addon",   // nm_modname
    NULL,                        // nm_priv
    {NULL}                       // reserved
};

class call_register {
public:
  call_register() {
    // should be called first during dlopen
    printf("call_register\n");
    napi_module_register(&mod);
  }
};

class init_static {
public:
  init_static() {
    // should be called second during dlopen
    printf("init_static\n");
  }
};

// declare these so their constructors run
static call_register constructor1;
static init_static constructor2;

napi_value register_cb(napi_env env, napi_value exports) {
  // should be called third, after dlopen returns and bun runs the callback
  // passed to napi_module_register
  (void)env;
  printf("register_cb\n");
  return exports;
}

#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>

void call_register(void) __attribute__((constructor(1)));
void init_static(void) __attribute__((constructor(2)));
napi_value register_cb(napi_env env, napi_value exports);

static napi_module mod = {1,
                          0,
                          "constructor_order_addon.c",
                          register_cb,
                          "constructor_order_addon",
                          NULL,
                          {NULL}};

void call_register(void) {
  printf("call_register\n");
  napi_module_register(&mod);
}

void init_static(void) { printf("init_static\n"); }

napi_value register_cb(napi_env env, napi_value exports) {
  (void)env;
  printf("register_cb\n");
  return exports;
}

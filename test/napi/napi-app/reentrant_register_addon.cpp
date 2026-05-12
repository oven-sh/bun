#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>

// This addon exercises re-entrant napi_module_register: the init callback
// of a module registered via a static constructor itself calls
// napi_module_register() for more modules. Bun iterates the pending-module
// vector after dlopen returns, and appending to that vector while iterating
// it used to reallocate the backing buffer and leave the range-for iterator
// dangling (heap-use-after-free under ASAN).

static napi_value register_cb_a(napi_env env, napi_value exports);
static napi_value register_cb_b(napi_env env, napi_value exports);
static napi_value register_cb_reentrant(napi_env env, napi_value exports);

static napi_module mod_a = {
    1,                              // nm_version
    0,                              // nm_flags
    "reentrant_register_addon.cpp", // nm_filename
    register_cb_a,                  // nm_register_func
    "reentrant_register_a",         // nm_modname
    NULL,                           // nm_priv
    {NULL}                          // reserved
};

static napi_module mod_b = {
    1,                              // nm_version
    0,                              // nm_flags
    "reentrant_register_addon.cpp", // nm_filename
    register_cb_b,                  // nm_register_func
    "reentrant_register_b",         // nm_modname
    NULL,                           // nm_priv
    {NULL}                          // reserved
};

// Enough extra registrations to force the backing WTF::Vector to grow
// past any initial capacity and reallocate at least once.
#define N_REENTRANT 64
static napi_module reentrant_mods[N_REENTRANT];
static int reentrant_calls = 0;

class call_register {
public:
  call_register() {
    // Register two modules so the outer execute loop iterates more than
    // once; the second iteration is what touches freed memory if the
    // vector was reallocated by the re-entrant appends in register_cb_a.
    napi_module_register(&mod_a);
    napi_module_register(&mod_b);
  }
};

static call_register constructor1;

static napi_value register_cb_a(napi_env env, napi_value exports) {
  (void)env;
  printf("register_cb_a\n");
  for (int i = 0; i < N_REENTRANT; i++) {
    reentrant_mods[i].nm_version = 1;
    reentrant_mods[i].nm_flags = 0;
    reentrant_mods[i].nm_filename = "reentrant_register_addon.cpp";
    reentrant_mods[i].nm_register_func = register_cb_reentrant;
    reentrant_mods[i].nm_modname = "reentrant_register_extra";
    reentrant_mods[i].nm_priv = NULL;
    napi_module_register(&reentrant_mods[i]);
  }
  return exports;
}

static napi_value register_cb_b(napi_env env, napi_value exports) {
  (void)env;
  printf("register_cb_b\n");
  return exports;
}

static napi_value register_cb_reentrant(napi_env env, napi_value exports) {
  (void)env;
  reentrant_calls++;
  if (reentrant_calls == N_REENTRANT) {
    printf("register_cb_reentrant x %d\n", N_REENTRANT);
  }
  return exports;
}

#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>

// This addon exercises re-entrant napi_module_register: the init callback
// of a module registered via a static constructor itself calls
// napi_module_register() for more modules. Bun iterates the pending-module
// vector after dlopen returns, and appending to that vector while iterating
// it used to reallocate the backing buffer and leave the range-for iterator
// dangling (heap-use-after-free under ASAN).
//
// Each init callback also counts its call in a property of the `exports` it
// receives (`a`, `b`, `reentrant`), so a test can tell which object each one
// got. register_cb_a calls globalThis.duringInit(), if it is a function,
// while the modules it registered are still queued.

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

static void count_call(napi_env env, napi_value exports, const char *name) {
  napi_value value;
  napi_valuetype type = napi_undefined;
  int32_t count = 0;
  napi_get_named_property(env, exports, name, &value);
  napi_typeof(env, value, &type);
  if (type == napi_number) {
    napi_get_value_int32(env, value, &count);
  }
  napi_create_int32(env, count + 1, &value);
  napi_set_named_property(env, exports, name, value);
}

static napi_value register_cb_a(napi_env env, napi_value exports) {
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

  napi_value global, during_init;
  napi_valuetype type = napi_undefined;
  napi_get_global(env, &global);
  napi_get_named_property(env, global, "duringInit", &during_init);
  napi_typeof(env, during_init, &type);
  if (type == napi_function) {
    napi_call_function(env, global, during_init, 0, NULL, NULL);
  }

  count_call(env, exports, "a");
  return exports;
}

static napi_value register_cb_b(napi_env env, napi_value exports) {
  printf("register_cb_b\n");
  count_call(env, exports, "b");
  return exports;
}

static napi_value register_cb_reentrant(napi_env env, napi_value exports) {
  reentrant_calls++;
  if (reentrant_calls == N_REENTRANT) {
    printf("register_cb_reentrant x %d\n", N_REENTRANT);
  }
  count_call(env, exports, "reentrant");
  return exports;
}

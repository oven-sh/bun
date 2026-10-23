#include "node_api.h"

/*
 * Model a legacy native addon which expects the host process to provide the
 * C++ runtime. The final link intentionally omits libstdc++, leaving these
 * relocations for process.dlopen() to resolve from the global loader scope.
 */
extern void *cxx_operator_new(size_t size) __asm__("_Znwm");
extern void cxx_operator_delete(void *ptr) __asm__("_ZdlPv");

static void *(*volatile cxx_operator_new_ptr)(size_t) = cxx_operator_new;
static void (*volatile cxx_operator_delete_ptr)(void *) = cxx_operator_delete;

NAPI_MODULE_INIT() {
  void *allocation = cxx_operator_new_ptr(32);
  cxx_operator_delete_ptr(allocation);

  napi_value loaded;
  if (napi_get_boolean(env, true, &loaded) != napi_ok)
    return NULL;
  if (napi_set_named_property(env, exports, "loaded", loaded) != napi_ok)
    return NULL;
  return exports;
}

#include <js_native_api.h>
#include <node_api.h>

// Registered through napi_module_register() from a static constructor (the
// pre-NAPI_MODULE_INIT registration path). Its init throws with
// napi_throw_error; requiring the addon must throw that error.

static napi_value init(napi_env env, napi_value exports) {
  napi_throw_error(env, "ERR_THROWING_INIT", "init threw on purpose");
  return NULL;
}

static napi_module mod = {
    1, 0, "throwing_init_addon.c", init, "throwing_init_addon", NULL, {NULL},
};

#if defined(_MSC_VER)
#pragma section(".CRT$XCU", read)
static void __cdecl do_register(void);
__declspec(allocate(".CRT$XCU")) void(__cdecl *do_register_)(void) =
    do_register;
static void __cdecl do_register(void) { napi_module_register(&mod); }
#else
static void do_register(void) __attribute__((constructor));
static void do_register(void) { napi_module_register(&mod); }
#endif

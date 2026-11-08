// An N-API addon whose Windows build imports from node.exe without node-gyp's
// win_delay_load_hook. binding.gyp builds this source in several variants:
//   (default)                    exports napi_register_module_v1
//   REGISTER_VIA_CONSTRUCTOR     calls napi_module_register from a static initializer, inside DllMain,
//                                as NAPI_MODULE() did in node_api.h before v18.17.0
//   IMPORT_MISSING_FROM_HOST     also imports a node.exe export that bun.exe doesn't have
#include <node_api.h>
#include <stdio.h>

#if defined(_WIN32) && defined(IMPORT_MISSING_FROM_HOST)
// Exported by node.exe (OpenSSL) but not by bun.
__declspec(dllimport) unsigned long OpenSSL_version_num(void);
#endif

static napi_value hello(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value out;
  const char *text = "hello";
#if defined(_WIN32) && defined(IMPORT_MISSING_FROM_HOST)
  char buf[64];
  snprintf(buf, sizeof(buf), "hello %lx", OpenSSL_version_num());
  text = buf;
#endif
  if (napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &out) != napi_ok)
    return NULL;
  return out;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "hello", NAPI_AUTO_LENGTH, hello, NULL, &fn) !=
      napi_ok)
    return NULL;
  if (napi_set_named_property(env, exports, "hello", fn) != napi_ok)
    return NULL;
  return exports;
}

#ifdef REGISTER_VIA_CONSTRUCTOR

static napi_module module_description = {
    NAPI_MODULE_VERSION, 0, __FILE__, init, "no_delay_load_hook_addon", NULL, {0},
};

// Copied from NAPI_C_CTOR in node_api.h v18.16.0, with different names.
#if defined(_MSC_VER)
#pragma section(".CRT$XCU", read)
static void __cdecl register_module(void);
__declspec(dllexport, allocate(".CRT$XCU")) void(__cdecl *register_module_)(void) =
    register_module;
static void __cdecl register_module(void) {
#else
static void register_module(void) __attribute__((constructor));
static void register_module(void) {
#endif
  napi_module_register(&module_description);
}

#else

NAPI_MODULE_EXPORT napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  return init(env, exports);
}

#endif

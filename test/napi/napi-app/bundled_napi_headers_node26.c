// Compiled against Bun's in-tree <node_api.h> (src/runtime/napi). Exercises
// the Node 26 type surface and the modern NAPI_MODULE_INIT() that exports
// node_api_module_get_api_version_v1. NAPI_VERSION is left unset on purpose
// so the test also pins Bun's default (10).

#include <node_api.h>

NAPI_MODULE_INIT() {
  napi_status s = node_api_get_module_file_name(env, 0);
  (void)s;
  return exports;
}

static void NAPI_CDECL my_cleanup(void* arg) { (void)arg; }
static void NAPI_CDECL my_finalize(napi_env env, void* data, void* hint) {
  (void)env;
  (void)data;
  (void)hint;
}
static void NAPI_CDECL my_noenv_finalize(void* data, void* hint) {
  (void)data;
  (void)hint;
}

NAPI_MODULE_EXPORT int use_node26_types(node_api_basic_env basic_env) {
  node_api_nogc_env nogc = basic_env;
  node_api_basic_finalize bf = my_finalize;
  node_api_nogc_finalize nf = my_finalize;
  node_api_noenv_finalize nef = my_noenv_finalize;
  napi_cleanup_hook hook = my_cleanup;
  node_api_addon_get_api_version_func ver = node_api_module_get_api_version_v1;
  (void)nogc;
  (void)bf;
  (void)nf;
  (void)nef;
  (void)hook;
  return ver();
}

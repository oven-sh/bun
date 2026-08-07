// Hand-written (unlike plugin.c, which is generated). Resolves libuv stub
// symbols through the dynamic linker from inside a NAPI addon — the same
// namespace a real addon's undefined references bind against at dlopen time.
#define _GNU_SOURCE
#include <node_api.h>

#include <dlfcn.h>
#include <stdint.h>

static const char *module_of(void *addr) {
  Dl_info info;
  if (addr != NULL && dladdr(addr, &info) != 0 && info.dli_fname != NULL) {
    return info.dli_fname;
  }
  return "";
}

// checkSymbols(names: string[]) ->
//   { missing: string[], modules: string[], napiModule: string }
// missing:    names dlsym(RTLD_DEFAULT) could not resolve
// modules:    for each resolved name, the object file it resolved into
// napiModule: the object file napi_create_function resolved into, i.e. the
//             bun executable — every stub should resolve into the same one
static napi_value check_symbols(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_error(env, NULL, "expected an array of symbol names");
    return NULL;
  }

  uint32_t len = 0;
  if (napi_get_array_length(env, args[0], &len) != napi_ok) {
    napi_throw_error(env, NULL, "expected an array of symbol names");
    return NULL;
  }

  napi_value result, missing, modules, napi_module;
  napi_create_object(env, &result);
  napi_create_array(env, &missing);
  napi_create_array(env, &modules);
  uint32_t missing_count = 0, modules_count = 0;

  for (uint32_t i = 0; i < len; i++) {
    napi_value name_value;
    char name[256];
    size_t copied = 0;
    if (napi_get_element(env, args[0], i, &name_value) != napi_ok ||
        napi_get_value_string_utf8(env, name_value, name, sizeof(name),
                                   &copied) != napi_ok) {
      napi_throw_error(env, NULL, "symbol names must be strings");
      return NULL;
    }

    void *addr = dlsym(RTLD_DEFAULT, name);
    if (addr == NULL) {
      napi_set_element(env, missing, missing_count++, name_value);
    } else {
      napi_value module_name;
      napi_create_string_utf8(env, module_of(addr), NAPI_AUTO_LENGTH,
                              &module_name);
      napi_set_element(env, modules, modules_count++, module_name);
    }
  }

  napi_create_string_utf8(env, module_of(dlsym(RTLD_DEFAULT, "napi_create_function")),
                          NAPI_AUTO_LENGTH, &napi_module);

  napi_set_named_property(env, result, "missing", missing);
  napi_set_named_property(env, result, "modules", modules);
  napi_set_named_property(env, result, "napiModule", napi_module);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  if (napi_create_function(env, "checkSymbols", NAPI_AUTO_LENGTH,
                           check_symbols, NULL, &fn) != napi_ok ||
      napi_set_named_property(env, exports, "checkSymbols", fn) != napi_ok) {
    napi_throw_error(env, NULL, "failed to register checkSymbols");
    return NULL;
  }
  return exports;
}

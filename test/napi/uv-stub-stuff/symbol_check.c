// Hand-written (unlike plugin.c, which is generated). Resolves libuv stub
// symbols through the dynamic linker from inside a NAPI addon — the same
// namespace a real addon's undefined references bind against at dlopen time.
#define _GNU_SOURCE
#include <node_api.h>

#include <dlfcn.h>
#include <stdbool.h>
#include <stdint.h>

// Bail on any napi failure without using its output: throw `message` unless
// the failing call already left a JavaScript exception pending (e.g. an
// accessor on the names array threw inside napi_get_element).
#define CHECK_NAPI(call, message)                                             \
  do {                                                                        \
    if ((call) != napi_ok) {                                                  \
      bool pending = false;                                                   \
      if (napi_is_exception_pending(env, &pending) != napi_ok || !pending) {  \
        napi_throw_error(env, NULL, (message));                               \
      }                                                                       \
      return NULL;                                                            \
    }                                                                         \
  } while (0)

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
  CHECK_NAPI(napi_get_cb_info(env, info, &argc, args, NULL, NULL),
             "expected an array of symbol names");
  if (argc < 1) {
    napi_throw_error(env, NULL, "expected an array of symbol names");
    return NULL;
  }

  uint32_t len = 0;
  CHECK_NAPI(napi_get_array_length(env, args[0], &len),
             "expected an array of symbol names");

  napi_value result, missing, modules, napi_module;
  CHECK_NAPI(napi_create_object(env, &result), "failed to build result");
  CHECK_NAPI(napi_create_array(env, &missing), "failed to build result");
  CHECK_NAPI(napi_create_array(env, &modules), "failed to build result");
  uint32_t missing_count = 0, modules_count = 0;

  for (uint32_t i = 0; i < len; i++) {
    napi_value name_value;
    char name[256];
    size_t copied = 0;
    CHECK_NAPI(napi_get_element(env, args[0], i, &name_value),
               "symbol names must be strings");
    CHECK_NAPI(napi_get_value_string_utf8(env, name_value, name, sizeof(name),
                                          &copied),
               "symbol names must be strings");

    void *addr = dlsym(RTLD_DEFAULT, name);
    if (addr == NULL) {
      CHECK_NAPI(napi_set_element(env, missing, missing_count++, name_value),
                 "failed to build result");
    } else {
      napi_value module_name;
      CHECK_NAPI(napi_create_string_utf8(env, module_of(addr),
                                         NAPI_AUTO_LENGTH, &module_name),
                 "failed to build result");
      CHECK_NAPI(napi_set_element(env, modules, modules_count++, module_name),
                 "failed to build result");
    }
  }

  CHECK_NAPI(napi_create_string_utf8(
                 env, module_of(dlsym(RTLD_DEFAULT, "napi_create_function")),
                 NAPI_AUTO_LENGTH, &napi_module),
             "failed to build result");

  CHECK_NAPI(napi_set_named_property(env, result, "missing", missing),
             "failed to build result");
  CHECK_NAPI(napi_set_named_property(env, result, "modules", modules),
             "failed to build result");
  CHECK_NAPI(napi_set_named_property(env, result, "napiModule", napi_module),
             "failed to build result");
  return result;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  CHECK_NAPI(napi_create_function(env, "checkSymbols", NAPI_AUTO_LENGTH,
                                  check_symbols, NULL, &fn),
             "failed to register checkSymbols");
  CHECK_NAPI(napi_set_named_property(env, exports, "checkSymbols", fn),
             "failed to register checkSymbols");
  return exports;
}

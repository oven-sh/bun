// Reproduces packages like nodegl that are linked with /DELAYLOAD:node.exe but
// omit win_delay_load_hook.cc (e.g. cmake-js projects that do not add
// ${CMAKE_JS_SRC}). See https://github.com/oven-sh/bun/issues/10690.
#include <node_api.h>

static napi_value hello(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value out;
  if (napi_create_string_utf8(env, "hello", NAPI_AUTO_LENGTH, &out) != napi_ok)
    return NULL;
  return out;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  if (napi_create_function(env, "hello", NAPI_AUTO_LENGTH, hello, NULL, &fn) != napi_ok)
    return NULL;
  if (napi_set_named_property(env, exports, "hello", fn) != napi_ok)
    return NULL;
  return exports;
}

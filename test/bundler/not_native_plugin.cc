/*
 */
#include <bun-native-bundler-plugin-api/bundler_plugin.h>
#include <cstdlib>
#include <cstring>
#include <node_api.h>

#ifdef _WIN32
#define BUN_PLUGIN_EXPORT __declspec(dllexport)
#else
#define BUN_PLUGIN_EXPORT
#endif

napi_value HelloWorld(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_string_utf8(env, "hello world", NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, nullptr, 0, HelloWorld, nullptr, &fn);
  napi_set_named_property(env, exports, "helloWorld", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

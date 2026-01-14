#include <node_api.h>

static napi_value FunctionB(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_string_utf8(env, "Hello from module B", NAPI_AUTO_LENGTH, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "functionB", NAPI_AUTO_LENGTH, FunctionB, NULL, &fn);
  napi_set_named_property(env, exports, "functionB", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

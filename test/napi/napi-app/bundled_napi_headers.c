#include <node_api.h>
napi_value passthrough(napi_env env, napi_value v) {
  (void)env;
  return v;
}

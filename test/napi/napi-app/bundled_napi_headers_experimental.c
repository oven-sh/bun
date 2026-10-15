// cc() (TinyCC) treats #warning as a hard error, so the bundled header must
// compile cleanly with NAPI_EXPERIMENTAL defined.
#define NAPI_EXPERIMENTAL
#define NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT
#include <node_api.h>

napi_value passthrough(napi_env env, napi_value v) {
  (void)env;
  node_api_basic_env be = env;
  (void)be;
  return v;
}

// GENERATED CODE ... NO TOUCHY!!
#include <node_api.h>

#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <uv.h>

napi_value Init(napi_env env, napi_value exports) {

  // call some function which we do not support
  int value = uv_cpumask_size();
  printf("VALUE: %d\n", value);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

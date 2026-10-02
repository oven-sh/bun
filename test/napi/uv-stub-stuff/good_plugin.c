#include <node_api.h>

#include <stdio.h>

typedef int uv_pid_t;
uv_pid_t uv_os_getpid();

napi_value Init(napi_env env, napi_value exports) {
  uv_pid_t pid = uv_os_getpid();
  printf("%d\n", pid);

  return NULL;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

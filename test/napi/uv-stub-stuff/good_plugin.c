#include <node_api.h>
#include <sys/types.h>

#include <signal.h>
#include <stdio.h>
#ifndef _WIN32
#include <unistd.h>
#endif

#ifdef _WIN32
typedef int uv_pid_t; /* matches uv/win.h */
#else
typedef pid_t uv_pid_t;
#endif
uv_pid_t uv_os_getpid();

napi_value Init(napi_env env, napi_value exports) {
  uv_pid_t pid = uv_os_getpid();
  printf("%d\n", pid);

  return NULL;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

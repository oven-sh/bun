// Reports whether the code of the addon runs on the main thread of the process.
#define _GNU_SOURCE
#include <js_native_api.h>
#include <node_api.h>
#include <stdlib.h>

#if defined(__APPLE__)
#include <pthread.h>
static bool is_main_thread(void) { return pthread_main_np(); }
#elif defined(__linux__)
#include <sys/syscall.h>
#include <unistd.h>
static bool is_main_thread(void) { return syscall(SYS_gettid) == getpid(); }
#else
static bool is_main_thread(void) { return true; }
#endif

static napi_value where(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_get_boolean(env, is_main_thread(), &result);
  return result;
}

static napi_value call(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value function, receiver, result = NULL;
  napi_get_cb_info(env, info, &count, &function, &receiver, NULL);
  napi_call_function(env, receiver, function, 0, NULL, &result);
  return result;
}

static void deliver(napi_env env, napi_value function, void *context, void *data) {
  (void)context;
  (void)data;
  napi_value receiver, argument = where(env, NULL);
  napi_get_undefined(env, &receiver);
  napi_call_function(env, receiver, function, 1, &argument, NULL);
}

static napi_value later(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value function, name;
  napi_threadsafe_function queue;
  napi_get_cb_info(env, info, &count, &function, NULL, NULL);
  napi_create_string_utf8(env, "later", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, function, NULL, name, 0, 1, NULL, NULL, NULL, deliver, &queue);
  napi_call_threadsafe_function(queue, NULL, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(queue, napi_tsfn_release);
  return NULL;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"where", NULL, where, NULL, NULL, NULL, napi_default, NULL},
      {"getter", NULL, NULL, where, NULL, NULL, napi_default, NULL},
      {"call", NULL, call, NULL, NULL, NULL, napi_default, NULL},
      {"later", NULL, later, NULL, NULL, NULL, napi_default, NULL},
      {"loaded", NULL, NULL, NULL, NULL, where(env, NULL), napi_default, NULL},
  };
  napi_define_properties(env, exports, 5, properties);
  return exports;
}

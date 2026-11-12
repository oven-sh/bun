// An experimental addon may call napi_queue_async_work from a finalizer. The
// finalizer of a value that is alive when a Worker exits runs when the addon's
// env is torn down. Async work that has not completed by then puts the
// finalizers off until the Worker's VM has everything back from other threads
// and has closed.
#define NAPI_EXPERIMENTAL
#include <node_api.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>

static napi_async_work work;
static napi_async_work running;

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t changed = PTHREAD_COND_INITIALIZER;
static bool exiting;

static void execute(napi_env env, void *data) {}

static void complete(napi_env env, napi_status status, void *data) {
  napi_delete_async_work(env, work);
}

// Stays on the thread pool until the env's cleanup hooks run.
static void execute_running(napi_env env, void *data) {
  pthread_mutex_lock(&lock);
  while (!exiting) {
    pthread_cond_wait(&changed, &lock);
  }
  pthread_mutex_unlock(&lock);
}

static void complete_running(napi_env env, napi_status status, void *data) {
  napi_delete_async_work(env, running);
}

static void cleanup_hook(void *data) {
  pthread_mutex_lock(&lock);
  exiting = true;
  pthread_cond_signal(&changed);
  pthread_mutex_unlock(&lock);
}

static void finalize(node_api_basic_env env, void *data, void *hint) {
  napi_status status = napi_queue_async_work(env, work);
  printf("queued from finalizer: %d\n", (int)status);
  fflush(stdout);
  if (status != napi_ok) {
    napi_delete_async_work((napi_env)env, work);
  }
}

// napi_create_async_work isn't allowed in a finalizer, so create the work here.
static napi_value queue_from_finalizer(napi_env env, napi_callback_info info) {
  napi_value name, external;
  napi_create_string_utf8(env, "late", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, execute, complete, NULL, &work);
  napi_create_async_work(env, NULL, name, execute_running, complete_running, NULL, &running);
  napi_queue_async_work(env, running);
  napi_add_env_cleanup_hook(env, cleanup_hook, NULL);
  napi_create_external(env, NULL, finalize, NULL, &external);
  return external;
}

NAPI_MODULE_INIT() {
  napi_value function;
  napi_create_function(env, "queueFromFinalizer", NAPI_AUTO_LENGTH, queue_from_finalizer, NULL, &function);
  napi_set_named_property(env, exports, "queueFromFinalizer", function);
  return exports;
}

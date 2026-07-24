#include <node_api.h>

#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <uv.h>

// Test mutex initialization and destruction
static napi_value test_mutex_init_destroy(napi_env env,
                                          napi_callback_info info) {
  uv_mutex_t mutex;
  int result = uv_mutex_init(&mutex);
  if (result != 0) {
    napi_throw_error(env, NULL, "Failed to initialize mutex");
    return NULL;
  }

  uv_mutex_destroy(&mutex);

  napi_value ret;
  napi_get_boolean(env, true, &ret);
  return ret;
}

// Test recursive mutex
static napi_value test_mutex_recursive(napi_env env, napi_callback_info info) {
  uv_mutex_t mutex;
  int result = uv_mutex_init_recursive(&mutex);
  if (result != 0) {
    napi_throw_error(env, NULL, "Failed to initialize recursive mutex");
    return NULL;
  }

  // Try locking multiple times
  uv_mutex_lock(&mutex);
  uv_mutex_lock(&mutex);

  // Unlock the same number of times
  uv_mutex_unlock(&mutex);
  uv_mutex_unlock(&mutex);

  uv_mutex_destroy(&mutex);

  napi_value ret;
  napi_get_boolean(env, true, &ret);
  return ret;
}

// Test mutex trylock
static napi_value test_mutex_trylock(napi_env env, napi_callback_info info) {
  uv_mutex_t mutex;
  uv_mutex_init(&mutex);

  int result = uv_mutex_trylock(&mutex);
  if (result != 0) {
    uv_mutex_destroy(&mutex);
    napi_throw_error(env, NULL, "Failed to trylock mutex");
    return NULL;
  }

  uv_mutex_unlock(&mutex);
  uv_mutex_destroy(&mutex);

  napi_value ret;
  napi_get_boolean(env, true, &ret);
  return ret;
}

// Test getpid and getppid
static napi_value test_process_ids(napi_env env, napi_callback_info info) {
  uv_pid_t pid = uv_os_getpid();
  uv_pid_t ppid = uv_os_getppid();

  // Create return object with pid and ppid
  napi_value obj;
  napi_create_object(env, &obj);

  napi_value pid_value, ppid_value;
  napi_create_int32(env, pid, &pid_value);
  napi_create_int32(env, ppid, &ppid_value);

  napi_set_named_property(env, obj, "pid", pid_value);
  napi_set_named_property(env, obj, "ppid", ppid_value);

  return obj;
}

int count = 0;
// Test uv_once
static void once_callback(void) {
  // Just a dummy callback
  count++;
}
uv_once_t guard = UV_ONCE_INIT;

static napi_value test_uv_once(napi_env env, napi_callback_info info) {
  uv_once(&guard, once_callback);

  napi_value ret;
  napi_create_int32(env, count, &ret);
  return ret;
}

// Test uv_hrtime
static napi_value test_hrtime(napi_env env, napi_callback_info info) {
  uint64_t time1 = uv_hrtime();

  // Sleep for a tiny bit to ensure time passes
  usleep(1000); // Sleep for 1ms

  uint64_t time2 = uv_hrtime();

  // Create return object with both timestamps
  napi_value obj;
  napi_create_object(env, &obj);

  // Convert uint64_t to two int32 values (high and low bits)
  // because JavaScript numbers can't safely handle 64-bit integers
  napi_value time1_low, time1_high, time2_low, time2_high;
  napi_create_int32(env, (int32_t)(time1 & 0xFFFFFFFF), &time1_low);
  napi_create_int32(env, (int32_t)(time1 >> 32), &time1_high);
  napi_create_int32(env, (int32_t)(time2 & 0xFFFFFFFF), &time2_low);
  napi_create_int32(env, (int32_t)(time2 >> 32), &time2_high);

  napi_set_named_property(env, obj, "time1Low", time1_low);
  napi_set_named_property(env, obj, "time1High", time1_high);
  napi_set_named_property(env, obj, "time2Low", time2_low);
  napi_set_named_property(env, obj, "time2High", time2_high);

  return obj;
}

// -----------------------------------------------------------------------------
// uv_async_t tests
// -----------------------------------------------------------------------------

struct async_test_state {
  uv_async_t async;
  napi_env env;
  napi_ref cb_ref;
  napi_ref holder_ref;
  int async_fired;
  int closed;
};

static void async_test_on_close(uv_handle_t *handle) {
  struct async_test_state *state = (struct async_test_state *)handle->data;
  state->closed = 1;

  napi_handle_scope scope;
  napi_open_handle_scope(state->env, &scope);

  napi_value result;
  napi_create_object(state->env, &result);
  napi_value v;
  napi_create_int32(state->env, state->async_fired, &v);
  napi_set_named_property(state->env, result, "asyncFired", v);
  napi_create_int32(state->env, state->closed, &v);
  napi_set_named_property(state->env, result, "closed", v);
  napi_create_int32(state->env, uv_is_closing(handle), &v);
  napi_set_named_property(state->env, result, "isClosingInCloseCb", v);

  napi_value cb;
  napi_get_reference_value(state->env, state->cb_ref, &cb);
  napi_value global;
  napi_get_global(state->env, &global);
  napi_call_function(state->env, global, cb, 1, &result, NULL);

  napi_delete_reference(state->env, state->cb_ref);
  napi_delete_reference(state->env, state->holder_ref);
  napi_close_handle_scope(state->env, scope);
  free(state);
}

static void async_test_on_async(uv_async_t *async) {
  struct async_test_state *state = (struct async_test_state *)async->data;
  state->async_fired += 1;
  uv_close((uv_handle_t *)async, async_test_on_close);
}

static void *async_test_sender_thread(void *arg) {
  uv_async_t *async = (uv_async_t *)arg;
  // Multiple sends must coalesce into a single callback invocation.
  uv_async_send(async);
  uv_async_send(async);
  uv_async_send(async);
  return NULL;
}

// testUvAsync(useDefaultLoop: bool, sendFromThread: bool, cb: (result) => void)
static napi_value test_uv_async(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  bool use_default_loop = false;
  bool send_from_thread = false;
  napi_get_value_bool(env, argv[0], &use_default_loop);
  napi_get_value_bool(env, argv[1], &send_from_thread);

  struct async_test_state *state = calloc(1, sizeof(*state));
  state->env = env;
  napi_create_reference(env, argv[2], 1, &state->cb_ref);

  uv_loop_t *loop;
  if (use_default_loop) {
    loop = uv_default_loop();
  } else {
    napi_get_uv_event_loop(env, &loop);
  }

  int rc = uv_async_init(loop, &state->async, async_test_on_async);
  state->async.data = state;

  napi_value ret;
  napi_create_object(env, &ret);
  // Keep the return object alive until the close callback runs so the test can
  // read the synchronous assertions below even if GC runs first.
  napi_create_reference(env, ret, 1, &state->holder_ref);

  napi_value v;
  napi_create_int32(env, rc, &v);
  napi_set_named_property(env, ret, "initRc", v);
  napi_get_boolean(env, uv_default_loop() == loop, &v);
  napi_set_named_property(env, ret, "defaultLoopMatchesNapiLoop", v);
  napi_create_int32(env, (int)uv_handle_get_type((uv_handle_t *)&state->async),
                    &v);
  napi_set_named_property(env, ret, "handleType", v);
  napi_create_int32(env, (int)UV_ASYNC, &v);
  napi_set_named_property(env, ret, "expectedHandleType", v);
  napi_get_boolean(
      env, uv_handle_get_loop((uv_handle_t *)&state->async) == loop, &v);
  napi_set_named_property(env, ret, "handleLoopMatches", v);
  napi_get_boolean(
      env, uv_handle_get_data((uv_handle_t *)&state->async) == state, &v);
  napi_set_named_property(env, ret, "handleDataMatches", v);
  napi_create_int32(env, uv_has_ref((uv_handle_t *)&state->async), &v);
  napi_set_named_property(env, ret, "hasRefAfterInit", v);
  napi_create_int32(env, uv_is_active((uv_handle_t *)&state->async), &v);
  napi_set_named_property(env, ret, "isActiveAfterInit", v);
  napi_create_int32(env, uv_is_closing((uv_handle_t *)&state->async), &v);
  napi_set_named_property(env, ret, "isClosingAfterInit", v);

  uv_unref((uv_handle_t *)&state->async);
  napi_create_int32(env, uv_has_ref((uv_handle_t *)&state->async), &v);
  napi_set_named_property(env, ret, "hasRefAfterUnref", v);
  uv_ref((uv_handle_t *)&state->async);
  napi_create_int32(env, uv_has_ref((uv_handle_t *)&state->async), &v);
  napi_set_named_property(env, ret, "hasRefAfterReref", v);

  if (send_from_thread) {
    pthread_t tid;
    pthread_create(&tid, NULL, async_test_sender_thread, &state->async);
    pthread_join(tid, NULL);
  } else {
    uv_async_send(&state->async);
    uv_async_send(&state->async);
  }

  // Must not fire synchronously.
  napi_create_int32(env, state->async_fired, &v);
  napi_set_named_property(env, ret, "firedSynchronously", v);

  return ret;
}

// Handle kept ref'd with no send: process must stay alive until unref.
static uv_async_t keepalive_async;
static napi_value test_uv_async_keepalive_init(napi_env env,
                                               napi_callback_info info) {
  uv_loop_t *loop;
  napi_get_uv_event_loop(env, &loop);
  uv_async_init(loop, &keepalive_async, NULL);
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}
static napi_value test_uv_async_keepalive_unref(napi_env env,
                                                napi_callback_info info) {
  uv_unref((uv_handle_t *)&keepalive_async);
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}

napi_value Init(napi_env env, napi_value exports) {
  // Register all test functions
  napi_value fn;

  napi_create_function(env, NULL, 0, test_mutex_init_destroy, NULL, &fn);
  napi_set_named_property(env, exports, "testMutexInitDestroy", fn);

  napi_create_function(env, NULL, 0, test_mutex_recursive, NULL, &fn);
  napi_set_named_property(env, exports, "testMutexRecursive", fn);

  napi_create_function(env, NULL, 0, test_mutex_trylock, NULL, &fn);
  napi_set_named_property(env, exports, "testMutexTrylock", fn);

  napi_create_function(env, NULL, 0, test_process_ids, NULL, &fn);
  napi_set_named_property(env, exports, "testProcessIds", fn);

  napi_create_function(env, NULL, 0, test_uv_once, NULL, &fn);
  napi_set_named_property(env, exports, "testUvOnce", fn);

  napi_create_function(env, NULL, 0, test_hrtime, NULL, &fn);
  napi_set_named_property(env, exports, "testHrtime", fn);

  napi_create_function(env, NULL, 0, test_uv_async, NULL, &fn);
  napi_set_named_property(env, exports, "testUvAsync", fn);

  napi_create_function(env, NULL, 0, test_uv_async_keepalive_init, NULL, &fn);
  napi_set_named_property(env, exports, "testUvAsyncKeepaliveInit", fn);

  napi_create_function(env, NULL, 0, test_uv_async_keepalive_unref, NULL, &fn);
  napi_set_named_property(env, exports, "testUvAsyncKeepaliveUnref", fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

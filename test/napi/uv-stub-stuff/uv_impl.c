#include <node_api.h>

#include <pthread.h>
#include <signal.h>
#include <stdio.h>
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

// Test uv_cwd
static napi_value test_cwd(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);

  napi_value v;

  napi_create_int32(env, UV_EINVAL, &v);
  napi_set_named_property(env, obj, "UV_EINVAL", v);
  napi_create_int32(env, UV_ENOBUFS, &v);
  napi_set_named_property(env, obj, "UV_ENOBUFS", v);

  size_t zero = 0;
  size_t one = 1;
  char dummy[1];
  napi_create_int32(env, uv_cwd(NULL, &one), &v);
  napi_set_named_property(env, obj, "nullBuffer", v);
  napi_create_int32(env, uv_cwd(dummy, NULL), &v);
  napi_set_named_property(env, obj, "nullSize", v);
  napi_create_int32(env, uv_cwd(dummy, &zero), &v);
  napi_set_named_property(env, obj, "zeroSize", v);

  char small[2];
  size_t small_size = sizeof(small);
  napi_create_int32(env, uv_cwd(small, &small_size), &v);
  napi_set_named_property(env, obj, "smallRc", v);
  napi_create_int64(env, (int64_t)small_size, &v);
  napi_set_named_property(env, obj, "smallRequired", v);

  char buf[4096];
  size_t size = sizeof(buf);
  napi_create_int32(env, uv_cwd(buf, &size), &v);
  napi_set_named_property(env, obj, "rc", v);
  napi_create_string_utf8(env, buf, size, &v);
  napi_set_named_property(env, obj, "cwd", v);
  napi_create_int64(env, (int64_t)size, &v);
  napi_set_named_property(env, obj, "size", v);

  return obj;
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

// Test uv_tty_reset_mode, the one implemented uv_* function that lives in bun's
// C++ (wtf-bindings.cpp) instead of uv-posix-polyfills.c, so the one that can
// end up missing from bun's export table. Referenced directly, like a real
// addon would.
static napi_value test_tty_reset_mode(napi_env env, napi_callback_info info) {
  napi_value ret;
  napi_create_int32(env, uv_tty_reset_mode(), &ret);
  return ret;
}

// uv_tty_reset_mode() holds its lock across the tcsetattr() that restores the
// snapshot, so two threads calling it back to back collide constantly once a
// snapshot exists. Every result must be 0 or UV_EBUSY; "busy" says how many
// collisions this run happened to produce.
#define TTY_RESET_ITERATIONS 4000

static pthread_mutex_t tty_reset_counts = PTHREAD_MUTEX_INITIALIZER;
static int tty_reset_busy;
static int tty_reset_unexpected;

static void *tty_reset_hammer(void *arg) {
  for (int i = 0; i < TTY_RESET_ITERATIONS; i++) {
    int result = uv_tty_reset_mode();
    if (result == 0) continue;
    pthread_mutex_lock(&tty_reset_counts);
    if (result == UV_EBUSY)
      tty_reset_busy++;
    else
      tty_reset_unexpected++;
    pthread_mutex_unlock(&tty_reset_counts);
  }
  return NULL;
}

static napi_value test_tty_reset_mode_concurrent(napi_env env,
                                                 napi_callback_info info) {
  pthread_t thread;
  tty_reset_busy = 0;
  tty_reset_unexpected = 0;
  if (pthread_create(&thread, NULL, tty_reset_hammer, NULL) != 0) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }
  tty_reset_hammer(NULL);
  pthread_join(thread, NULL);

  napi_value obj, busy, unexpected;
  napi_create_object(env, &obj);
  napi_create_int32(env, tty_reset_busy, &busy);
  napi_create_int32(env, tty_reset_unexpected, &unexpected);
  napi_set_named_property(env, obj, "busy", busy);
  napi_set_named_property(env, obj, "unexpected", unexpected);
  return obj;
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

  napi_create_function(env, NULL, 0, test_cwd, NULL, &fn);
  napi_set_named_property(env, exports, "testCwd", fn);

  napi_create_function(env, NULL, 0, test_hrtime, NULL, &fn);
  napi_set_named_property(env, exports, "testHrtime", fn);

  napi_create_function(env, NULL, 0, test_tty_reset_mode, NULL, &fn);
  napi_set_named_property(env, exports, "testTtyResetMode", fn);

  napi_create_function(env, NULL, 0, test_tty_reset_mode_concurrent, NULL,
                       &fn);
  napi_set_named_property(env, exports, "testTtyResetModeConcurrent", fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

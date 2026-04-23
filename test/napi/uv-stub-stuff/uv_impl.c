#include <node_api.h>

#include <errno.h>
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

// Test uv_version and uv_version_string
static napi_value test_version(napi_env env, napi_callback_info info) {
  unsigned int ver = uv_version();
  const char *str = uv_version_string();

  napi_value obj;
  napi_create_object(env, &obj);

  napi_value ver_value, str_value;
  napi_create_uint32(env, ver, &ver_value);
  napi_create_string_utf8(env, str, NAPI_AUTO_LENGTH, &str_value);

  napi_set_named_property(env, obj, "version", ver_value);
  napi_set_named_property(env, obj, "versionString", str_value);

  return obj;
}

// Test uv_buf_init
static napi_value test_buf_init(napi_env env, napi_callback_info info) {
  char data[16];
  uv_buf_t buf = uv_buf_init(data, sizeof(data));

  napi_value ret;
  napi_get_boolean(env, buf.base == data && buf.len == sizeof(data), &ret);
  return ret;
}

// Test error functions
static napi_value test_errors(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);

  napi_value v;
  napi_create_string_utf8(env, uv_err_name(UV_EINVAL), NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, "errName", v);

  napi_create_string_utf8(env, uv_strerror(UV_EINVAL), NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, "strerror", v);

  char buf[64];
  uv_err_name_r(UV_ENOENT, buf, sizeof(buf));
  napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, "errNameR", v);

  uv_strerror_r(UV_ENOENT, buf, sizeof(buf));
  napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, "strerrorR", v);

  napi_get_boolean(env, uv_translate_sys_error(EINVAL) == UV_EINVAL, &v);
  napi_set_named_property(env, obj, "translatedIsCorrect", v);

  napi_create_string_utf8(env, uv_err_name(-123456), NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, "unknownErrName", v);

  return obj;
}

// Test osfhandle identity
static napi_value test_osfhandle(napi_env env, napi_callback_info info) {
  uv_os_fd_t h = uv_get_osfhandle(1);
  int fd = uv_open_osfhandle(h);

  napi_value ret;
  napi_get_boolean(env, h == 1 && fd == 1, &ret);
  return ret;
}

// Test time functions
static napi_value test_time(napi_env env, napi_callback_info info) {
  uv_timeval64_t tv;
  int r1 = uv_gettimeofday(&tv);

  uv_timespec64_t ts;
  int r2 = uv_clock_gettime(UV_CLOCK_MONOTONIC, &ts);

  uint64_t before = uv_hrtime();
  uv_sleep(1);
  uint64_t after = uv_hrtime();

  napi_value ret;
  napi_get_boolean(env,
                   r1 == 0 && tv.tv_sec > 0 && r2 == 0 && ts.tv_sec >= 0 &&
                       after > before,
                   &ret);
  return ret;
}

// Test thread-local storage
static napi_value test_tls(napi_env env, napi_callback_info info) {
  uv_key_t key;
  if (uv_key_create(&key) != 0) {
    napi_throw_error(env, NULL, "uv_key_create failed");
    return NULL;
  }

  int value = 42;
  uv_key_set(&key, &value);
  int *got = (int *)uv_key_get(&key);
  uv_key_delete(&key);

  napi_value ret;
  napi_get_boolean(env, got == &value, &ret);
  return ret;
}

// Test rwlock
static napi_value test_rwlock(napi_env env, napi_callback_info info) {
  uv_rwlock_t lock;
  if (uv_rwlock_init(&lock) != 0) {
    napi_throw_error(env, NULL, "uv_rwlock_init failed");
    return NULL;
  }

  uv_rwlock_rdlock(&lock);
  uv_rwlock_rdunlock(&lock);

  uv_rwlock_wrlock(&lock);
  uv_rwlock_wrunlock(&lock);

  int r1 = uv_rwlock_tryrdlock(&lock);
  if (r1 == 0)
    uv_rwlock_rdunlock(&lock);

  int r2 = uv_rwlock_trywrlock(&lock);
  if (r2 == 0)
    uv_rwlock_wrunlock(&lock);

  uv_rwlock_destroy(&lock);

  napi_value ret;
  napi_get_boolean(env, r1 == 0 && r2 == 0, &ret);
  return ret;
}

// Test thread self/equal
static napi_value test_thread(napi_env env, napi_callback_info info) {
  uv_thread_t a = uv_thread_self();
  uv_thread_t b = uv_thread_self();

  napi_value ret;
  napi_get_boolean(env, uv_thread_equal(&a, &b) != 0, &ret);
  return ret;
}

// Test sizes and type names
static napi_value test_sizes(napi_env env, napi_callback_info info) {
  int ok = 1;
  ok = ok && uv_loop_size() == sizeof(uv_loop_t);
  ok = ok && uv_handle_size(UV_TIMER) == sizeof(uv_timer_t);
  ok = ok && uv_req_size(UV_WRITE) == sizeof(uv_write_t);
  ok = ok && strcmp(uv_handle_type_name(UV_TIMER), "timer") == 0;
  ok = ok && strcmp(uv_req_type_name(UV_WRITE), "write") == 0;

  napi_value ret;
  napi_get_boolean(env, ok, &ret);
  return ret;
}

// Test handle/req/loop data accessors
static napi_value test_data_accessors(napi_env env, napi_callback_info info) {
  uv_handle_t handle;
  memset(&handle, 0, sizeof(handle));
  handle.type = UV_TIMER;

  int value = 1;
  uv_handle_set_data(&handle, &value);
  int ok = uv_handle_get_data(&handle) == &value;
  ok = ok && uv_handle_get_type(&handle) == UV_TIMER;
  ok = ok && uv_handle_get_loop(&handle) == NULL;

  uv_req_t req;
  memset(&req, 0, sizeof(req));
  req.type = UV_WRITE;
  uv_req_set_data(&req, &value);
  ok = ok && uv_req_get_data(&req) == &value;
  ok = ok && uv_req_get_type(&req) == UV_WRITE;

  uv_loop_t loop;
  memset(&loop, 0, sizeof(loop));
  uv_loop_set_data(&loop, &value);
  ok = ok && uv_loop_get_data(&loop) == &value;

  napi_value ret;
  napi_get_boolean(env, ok, &ret);
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

  napi_create_function(env, NULL, 0, test_version, NULL, &fn);
  napi_set_named_property(env, exports, "testVersion", fn);

  napi_create_function(env, NULL, 0, test_buf_init, NULL, &fn);
  napi_set_named_property(env, exports, "testBufInit", fn);

  napi_create_function(env, NULL, 0, test_errors, NULL, &fn);
  napi_set_named_property(env, exports, "testErrors", fn);

  napi_create_function(env, NULL, 0, test_osfhandle, NULL, &fn);
  napi_set_named_property(env, exports, "testOsfhandle", fn);

  napi_create_function(env, NULL, 0, test_time, NULL, &fn);
  napi_set_named_property(env, exports, "testTime", fn);

  napi_create_function(env, NULL, 0, test_tls, NULL, &fn);
  napi_set_named_property(env, exports, "testTls", fn);

  napi_create_function(env, NULL, 0, test_rwlock, NULL, &fn);
  napi_set_named_property(env, exports, "testRwlock", fn);

  napi_create_function(env, NULL, 0, test_thread, NULL, &fn);
  napi_set_named_property(env, exports, "testThread", fn);

  napi_create_function(env, NULL, 0, test_sizes, NULL, &fn);
  napi_set_named_property(env, exports, "testSizes", fn);

  napi_create_function(env, NULL, 0, test_data_accessors, NULL, &fn);
  napi_set_named_property(env, exports, "testDataAccessors", fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

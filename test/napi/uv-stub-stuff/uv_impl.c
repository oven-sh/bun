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

static void set_str(napi_env env, napi_value obj, const char *key,
                    const char *val) {
  napi_value v;
  if (val == NULL)
    napi_get_null(env, &v);
  else
    napi_create_string_utf8(env, val, NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, key, v);
}

static void set_int(napi_env env, napi_value obj, const char *key,
                    int64_t val) {
  napi_value v;
  napi_create_int64(env, val, &v);
  napi_set_named_property(env, obj, key, v);
}

static void set_uint(napi_env env, napi_value obj, const char *key,
                     uint32_t val) {
  napi_value v;
  napi_create_uint32(env, val, &v);
  napi_set_named_property(env, obj, key, v);
}

static void set_bool(napi_env env, napi_value obj, const char *key, int val) {
  napi_value v;
  napi_get_boolean(env, val != 0, &v);
  napi_set_named_property(env, obj, key, v);
}

// Test uv_version / uv_version_string
static napi_value test_version(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);
  set_uint(env, obj, "versionHex", uv_version());
  set_str(env, obj, "versionString", uv_version_string());
  return obj;
}

// Test uv_buf_init
static napi_value test_buf_init(napi_env env, napi_callback_info info) {
  char data[16];
  uv_buf_t buf = uv_buf_init(data, sizeof(data));

  napi_value obj;
  napi_create_object(env, &obj);
  set_bool(env, obj, "baseOk", buf.base == data);
  set_uint(env, obj, "len", (uint32_t)buf.len);
  return obj;
}

// Test uv_err_name / uv_strerror / _r variants
static napi_value test_errors(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);

  set_str(env, obj, "errNameENOENT", uv_err_name(UV_ENOENT));
  set_str(env, obj, "errNameEINVAL", uv_err_name(UV_EINVAL));
  set_str(env, obj, "errNameUnknown", uv_err_name(1));

  set_str(env, obj, "strerrorENOENT", uv_strerror(UV_ENOENT));
  set_str(env, obj, "strerrorUnknown", uv_strerror(1));

  char buf[64];
  set_str(env, obj, "errNameR", uv_err_name_r(UV_EBUSY, buf, sizeof(buf)));
  set_str(env, obj, "errNameRUnknown", uv_err_name_r(1234, buf, sizeof(buf)));
  set_str(env, obj, "strerrorR", uv_strerror_r(UV_EBUSY, buf, sizeof(buf)));
  set_str(env, obj, "strerrorRUnknown", uv_strerror_r(1234, buf, sizeof(buf)));

  set_int(env, obj, "translateENOENT", uv_translate_sys_error(ENOENT));
  set_int(env, obj, "translateZero", uv_translate_sys_error(0));
  set_int(env, obj, "uvENOENT", UV_ENOENT);

  return obj;
}

// Test uv_handle_type_name / uv_req_type_name / uv_handle_size / uv_req_size
static napi_value test_type_names(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);

  set_str(env, obj, "handleAsync", uv_handle_type_name(UV_ASYNC));
  set_str(env, obj, "handleTimer", uv_handle_type_name(UV_TIMER));
  set_str(env, obj, "handleFile", uv_handle_type_name(UV_FILE));
  set_str(env, obj, "handleUnknown", uv_handle_type_name(UV_UNKNOWN_HANDLE));
  set_str(env, obj, "handleMax", uv_handle_type_name(UV_HANDLE_TYPE_MAX));

  set_str(env, obj, "reqWrite", uv_req_type_name(UV_WRITE));
  set_str(env, obj, "reqUnknown", uv_req_type_name(UV_UNKNOWN_REQ));
  set_str(env, obj, "reqMax", uv_req_type_name(UV_REQ_TYPE_MAX));

  set_bool(env, obj, "handleSizeAsync",
           uv_handle_size(UV_ASYNC) == sizeof(uv_async_t));
  set_bool(env, obj, "handleSizeTimer",
           uv_handle_size(UV_TIMER) == sizeof(uv_timer_t));
  set_bool(env, obj, "reqSizeWrite",
           uv_req_size(UV_WRITE) == sizeof(uv_write_t));
  set_bool(env, obj, "handleSizeMax",
           uv_handle_size(UV_HANDLE_TYPE_MAX) == (size_t)-1);
  set_bool(env, obj, "reqSizeMax", uv_req_size(UV_REQ_TYPE_MAX) == (size_t)-1);

  return obj;
}

// Test uv_sleep
static napi_value test_sleep(napi_env env, napi_callback_info info) {
  uint64_t t1 = uv_hrtime();
  uv_sleep(10);
  uint64_t t2 = uv_hrtime();

  napi_value ret;
  napi_create_int64(env, (int64_t)(t2 - t1), &ret);
  return ret;
}

// Test uv_gettimeofday / uv_clock_gettime
static napi_value test_time(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);

  uv_timeval64_t tv;
  int r = uv_gettimeofday(&tv);
  set_int(env, obj, "gettimeofdayRet", r);
  set_int(env, obj, "gettimeofdaySec", tv.tv_sec);
  set_int(env, obj, "gettimeofdayNull", uv_gettimeofday(NULL));

  uv_timespec64_t ts;
  set_int(env, obj, "clockMono", uv_clock_gettime(UV_CLOCK_MONOTONIC, &ts));
  set_int(env, obj, "clockReal", uv_clock_gettime(UV_CLOCK_REALTIME, &ts));
  set_int(env, obj, "clockRealSec", ts.tv_sec);
  set_int(env, obj, "clockNull", uv_clock_gettime(UV_CLOCK_REALTIME, NULL));
  set_int(env, obj, "clockBadId", uv_clock_gettime((uv_clock_id)99, &ts));

  set_int(env, obj, "uvEINVAL", UV_EINVAL);
  set_int(env, obj, "uvEFAULT", UV_EFAULT);

  return obj;
}

// Test uv_available_parallelism / uv_get_osfhandle / uv_open_osfhandle /
// uv_setup_args / uv_library_shutdown
static napi_value test_misc(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);

  set_uint(env, obj, "parallelism", uv_available_parallelism());
  set_int(env, obj, "getOsfhandle", (int64_t)uv_get_osfhandle(7));
  set_int(env, obj, "openOsfhandle", uv_open_osfhandle((uv_os_fd_t)7));

  char *argv[] = {(char *)"a", (char *)"b"};
  set_bool(env, obj, "setupArgs", uv_setup_args(2, argv) == argv);

  uv_library_shutdown();
  set_bool(env, obj, "libraryShutdown", 1);

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

  napi_create_function(env, NULL, 0, test_type_names, NULL, &fn);
  napi_set_named_property(env, exports, "testTypeNames", fn);

  napi_create_function(env, NULL, 0, test_sleep, NULL, &fn);
  napi_set_named_property(env, exports, "testSleep", fn);

  napi_create_function(env, NULL, 0, test_time, NULL, &fn);
  napi_set_named_property(env, exports, "testTime", fn);

  napi_create_function(env, NULL, 0, test_misc, NULL, &fn);
  napi_set_named_property(env, exports, "testMisc", fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

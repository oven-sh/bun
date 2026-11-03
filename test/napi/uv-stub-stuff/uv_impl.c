#include <node_api.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
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

// ---------------------------------------------------------------------------
// Tests for the loop-backed functions: uv_default_loop, uv_queue_work, the
// uv_async_t, uv_idle_t, uv_prepare_t, uv_check_t and uv_timer_t handles, and
// their header-only helpers. Each test reports events through a JS callback
// `(event, a, b)` so uv.test.ts can check callback order, thread and loop
// iteration. uv.test.ts runs them in a child process because a stubbed uv_*
// function aborts.
// ---------------------------------------------------------------------------

struct reporter {
  napi_env env;
  napi_ref callback;
};

static void reporter_init(struct reporter *r, napi_env env,
                          napi_value callback) {
  r->env = env;
  napi_create_reference(env, callback, 1, &r->callback);
}

// Calls the JS callback. Ignores the call's status on purpose, because one test
// throws from the callback to check that the exception is reported as uncaught.
static void report(struct reporter *r, const char *event, int32_t a,
                   int32_t b) {
  napi_env env = r->env;
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  napi_value callback, undefined, argv[3];
  napi_get_reference_value(env, r->callback, &callback);
  napi_get_undefined(env, &undefined);
  napi_create_string_utf8(env, event, NAPI_AUTO_LENGTH, &argv[0]);
  napi_create_int32(env, a, &argv[1]);
  napi_create_int32(env, b, &argv[2]);
  napi_call_function(env, undefined, callback, 3, argv, NULL);
  napi_close_handle_scope(env, scope);
}

static void reporter_destroy(struct reporter *r) {
  napi_delete_reference(r->env, r->callback);
}

static uv_loop_t *get_loop(napi_env env, bool use_default_loop) {
  if (use_default_loop)
    return uv_default_loop();
  uv_loop_t *loop = NULL;
  napi_get_uv_event_loop(env, &loop);
  return loop;
}

static napi_value make_int32_array(napi_env env, const int32_t *values,
                                   size_t count) {
  napi_value array;
  napi_create_array_with_length(env, count, &array);
  for (size_t i = 0; i < count; i++) {
    napi_value value;
    napi_create_int32(env, values[i], &value);
    napi_set_element(env, array, (uint32_t)i, value);
  }
  return array;
}

static void set_int32(napi_env env, napi_value object, const char *name,
                      int32_t value) {
  napi_value number;
  napi_create_int32(env, value, &number);
  napi_set_named_property(env, object, name, number);
}

static void get_args(napi_env env, napi_callback_info info, napi_value *args,
                     size_t count) {
  size_t argc = count;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
}

static bool as_bool(napi_env env, napi_value value) {
  bool result = false;
  napi_get_value_bool(env, value, &result);
  return result;
}

// testVersion() returns { version, versionString }.
static napi_value test_version(napi_env env, napi_callback_info info) {
  napi_value result, version, version_string;
  napi_create_object(env, &result);
  napi_create_uint32(env, uv_version(), &version);
  napi_create_string_utf8(env, uv_version_string(), NAPI_AUTO_LENGTH,
                          &version_string);
  napi_set_named_property(env, result, "version", version);
  napi_set_named_property(env, result, "versionString", version_string);
  return result;
}

// testSizesAndNames() checks uv_handle_size, uv_req_size and the type names
// against the headers this addon was compiled with. Addons rely on these to
// allocate handles dynamically.
static napi_value test_sizes_and_names(napi_env env, napi_callback_info info) {
  napi_value result, value;
  napi_create_object(env, &result);

  napi_get_boolean(env, uv_handle_size(UV_ASYNC) == sizeof(uv_async_t), &value);
  napi_set_named_property(env, result, "asyncSizeMatches", value);
  napi_get_boolean(env, uv_handle_size(UV_TIMER) == sizeof(uv_timer_t), &value);
  napi_set_named_property(env, result, "timerSizeMatches", value);
  napi_get_boolean(env, uv_handle_size(UV_UNKNOWN_HANDLE) == (size_t)-1,
                   &value);
  napi_set_named_property(env, result, "unknownHandleSizeIsMinusOne", value);
  napi_get_boolean(env, uv_req_size(UV_WORK) == sizeof(uv_work_t), &value);
  napi_set_named_property(env, result, "workSizeMatches", value);
  napi_get_boolean(env, uv_req_size(UV_UNKNOWN_REQ) == (size_t)-1, &value);
  napi_set_named_property(env, result, "unknownReqSizeIsMinusOne", value);
  napi_create_uint32(env, (uint32_t)sizeof(uv_async_t), &value);
  napi_set_named_property(env, result, "asyncSize", value);

  napi_create_string_utf8(env, uv_handle_type_name(UV_ASYNC), NAPI_AUTO_LENGTH,
                          &value);
  napi_set_named_property(env, result, "asyncName", value);
  napi_create_string_utf8(env, uv_handle_type_name(UV_NAMED_PIPE),
                          NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, result, "pipeName", value);
  napi_create_string_utf8(env, uv_req_type_name(UV_WORK), NAPI_AUTO_LENGTH,
                          &value);
  napi_set_named_property(env, result, "workName", value);
  napi_get_boolean(env, uv_handle_type_name(UV_UNKNOWN_HANDLE) == NULL, &value);
  napi_set_named_property(env, result, "unknownHandleNameIsNull", value);
  napi_get_boolean(env, uv_req_type_name(UV_UNKNOWN_REQ) == NULL, &value);
  napi_set_named_property(env, result, "unknownReqNameIsNull", value);
  return result;
}

// testOsfhandle(fd) returns uv_open_osfhandle(uv_get_osfhandle(fd)), which is
// `fd` on Unix.
static napi_value test_osfhandle(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  int32_t fd = -1;
  napi_get_value_int32(env, args[0], &fd);
  napi_value result;
  napi_create_int32(env, uv_open_osfhandle(uv_get_osfhandle(fd)), &result);
  return result;
}

static void *call_uv_default_loop(void *out) {
  *(uv_loop_t **)out = uv_default_loop();
  return NULL;
}

// testLoops() checks how the loops relate. On the main thread,
// napi_get_uv_event_loop returns uv_default_loop(). In a Worker it returns the
// Worker's own loop. uv_default_loop() is the same loop on every thread, and
// its `data` slot belongs to the addon.
static napi_value test_loops(napi_env env, napi_callback_info info) {
  uv_loop_t *napi_loop = get_loop(env, false);
  uv_loop_t *default_loop = uv_default_loop();
  uv_loop_t *default_loop_from_thread = NULL;
  pthread_t thread;
  if (pthread_create(&thread, NULL, call_uv_default_loop,
                     &default_loop_from_thread) != 0) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }
  pthread_join(thread, NULL);

  int marker;
  uv_loop_set_data(napi_loop, &marker);
  bool data_round_trips =
      uv_loop_get_data(napi_loop) == &marker && napi_loop->data == &marker;
  uv_loop_set_data(napi_loop, NULL);

  napi_value result, value;
  napi_create_object(env, &result);
  napi_get_boolean(env, napi_loop != NULL, &value);
  napi_set_named_property(env, result, "napiLoopIsSet", value);
  napi_get_boolean(env, napi_loop == default_loop, &value);
  napi_set_named_property(env, result, "napiLoopIsDefaultLoop", value);
  napi_get_boolean(env, default_loop_from_thread == default_loop, &value);
  napi_set_named_property(env, result, "defaultLoopIsSameFromThread", value);
  napi_get_boolean(env, data_round_trips, &value);
  napi_set_named_property(env, result, "loopDataRoundTrips", value);
  return result;
}

// testErrors() returns the result of each invalid call, all UV_EINVAL (listed
// in uv.test.ts). It closes the two handles it initializes so the process can
// exit. They're static because a handle must outlive its close.
static void unused_async_cb(uv_async_t *handle) { (void)handle; }
static void unused_idle_cb(uv_idle_t *handle) { (void)handle; }
static void unused_timer_cb(uv_timer_t *handle) { (void)handle; }

static uv_idle_t errors_idle;
static uv_timer_t errors_timer;

static napi_value test_errors(napi_env env, napi_callback_info info) {
  uv_loop_t *loop = get_loop(env, false);
  uv_async_t async;
  uv_check_t check;
  uv_timer_t timer;
  uv_work_t work;
  uv_req_t not_work;
  memset(&not_work, 0, sizeof(not_work));
  if (uv_idle_init(loop, &errors_idle) != 0 ||
      uv_timer_init(loop, &errors_timer) != 0) {
    napi_throw_error(env, NULL, "init failed");
    return NULL;
  }
  int32_t results[] = {
      uv_async_init(NULL, &async, unused_async_cb),
      uv_check_init(NULL, &check),
      uv_timer_init(NULL, &timer),
      uv_queue_work(loop, &work, NULL, NULL),
      uv_cancel(&not_work),
      // No callback.
      uv_idle_start(&errors_idle, NULL),
      uv_timer_start(&errors_timer, NULL, 0, 0),
      // Never started, so there's nothing to repeat.
      uv_timer_again(&errors_timer),
      // Wrong handle type.
      uv_prepare_start((uv_prepare_t *)&errors_idle,
                       (uv_prepare_cb)unused_idle_cb),
      uv_prepare_stop((uv_prepare_t *)&errors_idle),
      uv_idle_start((uv_idle_t *)&errors_timer, unused_idle_cb),
      uv_timer_start((uv_timer_t *)&errors_idle, unused_timer_cb, 0, 0),
      uv_timer_stop((uv_timer_t *)&errors_idle),
      uv_timer_again((uv_timer_t *)&errors_idle),
  };
  uv_close((uv_handle_t *)&errors_idle, NULL);
  uv_close((uv_handle_t *)&errors_timer, NULL);
  return make_int32_array(env, results, sizeof(results) / sizeof(results[0]));
}

// --- uv_async_t -------------------------------------------------------------

struct async_test {
  uv_async_t handle;
  struct reporter reporter;
  int calls;
};

static void async_test_close_cb(uv_handle_t *handle) {
  struct async_test *test = handle->data;
  report(&test->reporter, "close", uv_is_closing(handle),
         uv_handle_get_data(handle) == test);
  reporter_destroy(&test->reporter);
  free(test);
}

static void async_test_cb(uv_async_t *handle) {
  struct async_test *test = handle->data;
  test->calls++;
  report(&test->reporter, "async", test->calls,
         uv_is_active((uv_handle_t *)handle));
  if (test->calls == 1) {
    // A send from inside the callback must trigger another callback.
    uv_async_send(handle);
    return;
  }
  uv_close((uv_handle_t *)handle, async_test_close_cb);
  // The handle is closing immediately, but close_cb runs later.
  report(&test->reporter, "closing", uv_is_closing((uv_handle_t *)handle),
         uv_is_active((uv_handle_t *)handle));
}

static void *send_after_a_while(void *arg) {
  usleep(30 * 1000);
  uv_async_send(arg);
  return NULL;
}

// Calls uv_async_init and throws if it fails, so the test fails here instead of
// on bogus events from an uninitialized handle.
static bool init_async(napi_env env, uv_loop_t *loop, uv_async_t *handle,
                       uv_async_cb cb) {
  int rc = uv_async_init(loop, handle, cb);
  if (rc != 0) {
    char message[64];
    snprintf(message, sizeof(message), "uv_async_init returned %d", rc);
    napi_throw_error(env, NULL, message);
    return false;
  }
  return true;
}

// testAsync(useDefaultLoop, sendFromThread, callback) reports these events:
//   async 1 1      first callback, for the three coalesced sends
//   async 2 1      the callback's own send
//   closing 1 0    right after uv_close
//   close 1 1      the deferred close callback
// The calling script returns right away, so only the ref'd handle keeps the
// process alive until the events fire.
// Returns [is_active, is_closing, has_ref] right after init.
static napi_value test_async(napi_env env, napi_callback_info info) {
  napi_value args[3];
  get_args(env, info, args, 3);
  bool use_default_loop = as_bool(env, args[0]);
  bool send_from_thread = as_bool(env, args[1]);

  struct async_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, args[2]);
  test->handle.data = test; // set before init, as addons commonly do
  uv_loop_t *loop = get_loop(env, use_default_loop);
  if (!init_async(env, loop, &test->handle, async_test_cb))
    return NULL;
  if (test->handle.data != test ||
      uv_handle_get_loop((uv_handle_t *)&test->handle) != loop ||
      uv_handle_get_type((uv_handle_t *)&test->handle) != UV_ASYNC) {
    napi_throw_error(env, NULL, "uv_async_init didn't set up the handle");
    return NULL;
  }
  int32_t observed[3] = {
      uv_is_active((uv_handle_t *)&test->handle),
      uv_is_closing((uv_handle_t *)&test->handle),
      uv_has_ref((uv_handle_t *)&test->handle),
  };

  if (send_from_thread) {
    pthread_t thread;
    if (pthread_create(&thread, NULL, send_after_a_while, &test->handle) != 0) {
      napi_throw_error(env, NULL, "pthread_create failed");
      return NULL;
    }
    pthread_detach(thread);
  } else {
    // Nothing can run the callback between these, so they coalesce into one.
    uv_async_send(&test->handle);
    uv_async_send(&test->handle);
    uv_async_send(&test->handle);
  }
  return make_int32_array(env, observed, 3);
}

// testAsyncCloseWithSendPending(callback) sends and then closes a handle before
// the loop iterates, so only the close callback runs. A send after uv_close
// (allowed until close_cb) doesn't trigger a callback either.
// Returns [is_active, is_closing, send after close] right after uv_close.
static napi_value test_async_close_with_send_pending(napi_env env,
                                                     napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct async_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, args[0]);
  if (!init_async(env, get_loop(env, false), &test->handle, async_test_cb))
    return NULL;
  uv_handle_set_data((uv_handle_t *)&test->handle, test);
  uv_async_send(&test->handle);
  uv_close((uv_handle_t *)&test->handle, async_test_close_cb);
  uv_close((uv_handle_t *)&test->handle, async_test_close_cb); // ignored
  int32_t observed[3] = {
      uv_is_active((uv_handle_t *)&test->handle),
      uv_is_closing((uv_handle_t *)&test->handle),
      uv_async_send(&test->handle),
  };
  return make_int32_array(env, observed, 3);
}

// --- uv_async_send from another thread ---------------------------------------

#define STRESS_ROUNDS 200
#define STRESS_BURST 2000

struct stress_test {
  uv_async_t handle;
  struct reporter reporter;
  pthread_t sender;
  atomic_int callbacks;
};

static void *stress_sender(void *arg) {
  struct stress_test *test = arg;
  // Each round is one send and one callback. A send that arrives after the loop
  // consumed the previous one must wake the loop again. A lost wakeup hangs
  // here until the test times out.
  for (int round = 1; round <= STRESS_ROUNDS; round++) {
    uv_async_send(&test->handle);
    while (atomic_load(&test->callbacks) < round)
      sched_yield();
  }
  // The pending flag was cleared before the last round's callback ran, so this
  // burst triggers exactly one more callback, which closes the handle. The
  // remaining sends arrive during or after uv_close, which is allowed until
  // close_cb runs. close_cb joins this thread before it frees the handle.
  for (int i = 0; i < STRESS_BURST; i++)
    uv_async_send(&test->handle);
  return NULL;
}

static void stress_close_cb(uv_handle_t *handle) {
  struct stress_test *test = handle->data;
  pthread_join(test->sender, NULL);
  report(&test->reporter, "done", atomic_load(&test->callbacks),
         uv_is_closing(handle));
  reporter_destroy(&test->reporter);
  free(test);
}

static void stress_async_cb(uv_async_t *handle) {
  struct stress_test *test = handle->data;
  if (atomic_fetch_add(&test->callbacks, 1) + 1 > STRESS_ROUNDS)
    uv_close((uv_handle_t *)handle, stress_close_cb);
}

// testAsyncStress(callback) reports `done <STRESS_ROUNDS + 1> 1`: one callback
// per round, plus one for the burst, which closes the handle.
static napi_value test_async_stress(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct stress_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, args[0]);
  test->handle.data = test;
  if (!init_async(env, get_loop(env, false), &test->handle, stress_async_cb))
    return NULL;
  if (pthread_create(&test->sender, NULL, stress_sender, test) != 0) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }
  return NULL;
}

static struct {
  uv_async_t handle;
  pthread_t sender;
  atomic_uint sends;
  atomic_bool stop;
} flood;

static void *flood_sender(void *arg) {
  while (!atomic_load(&flood.stop)) {
    uv_async_send(&flood.handle);
    atomic_fetch_add(&flood.sends, 1);
  }
  return NULL;
}

// Returns after a whole send ran during the callback, so the handle is always
// pending again when the callback returns.
static void flood_async_cb(uv_async_t *handle) {
  unsigned start = atomic_load(&flood.sends);
  while (atomic_load(&flood.sends) - start < 2)
    sched_yield();
}

// startAsyncFlood() sends from another thread in a tight loop until
// stopAsyncFlood() is called.
static napi_value start_async_flood(napi_env env, napi_callback_info info) {
  if (!init_async(env, get_loop(env, false), &flood.handle, flood_async_cb))
    return NULL;
  if (pthread_create(&flood.sender, NULL, flood_sender, NULL) != 0)
    napi_throw_error(env, NULL, "pthread_create failed");
  return NULL;
}

static napi_value stop_async_flood(napi_env env, napi_callback_info info) {
  atomic_store(&flood.stop, true);
  pthread_join(flood.sender, NULL);
  uv_close((uv_handle_t *)&flood.handle, NULL);
  return NULL;
}

static uv_async_t unref_test_handle;

// testAsyncRef() checks that uv_ref and uv_unref are idempotent. Returns
// uv_has_ref after each step. The handle is never closed, only unref'd, so the
// process must still exit.
static napi_value test_async_ref(napi_env env, napi_callback_info info) {
  uv_handle_t *handle = (uv_handle_t *)&unref_test_handle;
  if (!init_async(env, get_loop(env, false), &unref_test_handle,
                  unused_async_cb))
    return NULL;
  int32_t observed[6];
  observed[0] = uv_has_ref(handle);
  uv_unref(handle);
  observed[1] = uv_has_ref(handle);
  uv_unref(handle);
  observed[2] = uv_has_ref(handle);
  uv_ref(handle);
  observed[3] = uv_has_ref(handle);
  uv_ref(handle);
  observed[4] = uv_has_ref(handle);
  uv_unref(handle);
  observed[5] = uv_has_ref(handle);
  return make_int32_array(env, observed, 6);
}

// --- uv_queue_work ----------------------------------------------------------

struct work_test {
  uv_work_t req;
  struct reporter reporter;
  pthread_t loop_thread;
  int work_ran;
  int work_ran_off_the_loop_thread;
};

static void work_test_work_cb(uv_work_t *req) {
  struct work_test *test = req->data;
  test->work_ran = 1;
  test->work_ran_off_the_loop_thread =
      !pthread_equal(pthread_self(), test->loop_thread);
  // The script has returned by now, so the request must keep the process alive.
  usleep(20 * 1000);
}

// Reports "after" with the status and one bit per check that passed:
//   1 work_cb ran                  2 work_cb ran off the loop thread
//   4 after_work_cb is on the loop thread
//   8 data is unchanged            16 req->loop is the loop it was queued on
//   32 uv_req_get_type returns UV_WORK
//   64 uv_cancel on a finished request returns UV_EBUSY
static void work_test_after_work_cb(uv_work_t *req, int status) {
  struct work_test *test = uv_req_get_data((uv_req_t *)req);
  uv_loop_t *loop = NULL;
  napi_get_uv_event_loop(test->reporter.env, &loop);
  int32_t passed = 0;
  if (test->work_ran)
    passed |= 1;
  if (test->work_ran_off_the_loop_thread)
    passed |= 2;
  if (pthread_equal(pthread_self(), test->loop_thread))
    passed |= 4;
  if (req->data == test)
    passed |= 8;
  if (req->loop == loop)
    passed |= 16;
  if (uv_req_get_type((uv_req_t *)req) == UV_WORK)
    passed |= 32;
  if (uv_cancel((uv_req_t *)req) == UV_EBUSY)
    passed |= 64;
  report(&test->reporter, "after", status, passed);
  reporter_destroy(&test->reporter);
  free(test);
}

static struct work_test *queue_work(napi_env env, napi_value callback) {
  struct work_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, callback);
  test->loop_thread = pthread_self();
  uv_req_set_data((uv_req_t *)&test->req, test); // set before queueing
  int rc = uv_queue_work(get_loop(env, false), &test->req, work_test_work_cb,
                         work_test_after_work_cb);
  if (rc != 0) {
    napi_throw_error(env, NULL, "uv_queue_work failed");
    return NULL;
  }
  return test;
}

// testQueueWork(callback) reports `after 0 127`.
static napi_value test_queue_work(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  queue_work(env, args[0]);
  return NULL;
}

// testCancelWork(callback) queues work and cancels it immediately. Returns
// uv_cancel's result: 0 if the request was still queued (the event is then
// `after UV_ECANCELED` with the work_cb bits clear), or UV_EBUSY if a pool
// thread had already started it (then `after 0` with the work_cb bits set).
static napi_value test_cancel_work(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct work_test *test = queue_work(env, args[0]);
  if (test == NULL)
    return NULL;
  napi_value result;
  napi_create_int32(env, uv_cancel((uv_req_t *)&test->req), &result);
  return result;
}

// --- uv_idle_t / uv_prepare_t / uv_check_t -----------------------------------

struct watcher_test {
  uv_idle_t idle;
  uv_prepare_t prepare;
  uv_check_t check;
  struct reporter reporter;
  int iterations;
  bool close_requested;
  int open;
};

// Reports "close <type name>", using the type that the init function stored.
static void watcher_test_close_cb(uv_handle_t *handle) {
  struct watcher_test *test = uv_handle_get_data(handle);
  char event[32];
  snprintf(event, sizeof(event), "close %s",
           uv_handle_type_name(uv_handle_get_type(handle)));
  report(&test->reporter, event, uv_is_closing(handle), uv_is_active(handle));
  if (--test->open == 0) {
    reporter_destroy(&test->reporter);
    free(test);
  }
}

// Called from a check callback, so this closes the handles, including the check
// handle itself, while the loop is iterating over them.
static void watcher_test_close_all(struct watcher_test *test) {
  if (test->open == 3)
    uv_close((uv_handle_t *)&test->idle, watcher_test_close_cb);
  uv_close((uv_handle_t *)&test->prepare, watcher_test_close_cb);
  uv_close((uv_handle_t *)&test->check, watcher_test_close_cb);
  report(&test->reporter, "closing", uv_is_closing((uv_handle_t *)&test->check),
         uv_is_active((uv_handle_t *)&test->check));
}

static struct watcher_test *init_watchers(napi_env env, napi_value callback,
                                          bool with_idle) {
  struct watcher_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, callback);
  uv_loop_t *loop = get_loop(env, false);
  int rc =
      uv_prepare_init(loop, &test->prepare) | uv_check_init(loop, &test->check);
  test->open = 2;
  if (with_idle) {
    rc |= uv_idle_init(loop, &test->idle);
    test->open = 3;
    uv_handle_set_data((uv_handle_t *)&test->idle, test);
  }
  if (rc != 0) {
    napi_throw_error(env, NULL, "init failed");
    return NULL;
  }
  uv_handle_set_data((uv_handle_t *)&test->prepare, test);
  uv_handle_set_data((uv_handle_t *)&test->check, test);
  return test;
}

static void loop_idle_cb(uv_idle_t *handle) {
  struct watcher_test *test = handle->data;
  test->iterations++;
  report(&test->reporter, "idle", test->iterations,
         uv_is_active((uv_handle_t *)handle));
}

static void loop_prepare_cb(uv_prepare_t *handle) {
  struct watcher_test *test = handle->data;
  report(&test->reporter, "prepare", test->iterations,
         uv_is_active((uv_handle_t *)handle));
}

static void loop_check_cb(uv_check_t *handle) {
  struct watcher_test *test = handle->data;
  report(&test->reporter, "check", test->iterations,
         uv_is_active((uv_handle_t *)handle));
  if (test->iterations == 2)
    watcher_test_close_all(test);
}

// testLoopWatchers(callback) starts an idle, a prepare and a check handle. The
// idle handle counts iterations and keeps the poll from blocking, since nothing
// else would wake the loop. Each iteration runs the three in libuv's order, and
// the second iteration's check callback closes all three. Events:
//   idle 1 1 / prepare 1 1 / check 1 1 / idle 2 1 / prepare 2 1 / check 2 1
//   closing 1 0 / close idle 1 0 / close prepare 1 0 / close check 1 0
static napi_value test_loop_watchers(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct watcher_test *test = init_watchers(env, args[0], true);
  if (test == NULL)
    return NULL;
  if ((uv_idle_start(&test->idle, loop_idle_cb) |
       uv_prepare_start(&test->prepare, loop_prepare_cb) |
       uv_check_start(&test->check, loop_check_cb)) != 0)
    napi_throw_error(env, NULL, "start failed");
  return NULL;
}

static struct watcher_test *io_test;

static void io_prepare_cb(uv_prepare_t *handle) {
  struct watcher_test *test = handle->data;
  test->iterations++;
  report(&test->reporter, "prepare", test->iterations,
         uv_is_active((uv_handle_t *)handle));
}

static void io_check_cb(uv_check_t *handle) {
  struct watcher_test *test = handle->data;
  report(&test->reporter, "check", test->iterations,
         uv_is_active((uv_handle_t *)handle));
  if (test->close_requested) {
    io_test = NULL;
    watcher_test_close_all(test);
  }
}

// testPrepareAndCheckAroundIo(callback) starts a prepare and a check handle
// without an idle handle, so the loop blocks in its poll between the two until
// I/O arrives. The script does some socket I/O and calls requestClose() from
// its I/O callback. That callback runs inside the poll, between one iteration's
// prepare and check events, and that iteration's check callback closes both
// handles.
static napi_value test_prepare_and_check_around_io(napi_env env,
                                                   napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct watcher_test *test = init_watchers(env, args[0], false);
  if (test == NULL)
    return NULL;
  if ((uv_prepare_start(&test->prepare, io_prepare_cb) |
       uv_check_start(&test->check, io_check_cb)) != 0) {
    napi_throw_error(env, NULL, "start failed");
    return NULL;
  }
  io_test = test;
  return NULL;
}

static napi_value request_close(napi_env env, napi_callback_info info) {
  if (io_test != NULL)
    io_test->close_requested = true;
  return NULL;
}

static uv_idle_t state_idle;
static uv_check_t state_check;
static void unused_check_cb(uv_check_t *handle) { (void)handle; }

// testWatcherStates() checks the start/stop state machine synchronously. It
// closes both handles before the loop iterates, so no callback runs and the
// process exits. Otherwise the started idle handle would spin forever.
static napi_value test_watcher_states(napi_env env, napi_callback_info info) {
  uv_loop_t *loop = get_loop(env, false);
  uv_handle_t *idle = (uv_handle_t *)&state_idle;
  uv_handle_t *check = (uv_handle_t *)&state_check;
  napi_value result;
  napi_create_object(env, &result);
  set_int32(env, result, "init",
            uv_idle_init(loop, &state_idle) |
                uv_check_init(loop, &state_check));
  set_int32(env, result, "activeAfterInit", uv_is_active(idle));
  set_int32(env, result, "refAfterInit", uv_has_ref(idle));
  set_int32(env, result, "typeIsIdle", uv_handle_get_type(idle) == UV_IDLE);
  set_int32(env, result, "typeIsCheck", uv_handle_get_type(check) == UV_CHECK);
  set_int32(env, result, "loopIsSet", uv_handle_get_loop(idle) == loop);
  set_int32(env, result, "start", uv_idle_start(&state_idle, unused_idle_cb));
  set_int32(env, result, "activeAfterStart", uv_is_active(idle));
  set_int32(env, result, "startAgain",
            uv_idle_start(&state_idle, unused_idle_cb));
  set_int32(env, result, "stop", uv_idle_stop(&state_idle));
  set_int32(env, result, "activeAfterStop", uv_is_active(idle));
  set_int32(env, result, "stopAgain", uv_idle_stop(&state_idle));
  set_int32(env, result, "restart", uv_idle_start(&state_idle, unused_idle_cb));
  set_int32(env, result, "activeAfterRestart", uv_is_active(idle));
  uv_unref(idle);
  set_int32(env, result, "refAfterUnref", uv_has_ref(idle));
  set_int32(env, result, "activeAfterUnref", uv_is_active(idle));
  uv_ref(idle);
  set_int32(env, result, "refAfterRef", uv_has_ref(idle));
  set_int32(env, result, "checkStart",
            uv_check_start(&state_check, unused_check_cb));
  uv_close(idle, NULL);
  uv_close(check, NULL);
  set_int32(env, result, "activeAfterClose", uv_is_active(idle));
  set_int32(env, result, "closingAfterClose", uv_is_closing(idle));
  set_int32(env, result, "refAfterClose", uv_has_ref(idle));
  set_int32(env, result, "startAfterClose",
            uv_idle_start(&state_idle, unused_idle_cb));
  set_int32(env, result, "activeAfterStartAfterClose", uv_is_active(idle));
  return result;
}

// --- uv_timer_t --------------------------------------------------------------

struct timer_test {
  uv_timer_t handle;
  struct reporter reporter;
  int fires;
};

static void timer_test_close_cb(uv_handle_t *handle) {
  struct timer_test *test = handle->data;
  report(&test->reporter, "close timer", uv_is_closing(handle),
         uv_is_active(handle));
  reporter_destroy(&test->reporter);
  free(test);
}

static struct timer_test *init_timer(napi_env env, napi_value callback) {
  struct timer_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, callback);
  test->handle.data = test;
  if (uv_timer_init(get_loop(env, false), &test->handle) != 0) {
    napi_throw_error(env, NULL, "uv_timer_init failed");
    return NULL;
  }
  return test;
}

static napi_value timer_state(napi_env env, struct timer_test *test) {
  uv_handle_t *handle = (uv_handle_t *)&test->handle;
  napi_value result;
  napi_create_object(env, &result);
  set_int32(env, result, "typeIsTimer", uv_handle_get_type(handle) == UV_TIMER);
  set_int32(env, result, "isActive", uv_is_active(handle));
  set_int32(env, result, "hasRef", uv_has_ref(handle));
  set_int32(env, result, "dueIn", (int32_t)uv_timer_get_due_in(&test->handle));
  set_int32(env, result, "repeat", (int32_t)uv_timer_get_repeat(&test->handle));
  return result;
}

static void timer_once_cb(uv_timer_t *handle) {
  struct timer_test *test = handle->data;
  // Like libuv, a one-shot timer is already stopped when its callback runs.
  report(&test->reporter, "timer", uv_is_active((uv_handle_t *)handle),
         (int32_t)uv_timer_get_due_in(handle));
  uv_close((uv_handle_t *)handle, timer_test_close_cb);
}

// testTimer(callback) starts a 10ms one-shot timer. The script returns right
// away, and the timer keeps the process alive until it fires. Reports
// `timer 0 0`, then `close timer 1 0`. Returns the state right after the start.
static napi_value test_timer(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct timer_test *test = init_timer(env, args[0]);
  if (test == NULL)
    return NULL;
  if (uv_timer_start(&test->handle, timer_once_cb, 10, 0) != 0) {
    napi_throw_error(env, NULL, "uv_timer_start failed");
    return NULL;
  }
  return timer_state(env, test);
}

static void timer_repeat_cb(uv_timer_t *handle) {
  struct timer_test *test = handle->data;
  test->fires++;
  // A repeating timer is already rearmed when its callback runs.
  report(&test->reporter, "repeat", test->fires,
         uv_is_active((uv_handle_t *)handle));
  if (test->fires < 3)
    return;
  uv_timer_stop(handle);
  report(&test->reporter, "stopped", uv_is_active((uv_handle_t *)handle),
         (int32_t)uv_timer_get_repeat(handle));
  uv_close((uv_handle_t *)handle, timer_test_close_cb);
}

// testTimerRepeat(callback) starts a timer with a 1ms timeout and a 1ms repeat.
// Reports `repeat 1 1`, `repeat 2 1`, `repeat 3 1`, `stopped 0 1`,
// `close timer 1 0`.
static napi_value test_timer_repeat(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct timer_test *test = init_timer(env, args[0]);
  if (test == NULL)
    return NULL;
  uv_timer_start(&test->handle, timer_repeat_cb, 1, 1);
  return timer_state(env, test);
}

// testTimerAgain(callback) starts a one-hour timer, sets a 1ms repeat and calls
// uv_timer_again, which restarts it with the repeat. Reports the same events as
// testTimerRepeat. Returns { dueInBefore, again, dueInAfter, repeat }.
static napi_value test_timer_again(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct timer_test *test = init_timer(env, args[0]);
  if (test == NULL)
    return NULL;
  uv_timer_start(&test->handle, timer_repeat_cb, 60 * 60 * 1000, 0);
  napi_value result;
  napi_create_object(env, &result);
  set_int32(env, result, "dueInBefore",
            (int32_t)uv_timer_get_due_in(&test->handle));
  uv_timer_set_repeat(&test->handle, 1);
  set_int32(env, result, "again", uv_timer_again(&test->handle));
  set_int32(env, result, "dueInAfter",
            (int32_t)uv_timer_get_due_in(&test->handle));
  set_int32(env, result, "repeat", (int32_t)uv_timer_get_repeat(&test->handle));
  return result;
}

// testTimerRestart(callback) starts a one-hour timer and starts it again with
// 10ms. uv_timer_start reschedules a started timer, so this reports the same
// events as testTimer. Returns the state after the restart.
static napi_value test_timer_restart(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct timer_test *test = init_timer(env, args[0]);
  if (test == NULL)
    return NULL;
  uv_timer_start(&test->handle, timer_once_cb, 60 * 60 * 1000, 0);
  uv_timer_start(&test->handle, timer_once_cb, 10, 0);
  return timer_state(env, test);
}

// testTimerClosedBeforeItFires(callback) starts a one-hour timer and closes it
// immediately. The only event is `close timer 1 0`, and the process exits.
// Returns the state right after uv_close.
static napi_value test_timer_closed_before_it_fires(napi_env env,
                                                    napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct timer_test *test = init_timer(env, args[0]);
  if (test == NULL)
    return NULL;
  uv_timer_start(&test->handle, timer_once_cb, 60 * 60 * 1000, 0);
  uv_close((uv_handle_t *)&test->handle, timer_test_close_cb);
  // Allowed until close_cb runs, but none of these may restart the timer.
  uv_timer_start(&test->handle, timer_once_cb, 0, 0);
  uv_timer_again(&test->handle);
  uv_timer_stop(&test->handle);
  return timer_state(env, test);
}

static void timer_unref_cb(uv_timer_t *handle) {
  struct timer_test *test = handle->data;
  report(&test->reporter, "fired", 0, 0);
}

// testTimerUnref(callback) starts a one-hour timer and unrefs it. The process
// must exit even though the timer is never stopped or closed, so `fired` is
// never reported. Returns the state after the unref.
static napi_value test_timer_unref(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct timer_test *test = init_timer(env, args[0]);
  if (test == NULL)
    return NULL;
  uv_timer_start(&test->handle, timer_unref_cb, 60 * 60 * 1000, 0);
  uv_unref((uv_handle_t *)&test->handle);
  return timer_state(env, test);
}

// testNow() checks that uv_now advances while the process spins for 5ms of
// uv_hrtime. Returns { nowIsPositive, advancedMs }.
static napi_value test_now(napi_env env, napi_callback_info info) {
  uv_loop_t *loop = get_loop(env, false);
  uv_update_time(loop);
  uint64_t before = uv_now(loop);
  uint64_t start = uv_hrtime();
  while (uv_hrtime() - start < 5 * 1000 * 1000)
    ;
  uv_update_time(loop);
  uint64_t after = uv_now(loop);
  napi_value result;
  napi_create_object(env, &result);
  set_int32(env, result, "nowIsPositive", before > 0);
  set_int32(env, result, "advancedMs", (int32_t)(after - before));
  return result;
}

// --- uv_udp_t ----------------------------------------------------------------

struct udp_test {
  uv_udp_t server;
  uv_udp_t client;
  uv_udp_send_t send;
  struct reporter reporter;
  struct sockaddr_in server_addr;
  char server_buf[64];
  char client_buf[64];
  int closed;
};

static struct sockaddr_in loopback(int port) {
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
  return addr;
}

static int udp_port(uv_udp_t *handle) {
  struct sockaddr_in addr;
  int len = sizeof(addr);
  if (uv_udp_getsockname(handle, (struct sockaddr *)&addr, &len) != 0)
    return -1;
  return ntohs(addr.sin_port);
}

static void udp_close_cb(uv_handle_t *handle) {
  struct udp_test *test = handle->data;
  report(&test->reporter,
         handle == (uv_handle_t *)&test->server ? "close server"
                                                : "close client",
         uv_is_closing(handle), uv_is_active(handle));
  if (++test->closed == 2) {
    reporter_destroy(&test->reporter);
    free(test);
  }
}

static void udp_server_alloc(uv_handle_t *handle, size_t suggested,
                             uv_buf_t *buf) {
  struct udp_test *test = handle->data;
  (void)suggested;
  *buf = uv_buf_init(test->server_buf, sizeof(test->server_buf));
}

static void udp_client_alloc(uv_handle_t *handle, size_t suggested,
                             uv_buf_t *buf) {
  struct udp_test *test = handle->data;
  (void)suggested;
  *buf = uv_buf_init(test->client_buf, sizeof(test->client_buf));
}

// nread == 0 with no address means the socket had nothing more to read.
static void udp_server_recv(uv_udp_t *handle, ssize_t nread,
                            const uv_buf_t *buf, const struct sockaddr *addr,
                            unsigned flags) {
  struct udp_test *test = handle->data;
  if (nread == 0 && addr == NULL)
    return;
  int from_client = addr != NULL && addr->sa_family == AF_INET &&
                    ntohs(((const struct sockaddr_in *)addr)->sin_port) ==
                        udp_port(&test->client);
  report(&test->reporter, "server recv", (int32_t)nread,
         from_client && flags == 0 && memcmp(buf->base, "ping", 4) == 0);
  uv_buf_t reply = uv_buf_init("pong", 4);
  report(&test->reporter, "reply", uv_udp_try_send(handle, &reply, 1, addr), 0);
}

static void udp_client_recv(uv_udp_t *handle, ssize_t nread,
                            const uv_buf_t *buf, const struct sockaddr *addr,
                            unsigned flags) {
  struct udp_test *test = handle->data;
  if (nread == 0 && addr == NULL)
    return;
  report(&test->reporter, "client recv", (int32_t)nread,
         flags == 0 && memcmp(buf->base, "pong", 4) == 0);
  uv_close((uv_handle_t *)&test->server, udp_close_cb);
  uv_close((uv_handle_t *)&test->client, udp_close_cb);
}

static void udp_client_sent(uv_udp_send_t *req, int status) {
  struct udp_test *test = req->handle->data;
  // libuv takes the request off the queue before it calls back.
  report(&test->reporter, "sent", status,
         (int32_t)uv_udp_get_send_queue_count(req->handle));
  uv_udp_recv_start(&test->server, udp_server_alloc, udp_server_recv);
  uv_udp_recv_start(&test->client, udp_client_alloc, udp_client_recv);
}

// testUdpEcho(callback) binds a server to 127.0.0.1, and an unbound client
// sends it "ping". When the send completes, both start receiving: the server
// answers with uv_udp_try_send and the client closes both handles when "pong"
// arrives. Reports `sent 0 0`, `server recv 4 1`, `reply 4 0`, `client recv 4
// 1`, `close server 1 0`, `close client 1 0`. Returns the queue right after the
// send.
static napi_value test_udp_echo(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct udp_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, args[0]);
  uv_loop_t *loop = get_loop(env, false);
  test->server.data = test;
  test->client.data = test;
  struct sockaddr_in any = loopback(0);
  if (uv_udp_init(loop, &test->server) != 0 ||
      uv_udp_init(loop, &test->client) != 0 ||
      uv_udp_bind(&test->server, (const struct sockaddr *)&any, 0) != 0) {
    napi_throw_error(env, NULL, "uv_udp_init or uv_udp_bind failed");
    return NULL;
  }
  test->server_addr = loopback(udp_port(&test->server));
  uv_buf_t ping = uv_buf_init("ping", 4);
  if (uv_udp_send(&test->send, &test->client, &ping, 1,
                  (const struct sockaddr *)&test->server_addr,
                  udp_client_sent) != 0) {
    napi_throw_error(env, NULL, "uv_udp_send failed");
    return NULL;
  }
  napi_value result;
  napi_create_object(env, &result);
  set_int32(env, result, "count",
            (int32_t)uv_udp_get_send_queue_count(&test->client));
  set_int32(env, result, "size",
            (int32_t)uv_udp_get_send_queue_size(&test->client));
  set_int32(env, result, "active", uv_is_active((uv_handle_t *)&test->client));
  set_int32(env, result, "typeIsUdp",
            uv_handle_get_type((uv_handle_t *)&test->client) == UV_UDP);
  return result;
}

struct udp_stop_test {
  uv_udp_t server;
  uv_udp_t client;
  uv_udp_send_t sends[2];
  struct reporter reporter;
  char buf[64];
  int sent;
  int stopped;
  int closed;
};

static void udp_stop_close_cb(uv_handle_t *handle) {
  struct udp_stop_test *test = handle->data;
  if (++test->closed == 2) {
    report(&test->reporter, "closed", test->closed, 0);
    reporter_destroy(&test->reporter);
    free(test);
  }
}

// Once both datagrams are sent and receiving has stopped, both must still be in
// the server's socket (loopback delivers them during sendmsg): read them here.
static void udp_stop_check(struct udp_stop_test *test) {
  if (test->sent < 2 || !test->stopped)
    return;
  uv_os_fd_t fd;
  int unread = 0;
  char b[8];
  if (uv_fileno((uv_handle_t *)&test->server, &fd) == 0)
    while (recv(fd, b, sizeof(b), MSG_DONTWAIT) == 4)
      unread++;
  report(&test->reporter, "unread", unread, 0);
  uv_close((uv_handle_t *)&test->server, udp_stop_close_cb);
  uv_close((uv_handle_t *)&test->client, udp_stop_close_cb);
}

// Stops receiving from inside alloc_cb, as an addon might when it runs out of
// buffers: no datagram may be read into the buffer or delivered after that.
static void udp_stop_alloc(uv_handle_t *handle, size_t suggested,
                           uv_buf_t *buf) {
  struct udp_stop_test *test = handle->data;
  (void)suggested;
  report(&test->reporter, "alloc stops", uv_udp_recv_stop((uv_udp_t *)handle),
         0);
  *buf = uv_buf_init(test->buf, sizeof(test->buf));
}

static void udp_stop_recv(uv_udp_t *handle, ssize_t nread, const uv_buf_t *buf,
                          const struct sockaddr *addr, unsigned flags) {
  struct udp_stop_test *test = handle->data;
  (void)flags;
  report(&test->reporter, "recv", (int32_t)nread,
         addr == NULL && buf->base == test->buf);
  test->stopped = 1;
  udp_stop_check(test);
}

static void udp_stop_sent(uv_udp_send_t *req, int status) {
  struct udp_stop_test *test = req->handle->data;
  (void)status;
  test->sent++;
  udp_stop_check(test);
}

// testUdpStopInAlloc(callback) sends two datagrams to a receiving server whose
// alloc_cb calls uv_udp_recv_stop. Reports `alloc stops 0 0`, then `recv 0 1`
// (nothing read, no address, the addon's buffer handed back). Once both sends have
// completed, it reads the server's socket itself: `unread 2 0` means neither
// datagram was read or delivered. Then `closed 2 0`.
static napi_value test_udp_stop_in_alloc(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct udp_stop_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, args[0]);
  uv_loop_t *loop = get_loop(env, false);
  test->server.data = test;
  test->client.data = test;
  struct sockaddr_in any = loopback(0);
  if (uv_udp_init(loop, &test->server) != 0 ||
      uv_udp_init(loop, &test->client) != 0 ||
      uv_udp_bind(&test->server, (const struct sockaddr *)&any, 0) != 0) {
    napi_throw_error(env, NULL, "uv_udp_init or uv_udp_bind failed");
    return NULL;
  }
  struct sockaddr_in to = loopback(udp_port(&test->server));
  uv_buf_t ping = uv_buf_init("ping", 4);
  uv_udp_recv_start(&test->server, udp_stop_alloc, udp_stop_recv);
  for (int i = 0; i < 2; i++) {
    if (uv_udp_send(&test->sends[i], &test->client, &ping, 1,
                    (const struct sockaddr *)&to, udp_stop_sent) != 0) {
      napi_throw_error(env, NULL, "uv_udp_send failed");
      return NULL;
    }
  }
  return NULL;
}

struct udp_cancel_test {
  uv_udp_t handle;
  uv_udp_send_t first;
  uv_udp_send_t second;
  struct reporter reporter;
};

static void udp_cancel_close_cb(uv_handle_t *handle) {
  struct udp_cancel_test *test = handle->data;
  report(&test->reporter, "close", uv_is_closing(handle),
         (int32_t)uv_udp_get_send_queue_count(&test->handle));
  reporter_destroy(&test->reporter);
  free(test);
}

static void udp_second_sent(uv_udp_send_t *req, int status) {
  struct udp_cancel_test *test = req->handle->data;
  report(&test->reporter, "second", status,
         (int32_t)uv_udp_get_send_queue_count(req->handle));
}

static void udp_first_sent(uv_udp_send_t *req, int status) {
  struct udp_cancel_test *test = req->handle->data;
  report(&test->reporter, "first", status,
         (int32_t)uv_udp_get_send_queue_count(req->handle));
  // A send from a send callback waits behind the callbacks, so closing the
  // handle now cancels it.
  struct sockaddr_in to = loopback(udp_port(&test->handle));
  uv_buf_t buf = uv_buf_init("two", 3);
  // Send first: the order of a call's arguments isn't defined.
  int queued = uv_udp_send(&test->second, &test->handle, &buf, 1,
                           (const struct sockaddr *)&to, udp_second_sent);
  report(&test->reporter, "queued", queued,
         (int32_t)uv_udp_get_send_queue_count(req->handle));
  uv_close((uv_handle_t *)&test->handle, udp_cancel_close_cb);
}

// testUdpCloseCancels(callback) sends to itself, and from the send's callback
// sends again and closes the handle. Reports `first 0 0`, `queued 0 1`,
// `second -ECANCELED 0`, `close 1 0`.
static napi_value test_udp_close_cancels(napi_env env,
                                         napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct udp_cancel_test *test = calloc(1, sizeof(*test));
  reporter_init(&test->reporter, env, args[0]);
  test->handle.data = test;
  struct sockaddr_in any = loopback(0);
  uv_udp_init_ex(get_loop(env, false), &test->handle, AF_INET);
  uv_udp_bind(&test->handle, (const struct sockaddr *)&any, 0);
  struct sockaddr_in to = loopback(udp_port(&test->handle));
  uv_buf_t buf = uv_buf_init("one", 3);
  uv_udp_send(&test->first, &test->handle, &buf, 1,
              (const struct sockaddr *)&to, udp_first_sent);
  return NULL;
}

static void unused_alloc_cb(uv_handle_t *handle, size_t suggested,
                            uv_buf_t *buf) {
  (void)handle;
  (void)suggested;
  *buf = uv_buf_init(NULL, 0);
}

static void unused_recv_cb(uv_udp_t *handle, ssize_t nread, const uv_buf_t *buf,
                           const struct sockaddr *addr, unsigned flags) {
  (void)handle;
  (void)nread;
  (void)buf;
  (void)addr;
  (void)flags;
}

static uv_udp_t errors_udp;
static uv_udp_t errors_udp_bad;

// testUdpErrors() returns the result of each call, in order. See uv.test.ts.
static napi_value test_udp_errors(napi_env env, napi_callback_info info) {
  (void)info;
  uv_loop_t *loop = get_loop(env, false);
  uv_udp_send_t req;
  uv_buf_t buf = uv_buf_init("data", 4);
  struct sockaddr_in any = loopback(0);
  struct sockaddr_in discard = loopback(9);
  int fd = -1;
  int value = 0;
  // One call per line, in order (an initializer list's order isn't defined).
  int32_t results[32];
  size_t n = 0;
  results[n++] = uv_udp_init_ex(loop, &errors_udp_bad, 99);
  results[n++] = uv_udp_init_ex(loop, &errors_udp_bad, AF_INET | (1 << 12));
  results[n++] = uv_udp_init(loop, &errors_udp);
  results[n++] = uv_udp_recv_start(&errors_udp, NULL, unused_recv_cb);
  results[n++] = uv_udp_send(&req, &errors_udp, &buf, 1, NULL, NULL);
  results[n++] = uv_fileno((uv_handle_t *)&errors_udp, &fd);
  results[n++] =
      uv_udp_bind(&errors_udp, (const struct sockaddr *)&any, UV_UDP_IPV6ONLY);
  results[n++] = uv_udp_bind(&errors_udp, (const struct sockaddr *)&any, 0);
  results[n++] = uv_fileno((uv_handle_t *)&errors_udp, &fd) == 0 && fd >= 0;
  results[n++] = uv_udp_open(&errors_udp, fd);
  results[n++] =
      uv_udp_recv_start(&errors_udp, unused_alloc_cb, unused_recv_cb);
  results[n++] =
      uv_udp_recv_start(&errors_udp, unused_alloc_cb, unused_recv_cb);
  results[n++] = uv_udp_recv_stop(&errors_udp);
  results[n++] = uv_udp_connect(&errors_udp, (const struct sockaddr *)&discard);
  results[n++] = uv_udp_connect(&errors_udp, (const struct sockaddr *)&discard);
  results[n++] =
      uv_udp_try_send(&errors_udp, &buf, 1, (const struct sockaddr *)&discard);
  results[n++] = uv_udp_try_send(&errors_udp, &buf, 1, NULL);
  results[n++] = uv_udp_connect(&errors_udp, NULL);
  results[n++] = uv_udp_connect(&errors_udp, NULL);
  results[n++] = uv_udp_set_ttl(&errors_udp, 0);
  results[n++] = uv_udp_set_ttl(&errors_udp, 64);
  results[n++] = uv_udp_set_broadcast(&errors_udp, 1);
  results[n++] = uv_udp_set_multicast_ttl(&errors_udp, 1);
  results[n++] = uv_udp_set_multicast_loop(&errors_udp, 1);
  results[n++] =
      uv_send_buffer_size((uv_handle_t *)&errors_udp, &value) == 0 && value > 0;
  results[n++] = uv_udp_using_recvmmsg(&errors_udp);
  uv_close((uv_handle_t *)&errors_udp, NULL);
  return make_int32_array(env, results, n);
}

// testUdpUnref(callback) receives on a bound socket and unrefs it. Nothing
// arrives and nothing else keeps the process alive, so it exits. Returns
// { active, hasRef }.
static uv_udp_t unref_udp;

static napi_value test_udp_unref(napi_env env, napi_callback_info info) {
  (void)info;
  struct sockaddr_in any = loopback(0);
  uv_udp_init(get_loop(env, false), &unref_udp);
  uv_udp_bind(&unref_udp, (const struct sockaddr *)&any, 0);
  uv_udp_recv_start(&unref_udp, unused_alloc_cb, unused_recv_cb);
  uv_unref((uv_handle_t *)&unref_udp);
  napi_value result;
  napi_create_object(env, &result);
  set_int32(env, result, "active", uv_is_active((uv_handle_t *)&unref_udp));
  set_int32(env, result, "hasRef", uv_has_ref((uv_handle_t *)&unref_udp));
  return result;
}

// testErrorNames() returns [uv_err_name, uv_strerror] for UV_EINVAL and an
// unknown code, and what uv_err_name_r and uv_strerror_r write.
static napi_value test_error_names(napi_env env, napi_callback_info info) {
  (void)info;
  char name[32], message[64];
  const char *strings[] = {
      uv_err_name(UV_EINVAL),
      uv_strerror(UV_EINVAL),
      uv_err_name(-99999),
      uv_strerror(-99999),
      uv_err_name_r(UV_ECANCELED, name, sizeof(name)),
      uv_strerror_r(UV_EAGAIN, message, sizeof(message)),
  };
  napi_value array;
  napi_create_array_with_length(env, 6, &array);
  for (uint32_t i = 0; i < 6; i++) {
    napi_value s;
    napi_create_string_utf8(env, strings[i], NAPI_AUTO_LENGTH, &s);
    napi_set_element(env, array, i, s);
  }
  return array;
}

// testIpAddresses() parses and formats addresses with uv_ip4_addr,
// uv_ip6_addr and the name functions. See uv.test.ts.
static napi_value test_ip_addresses(napi_env env, napi_callback_info info) {
  (void)info;
  struct sockaddr_in a4;
  struct sockaddr_in6 a6;
  struct sockaddr unknown;
  char name[64], tiny[4];
  napi_value result;
  napi_create_object(env, &result);
  set_int32(env, result, "ip4", uv_ip4_addr("127.0.0.1", 8080, &a4));
  set_int32(env, result, "ip4Port", ntohs(a4.sin_port));
  set_int32(env, result, "ip4Name", uv_ip4_name(&a4, name, sizeof(name)));
  napi_value s;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &s);
  napi_set_named_property(env, result, "ip4String", s);
  set_int32(env, result, "ip4Invalid", uv_ip4_addr("256.1.1.1", 0, &a4));
  set_int32(env, result, "ip6", uv_ip6_addr("fe80::1%lo", 53, &a6));
  set_int32(env, result, "ip6Name",
            uv_ip_name((const struct sockaddr *)&a6, name, sizeof(name)));
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &s);
  napi_set_named_property(env, result, "ip6String", s);
  set_int32(env, result, "ip6Invalid", uv_ip6_addr("::g", 0, &a6));
  memset(&unknown, 0, sizeof(unknown));
  unknown.sa_family = AF_UNIX;
  set_int32(env, result, "unknownFamily",
            uv_ip_name(&unknown, name, sizeof(name)));
  uv_ip4_addr("255.255.255.255", 0, &a4);
  set_int32(env, result, "tooSmall", uv_ip4_name(&a4, tiny, sizeof(tiny)));
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  // Register all test functions
  napi_value fn;

  napi_create_function(env, NULL, 0, test_loop_watchers, NULL, &fn);
  napi_set_named_property(env, exports, "testLoopWatchers", fn);

  napi_create_function(env, NULL, 0, test_prepare_and_check_around_io, NULL,
                       &fn);
  napi_set_named_property(env, exports, "testPrepareAndCheckAroundIo", fn);

  napi_create_function(env, NULL, 0, request_close, NULL, &fn);
  napi_set_named_property(env, exports, "requestClose", fn);

  napi_create_function(env, NULL, 0, test_watcher_states, NULL, &fn);
  napi_set_named_property(env, exports, "testWatcherStates", fn);

  napi_create_function(env, NULL, 0, test_timer, NULL, &fn);
  napi_set_named_property(env, exports, "testTimer", fn);

  napi_create_function(env, NULL, 0, test_timer_repeat, NULL, &fn);
  napi_set_named_property(env, exports, "testTimerRepeat", fn);

  napi_create_function(env, NULL, 0, test_timer_again, NULL, &fn);
  napi_set_named_property(env, exports, "testTimerAgain", fn);

  napi_create_function(env, NULL, 0, test_timer_restart, NULL, &fn);
  napi_set_named_property(env, exports, "testTimerRestart", fn);

  napi_create_function(env, NULL, 0, test_timer_closed_before_it_fires, NULL,
                       &fn);
  napi_set_named_property(env, exports, "testTimerClosedBeforeItFires", fn);

  napi_create_function(env, NULL, 0, test_timer_unref, NULL, &fn);
  napi_set_named_property(env, exports, "testTimerUnref", fn);

  napi_create_function(env, NULL, 0, test_now, NULL, &fn);
  napi_set_named_property(env, exports, "testNow", fn);

  napi_create_function(env, NULL, 0, test_version, NULL, &fn);
  napi_set_named_property(env, exports, "testVersion", fn);

  napi_create_function(env, NULL, 0, test_sizes_and_names, NULL, &fn);
  napi_set_named_property(env, exports, "testSizesAndNames", fn);

  napi_create_function(env, NULL, 0, test_osfhandle, NULL, &fn);
  napi_set_named_property(env, exports, "testOsfhandle", fn);

  napi_create_function(env, NULL, 0, test_loops, NULL, &fn);
  napi_set_named_property(env, exports, "testLoops", fn);

  napi_create_function(env, NULL, 0, test_errors, NULL, &fn);
  napi_set_named_property(env, exports, "testErrors", fn);

  napi_create_function(env, NULL, 0, test_async, NULL, &fn);
  napi_set_named_property(env, exports, "testAsync", fn);

  napi_create_function(env, NULL, 0, test_async_close_with_send_pending, NULL,
                       &fn);
  napi_set_named_property(env, exports, "testAsyncCloseWithSendPending", fn);

  napi_create_function(env, NULL, 0, test_async_stress, NULL, &fn);
  napi_set_named_property(env, exports, "testAsyncStress", fn);

  napi_create_function(env, NULL, 0, start_async_flood, NULL, &fn);
  napi_set_named_property(env, exports, "startAsyncFlood", fn);

  napi_create_function(env, NULL, 0, stop_async_flood, NULL, &fn);
  napi_set_named_property(env, exports, "stopAsyncFlood", fn);

  napi_create_function(env, NULL, 0, test_async_ref, NULL, &fn);
  napi_set_named_property(env, exports, "testAsyncRef", fn);

  napi_create_function(env, NULL, 0, test_queue_work, NULL, &fn);
  napi_set_named_property(env, exports, "testQueueWork", fn);

  napi_create_function(env, NULL, 0, test_cancel_work, NULL, &fn);
  napi_set_named_property(env, exports, "testCancelWork", fn);

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

  napi_create_function(env, NULL, 0, test_udp_echo, NULL, &fn);
  napi_set_named_property(env, exports, "testUdpEcho", fn);

  napi_create_function(env, NULL, 0, test_udp_stop_in_alloc, NULL, &fn);
  napi_set_named_property(env, exports, "testUdpStopInAlloc", fn);

  napi_create_function(env, NULL, 0, test_udp_close_cancels, NULL, &fn);
  napi_set_named_property(env, exports, "testUdpCloseCancels", fn);

  napi_create_function(env, NULL, 0, test_udp_errors, NULL, &fn);
  napi_set_named_property(env, exports, "testUdpErrors", fn);

  napi_create_function(env, NULL, 0, test_udp_unref, NULL, &fn);
  napi_set_named_property(env, exports, "testUdpUnref", fn);

  napi_create_function(env, NULL, 0, test_error_names, NULL, &fn);
  napi_set_named_property(env, exports, "testErrorNames", fn);

  napi_create_function(env, NULL, 0, test_ip_addresses, NULL, &fn);
  napi_set_named_property(env, exports, "testIpAddresses", fn);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

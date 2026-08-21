#include <node_api.h>

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
// The loop-backed functions: uv_default_loop, the uv_async_t, uv_idle_t,
// uv_prepare_t, uv_check_t and uv_timer_t handles, uv_queue_work, and the
// header-only helpers around them. Every test below reports back through
// a JS callback `(event, a, b)` so the test can see the order of the
// callbacks, and which thread and loop turn they ran on. The tests run these
// in a child process: on a bun whose uv_* are still stubs they abort it.
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

// Calls the JS callback. The status of the call is ignored on purpose: one
// test makes the callback throw, to check the exception surfaces as uncaught.
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

// testVersion(): { version, versionString }
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

// testSizesAndNames(): the sizeof table and type names from the headers this
// addon was compiled against, which is what an addon relies on when it
// allocates handles dynamically.
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

// testOsfhandle(fd): uv_open_osfhandle(uv_get_osfhandle(fd)), the identity
// on unix.
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

// testLoops(): how the loops relate. On the main thread the loop
// napi_get_uv_event_loop returns is uv_default_loop(); in a Worker it is the
// Worker's own. uv_default_loop() is the same loop from any thread, and its
// `data` slot belongs to the addon.
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

// testErrors(): the argument errors, all UV_EINVAL (see uv.test.ts for the
// list). The two handles it initialises are closed again so that the process
// exits; they are static because a handle must outlive its close.
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
      // Never started, so there is nothing to repeat.
      uv_timer_again(&errors_timer),
      // A handle of another type.
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
    // A send from inside the callback must produce another callback.
    uv_async_send(handle);
    return;
  }
  uv_close((uv_handle_t *)handle, async_test_close_cb);
  // Closing is immediate, the callback is not.
  report(&test->reporter, "closing", uv_is_closing((uv_handle_t *)handle),
         uv_is_active((uv_handle_t *)handle));
}

static void *send_after_a_while(void *arg) {
  usleep(30 * 1000);
  uv_async_send(arg);
  return NULL;
}

// uv_async_init, as a thrown error when it fails so that a test fails there
// and not on the events the uninitialised handle would then produce.
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

// testAsync(useDefaultLoop, sendFromThread, callback): events
//   async 1 1      first callback; the three sends coalesced into it
//   async 2 1      the callback's own send
//   closing 1 0    right after uv_close
//   close 1 1      the deferred close callback
// The script that calls this returns right away: the ref'd handle is the
// only thing keeping the process alive until the events have happened.
// Returns [is_active, is_closing, has_ref] as observed right after init.
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
    napi_throw_error(env, NULL, "uv_async_init did not set the handle up");
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

// testAsyncCloseWithSendPending(callback): a handle that is sent and then
// closed before the loop turns gets its close callback and nothing else, and
// so does one that is sent again after uv_close (allowed until close_cb).
// Returns [is_active, is_closing, send after close] as observed right after
// uv_close.
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

// --- a thread and the loop thread taking turns, then racing ------------------

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
  // Each round is one send and one callback: a send after the dispatch took
  // the previous one must wake the loop again. A lost wakeup hangs here, and
  // the test times out.
  for (int round = 1; round <= STRESS_ROUNDS; round++) {
    uv_async_send(&test->handle);
    while (atomic_load(&test->callbacks) < round)
      sched_yield();
  }
  // The pending flag was cleared before the last round's callback ran, so
  // these produce exactly one more callback, which closes the handle; the
  // rest land while it is closing or after uv_close, which is allowed until
  // close_cb has run. close_cb joins this thread before it frees the handle.
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

// testAsyncStress(callback): event `done <STRESS_ROUNDS + 1> 1`. Exactly one
// callback per round, and one for the burst, which closes the handle.
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

static uv_async_t unref_test_handle;

// testAsyncRef(): uv_ref / uv_unref are idempotent toggles; returns
// uv_has_ref after each step. Leaves the handle open and unref'd, so the
// process must exit although the handle is never closed.
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
  // The script has returned by now; the request must keep the process alive.
  usleep(20 * 1000);
}

// Reports "after" with the status and a bit set per property that held:
//   1 work_cb ran                  2 work_cb ran off the loop thread
//   4 after_work_cb is on the loop thread
//   8 data survived                16 req->loop is the loop it was queued on
//   32 uv_req_get_type says UV_WORK
//   64 uv_cancel of a finished request is UV_EBUSY
static void work_test_after_work_cb(uv_work_t *req, int status) {
  struct work_test *test = uv_req_get_data((uv_req_t *)req);
  uv_loop_t *loop = NULL;
  napi_get_uv_event_loop(test->reporter.env, &loop);
  int32_t held = 0;
  if (test->work_ran)
    held |= 1;
  if (test->work_ran_off_the_loop_thread)
    held |= 2;
  if (pthread_equal(pthread_self(), test->loop_thread))
    held |= 4;
  if (req->data == test)
    held |= 8;
  if (req->loop == loop)
    held |= 16;
  if (uv_req_get_type((uv_req_t *)req) == UV_WORK)
    held |= 32;
  if (uv_cancel((uv_req_t *)req) == UV_EBUSY)
    held |= 64;
  report(&test->reporter, "after", status, held);
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

// testQueueWork(callback): events
//   after 0 127
static napi_value test_queue_work(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  queue_work(env, args[0]);
  return NULL;
}

// testCancelWork(callback): queues work and cancels it at once. Returns what
// uv_cancel said: 0 when the request was still queued (the event is then
// `after UV_ECANCELED` with the work_cb bits clear), UV_EBUSY when a pool
// thread had already taken it (then `after 0` with the work_cb bits set).
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

// Reports "close <type name>": the name comes from the type the init stored.
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

// Called from inside a check callback: closes the handles from within the
// walk over them, the check handle itself included.
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

// testLoopWatchers(callback): an idle, a prepare and a check handle. The idle
// handle counts the iterations, and it is what keeps the poll from blocking:
// nothing else would wake the loop. Every iteration runs the three in libuv's
// order; the check callback of the second iteration closes all three. Events:
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

// testPrepareAndCheckAroundIo(callback): a prepare and a check handle and no
// idle handle, so between the two the loop blocks in its poll until I/O
// arrives. The script does some socket I/O and calls requestClose() from its
// I/O callback. That callback runs inside the poll, so it lands between the
// prepare and the check event of one iteration, and the check callback of
// that iteration closes both handles.
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

// testWatcherStates(): the start/stop state machine, observed synchronously.
// Both handles are closed before the loop turns, so no callback ever runs and
// the process exits; the started idle handle would otherwise spin forever.
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
  // A one-shot timer is stopped by the time its callback runs, as in libuv.
  report(&test->reporter, "timer", uv_is_active((uv_handle_t *)handle),
         (int32_t)uv_timer_get_due_in(handle));
  uv_close((uv_handle_t *)handle, timer_test_close_cb);
}

// testTimer(callback): a 10ms one-shot timer. The script returns at once; the
// timer keeps the process alive until it fires. Events `timer 0 0`, then
// `close timer 1 0`. Returns the state right after the start.
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
  // A repeating timer is armed again by the time its callback runs.
  report(&test->reporter, "repeat", test->fires,
         uv_is_active((uv_handle_t *)handle));
  if (test->fires < 3)
    return;
  uv_timer_stop(handle);
  report(&test->reporter, "stopped", uv_is_active((uv_handle_t *)handle),
         (int32_t)uv_timer_get_repeat(handle));
  uv_close((uv_handle_t *)handle, timer_test_close_cb);
}

// testTimerRepeat(callback): timeout 1ms, repeat 1ms. Events `repeat 1 1`,
// `repeat 2 1`, `repeat 3 1`, `stopped 0 1`, `close timer 1 0`.
static napi_value test_timer_repeat(napi_env env, napi_callback_info info) {
  napi_value args[1];
  get_args(env, info, args, 1);
  struct timer_test *test = init_timer(env, args[0]);
  if (test == NULL)
    return NULL;
  uv_timer_start(&test->handle, timer_repeat_cb, 1, 1);
  return timer_state(env, test);
}

// testTimerAgain(callback): a timer started to fire in an hour gets a 1ms
// repeat and uv_timer_again, which restarts it with the repeat: the events
// are testTimerRepeat's. Returns { dueInBefore, again, dueInAfter, repeat }.
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

// testTimerRestart(callback): a started one-hour timer restarted as a 10ms
// one: uv_timer_start on a started timer reschedules it, so the events are
// testTimer's. Returns the state after the restart.
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

// testTimerClosedBeforeItFires(callback): a started one-hour timer that is
// closed at once. The only event is `close timer 1 0`, and the process exits.
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
  // Allowed until close_cb has run; none of these may start it again.
  uv_timer_start(&test->handle, timer_once_cb, 0, 0);
  uv_timer_again(&test->handle);
  uv_timer_stop(&test->handle);
  return timer_state(env, test);
}

static void timer_unref_cb(uv_timer_t *handle) {
  struct timer_test *test = handle->data;
  report(&test->reporter, "fired", 0, 0);
}

// testTimerUnref(callback): a started one-hour timer that is unref'd. The
// process must exit although the timer is never stopped or closed, so `fired`
// is never reported. Returns the state after the unref.
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

// testNow(): uv_now advances while the process spins for 5ms of uv_hrtime.
// Returns { nowIsPositive, advancedMs }.
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

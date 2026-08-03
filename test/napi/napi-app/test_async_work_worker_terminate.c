#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
static void sleep_ms(unsigned ms) { Sleep(ms); }
#else
#include <unistd.h>
static void sleep_ms(unsigned ms) { usleep(ms * 1000); }
#endif

#define CHECK(env, call)                                                       \
  do {                                                                         \
    napi_status s_ = (call);                                                   \
    if (s_ != napi_ok) {                                                       \
      napi_throw_error((env), NULL, #call " failed");                          \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

typedef struct {
  napi_async_work work;
  napi_ref buf_ref;
  napi_ref cb_ref;
  unsigned char *data;
  size_t len;
  unsigned sleep_ms;
} work_t;

static void exec_cb(napi_env env, void *arg) {
  work_t *w = (work_t *)arg;
  sleep_ms(w->sleep_ms);
  // Touch the ArrayBuffer backing store. Before the fix, worker.terminate()
  // could free it (via JSC VM teardown running the ArrayBuffer finalizer)
  // while this callback is still running on the pool thread.
  if (w->len > 0) {
    volatile unsigned char first = w->data[0];
    (void)first;
    memset(w->data, 0xab, w->len);
  }
}

static void done_cb(napi_env env, napi_status status, void *arg) {
  work_t *w = (work_t *)arg;
  napi_value cb = NULL, undef = NULL, argv[1];
  if (w->cb_ref != NULL) {
    napi_get_reference_value(env, w->cb_ref, &cb);
  }
  napi_get_undefined(env, &undef);
  napi_create_int32(env, (int)status, &argv[0]);
  if (cb != NULL) {
    napi_call_function(env, undef, cb, 1, argv, NULL);
  }
  napi_delete_reference(env, w->buf_ref);
  if (w->cb_ref != NULL) napi_delete_reference(env, w->cb_ref);
  napi_delete_async_work(env, w->work);
  free(w);
}

// queueWork(arrayBuffer, ms[, cb]) -> undefined
static napi_value queue_work(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  CHECK(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 2) {
    napi_throw_error(env, NULL, "expected (arrayBuffer, ms[, cb])");
    return NULL;
  }

  work_t *w = (work_t *)calloc(1, sizeof(*w));

  void *data = NULL;
  size_t len = 0;
  CHECK(env, napi_get_arraybuffer_info(env, argv[0], &data, &len));
  w->data = (unsigned char *)data;
  w->len = len;

  int32_t ms = 0;
  CHECK(env, napi_get_value_int32(env, argv[1], &ms));
  w->sleep_ms = (unsigned)(ms < 0 ? 0 : ms);

  CHECK(env, napi_create_reference(env, argv[0], 1, &w->buf_ref));
  if (argc >= 3) {
    napi_valuetype t;
    CHECK(env, napi_typeof(env, argv[2], &t));
    if (t == napi_function) {
      CHECK(env, napi_create_reference(env, argv[2], 1, &w->cb_ref));
    }
  }

  napi_value name;
  CHECK(env, napi_create_string_utf8(env, "test_async_work_worker_terminate",
                                     NAPI_AUTO_LENGTH, &name));
  CHECK(env, napi_create_async_work(env, NULL, name, exec_cb, done_cb, w,
                                    &w->work));
  CHECK(env, napi_queue_async_work(env, w->work));

  napi_value undef;
  CHECK(env, napi_get_undefined(env, &undef));
  return undef;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  CHECK(env, napi_create_function(env, "queueWork", NAPI_AUTO_LENGTH,
                                  queue_work, NULL, &fn));
  CHECK(env, napi_set_named_property(env, exports, "queueWork", fn));
  return exports;
}

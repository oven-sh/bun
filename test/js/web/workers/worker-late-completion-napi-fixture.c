// The napi rows of worker-late-completion.test.ts. Built against Bun's own
// N-API headers as a NAPI_VERSION_EXPERIMENTAL addon, so its finalizers run
// inline during garbage collection (including the collection that destroys
// the worker's heap) and only the basic-env subset of the API is allowed there;
// napi_queue_async_work is in that subset. Every entry point starts one
// napi_async_work at a different point in the worker's life, and every work
// reports the status its `complete` callback is eventually handed.
#define NAPI_EXPERIMENTAL
#include <node_api.h>
#include <stdio.h>

typedef struct Work {
  const char *name;
  napi_async_work work;
  // Queued by this work's `complete`, i.e. while the worker is already
  // tearing down (queueFromComplete).
  struct Work *then;
} Work;

static Work first = {"first", NULL, NULL};
static Work second = {"second", NULL, NULL};
static Work late = {"late", NULL, NULL};

static void report(const char *what, const Work *w, napi_status status) {
  const char *name = status == napi_ok              ? "ok"
                     : status == napi_cancelled     ? "cancelled"
                     : status == napi_cannot_run_js ? "cannot run js"
                                                    : "unexpected status";
  printf("%s %s: %s\n", what, w->name, name);
  fflush(stdout);
}

static void execute(napi_env env, void *data) {
  (void)env;
  (void)data;
}

static void complete(napi_env env, napi_status status, void *data) {
  Work *w = data;
  report("complete", w, status);
  if (w->then != NULL) {
    report("queued from complete", w->then,
           napi_queue_async_work(env, w->then->work));
  }
  napi_delete_async_work(env, w->work);
}

static void create(napi_env env, Work *w) {
  napi_value name;
  napi_create_string_utf8(env, w->name, NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, execute, complete, w, &w->work);
}

// The ordinary path: queued while the worker runs. The completion comes back
// from the pool during the teardown's wait and is released there.
static napi_value queue(napi_env env, napi_callback_info info) {
  (void)info;
  create(env, &first);
  report("queued", &first, napi_queue_async_work(env, first.work));
  return NULL;
}

// `first` completes during the wait; its `complete` then queues `second`.
static napi_value queue_from_complete(napi_env env, napi_callback_info info) {
  create(env, &second);
  first.then = &second;
  return queue(env, info);
}

// Runs during the collection that destroys the heap, after the wait is over:
// the worker keeps the external reachable until it exits. The work itself is
// created up front because napi_create_async_work is not a basic-env API.
// Refused work is still the addon's; deleting it here (a plain free in Bun,
// though the API is not declared basic, hence the cast) keeps the leak
// checker quiet.
static void finalize(node_api_basic_env env, void *data, void *hint) {
  (void)hint;
  Work *w = data;
  napi_status status = napi_queue_async_work(env, w->work);
  report("queued from finalizer", w, status);
  if (status != napi_ok) {
    napi_delete_async_work((napi_env)env, w->work);
  }
}

static napi_value queue_from_finalizer(napi_env env, napi_callback_info info) {
  (void)info;
  create(env, &late);
  napi_value external;
  napi_create_external(env, &late, finalize, NULL, &external);
  return external;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor props[] = {
      {"queue", NULL, queue, NULL, NULL, NULL, napi_default, NULL},
      {"queueFromComplete", NULL, queue_from_complete, NULL, NULL, NULL,
       napi_default, NULL},
      {"queueFromFinalizer", NULL, queue_from_finalizer, NULL, NULL, NULL,
       napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]),
                         props);
  return exports;
}

// Built twice: as a regular module, and with NAPI_EXPERIMENTAL. In an
// experimental module the finalizers of externals, wraps and
// napi_add_finalizer run inside the collection, and node_api_post_finalizer
// exists.
//
// The addon keeps its state in napi_set_instance_data and reads it from every
// callback, as an addon written with node-addon-api does. The instance data
// finalizer prints what ran before it. A callback that runs after it prints a
// line of its own. After reportEveryCallback(), every callback prints a line
// when it runs.
#include <node_api.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

// MSVC has no <stdatomic.h> in its default C mode.
#ifdef _WIN32
#include <windows.h>
typedef volatile LONG atomic_count;
static void count_add(atomic_count *count) { InterlockedIncrement(count); }
static int count_get(atomic_count *count) {
  return (int)InterlockedCompareExchange(count, 0, 0);
}
#else
typedef int atomic_count;
static void count_add(atomic_count *count) {
  __atomic_fetch_add(count, 1, __ATOMIC_SEQ_CST);
}
static int count_get(atomic_count *count) {
  return __atomic_load_n(count, __ATOMIC_SEQ_CST);
}
#endif

enum kind {
  kind_external,
  kind_wrap,
  kind_wrap_ref,
  kind_add_finalizer,
  kind_add_finalizer_ref,
  kind_external_buffer,
  kind_empty_external_buffer,
  kind_external_arraybuffer,
  kind_posted,
  kind_count,
};

static const char *const kind_names[kind_count] = {
    "external",
    "wrap",
    "wrap_ref",
    "add_finalizer",
    "add_finalizer_ref",
    "external_buffer",
    "empty_external_buffer",
    "external_arraybuffer",
    "posted",
};

struct work {
  napi_async_work handle;
  // Set by the thread pool.
  atomic_count executed;
};

struct closing_handle {
  uv_async_t handle;
  napi_env env;
};

// The callbacks that callFunctionFromCallbacks() makes call into JavaScript.
enum caller {
  caller_finalizer,
  caller_complete,
  caller_uv_close,
  caller_count,
};

static const char *const caller_names[caller_count] = {
    "a finalizer",
    "complete",
    "a uv close callback",
};

// The instance data.
struct state {
  int created[kind_count];
  int finalized[kind_count];
  struct work *work;
  bool queued_work;
  bool completed_work;
  bool closing_uv_handle;
  bool closed_uv_handle;
  bool report_every_callback;
  // callFunctionFromCallbacks(): the function, and the status of each call.
  napi_ref function;
  bool called[caller_count];
  int call_status[caller_count];
  // createThreadsafeFunction()
  napi_threadsafe_function threadsafe_function;
  int queued_calls;
  int delivered_calls;
  // callThreadsafeFunctionInFinalizer()
  bool called_in_finalizer;
  int status_in_finalizer;
};

// What a finalize callback gets: as `data`, or as `hint` when `data` is the
// bytes of an external buffer.
struct value {
  enum kind kind;
  // wrap_ref, add_finalizer_ref: the finalizer deletes the reference.
  napi_ref ref;
  // closeUvHandleInFinalizer(): the finalizer closes it.
  struct closing_handle *closing;
  // postChain(): how many more finalizers the finalizer posts, one after the
  // other.
  int chain;
  // createWrapThatPosts(): the finalizer posts one finalizer.
  bool posts;
  // callThreadsafeFunctionInFinalizer(): the finalizer calls the function.
  bool calls_threadsafe_function;
  char bytes[8];
};

static void uv_handle_closed(uv_handle_t *handle);
#ifdef NAPI_EXPERIMENTAL
static void finalize_posted(napi_env env, void *data, void *hint);
#endif

static void report(struct state *state, const char *line) {
  if (state->report_every_callback) {
    printf("%s\n", line);
    fflush(stdout);
  }
}

// Calls the function of callFunctionFromCallbacks(), and keeps the status.
static void call_function(napi_env env, struct state *state,
                          enum caller caller) {
  if (!state->function) {
    return;
  }
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  napi_value function;
  napi_value receiver;
  napi_get_reference_value(env, state->function, &function);
  napi_get_undefined(env, &receiver);
  state->called[caller] = true;
  state->call_status[caller] =
      (int)napi_call_function(env, receiver, function, 0, NULL, NULL);
  napi_close_handle_scope(env, scope);
}

// The finalizer of a value. An experimental module gets a node_api_basic_env
// here, and the functions below accept it.
static void finalize(node_api_basic_env env, void *data, void *hint) {
  struct value *value = hint ? hint : data;
  struct state *state = NULL;
  napi_get_instance_data(env, (void **)&state);
  if (state) {
    state->finalized[value->kind]++;
    if (state->report_every_callback) {
      printf("%s finalizer ran\n", kind_names[value->kind]);
      fflush(stdout);
    }
#ifndef NAPI_EXPERIMENTAL
    call_function(env, state, caller_finalizer);
#endif
    if (value->calls_threadsafe_function) {
      state->called_in_finalizer = true;
      state->status_in_finalizer = (int)napi_call_threadsafe_function(
          state->threadsafe_function, NULL, napi_tsfn_nonblocking);
      if (state->status_in_finalizer == napi_ok) {
        state->queued_calls++;
      }
      napi_release_threadsafe_function(state->threadsafe_function,
                                       napi_tsfn_release);
    }
  } else {
    printf("%s finalized after the instance data finalizer\n",
           kind_names[value->kind]);
    fflush(stdout);
  }
  if (value->ref) {
    napi_delete_reference(env, value->ref);
  }
  if (value->closing) {
    uv_close((uv_handle_t *)&value->closing->handle, uv_handle_closed);
  }
#ifdef NAPI_EXPERIMENTAL
  if (value->posts) {
    struct value *posted = calloc(1, sizeof(*posted));
    posted->kind = kind_posted;
    node_api_post_finalizer(env, finalize_posted, posted, NULL);
    if (state) {
      state->created[kind_posted]++;
    }
  }
#endif
  free(value);
}

#ifdef NAPI_EXPERIMENTAL
static void finalize_posted(napi_env env, void *data, void *hint) {
  struct value *value = data;
  if (value->chain > 0) {
    struct value *next = calloc(1, sizeof(*next));
    next->kind = kind_posted;
    next->chain = value->chain - 1;
    node_api_post_finalizer(env, finalize_posted, next, NULL);
  }
  finalize(env, data, hint);
}
#endif

static void finalize_instance_data(napi_env env, void *data, void *hint) {
  struct state *state = data;
  for (int kind = 0; kind < kind_count; kind++) {
    if (state->created[kind]) {
      printf("%s: %d of %d finalized before the instance data finalizer\n",
             kind_names[kind], state->finalized[kind], state->created[kind]);
    }
  }
  if (state->queued_work) {
    printf("async work: %s before the instance data finalizer\n",
           state->completed_work ? "completed" : "not completed");
  }
  if (state->closing_uv_handle) {
    printf("uv handle: %s before the instance data finalizer\n",
           state->closed_uv_handle ? "closed" : "not closed");
  }
  if (state->queued_calls) {
    printf("threadsafe function: %d of %d calls delivered before the instance "
           "data finalizer\n",
           state->delivered_calls, state->queued_calls);
  }
  if (state->called_in_finalizer) {
    printf("threadsafe function: the call from a finalizer returned %d\n",
           state->status_in_finalizer);
  }
  for (int caller = 0; caller < caller_count; caller++) {
    if (state->called[caller]) {
      printf("a call into JavaScript from %s returned %d\n",
             caller_names[caller], state->call_status[caller]);
    }
  }
  fflush(stdout);
  if (state->function) {
    napi_delete_reference(env, state->function);
  }
  free(state);
}

static void cleanup_hook(void *data) {
  struct state *state = data;
  int created = 0;
  int finalized = 0;
  for (int kind = 0; kind < kind_count; kind++) {
    created += state->created[kind];
    finalized += state->finalized[kind];
  }
  if (created) {
    printf("cleanup hook: %d of %d values finalized before it\n", finalized,
           created);
  }
  if (state->queued_work) {
    printf("cleanup hook: async work %s before it\n",
           state->completed_work ? "completed" : "not completed");
  }
  if (state->closing_uv_handle) {
    printf("cleanup hook: uv handle %s before it\n",
           state->closed_uv_handle ? "closed" : "not closed");
  }
  if (state->queued_calls) {
    printf("cleanup hook: %d of %d threadsafe function calls delivered before "
           "it\n",
           state->delivered_calls, state->queued_calls);
  }
  fflush(stdout);
}

static struct state *get_state(napi_env env) {
  struct state *state = NULL;
  napi_get_instance_data(env, (void **)&state);
  return state;
}

// Returns NULL, with an exception pending, if the value cannot be created.
static napi_value create_value(napi_env env, int kind, struct value *value) {
  value->kind = (enum kind)kind;
  napi_value result = NULL;
  napi_status status = napi_generic_failure;
  switch (value->kind) {
  case kind_external:
    status = napi_create_external(env, value, finalize, NULL, &result);
    break;
  case kind_wrap:
    napi_create_object(env, &result);
    status = napi_wrap(env, result, value, finalize, NULL, NULL);
    break;
  case kind_wrap_ref:
    napi_create_object(env, &result);
    status = napi_wrap(env, result, value, finalize, NULL, &value->ref);
    break;
  case kind_add_finalizer:
    napi_create_object(env, &result);
    status = napi_add_finalizer(env, result, value, finalize, NULL, NULL);
    break;
  case kind_add_finalizer_ref:
    napi_create_object(env, &result);
    status =
        napi_add_finalizer(env, result, value, finalize, NULL, &value->ref);
    break;
  case kind_external_buffer:
    status = napi_create_external_buffer(
        env, sizeof(value->bytes), value->bytes, finalize, value, &result);
    break;
  case kind_empty_external_buffer:
    status =
        napi_create_external_buffer(env, 0, NULL, finalize, value, &result);
    break;
  case kind_external_arraybuffer:
    status = napi_create_external_arraybuffer(
        env, value->bytes, sizeof(value->bytes), finalize, value, &result);
    break;
  default:
    break;
  }
  if (status != napi_ok) {
    free(value);
    napi_throw_error(env, NULL, "could not create the value");
    return NULL;
  }
  get_state(env)->created[kind]++;
  return result;
}

// create(kind: string, count: number): object[]
static napi_value create(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  char name[64];
  size_t name_length = 0;
  napi_get_value_string_utf8(env, argv[0], name, sizeof(name), &name_length);
  uint32_t count = 0;
  napi_get_value_uint32(env, argv[1], &count);

  int kind = 0;
  while (kind < kind_count && strcmp(kind_names[kind], name) != 0) {
    kind++;
  }
  if (kind == kind_count || kind == kind_posted) {
    napi_throw_error(env, NULL, "unknown kind");
    return NULL;
  }

  napi_value array;
  napi_create_array_with_length(env, count, &array);
  for (uint32_t i = 0; i < count; i++) {
    napi_value result =
        create_value(env, kind, calloc(1, sizeof(struct value)));
    if (!result) {
      return NULL;
    }
    napi_set_element(env, array, i, result);
  }
  return array;
}

// reportCleanupHook(): the env's cleanup hook prints what ran before it.
static napi_value report_cleanup_hook(napi_env env, napi_callback_info info) {
  napi_add_env_cleanup_hook(env, cleanup_hook, get_state(env));
  return NULL;
}

// reportEveryCallback(): every callback prints a line when it runs.
static napi_value report_every_callback(napi_env env, napi_callback_info info) {
  get_state(env)->report_every_callback = true;
  return NULL;
}

// callFunctionFromCallbacks(function): the finalizers, complete and the uv
// close callback call `function`. The instance data finalizer prints the
// status of each call.
static napi_value call_function_from_callbacks(napi_env env,
                                               napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  napi_create_reference(env, argv[0], 1, &get_state(env)->function);
  return NULL;
}

static void execute(napi_env env, void *data) {
  struct work *work = data;
  count_add(&work->executed);
}

static void complete(napi_env env, napi_status status, void *data) {
  struct work *work = data;
  struct state *state = get_state(env);
  if (state) {
    state->completed_work = true;
    state->work = NULL;
    report(state, "async work: complete ran");
    call_function(env, state, caller_complete);
  } else {
    printf("async work completed after the instance data finalizer\n");
    fflush(stdout);
  }
  napi_delete_async_work(env, work->handle);
  free(work);
}

// queueWork(): queues async work. workExecuted() says when its execute
// callback has run.
static napi_value queue_work(napi_env env, napi_callback_info info) {
  struct state *state = get_state(env);
  struct work *work = calloc(1, sizeof(*work));
  napi_value name;
  napi_create_string_utf8(env, "work", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, execute, complete, work,
                         &work->handle);
  napi_queue_async_work(env, work->handle);
  state->work = work;
  state->queued_work = true;
  return NULL;
}

static napi_value work_executed(napi_env env, napi_callback_info info) {
  struct state *state = get_state(env);
  napi_value result;
  napi_get_boolean(env, state->work && count_get(&state->work->executed),
                   &result);
  return result;
}

static void uv_handle_closed(uv_handle_t *handle) {
  struct closing_handle *closing = handle->data;
  struct state *state = get_state(closing->env);
  if (state) {
    state->closed_uv_handle = true;
    report(state, "uv handle: close callback ran");
    call_function(closing->env, state, caller_uv_close);
  } else {
    printf("uv handle closed after the instance data finalizer\n");
    fflush(stdout);
  }
  free(closing);
}

static void uv_async_unused(uv_async_t *handle) {}

static struct closing_handle *create_uv_handle(napi_env env) {
  struct closing_handle *closing = calloc(1, sizeof(*closing));
  closing->env = env;
  uv_loop_t *loop = NULL;
  napi_get_uv_event_loop(env, &loop);
  uv_async_init(loop, &closing->handle, uv_async_unused);
  closing->handle.data = closing;
  get_state(env)->closing_uv_handle = true;
  return closing;
}

// closeUvHandle(): closes a uv handle. Its close callback runs on a later turn
// of the loop.
static napi_value close_uv_handle(napi_env env, napi_callback_info info) {
  uv_close((uv_handle_t *)&create_uv_handle(env)->handle, uv_handle_closed);
  return NULL;
}

// closeUvHandleInFinalizer(): an external whose finalizer closes a uv handle.
static napi_value close_uv_handle_in_finalizer(napi_env env,
                                               napi_callback_info info) {
  struct value *value = calloc(1, sizeof(*value));
  value->closing = create_uv_handle(env);
  // The handle must not keep the loop alive.
  uv_unref((uv_handle_t *)&value->closing->handle);
  return create_value(env, kind_external, value);
}

static void call_js(napi_env env, napi_value js_callback, void *context,
                    void *data) {
  struct state *state = env ? get_state(env) : NULL;
  if (state) {
    state->delivered_calls++;
    report(state, "threadsafe function: call ran");
  } else {
    printf("threadsafe function called %s\n",
           env ? "after the instance data finalizer" : "without an env");
    fflush(stdout);
  }
}

// createThreadsafeFunction(): the function does not keep the loop alive. The
// addon holds one reference to it, which callThreadsafeFunction() or the
// finalizer of callThreadsafeFunctionInFinalizer() releases.
static napi_value create_threadsafe_function(napi_env env,
                                             napi_callback_info info) {
  struct state *state = get_state(env);
  napi_value name;
  napi_create_string_utf8(env, "calls", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, NULL, NULL, NULL,
                                  call_js, &state->threadsafe_function);
  napi_unref_threadsafe_function(env, state->threadsafe_function);
  return NULL;
}

// callThreadsafeFunction(count: number): queues `count` calls.
static napi_value call_threadsafe_function(napi_env env,
                                           napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  uint32_t count = 0;
  napi_get_value_uint32(env, argv[0], &count);
  struct state *state = get_state(env);
  for (uint32_t i = 0; i < count; i++) {
    napi_call_threadsafe_function(state->threadsafe_function, NULL,
                                  napi_tsfn_nonblocking);
    state->queued_calls++;
  }
  napi_release_threadsafe_function(state->threadsafe_function,
                                   napi_tsfn_release);
  return NULL;
}

// callThreadsafeFunctionInFinalizer(): an external whose finalizer calls the
// threadsafe function.
static napi_value
call_threadsafe_function_in_finalizer(napi_env env, napi_callback_info info) {
  struct value *value = calloc(1, sizeof(*value));
  value->calls_threadsafe_function = true;
  return create_value(env, kind_external, value);
}

#ifdef NAPI_EXPERIMENTAL
// createWrapThatPosts(): a wrapped object whose finalizer posts a finalizer.
static napi_value create_wrap_that_posts(napi_env env,
                                         napi_callback_info info) {
  struct value *value = calloc(1, sizeof(*value));
  value->posts = true;
  return create_value(env, kind_wrap, value);
}

// post(count: number): posts `count` finalizers with node_api_post_finalizer.
static napi_value post(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  uint32_t count = 0;
  napi_get_value_uint32(env, argv[0], &count);
  struct state *state = get_state(env);
  for (uint32_t i = 0; i < count; i++) {
    struct value *value = calloc(1, sizeof(*value));
    value->kind = kind_posted;
    node_api_post_finalizer(env, finalize_posted, value, NULL);
    state->created[kind_posted]++;
  }
  return NULL;
}

// postChain(length: number): posts a finalizer that posts the next one, until
// `length` finalizers have run.
static napi_value post_chain(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  uint32_t length = 0;
  napi_get_value_uint32(env, argv[0], &length);
  if (length == 0) {
    return NULL;
  }
  struct value *value = calloc(1, sizeof(*value));
  value->kind = kind_posted;
  value->chain = (int)length - 1;
  node_api_post_finalizer(env, finalize_posted, value, NULL);
  get_state(env)->created[kind_posted] += (int)length;
  return NULL;
}
#endif

static void export_function(napi_env env, napi_value exports, const char *name,
                            napi_callback callback) {
  napi_value function;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, NULL, &function);
  napi_set_named_property(env, exports, name, function);
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  struct state *state = calloc(1, sizeof(*state));
  napi_set_instance_data(env, state, finalize_instance_data, NULL);
  export_function(env, exports, "create", create);
  export_function(env, exports, "reportCleanupHook", report_cleanup_hook);
  export_function(env, exports, "reportEveryCallback", report_every_callback);
  export_function(env, exports, "callFunctionFromCallbacks",
                  call_function_from_callbacks);
  export_function(env, exports, "queueWork", queue_work);
  export_function(env, exports, "workExecuted", work_executed);
  export_function(env, exports, "closeUvHandle", close_uv_handle);
  export_function(env, exports, "closeUvHandleInFinalizer",
                  close_uv_handle_in_finalizer);
  export_function(env, exports, "createThreadsafeFunction",
                  create_threadsafe_function);
  export_function(env, exports, "callThreadsafeFunction",
                  call_threadsafe_function);
  export_function(env, exports, "callThreadsafeFunctionInFinalizer",
                  call_threadsafe_function_in_finalizer);
#ifdef NAPI_EXPERIMENTAL
  export_function(env, exports, "createWrapThatPosts", create_wrap_that_posts);
  export_function(env, exports, "post", post);
  export_function(env, exports, "postChain", post_chain);
#endif
  return exports;
}

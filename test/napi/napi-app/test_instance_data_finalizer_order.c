// Built twice: as a regular module, and with NAPI_EXPERIMENTAL. In an
// experimental module the finalizers of externals, wraps and
// napi_add_finalizer run inside the collection, and node_api_post_finalizer
// exists.
//
// The addon keeps its state in napi_set_instance_data and reads it from every
// finalize callback and from the async work's complete callback, as an addon
// written with node-addon-api does. Node's env teardown runs the finalizers
// that a collection queued, then the finalizer of every value that is still
// alive, and the finalizer of the instance data set in the addon's init last.
// The instance data finalizer prints how many finalizers of each kind ran
// before it. A callback that runs after it prints a line of its own.
#include <node_api.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

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
  atomic_bool executed;
};

struct closing_handle {
  uv_async_t handle;
  napi_env env;
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
  bool post_from_instance_data_finalizer;
};

// The finalizers that ran in this process, for every env of the addon.
static atomic_int finalized_in_process;

// What a finalize callback gets: as `data`, or as `hint` when `data` is the
// bytes of an external buffer.
struct value {
  enum kind kind;
  // wrap_ref, add_finalizer_ref: the finalizer deletes the reference.
  napi_ref ref;
  char bytes[8];
};

// The finalizer of a value. An experimental module gets a node_api_basic_env
// here, and the functions below accept it.
static void finalize(node_api_basic_env env, void *data, void *hint) {
  struct value *value = hint ? hint : data;
  struct state *state = NULL;
  napi_get_instance_data(env, (void **)&state);
  atomic_fetch_add(&finalized_in_process, 1);
  if (state) {
    state->finalized[value->kind]++;
  } else {
    printf("%s finalized after the instance data finalizer\n",
           kind_names[value->kind]);
    fflush(stdout);
  }
  if (value->ref) {
    napi_delete_reference(env, value->ref);
  }
  free(value);
}

#ifdef NAPI_EXPERIMENTAL
static void finalize_posted(napi_env env, void *data, void *hint) {
  finalize(env, data, hint);
}

static void finalize_posted_by_instance_data_finalizer(napi_env env, void *data,
                                                        void *hint) {
  printf("the finalizer that the instance data finalizer posted ran\n");
  fflush(stdout);
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
  fflush(stdout);
#ifdef NAPI_EXPERIMENTAL
  if (state->post_from_instance_data_finalizer) {
    node_api_post_finalizer(env, finalize_posted_by_instance_data_finalizer,
                            NULL, NULL);
  }
#endif
  free(state);
}

static void cleanup_hook(void *data) {
  struct state *state = data;
  int finalized = 0;
  for (int kind = 0; kind < kind_count; kind++) {
    finalized += state->finalized[kind];
  }
  printf("cleanup hook: %s the finalizers of the collected values\n",
         finalized > 0 ? "after" : "before");
  fflush(stdout);
}

static struct state *get_state(napi_env env) {
  struct state *state = NULL;
  napi_get_instance_data(env, (void **)&state);
  return state;
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

  struct state *state = get_state(env);
  napi_value array;
  napi_create_array_with_length(env, count, &array);
  for (uint32_t i = 0; i < count; i++) {
    struct value *value = calloc(1, sizeof(*value));
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
      status = napi_create_external_buffer(env, sizeof(value->bytes),
                                           value->bytes, finalize, value,
                                           &result);
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
    state->created[kind]++;
    napi_set_element(env, array, i, result);
  }
  return array;
}

// reportCleanupHook(): the env's cleanup hook prints whether a finalizer ran
// before it.
static napi_value report_cleanup_hook(napi_env env, napi_callback_info info) {
  napi_add_env_cleanup_hook(env, cleanup_hook, get_state(env));
  return NULL;
}

// setInstanceDataAgain(): registers the same instance data a second time, so
// that it is newer than every value created so far.
static napi_value set_instance_data_again(napi_env env,
                                          napi_callback_info info) {
  napi_set_instance_data(env, get_state(env), finalize_instance_data, NULL);
  return NULL;
}

static void execute(napi_env env, void *data) {
  struct work *work = data;
  atomic_store(&work->executed, true);
}

static void complete(napi_env env, napi_status status, void *data) {
  struct work *work = data;
  struct state *state = get_state(env);
  if (state) {
    state->completed_work = true;
    state->work = NULL;
  } else {
    printf("async work completed after the instance data finalizer\n");
    fflush(stdout);
  }
  napi_delete_async_work(env, work->handle);
  free(work);
}

// queueWork(): queues async work. workExecuted() says when its execute
// callback has returned.
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
  napi_get_boolean(env, state->work && atomic_load(&state->work->executed),
                   &result);
  return result;
}

static void uv_handle_closed(uv_handle_t *handle) {
  struct closing_handle *closing = handle->data;
  struct state *state = get_state(closing->env);
  if (state) {
    state->closed_uv_handle = true;
  } else {
    printf("uv handle closed after the instance data finalizer\n");
    fflush(stdout);
  }
  free(closing);
}

static void uv_async_unused(uv_async_t *handle) {}

// closeUvHandle(): closes a uv handle. Its close callback runs on a later turn
// of the loop.
static napi_value close_uv_handle(napi_env env, napi_callback_info info) {
  struct closing_handle *closing = calloc(1, sizeof(*closing));
  closing->env = env;
  uv_loop_t *loop = NULL;
  napi_get_uv_event_loop(env, &loop);
  uv_async_init(loop, &closing->handle, uv_async_unused);
  closing->handle.data = closing;
  uv_close((uv_handle_t *)&closing->handle, uv_handle_closed);
  get_state(env)->closing_uv_handle = true;
  return NULL;
}

// finalizedInProcess(): number
static napi_value finalized_in_process_count(napi_env env,
                                             napi_callback_info info) {
  napi_value result;
  napi_create_int32(env, atomic_load(&finalized_in_process), &result);
  return result;
}

#ifdef NAPI_EXPERIMENTAL
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

// postFromInstanceDataFinalizer(): the instance data finalizer posts a
// finalizer.
static napi_value post_from_instance_data_finalizer(napi_env env,
                                                    napi_callback_info info) {
  get_state(env)->post_from_instance_data_finalizer = true;
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
  export_function(env, exports, "setInstanceDataAgain",
                  set_instance_data_again);
  export_function(env, exports, "queueWork", queue_work);
  export_function(env, exports, "workExecuted", work_executed);
  export_function(env, exports, "closeUvHandle", close_uv_handle);
  export_function(env, exports, "finalizedInProcess",
                  finalized_in_process_count);
#ifdef NAPI_EXPERIMENTAL
  export_function(env, exports, "post", post);
  export_function(env, exports, "postFromInstanceDataFinalizer",
                  post_from_instance_data_finalizer);
#endif
  return exports;
}

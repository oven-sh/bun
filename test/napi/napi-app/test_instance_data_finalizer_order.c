// Built as a regular module, and with NAPI_EXPERIMENTAL. In an experimental
// module the finalizers of externals, wraps and napi_add_finalizer run inside
// the collection, and node_api_post_finalizer exists. A third build, with
// NATIVE_BUNDLER_PLUGIN, is also a native plugin for Bun.build().
//
// The addon keeps its state in napi_set_instance_data and reads it from every
// callback, as an addon written with node-addon-api does. The instance data
// finalizer prints what ran before it. A callback that runs after it prints a
// line of its own.
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
static int count_add(atomic_count *count) {
  return (int)InterlockedIncrement(count);
}
static int count_get(atomic_count *count) {
  return (int)InterlockedCompareExchange(count, 0, 0);
}
#else
#include <unistd.h>
typedef int atomic_count;
static int count_add(atomic_count *count) {
  return __atomic_add_fetch(count, 1, __ATOMIC_SEQ_CST);
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

// The instance data.
struct state {
  int created[kind_count];
  int finalized[kind_count];
  // createInOrder(): the kinds, in the order of their finalizers.
  bool report_order;
  int order[64];
  int order_length;
  struct work *work;
  bool queued_work;
  bool completed_work;
  bool closing_uv_handle;
  bool closed_uv_handle;
  bool open_scope_in_instance_data_finalizer;
  bool post_from_instance_data_finalizer;
  bool holds_plugin;
};

#ifdef NATIVE_BUNDLER_PLUGIN
// What the native bundler plugin below shares with the env that holds it. It
// outlives the env, because a thread of the bundler reads it.
static struct {
  atomic_count entered;
  atomic_count released;
  atomic_count instance_data_finalized;
} plugin;
#endif

// The finalizers that ran in this process, for every env of the addon.
static atomic_count finalized_in_process;

// What a finalize callback gets: as `data`, or as `hint` when `data` is the
// bytes of an external buffer.
struct value {
  enum kind kind;
  // wrap_ref, add_finalizer_ref: the finalizer deletes the reference.
  napi_ref ref;
  // closeUvHandleInFinalizer(): the finalizer closes it.
  struct closing_handle *closing;
  // queueWorkInFinalizer(): the finalizer queues it.
  struct work *work;
  char bytes[8];
};

static void uv_handle_closed(uv_handle_t *handle);

// The finalizer of a value. An experimental module gets a node_api_basic_env
// here, and the functions below accept it.
static void finalize(node_api_basic_env env, void *data, void *hint) {
  struct value *value = hint ? hint : data;
  struct state *state = NULL;
  napi_get_instance_data(env, (void **)&state);
  count_add(&finalized_in_process);
  if (state) {
    state->finalized[value->kind]++;
    if (state->report_order && state->order_length < 64) {
      state->order[state->order_length++] = value->kind;
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
  if (value->work) {
    napi_status status = napi_queue_async_work(env, value->work->handle);
    if (status != napi_ok) {
      printf("napi_queue_async_work in a finalizer: status %d\n", (int)status);
      fflush(stdout);
    }
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
  if (state->report_order) {
    printf("order:");
    for (int i = 0; i < state->order_length; i++) {
      printf(" %s", kind_names[state->order[i]]);
    }
    printf("\n");
  }
  if (state->queued_work) {
    printf("async work: %s before the instance data finalizer\n",
           state->completed_work ? "completed" : "not completed");
  }
  if (state->closing_uv_handle) {
    printf("uv handle: %s before the instance data finalizer\n",
           state->closed_uv_handle ? "closed" : "not closed");
  }
  if (state->open_scope_in_instance_data_finalizer) {
    napi_escapable_handle_scope scope = NULL;
    napi_value object = NULL;
    napi_value escaped = NULL;
    napi_status open = napi_open_escapable_handle_scope(env, &scope);
    napi_create_object(env, &object);
    napi_status escape = napi_escape_handle(env, scope, object, &escaped);
    napi_status close = napi_close_escapable_handle_scope(env, scope);
    printf("escapable handle scope: open=%d escape=%d close=%d\n", (int)open,
           (int)escape, (int)close);
  }
  fflush(stdout);
#ifdef NAPI_EXPERIMENTAL
  if (state->post_from_instance_data_finalizer) {
    node_api_post_finalizer(env, finalize_posted_by_instance_data_finalizer,
                            NULL, NULL);
  }
#endif
#ifdef NATIVE_BUNDLER_PLUGIN
  if (state->holds_plugin) {
    count_add(&plugin.instance_data_finalized);
  }
#endif
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
    printf("cleanup hook: %s\n", finalized > 0 ? "after the queued finalizers"
                                               : "before every finalizer");
  }
  if (state->closing_uv_handle) {
    printf("cleanup hook: uv handle %s before it\n",
           state->closed_uv_handle ? "closed" : "not closed");
  }
  fflush(stdout);
}

static struct state *get_state(napi_env env) {
  struct state *state = NULL;
  napi_get_instance_data(env, (void **)&state);
  return state;
}

static int kind_from_name(napi_env env, napi_value name_value) {
  char name[64];
  size_t name_length = 0;
  napi_get_value_string_utf8(env, name_value, name, sizeof(name), &name_length);
  int kind = 0;
  while (kind < kind_count && strcmp(kind_names[kind], name) != 0) {
    kind++;
  }
  return kind == kind_posted ? kind_count : kind;
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
  int kind = kind_from_name(env, argv[0]);
  uint32_t count = 0;
  napi_get_value_uint32(env, argv[1], &count);
  if (kind == kind_count) {
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

// createInOrder(kinds: string[]): object[]. One value of each kind, created in
// this order. The instance data finalizer prints the order of their
// finalizers.
static napi_value create_in_order(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  uint32_t count = 0;
  napi_get_array_length(env, argv[0], &count);
  get_state(env)->report_order = true;

  napi_value array;
  napi_create_array_with_length(env, count, &array);
  for (uint32_t i = 0; i < count; i++) {
    napi_value name;
    napi_get_element(env, argv[0], i, &name);
    int kind = kind_from_name(env, name);
    if (kind == kind_count) {
      napi_throw_error(env, NULL, "unknown kind");
      return NULL;
    }
    napi_value result =
        create_value(env, kind, calloc(1, sizeof(struct value)));
    if (!result) {
      return NULL;
    }
    napi_set_element(env, array, i, result);
  }
  return array;
}

// createCancelled(kind: "wrap" | "wrap_ref" | "add_finalizer_ref", count):
// object[]. The addon takes the finalizer of each value back, with
// napi_remove_wrap or napi_delete_reference, so it never runs.
static napi_value create_cancelled(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int kind = kind_from_name(env, argv[0]);
  uint32_t count = 0;
  napi_get_value_uint32(env, argv[1], &count);
  if (kind != kind_wrap && kind != kind_wrap_ref &&
      kind != kind_add_finalizer_ref) {
    napi_throw_error(env, NULL, "no way to cancel this kind");
    return NULL;
  }

  napi_value array;
  napi_create_array_with_length(env, count, &array);
  for (uint32_t i = 0; i < count; i++) {
    struct value *value = calloc(1, sizeof(*value));
    napi_value result = create_value(env, kind, value);
    if (!result) {
      return NULL;
    }
    if (kind == kind_wrap) {
      napi_remove_wrap(env, result, NULL);
    } else {
      napi_delete_reference(env, value->ref);
    }
    free(value);
    napi_set_element(env, array, i, result);
  }
  return array;
}

// reportCleanupHook(): the env's cleanup hook prints what ran before it.
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
  count_add(&work->executed);
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

static struct work *create_work(napi_env env) {
  struct state *state = get_state(env);
  struct work *work = calloc(1, sizeof(*work));
  napi_value name;
  napi_create_string_utf8(env, "work", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, execute, complete, work,
                         &work->handle);
  state->work = work;
  state->queued_work = true;
  return work;
}

// queueWork(): queues async work. workExecuted() says when its execute
// callback has run.
static napi_value queue_work(napi_env env, napi_callback_info info) {
  napi_queue_async_work(env, create_work(env)->handle);
  return NULL;
}

static napi_value work_executed(napi_env env, napi_callback_info info) {
  struct state *state = get_state(env);
  napi_value result;
  napi_get_boolean(env, state->work && count_get(&state->work->executed),
                   &result);
  return result;
}

// queueWorkInFinalizer(): an external whose finalizer queues async work.
static napi_value queue_work_in_finalizer(napi_env env,
                                          napi_callback_info info) {
  struct value *value = calloc(1, sizeof(*value));
  value->work = create_work(env);
  return create_value(env, kind_external, value);
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

// openScopeInInstanceDataFinalizer(): the instance data finalizer opens an
// escapable handle scope.
static napi_value
open_scope_in_instance_data_finalizer(napi_env env, napi_callback_info info) {
  get_state(env)->open_scope_in_instance_data_finalizer = true;
  return NULL;
}

#ifdef NATIVE_BUNDLER_PLUGIN
static void sleep_one_millisecond(void) {
#ifdef _WIN32
  Sleep(1);
#else
  usleep(1000);
#endif
}

// Makes the addon a native bundler plugin for Bun.build().
NAPI_MODULE_EXPORT const char *BUN_PLUGIN_NAME =
    "instance_data_finalizer_order";

// Bun.build() calls this on a thread of the bundler, for each file of the
// build (onBeforeParse). The first call returns after the env's cleanup hook
// has run.
NAPI_MODULE_EXPORT void plugin_on_before_parse(const void *arguments,
                                               void *result) {
  if (count_add(&plugin.entered) != 1) {
    return;
  }
  while (!count_get(&plugin.released)) {
    sleep_one_millisecond();
  }
  // An env that does not wait for the build runs its instance data finalizer
  // right after its cleanup hooks.
  for (int i = 0; i < 200 && !count_get(&plugin.instance_data_finalized); i++) {
    sleep_one_millisecond();
  }
  printf("native bundler plugin: %s\n",
         count_get(&plugin.instance_data_finalized)
             ? "the instance data finalizer ran under it"
             : "returned before the instance data finalizer");
  fflush(stdout);
}

static void release_plugin(void *data) { count_add(&plugin.released); }

// holdPluginUntilCleanupHook(): plugin_on_before_parse returns only after a
// cleanup hook of this env has run.
static napi_value hold_plugin_until_cleanup_hook(napi_env env,
                                                 napi_callback_info info) {
  napi_add_env_cleanup_hook(env, release_plugin, NULL);
  get_state(env)->holds_plugin = true;
  return NULL;
}

// pluginEntered(): boolean
static napi_value plugin_entered(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_get_boolean(env, count_get(&plugin.entered) > 0, &result);
  return result;
}
#endif

// finalizedInProcess(): number
static napi_value finalized_in_process_count(napi_env env,
                                             napi_callback_info info) {
  napi_value result;
  napi_create_int32(env, count_get(&finalized_in_process), &result);
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
  export_function(env, exports, "createInOrder", create_in_order);
  export_function(env, exports, "createCancelled", create_cancelled);
  export_function(env, exports, "reportCleanupHook", report_cleanup_hook);
  export_function(env, exports, "setInstanceDataAgain",
                  set_instance_data_again);
  export_function(env, exports, "queueWork", queue_work);
  export_function(env, exports, "workExecuted", work_executed);
  export_function(env, exports, "queueWorkInFinalizer",
                  queue_work_in_finalizer);
  export_function(env, exports, "closeUvHandle", close_uv_handle);
  export_function(env, exports, "closeUvHandleInFinalizer",
                  close_uv_handle_in_finalizer);
  export_function(env, exports, "openScopeInInstanceDataFinalizer",
                  open_scope_in_instance_data_finalizer);
#ifdef NATIVE_BUNDLER_PLUGIN
  export_function(env, exports, "holdPluginUntilCleanupHook",
                  hold_plugin_until_cleanup_hook);
  export_function(env, exports, "pluginEntered", plugin_entered);
#endif
  export_function(env, exports, "finalizedInProcess",
                  finalized_in_process_count);
#ifdef NAPI_EXPERIMENTAL
  export_function(env, exports, "post", post);
  export_function(env, exports, "postFromInstanceDataFinalizer",
                  post_from_instance_data_finalizer);
#endif
  return exports;
}

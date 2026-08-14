// Finalizers that only the destruction of the JSC VM can reach.
//
// setup(kind) registers one finalizer of the given kind and then pins its
// object with a strong napi_ref that is never released, so no garbage
// collection can run the finalizer while the env is alive. Env teardown
// (NapiEnv::cleanup, whose last step is the instance data finalizer below)
// does not run these kinds either, so the finalizer is still registered when
// the JSC VM is destroyed afterwards: a worker_threads Worker exiting, or the
// main thread exiting under BUN_DESTRUCT_VM_ON_EXIT=1. JSC's
// Heap::lastChanceToFinalize then fires every remaining finalizer, without
// the bookkeeping a collection has (MutatorState::Sweeping), so Bun must
// recognize that state on its own.
//
// Built twice (binding.gyp): as a regular module, and with TEST_EXPERIMENTAL
// as a NAPI_EXPERIMENTAL module. Whatever the finalizer reports on stderr
// starts with "FAIL:".
//   - Regular module: a finalizer may call any Node-API function, which cannot
//     be honored while the heap is being destroyed, so it must not be invoked
//     from there at all.
//   - Experimental module: finalizers run synchronously from whatever frees
//     their object and must not call functions that may affect GC state (Node
//     aborts with "FATAL ERROR" when they do). The finalizer calls one such
//     function, napi_get_undefined; Bun has to abort rather than let it through.

#ifdef TEST_EXPERIMENTAL
#define NAPI_EXPERIMENTAL
#define NODE_API_EXPERIMENTAL_NO_WARNING
#endif

#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NODE_API_CALL(env, call)                                               \
  do {                                                                         \
    if ((call) != napi_ok) {                                                   \
      napi_throw_error((env), NULL, #call " failed");                          \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

static int env_torn_down = 0;
static int pending_finalizers = 0;
static int instance_data;

static void instance_data_finalizer(napi_env env, void *data, void *hint) {
  (void)env;
  (void)data;
  (void)hint;
  env_torn_down = 1;
  printf("env teardown: %d finalizer(s) still pending\n", pending_finalizers);
  fflush(stdout);
}

// Registered as the finalize callback of every kind; `hint` is the kind name.
static void finalizer(napi_env env, void *data, void *hint) {
  const char *kind = hint;
  (void)data;
  pending_finalizers--;

  if (!env_torn_down) {
    printf("finalizer: %s\n", kind);
    fflush(stdout);
    return;
  }

  // Only VM destruction gets here.
#ifdef TEST_EXPERIMENTAL
  // Bun has to refuse this (it aborts, as during a collection); returning from
  // it means the call went through.
  napi_value undefined;
  napi_status status = napi_get_undefined(env, &undefined);
  fprintf(stderr,
          "FAIL: %s finalizer called napi_get_undefined during VM destruction "
          "and got status %d\n",
          kind, (int)status);
#else
  fprintf(stderr, "FAIL: %s finalizer ran after env teardown\n", kind);
  // What node-addon-api's finalizer wrapper does before anything else; here it
  // allocates a JSC cell in the heap being destroyed.
  napi_handle_scope scope;
  if (napi_open_handle_scope(env, &scope) == napi_ok) {
    napi_close_handle_scope(env, scope);
  }
#endif
}

static char *dup_kind(const char *kind) {
  // Leaked on purpose: it is the finalize hint, read whenever the finalizer
  // runs, including from VM destruction.
  char *copy = malloc(strlen(kind) + 1);
  strcpy(copy, kind);
  return copy;
}

static napi_value setup(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  char kind[64];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 1) {
    napi_throw_error(env, NULL, "setup(kind) needs a kind");
    return NULL;
  }
  NODE_API_CALL(env, napi_get_value_string_utf8(env, argv[0], kind,
                                                sizeof(kind), NULL));

  napi_value pinned;
  if (strcmp(kind, "add_finalizer") == 0) {
    // No napi_ref asked for: registered straight on the JSC heap
    // (Heap::addFinalizer).
    NODE_API_CALL(env, napi_create_object(env, &pinned));
    NODE_API_CALL(env, napi_add_finalizer(env, pinned, NULL, finalizer,
                                          dup_kind(kind), NULL));
  } else if (strcmp(kind, "add_finalizer_ref") == 0) {
    // Registered through a weak NapiRef (the napi_ref variant).
    napi_ref weak;
    NODE_API_CALL(env, napi_create_object(env, &pinned));
    NODE_API_CALL(env, napi_add_finalizer(env, pinned, NULL, finalizer,
                                          dup_kind(kind), &weak));
  } else if (strcmp(kind, "external") == 0) {
    // Runs from the NapiExternal cell's destructor.
    NODE_API_CALL(env, napi_create_external(env, NULL, finalizer,
                                            dup_kind(kind), &pinned));
  } else if (strcmp(kind, "empty_external_buffer") == 0) {
    // A zero-length external buffer has no contents to hang the finalizer
    // on, so it too is registered straight on the JSC heap.
    NODE_API_CALL(env, napi_create_external_buffer(env, 0, NULL, finalizer,
                                                   dup_kind(kind), &pinned));
  } else {
    napi_throw_error(env, NULL, "unknown kind");
    return NULL;
  }
  pending_finalizers++;

  // Never deleted: the object stays reachable until the VM is destroyed.
  napi_ref pin;
  NODE_API_CALL(env, napi_create_reference(env, pinned, 1, &pin));

  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

static napi_value init(napi_env env, napi_value exports) {
  NODE_API_CALL(env, napi_set_instance_data(env, &instance_data,
                                            instance_data_finalizer, NULL));
  napi_value setup_fn;
  NODE_API_CALL(env, napi_create_function(env, "setup", NAPI_AUTO_LENGTH,
                                          setup, NULL, &setup_fn));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "setup", setup_fn));
  return exports;
}

NAPI_MODULE(test_vm_teardown_finalizers, init)

// A module built against a released Node-API version (not NAPI_EXPERIMENTAL)
// gets its finalizers run from the event loop, after the GC that collected the
// object. An addon that deletes the reference from napi_wrap or
// napi_add_finalizer in between must not see the finalizer run any more: it
// normally frees the native object together with the reference. Node
// dequeues the finalizer when the reference is deleted.
//
// The native objects here are static, so a finalizer that does run after the
// delete is reported instead of reading freed memory.

#include <js_native_api.h>
#include <node_api.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#define NODE_API_CALL(env, call)                                               \
  do {                                                                         \
    napi_status status = (call);                                               \
    if (status != napi_ok) {                                                   \
      const napi_extended_error_info *error_info = NULL;                       \
      napi_get_last_error_info((env), &error_info);                            \
      const char *err_message = error_info->error_message;                     \
      bool is_pending;                                                         \
      napi_is_exception_pending((env), &is_pending);                           \
      if (!is_pending) {                                                       \
        const char *message =                                                  \
            (err_message == NULL) ? "empty error message" : err_message;       \
        napi_throw_error((env), NULL, message);                                \
      }                                                                        \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

typedef struct {
  napi_ref ref;
  // The addon deleted the reference (and, in a real addon, this object).
  bool deleted;
  int finalized;
} Native;

// ---------------------------------------------------------------------------
// solo: JS deletes the reference right after the GC that collected the object.

static Native solo;
static int solo_finalized_after_delete = 0;

static void solo_finalize(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  Native *native = data;
  native->finalized++;
  if (native->deleted) {
    solo_finalized_after_delete++;
  }
}

// makeSolo(useAddFinalizer: boolean): undefined
// Creates an object that only the handle scope of this call keeps alive, and
// attaches `solo` to it, keeping the reference.
static napi_value make_solo(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  bool use_add_finalizer = false;
  NODE_API_CALL(env, napi_get_value_bool(env, argv[0], &use_add_finalizer));

  memset(&solo, 0, sizeof solo);
  napi_value object;
  NODE_API_CALL(env, napi_create_object(env, &object));
  if (use_add_finalizer) {
    NODE_API_CALL(env, napi_add_finalizer(env, object, &solo, solo_finalize,
                                          NULL, &solo.ref));
  } else {
    NODE_API_CALL(
        env, napi_wrap(env, object, &solo, solo_finalize, NULL, &solo.ref));
  }
  return NULL;
}

// isSoloCollected(): boolean
static napi_value is_solo_collected(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value value = NULL;
  NODE_API_CALL(env, napi_get_reference_value(env, solo.ref, &value));
  napi_value result;
  NODE_API_CALL(env, napi_get_boolean(env, value == NULL, &result));
  return result;
}

// deleteSolo(): undefined
static napi_value delete_solo(napi_env env, napi_callback_info info) {
  (void)info;
  NODE_API_CALL(env, napi_delete_reference(env, solo.ref));
  solo.ref = NULL;
  solo.deleted = true;
  return NULL;
}

// soloFinalizedAfterDelete(): number (over every makeSolo so far)
static napi_value solo_finalized_after_delete_count(napi_env env,
                                                    napi_callback_info info) {
  (void)info;
  napi_value result;
  NODE_API_CALL(env,
                napi_create_int32(env, solo_finalized_after_delete, &result));
  return result;
}

// ---------------------------------------------------------------------------
// pair: a parent whose finalizer tears down its children (the node-addon-api
// shape: ~Parent deletes the children, ~Child deletes the child's reference),
// all of them collected by the same GC.

#define CHILD_COUNT 8

static Native parent;
static Native children[CHILD_COUNT];
static int child_finalized_after_delete = 0;

static void child_finalize(napi_env env, void *data, void *hint) {
  (void)hint;
  Native *child = data;
  child->finalized++;
  if (child->deleted) {
    child_finalized_after_delete++;
    return;
  }
  // A child that goes first cleans up after itself, so the parent skips it.
  napi_delete_reference(env, child->ref);
  child->ref = NULL;
  child->deleted = true;
}

static void delete_children(napi_env env) {
  for (int i = 0; i < CHILD_COUNT; i++) {
    Native *child = &children[i];
    if (child->deleted) {
      continue;
    }
    napi_delete_reference(env, child->ref);
    child->ref = NULL;
    child->deleted = true;
  }
}

static void parent_finalize(napi_env env, void *data, void *hint) {
  (void)hint;
  Native *native = data;
  native->finalized++;
  delete_children(env);
  napi_delete_reference(env, native->ref);
  native->ref = NULL;
  native->deleted = true;
}

static napi_value wrap_new_object(napi_env env, Native *native,
                                  napi_finalize finalize) {
  napi_value object;
  NODE_API_CALL(env, napi_create_object(env, &object));
  NODE_API_CALL(env,
                napi_wrap(env, object, native, finalize, NULL, &native->ref));
  return object;
}

// makePair(parentFirst: boolean): undefined
// The order of creation decides the order in which the runtime finds the dead
// wrappers, so both orders are tried.
static napi_value make_pair(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  NODE_API_CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  bool parent_first = false;
  NODE_API_CALL(env, napi_get_value_bool(env, argv[0], &parent_first));

  memset(&parent, 0, sizeof parent);
  memset(children, 0, sizeof children);
  if (parent_first && wrap_new_object(env, &parent, parent_finalize) == NULL) {
    return NULL;
  }
  for (int i = 0; i < CHILD_COUNT; i++) {
    if (wrap_new_object(env, &children[i], child_finalize) == NULL) {
      return NULL;
    }
  }
  if (!parent_first && wrap_new_object(env, &parent, parent_finalize) == NULL) {
    return NULL;
  }
  return NULL;
}

// isParentCollected(): boolean
// Only valid right after the GC, before the finalizers get to run: the
// parent's finalizer deletes the reference this reads.
static napi_value is_parent_collected(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value value = NULL;
  NODE_API_CALL(env, napi_get_reference_value(env, parent.ref, &value));
  napi_value result;
  NODE_API_CALL(env, napi_get_boolean(env, value == NULL, &result));
  return result;
}

// isParentFinalized(): boolean
static napi_value is_parent_finalized(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  NODE_API_CALL(env, napi_get_boolean(env, parent.finalized > 0, &result));
  return result;
}

// discardPair(): undefined
// For an attempt whose parent the GC did not collect: delete everything, so
// the next attempt starts from fresh objects. A finalizer still queued for one
// of these is exactly what must not run.
static napi_value discard_pair(napi_env env, napi_callback_info info) {
  (void)info;
  delete_children(env);
  if (!parent.deleted) {
    NODE_API_CALL(env, napi_delete_reference(env, parent.ref));
    parent.ref = NULL;
    parent.deleted = true;
  }
  return NULL;
}

// childFinalizedAfterDelete(): number (over every makePair so far)
static napi_value child_finalized_after_delete_count(napi_env env,
                                                     napi_callback_info info) {
  (void)info;
  napi_value result;
  NODE_API_CALL(env,
                napi_create_int32(env, child_finalized_after_delete, &result));
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  const struct {
    const char *name;
    napi_callback callback;
  } functions[] = {
      {"makeSolo", make_solo},
      {"isSoloCollected", is_solo_collected},
      {"deleteSolo", delete_solo},
      {"soloFinalizedAfterDelete", solo_finalized_after_delete_count},
      {"makePair", make_pair},
      {"isParentCollected", is_parent_collected},
      {"isParentFinalized", is_parent_finalized},
      {"discardPair", discard_pair},
      {"childFinalizedAfterDelete", child_finalized_after_delete_count},
  };
  for (size_t i = 0; i < sizeof functions / sizeof functions[0]; i++) {
    napi_value function;
    NODE_API_CALL(env,
                  napi_create_function(env, functions[i].name, NAPI_AUTO_LENGTH,
                                       functions[i].callback, NULL, &function));
    NODE_API_CALL(env, napi_set_named_property(env, exports, functions[i].name,
                                               function));
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

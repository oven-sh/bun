// Every finalizer registration API must run its finalizer at env teardown,
// exactly once, including finalizers registered by another teardown finalizer.
// Each prints "finalize: <name>" to stdout (a child's stderr is unreliable on CI).

#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int finalize_count = 0;

static void finalize(napi_env env, void* data, void* hint) {
    (void)env;
    (void)data;
    printf("finalize: %s\n", (const char*)hint);
    fflush(stdout);
    free(hint);
    finalize_count++;
}

// Copies the string in `arg` into a malloc'd buffer that finalize() frees.
static char* dup_name_arg(napi_env env, napi_value arg) {
    size_t len = 0;
    napi_get_value_string_utf8(env, arg, NULL, 0, &len);
    char* name = (char*)malloc(len + 1);
    napi_get_value_string_utf8(env, arg, name, len + 1, &len);
    return name;
}

// wrap(obj, name)
static napi_value wrap(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_wrap(env, argv[0], NULL, finalize, dup_name_arg(env, argv[1]), NULL);
    return argv[0];
}

// addFinalizer(obj, name, wantRef): wantRef=true exercises the napi_ref-returning overload.
static napi_value add_finalizer(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    bool want_ref = false;
    napi_get_value_bool(env, argv[2], &want_ref);
    // Leaked on purpose: this test never releases the ref, matching addons
    // that hold a weak ref for the object's whole lifetime.
    napi_ref* ref = want_ref ? (napi_ref*)malloc(sizeof(napi_ref)) : NULL;
    napi_add_finalizer(env, argv[0], NULL, finalize, dup_name_arg(env, argv[1]), ref);
    return argv[0];
}

// createExternal(name) -> external value
static napi_value create_external(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_value external;
    napi_create_external(env, NULL, finalize, dup_name_arg(env, argv[0]), &external);
    return external;
}

// finalizeCount() -> number of finalizers that have already run (and flushed).
static napi_value get_finalize_count(napi_env env, napi_callback_info info) {
    (void)info;
    napi_value out;
    napi_create_int32(env, finalize_count, &out);
    return out;
}

typedef struct {
    char* outer_name;
    char* nested_external_name;
    char* nested_add_finalizer_name;
} NestingContext;

// Runs as a teardown finalizer and registers two new finalizers while the env
// is already draining its finalizer list. Bun accepts these calls here (Node
// rejects them with napi_pending_exception), so it must drain them safely.
static void nesting_finalize(napi_env env, void* data, void* hint) {
    (void)hint;
    NestingContext* ctx = (NestingContext*)data;
    printf("finalize: %s\n", ctx->outer_name);
    fflush(stdout);
    finalize_count++;
    napi_value external;
    napi_create_external(env, NULL, finalize, ctx->nested_external_name, &external);
    napi_add_finalizer(env, external, NULL, finalize, ctx->nested_add_finalizer_name, NULL);
    free(ctx->outer_name);
    free(ctx);
}

// wrapNesting(obj, outerName, nestedExternalName, nestedAddFinalizerName)
static napi_value wrap_nesting(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value argv[4];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    NestingContext* ctx = (NestingContext*)malloc(sizeof(NestingContext));
    ctx->outer_name = dup_name_arg(env, argv[1]);
    ctx->nested_external_name = dup_name_arg(env, argv[2]);
    ctx->nested_add_finalizer_name = dup_name_arg(env, argv[3]);
    napi_wrap(env, argv[0], ctx, nesting_finalize, NULL, NULL);
    return argv[0];
}

static napi_ref saved_ref = NULL;

// addFinalizerSaveRef(obj, name): napi_add_finalizer keeping the returned ref
// so a later teardown finalizer can napi_delete_reference it.
static napi_value add_finalizer_save_ref(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    napi_add_finalizer(env, argv[0], NULL, finalize, dup_name_arg(env, argv[1]), &saved_ref);
    return argv[0];
}

typedef struct {
    char* outer_name;
    char* recycled_name;
} RecycleContext;

// Runs as a teardown finalizer: deletes the ref from addFinalizerSaveRef, then
// registers a new finalizer. The allocator commonly hands back the just-freed
// NapiRef address; the new finalizer must still run.
static void recycle_finalize(napi_env env, void* data, void* hint) {
    (void)hint;
    RecycleContext* ctx = (RecycleContext*)data;
    printf("finalize: %s\n", ctx->outer_name);
    fflush(stdout);
    finalize_count++;
    void* old_ref = (void*)saved_ref;
    napi_delete_reference(env, saved_ref);
    napi_value obj;
    napi_create_object(env, &obj);
    napi_ref new_ref = NULL;
    napi_add_finalizer(env, obj, NULL, finalize, ctx->recycled_name, &new_ref);
    // Diagnostic only (not asserted): says whether the address-reuse collision
    // this exercise targets actually happened on this platform and allocator.
    printf("recycled-address: %s\n", (void*)new_ref == old_ref ? "yes" : "no");
    fflush(stdout);
    free(ctx->outer_name);
    free(ctx);
}

// wrapRecycling(obj, outerName, recycledName)
static napi_value wrap_recycling(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    RecycleContext* ctx = (RecycleContext*)malloc(sizeof(RecycleContext));
    ctx->outer_name = dup_name_arg(env, argv[1]);
    ctx->recycled_name = dup_name_arg(env, argv[2]);
    napi_wrap(env, argv[0], ctx, recycle_finalize, NULL, NULL);
    return argv[0];
}

static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        { "wrap", 0, wrap, 0, 0, 0, napi_default, 0 },
        { "addFinalizer", 0, add_finalizer, 0, 0, 0, napi_default, 0 },
        { "createExternal", 0, create_external, 0, 0, 0, napi_default, 0 },
        { "finalizeCount", 0, get_finalize_count, 0, 0, 0, napi_default, 0 },
        { "wrapNesting", 0, wrap_nesting, 0, 0, 0, napi_default, 0 },
        { "addFinalizerSaveRef", 0, add_finalizer_save_ref, 0, 0, 0, napi_default, 0 },
        { "wrapRecycling", 0, wrap_recycling, 0, 0, 0, napi_default, 0 },
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

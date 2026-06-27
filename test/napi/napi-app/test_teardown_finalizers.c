// napi_add_finalizer and napi_create_external finalizers must run at env
// teardown for objects still alive at exit (only napi_wrap's used to). A
// finalizer already run by GC must not run again at teardown. Each finalizer
// prints "finalize: <name>" to stderr exactly once.

#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void finalize(napi_env env, void* data, void* hint) {
    (void)env;
    (void)data;
    fprintf(stderr, "finalize: %s\n", (const char*)hint);
    fflush(stderr);
    free(hint);
}

// Copies the string argument at `index` into a malloc'd buffer that finalize() frees.
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

static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        { "wrap", 0, wrap, 0, 0, 0, napi_default, 0 },
        { "addFinalizer", 0, add_finalizer, 0, 0, 0, napi_default, 0 },
        { "createExternal", 0, create_external, 0, 0, 0, napi_default, 0 },
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

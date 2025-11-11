#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>

// This test reproduces issue #24552 where finalizers crash when run during
// env teardown (e.g., when a subprocess using NAPI modules terminates).

static int finalize_count = 0;

// Finalizer that tries to access the env
static void finalizer_that_uses_env(napi_env env, void* finalize_data, void* finalize_hint) {
    finalize_count++;

    // These operations would crash if env->globalObject() is null or VM is terminating
    // The fix in Finalizer.run() checks NapiEnv__canRunFinalizer() before allowing this
    napi_value global;
    napi_status status = napi_get_global(env, &global);

    if (status == napi_ok) {
        printf("Finalizer %d: Successfully accessed global object\n", finalize_count);
    } else {
        printf("Finalizer %d: Could not access global (expected during teardown)\n", finalize_count);
    }

    // Free the allocated data
    free(finalize_data);
}

static napi_value create_objects_with_finalizers(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    int count = 10;
    if (argc >= 1) {
        napi_get_value_int32(env, args[0], &count);
    }

    napi_value result_array;
    napi_create_array_with_length(env, count, &result_array);

    for (int i = 0; i < count; i++) {
        napi_value obj;
        napi_create_object(env, &obj);

        int* data = (int*)malloc(sizeof(int));
        *data = i;

        // Wrap with finalizer that will try to access the env
        napi_wrap(env, obj, data, finalizer_that_uses_env, NULL, NULL);

        napi_set_element(env, result_array, i, obj);
    }

    return result_array;
}

static napi_value get_finalize_count(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_create_int32(env, finalize_count, &result);
    return result;
}

static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        { "createObjects", 0, create_objects_with_finalizers, 0, 0, 0, napi_default, 0 },
        { "getFinalizeCount", 0, get_finalize_count, 0, 0, 0, napi_default, 0 }
    };

    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

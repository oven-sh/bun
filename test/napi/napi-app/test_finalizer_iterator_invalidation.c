#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <assert.h>

static int finalize_call_count = 0;
static napi_env saved_env = NULL;

// This finalizer will trigger operations that can cause GC
static void problematic_finalizer(napi_env env, void* finalize_data, void* finalize_hint) {
    finalize_call_count++;
    printf("Finalizer %d called\n", finalize_call_count);
    
    // Save env for later use
    if (!saved_env) saved_env = env;
    
    // Operations that can trigger GC and modify m_finalizers during iteration:
    
    // 1. Try to force GC if available
    napi_value global, gc_func;
    if (napi_get_global(env, &global) == napi_ok) {
        if (napi_get_named_property(env, global, "gc", &gc_func) == napi_ok) {
            napi_valuetype type;
            if (napi_typeof(env, gc_func, &type) == napi_ok && type == napi_function) {
                napi_value result;
                napi_call_function(env, global, gc_func, 0, NULL, &result);
                printf("  - GC triggered from finalizer %d\n", finalize_call_count);
            }
        }
    }
    
    // 2. Create and immediately abandon objects (can trigger GC)
    for (int i = 0; i < 10; i++) {
        napi_value obj;
        napi_create_object(env, &obj);
        napi_value arr;
        napi_create_array_with_length(env, 100, &arr);
    }
    
    // 3. Try to run some JavaScript that might trigger GC
    napi_value code_string, result;
    const char* js_code = "Array.from({length: 100}, (_, i) => ({id: i, data: new Array(100).fill(i)}))";
    if (napi_create_string_utf8(env, js_code, NAPI_AUTO_LENGTH, &code_string) == napi_ok) {
        // This might trigger more allocations and GC
        napi_run_script(env, code_string, &result);
    }
    
    printf("  - Finalizer %d completed\n", finalize_call_count);
}

static napi_value create_objects_with_problematic_finalizers(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    
    int count = 10; // default
    if (argc >= 1) {
        napi_get_value_int32(env, args[0], &count);
    }
    
    printf("Creating %d objects with problematic finalizers\n", count);
    
    napi_value result_array;
    napi_create_array_with_length(env, count, &result_array);
    
    for (int i = 0; i < count; i++) {
        napi_value obj;
        napi_create_object(env, &obj);
        
        // Allocate some data for the finalizer
        int* data = (int*)malloc(sizeof(int));
        *data = i;
        
        // Wrap object with the problematic finalizer
        napi_wrap(env, obj, data, problematic_finalizer, NULL, NULL);
        
        napi_set_element(env, result_array, i, obj);
    }
    
    return result_array;
}

static napi_value get_finalize_count(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_create_int32(env, finalize_call_count, &result);
    return result;
}

static napi_value force_cleanup_and_exit(napi_env env, napi_callback_info info) {
    printf("Forcing cleanup and exit - this would crash before the fix\n");
    
    // Try to trigger GC first
    napi_value global, gc_func;
    if (napi_get_global(env, &global) == napi_ok) {
        if (napi_get_named_property(env, global, "gc", &gc_func) == napi_ok) {
            napi_valuetype type;
            if (napi_typeof(env, gc_func, &type) == napi_ok && type == napi_function) {
                napi_value result;
                napi_call_function(env, global, gc_func, 0, NULL, &result);
                printf("GC triggered before exit\n");
            }
        }
    }
    
    // This will cause process exit and trigger the finalizer cleanup
    // where the crash would occur due to iterator invalidation
    exit(0);
}

static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        { "createProblematicObjects", 0, create_objects_with_problematic_finalizers, 0, 0, 0, napi_default, 0 },
        { "getFinalizeCount", 0, get_finalize_count, 0, 0, 0, napi_default, 0 },
        { "forceCleanupAndExit", 0, force_cleanup_and_exit, 0, 0, 0, napi_default, 0 }
    };
    
    size_t property_count = sizeof(properties) / sizeof(properties[0]);
    napi_define_properties(env, exports, property_count, properties);
    
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
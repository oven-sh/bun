#include <node_api.h>
#include <stdio.h>

// This reproduces the crash that was happening in napi_is_exception_pending
// when called during cleanup/finalizers
static void test_finalizer(napi_env env, void* finalize_data, void* finalize_hint) {
    // This is what was causing the crash before the fix
    bool result = false;
    napi_status status = napi_is_exception_pending(env, &result);
    
    // Print status for verification (should not crash and should return napi_ok)
    printf("napi_is_exception_pending in finalizer: status=%d, result=%s\n", 
           status, result ? "true" : "false");
}

static napi_value create_object_with_finalizer(napi_env env, napi_callback_info info) {
    napi_value obj;
    napi_create_object(env, &obj);
    
    // Add a finalizer that will call napi_is_exception_pending during cleanup
    napi_add_finalizer(env, obj, nullptr, test_finalizer, nullptr, nullptr);
    
    return obj;
}

static napi_value test_exception_pending_basic(napi_env env, napi_callback_info info) {
    bool result = false;
    napi_status status = napi_is_exception_pending(env, &result);
    
    napi_value return_status, return_result;
    napi_create_int32(env, status, &return_status);
    napi_get_boolean(env, result, &return_result);
    
    napi_value return_obj;
    napi_create_object(env, &return_obj);
    napi_set_named_property(env, return_obj, "status", return_status);
    napi_set_named_property(env, return_obj, "result", return_result);
    
    return return_obj;
}

static napi_value test_with_pending_exception(napi_env env, napi_callback_info info) {
    // Create a pending exception
    napi_throw_error(env, nullptr, "Test exception");
    
    // Now test napi_is_exception_pending
    bool result = false;
    napi_status status = napi_is_exception_pending(env, &result);
    
    napi_value return_status, return_result;
    napi_create_int32(env, status, &return_status);
    napi_get_boolean(env, result, &return_result);
    
    napi_value return_obj;
    napi_create_object(env, &return_obj);
    napi_set_named_property(env, return_obj, "status", return_status);
    napi_set_named_property(env, return_obj, "result", return_result);
    
    return return_obj;
}

static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        { "createObjectWithFinalizer", nullptr, create_object_with_finalizer, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "testExceptionPendingBasic", nullptr, test_exception_pending_basic, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "testWithPendingException", nullptr, test_with_pending_exception, nullptr, nullptr, nullptr, napi_default, nullptr }
    };
    
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
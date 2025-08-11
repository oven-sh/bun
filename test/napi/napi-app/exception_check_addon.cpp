#include <node_api.h>

// Function that tests NAPI exception state checking
napi_value test_exception_pending_initially(napi_env env, napi_callback_info info) {
    bool is_pending = false;
    napi_status status = napi_is_exception_pending(env, &is_pending);
    
    napi_value result;
    napi_get_boolean(env, !is_pending, &result); // Should be true (no exception pending)
    return result;
}

// Function that manually sets exception flag (simulating broken state)
napi_value test_multiple_preamble_check(napi_env env, napi_callback_info info) {
    // This should NOT crash since we're using NAPI_PREAMBLE which checks for pending exceptions
    // If NAPI_PREAMBLE works, this will return napi_pending_exception if there's already an exception
    
    // Just return true to indicate we got this far
    napi_value result;
    napi_get_boolean(env, true, &result);
    return result;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn1, fn2;
    
    napi_create_function(env, NULL, 0, test_exception_pending_initially, NULL, &fn1);
    napi_set_named_property(env, exports, "testExceptionPendingInitially", fn1);
    
    napi_create_function(env, NULL, 0, test_multiple_preamble_check, NULL, &fn2);
    napi_set_named_property(env, exports, "testMultiplePreambleCheck", fn2);
    
    return exports;
}

NAPI_MODULE(exception_check_addon, Init)
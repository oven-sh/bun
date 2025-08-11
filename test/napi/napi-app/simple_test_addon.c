#include <node_api.h>

// Simple test function that throws two exceptions in a row
napi_value test_double_throw(napi_env env, napi_callback_info info) {
    // First throw
    napi_value error1;
    napi_create_error(env, NULL, NULL, &error1);
    napi_value message1;
    napi_create_string_utf8(env, "First error", NAPI_AUTO_LENGTH, &message1);
    napi_set_named_property(env, error1, "message", message1);
    napi_throw(env, error1);
    
    // Second throw - this should be ignored in Node.js but crashes in Bun
    napi_value error2;
    napi_create_error(env, NULL, NULL, &error2);
    napi_value message2;
    napi_create_string_utf8(env, "Second error", NAPI_AUTO_LENGTH, &message2);
    napi_set_named_property(env, error2, "message", message2);
    napi_throw(env, error2);
    
    napi_value result;
    napi_get_null(env, &result);
    return result;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, NULL, 0, test_double_throw, NULL, &fn);
    napi_set_named_property(env, exports, "testDoubleThrow", fn);
    return exports;
}

NAPI_MODULE(simple_test_addon, Init)
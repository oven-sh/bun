#include <node_api.h>
#include <stdio.h>

// Test function that throws multiple exceptions in sequence  
// This should cause Bun to crash with an assertion failure currently
napi_value ThrowAfterCatch(napi_env env, napi_callback_info info) {
    // First exception - throw it
    napi_value error1;
    napi_create_error(env, nullptr, 
                      nullptr, // we'll create the message below
                      &error1);
    
    napi_value message1;
    napi_create_string_utf8(env, "First exception", NAPI_AUTO_LENGTH, &message1);
    napi_set_named_property(env, error1, "message", message1);
    
    napi_throw(env, error1);
    
    // Check if exception is pending after first throw
    bool pending;
    napi_is_exception_pending(env, &pending);
    
    // Second exception - this should cause assertion failure in Bun  
    // but should work fine in Node.js (should be ignored since first is pending)
    napi_value error2;
    napi_create_error(env, nullptr,
                      nullptr,
                      &error2);
                      
    napi_value message2;
    napi_create_string_utf8(env, "Second exception after first", NAPI_AUTO_LENGTH, &message2);
    napi_set_named_property(env, error2, "message", message2);
    
    napi_throw(env, error2);
    
    napi_value result;
    napi_get_null(env, &result);
    return result;
}

// Test function that throws multiple exceptions without any catching
napi_value ThrowMultiple(napi_env env, napi_callback_info info) {
    // First exception
    napi_value error1;
    napi_create_error(env, nullptr, nullptr, &error1);
    
    napi_value message1;
    napi_create_string_utf8(env, "First exception", NAPI_AUTO_LENGTH, &message1);
    napi_set_named_property(env, error1, "message", message1);
    napi_throw(env, error1);
    
    // Second exception - this should be ignored/overwrite the first in Node.js
    napi_value error2; 
    napi_create_error(env, nullptr, nullptr, &error2);
    
    napi_value message2;
    napi_create_string_utf8(env, "Second exception", NAPI_AUTO_LENGTH, &message2);
    napi_set_named_property(env, error2, "message", message2);
    napi_throw(env, error2);
    
    napi_value result;
    napi_get_null(env, &result);
    return result;
}

// Test function that checks if an exception is pending
napi_value CheckExceptionPending(napi_env env, napi_callback_info info) {
    // Throw an exception
    napi_value error;
    napi_create_error(env, nullptr, nullptr, &error);
    
    napi_value message;
    napi_create_string_utf8(env, "Test exception", NAPI_AUTO_LENGTH, &message);
    napi_set_named_property(env, error, "message", message);
    napi_throw(env, error);
    
    // Check if exception is pending
    bool isPending;
    napi_is_exception_pending(env, &isPending);
    
    napi_value result;
    napi_get_boolean(env, isPending, &result);
    return result;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn1, fn2, fn3;
    
    napi_create_function(env, nullptr, 0, ThrowAfterCatch, nullptr, &fn1);
    napi_set_named_property(env, exports, "throwAfterCatch", fn1);
    
    napi_create_function(env, nullptr, 0, ThrowMultiple, nullptr, &fn2);
    napi_set_named_property(env, exports, "throwMultiple", fn2);
    
    napi_create_function(env, nullptr, 0, CheckExceptionPending, nullptr, &fn3);
    napi_set_named_property(env, exports, "checkExceptionPending", fn3);
    
    return exports;
}

NAPI_MODULE(multiple_exceptions_addon, Init)
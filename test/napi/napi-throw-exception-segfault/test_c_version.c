#include <assert.h>
#include <js_native_api.h>
#include <stdlib.h>

// This reproduces the issue from https://github.com/oven-sh/bun/issues/4526
// using C NAPI to avoid any C++ wrapper issues

static napi_value ThrowError(napi_env env, napi_callback_info info) {
    napi_value error;
    napi_value message;
    napi_status status;
    
    // Create message string
    status = napi_create_string_utf8(env, "Test error from C NAPI", NAPI_AUTO_LENGTH, &message);
    if (status != napi_ok) return NULL;
    
    // Create an error
    status = napi_create_error(env, NULL, message, &error);
    if (status != napi_ok) return NULL;
    
    // Try to throw it
    status = napi_throw(env, error);
    if (status != napi_ok) return NULL;
    
    return NULL;
}

static napi_value ThrowErrorString(napi_env env, napi_callback_info info) {
    // Use napi_throw_error directly
    napi_status status = napi_throw_error(env, NULL, "Test error string from C NAPI");
    if (status != napi_ok) return NULL;
    
    return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        { "throwError", NULL, ThrowError, NULL, NULL, NULL, napi_default, NULL },
        { "throwErrorString", NULL, ThrowErrorString, NULL, NULL, NULL, napi_default, NULL },
    };
    
    napi_status status = napi_define_properties(env, exports, 2, desc);
    assert(status == napi_ok);
    
    return exports;
}

NAPI_MODULE(test_c_version, Init)
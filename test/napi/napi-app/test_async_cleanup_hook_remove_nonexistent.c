#include <node_api.h>
#include <stdio.h>

static void dummy_async_hook(napi_async_cleanup_hook_handle handle, void* arg) {
    // This should never be called
}

napi_value test_function(napi_env env, napi_callback_info info) {
    printf("Testing removal of non-existent async cleanup hook\n");
    
    // Test with NULL handle first (safer)
    napi_status status = napi_remove_async_cleanup_hook(NULL);
    
    if (status == napi_invalid_arg) {
        printf("Got expected napi_invalid_arg for NULL handle\n");
    } else {
        printf("Got unexpected status for NULL handle: %d\n", status);
    }
    
    printf("Test completed without crashing\n");
    
    return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, NULL, 0, test_function, NULL, &fn);
    napi_set_named_property(env, exports, "test", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
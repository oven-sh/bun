#include <node_api.h>
#include <stdio.h>

static void dummy_hook(void* arg) {
    // This should never be called
}

napi_value test_function(napi_env env, napi_callback_info info) {
    printf("Testing removal of non-existent env cleanup hook\n");
    
    // Try to remove a hook that was never added
    // In Node.js, this should silently do nothing
    // In Bun currently, this causes NAPI_PERISH crash
    napi_status status = napi_remove_env_cleanup_hook(env, dummy_hook, NULL);
    
    if (status == napi_ok) {
        printf("Successfully removed non-existent hook (no crash)\n");
    } else {
        printf("Failed to remove non-existent hook with status: %d\n", status);
    }
    
    // Also test removing with different data pointer
    int dummy_data = 42;
    status = napi_remove_env_cleanup_hook(env, dummy_hook, &dummy_data);
    
    if (status == napi_ok) {
        printf("Successfully removed non-existent hook with data (no crash)\n");
    } else {
        printf("Failed to remove non-existent hook with data, status: %d\n", status);
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
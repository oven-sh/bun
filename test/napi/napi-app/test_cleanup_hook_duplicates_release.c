#include <node_api.h>
#include <stdio.h>

static int hook_call_count = 0;

static void test_hook(void* arg) {
    hook_call_count++;
    printf("Hook called, count: %d\n", hook_call_count);
}

napi_value test_function(napi_env env, napi_callback_info info) {
    printf("Testing duplicate cleanup hooks (should work in release build)\n");
    
    // Add the same hook twice with same data
    // In Node.js release builds, this works
    // In Bun release builds, this should now work too
    napi_status status1 = napi_add_env_cleanup_hook(env, test_hook, NULL);
    printf("First add status: %d\n", status1);
    
    napi_status status2 = napi_add_env_cleanup_hook(env, test_hook, NULL);
    printf("Second add status: %d\n", status2);
    
    if (status1 == napi_ok && status2 == napi_ok) {
        printf("Both hooks added successfully (no crash in release build)\n");
    }
    
    return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, NULL, 0, test_function, NULL, &fn);
    napi_set_named_property(env, exports, "test", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
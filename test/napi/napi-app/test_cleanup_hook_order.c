#include <node_api.h>
#include <stdio.h>
#include <assert.h>

// Global counter to track execution order
static int execution_order = 0;
static int hook1_executed = -1;
static int hook2_executed = -1;
static int hook3_executed = -1;

// Hook functions that record their execution order
static void hook1(void* arg) {
    hook1_executed = execution_order++;
    printf("hook1 executed at position %d\n", hook1_executed);
}

static void hook2(void* arg) {
    hook2_executed = execution_order++;
    printf("hook2 executed at position %d\n", hook2_executed);
}

static void hook3(void* arg) {
    hook3_executed = execution_order++;
    printf("hook3 executed at position %d\n", hook3_executed);
}

napi_value test_function(napi_env env, napi_callback_info info) {
    // Add hooks in order 1, 2, 3
    // They should execute in reverse order: 3, 2, 1
    napi_add_env_cleanup_hook(env, hook1, NULL);
    napi_add_env_cleanup_hook(env, hook2, NULL);
    napi_add_env_cleanup_hook(env, hook3, NULL);
    
    printf("Added hooks in order: 1, 2, 3\n");
    printf("They should execute in reverse order: 3, 2, 1\n");
    
    return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, NULL, 0, test_function, NULL, &fn);
    napi_set_named_property(env, exports, "test", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
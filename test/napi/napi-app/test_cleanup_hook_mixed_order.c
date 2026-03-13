#include <node_api.h>
#include <stdio.h>
#include <assert.h>

// Global counter to track execution order
static int execution_order = 0;
static int regular1_executed = -1;
static int async1_executed = -1;
static int regular2_executed = -1;
static int async2_executed = -1;

// Regular cleanup hooks
static void regular_hook1(void* arg) {
    regular1_executed = execution_order++;
    printf("regular_hook1 executed at position %d\n", regular1_executed);
}

static void regular_hook2(void* arg) {
    regular2_executed = execution_order++;
    printf("regular_hook2 executed at position %d\n", regular2_executed);
}

// Async cleanup hooks
static void async_hook1(napi_async_cleanup_hook_handle handle, void* arg) {
    async1_executed = execution_order++;
    printf("async_hook1 executed at position %d\n", async1_executed);
    // Signal completion (this is required for async hooks)
}

static void async_hook2(napi_async_cleanup_hook_handle handle, void* arg) {
    async2_executed = execution_order++;
    printf("async_hook2 executed at position %d\n", async2_executed);
    // Signal completion (this is required for async hooks)
}

napi_value test_function(napi_env env, napi_callback_info info) {
    printf("Testing mixed async and regular cleanup hook execution order\n");
    
    // Add hooks in interleaved pattern: regular1 → async1 → regular2 → async2
    printf("Adding hooks in order: regular1 → async1 → regular2 → async2\n");
    
    napi_add_env_cleanup_hook(env, regular_hook1, NULL);
    printf("Added regular_hook1\n");
    
    napi_async_cleanup_hook_handle handle1;
    napi_add_async_cleanup_hook(env, async_hook1, NULL, &handle1);
    printf("Added async_hook1\n");
    
    napi_add_env_cleanup_hook(env, regular_hook2, NULL);
    printf("Added regular_hook2\n");
    
    napi_async_cleanup_hook_handle handle2;
    napi_add_async_cleanup_hook(env, async_hook2, NULL, &handle2);
    printf("Added async_hook2\n");
    
    printf("If Node.js uses a single queue, execution should be:\n");
    printf("  async2 → regular2 → async1 → regular1 (reverse insertion order)\n");
    printf("If separate queues, execution would be different\n");
    
    return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, NULL, 0, test_function, NULL, &fn);
    napi_set_named_property(env, exports, "test", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
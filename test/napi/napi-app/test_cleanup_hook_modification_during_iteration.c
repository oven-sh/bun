#include <node_api.h>
#include <stdio.h>
#include <assert.h>

// Global references for testing modification during iteration
static napi_env g_env = NULL;
static int execution_count = 0;
static int hook1_executed = 0;
static int hook2_executed = 0;
static int hook3_executed = 0;
static int hook4_executed = 0;

// Hook that removes another hook during execution
static void hook1_removes_hook2(void* arg) {
    hook1_executed = 1;
    printf("hook1 executing - will try to remove hook2\n");
    
    // Try to remove hook2 while hooks are being executed
    // In Node.js this should be handled gracefully
    napi_status status = napi_remove_env_cleanup_hook(g_env, (void(*)(void*))arg, NULL);
    printf("hook1: removal status = %d\n", status);
    
    execution_count++;
}

static void hook2_target_for_removal(void* arg) {
    hook2_executed = 1;
    printf("hook2 executing (this should be skipped if removed by hook1)\n");
    execution_count++;
}

static void hook3_adds_new_hook(void* arg) {
    hook3_executed = 1;
    printf("hook3 executing - will try to add hook4\n");
    
    // Try to add a new hook while hooks are being executed
    napi_status status = napi_add_env_cleanup_hook(g_env, (void(*)(void*))arg, NULL);
    printf("hook3: addition status = %d\n", status);
    
    execution_count++;
}

static void hook4_added_during_iteration(void* arg) {
    hook4_executed = 1;
    printf("hook4 executing (added during iteration)\n");
    execution_count++;
}

napi_value test_function(napi_env env, napi_callback_info info) {
    g_env = env;
    
    printf("Testing hook modification during iteration\n");
    
    // Add hooks in specific order to test removal and addition during iteration
    printf("Adding hooks: hook1 (removes hook2) → hook2 (target) → hook3 (adds hook4)\n");
    
    // Add hook1 that will remove hook2
    napi_add_env_cleanup_hook(env, hook1_removes_hook2, (void*)hook2_target_for_removal);
    
    // Add hook2 that should be removed by hook1
    napi_add_env_cleanup_hook(env, hook2_target_for_removal, NULL);
    
    // Add hook3 that will add hook4
    napi_add_env_cleanup_hook(env, hook3_adds_new_hook, (void*)hook4_added_during_iteration);
    
    printf("Expected behavior differences:\n");
    printf("- Node.js: Should handle removal/addition gracefully during iteration\n");
    printf("- Bun: May have undefined behavior due to direct list modification\n");
    
    return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, NULL, 0, test_function, NULL, &fn);
    napi_set_named_property(env, exports, "test", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
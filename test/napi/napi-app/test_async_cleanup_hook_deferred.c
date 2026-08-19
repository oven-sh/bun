#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <pthread.h>
#include <unistd.h>
#endif

// Two modes driven by the `data` argument to arm():
//   mode 0: hook synchronously calls napi_remove_async_cleanup_hook
//   mode 1: hook spawns a thread that sleeps, then calls remove
// arm() also installs an instance-data finalizer, which env teardown runs
// after the cleanup hooks. A runtime that waits for the removal prints:
//   hook-invoked, hook-completed, instance-data-finalized
// One that does not prints instance-data-finalized right after hook-invoked
// (and, at process exit, never prints hook-completed at all).

struct ctx {
    napi_async_cleanup_hook_handle handle;
};

static struct ctx g_ctx;

static void complete(napi_async_cleanup_hook_handle handle) {
    printf("hook-completed\n");
    fflush(stdout);
    napi_status status = napi_remove_async_cleanup_hook(handle);
    if (status != napi_ok) {
        printf("remove-failed:%d\n", (int)status);
        fflush(stdout);
    }
}

#ifdef _WIN32
static DWORD WINAPI completer_thread(LPVOID p) {
    Sleep(50);
    complete(((struct ctx*)p)->handle);
    return 0;
}
#else
static void* completer_thread(void* p) {
    usleep(50000);
    complete(((struct ctx*)p)->handle);
    return NULL;
}
#endif

static void async_hook_sync(napi_async_cleanup_hook_handle handle, void* data) {
    (void)data;
    printf("hook-invoked\n");
    fflush(stdout);
    complete(handle);
}

static void async_hook_deferred(napi_async_cleanup_hook_handle handle, void* data) {
    (void)data;
    printf("hook-invoked\n");
    fflush(stdout);
    g_ctx.handle = handle;
#ifdef _WIN32
    HANDLE th = CreateThread(NULL, 0, completer_thread, &g_ctx, 0, NULL);
    if (th) CloseHandle(th);
#else
    pthread_t th;
    pthread_create(&th, NULL, completer_thread, &g_ctx);
    pthread_detach(th);
#endif
}

static void instance_data_finalizer(napi_env env, void* data, void* hint) {
    (void)env;
    (void)data;
    (void)hint;
    printf("instance-data-finalized\n");
    fflush(stdout);
}

static napi_value arm(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    int32_t mode = 0;
    if (argc >= 1) {
        napi_get_value_int32(env, argv[0], &mode);
    }

    napi_set_instance_data(env, &g_ctx, instance_data_finalizer, NULL);

    napi_async_cleanup_hook_handle h = NULL;
    napi_status status = napi_add_async_cleanup_hook(
        env,
        mode == 0 ? async_hook_sync : async_hook_deferred,
        NULL,
        &h);
    printf("armed:%d status=%d\n", mode, (int)status);
    fflush(stdout);
    return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, "arm", NAPI_AUTO_LENGTH, arm, NULL, &fn);
    napi_set_named_property(env, exports, "arm", fn);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

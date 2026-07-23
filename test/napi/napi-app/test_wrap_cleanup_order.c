#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>

// Verifies napi_wrap finalizers run in reverse insertion order (LIFO) during env teardown.
// Native modules like sqlite3/duckdb wrap a parent (Database) before children (Statement)
// and the child destructor dereferences the parent; arbitrary order is a use-after-free.

static int finalize_log[256];
static int finalize_log_len = 0;
static int parent_alive = 0;

static void print_order(void) {
    printf("finalize order:");
    for (int i = 0; i < finalize_log_len; i++) {
        printf(" %d", finalize_log[i]);
    }
    printf("\n");
    fflush(stdout);
}

static void parent_finalize(napi_env env, void* data, void* hint) {
    (void)env;
    (void)hint;
    finalize_log[finalize_log_len++] = *(int*)data;
    parent_alive = 0;
    free(data);
    print_order();
}

static void child_finalize(napi_env env, void* data, void* hint) {
    (void)env;
    (void)hint;
    if (!parent_alive) {
        finalize_log[finalize_log_len++] = *(int*)data;
        print_order();
        fprintf(stderr, "FAIL: child %d finalizer ran after parent was destroyed\n", *(int*)data);
        fflush(stderr);
        abort();
    }
    finalize_log[finalize_log_len++] = *(int*)data;
    free(data);
}

static napi_value create_parent_and_children(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, NULL, NULL);

    int child_count = 32;
    if (argc >= 1) {
        napi_get_value_int32(env, args[0], &child_count);
    }

    napi_value result;
    napi_create_array(env, &result);

    napi_value parent;
    napi_create_object(env, &parent);
    int* parent_id = (int*)malloc(sizeof(int));
    *parent_id = 0;
    parent_alive = 1;
    napi_wrap(env, parent, parent_id, parent_finalize, NULL, NULL);
    napi_set_element(env, result, 0, parent);

    for (int i = 0; i < child_count; i++) {
        napi_value child;
        napi_create_object(env, &child);
        int* child_id = (int*)malloc(sizeof(int));
        *child_id = i + 1;
        napi_wrap(env, child, child_id, child_finalize, NULL, NULL);
        napi_set_element(env, result, i + 1, child);
    }

    return result;
}

static napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        { "createParentAndChildren", 0, create_parent_and_children, 0, 0, 0, napi_default, 0 },
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

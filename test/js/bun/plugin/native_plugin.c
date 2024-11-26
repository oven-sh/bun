/*
  Dummy plugin which counts the occurences of the word "foo" in the source code,
  replacing it with "boo".

  It stores the number of occurences in the External struct.
*/
#include <stdlib.h>
#include <stdio.h>
#include <node_api.h>
#include <string.h>
#include <stdatomic.h>
#include <bun-native-bundler-plugin-api/bundler_plugin.h>

typedef struct {
    atomic_size_t foo_count;
    // For testing logging error logic
    atomic_bool throws_an_error;
} External;

void log_error(const OnBeforeParseArguments* args, const OnBeforeParseResult* result, BunLogLevel level, const char* message, size_t message_len) {
    BunLogOptions options = (BunLogOptions) {
        .message_ptr = (uint8_t*)message,
        .message_len = message_len,
        .path_ptr = args->path_ptr,
        .path_len = args->path_len,
        .source_line_text_ptr = NULL,
        .source_line_text_len = 0,
        .level = level,
        .line = 0,
        .lineEnd = 0,
        .column = 0,
        .columnEnd = 0,
    };
    (result->log)(args, &options);
}

void plugin_impl(const OnBeforeParseArguments* args, OnBeforeParseResult* result) {
    // if (args->__struct_size < sizeof(OnBeforeParseArguments)) {
    //     log_error(args, result, BUN_LOG_LEVEL_ERROR, "Invalid OnBeforeParseArguments struct size", sizeof("Invalid OnBeforeParseArguments struct size") - 1);
    //     return;
    // }

    if (args->external) {
        External* external = (External*)args->external;
        if (atomic_load(&external->throws_an_error)) {
            log_error(args, result, BUN_LOG_LEVEL_ERROR, "Throwing an error", sizeof("Throwing an error") - 1);
            return;
        }
    }

    int fetch_result = result->fetchSourceCode(args, result);
    if (fetch_result != 0) {
        printf("FUCK\n");
        exit(1);
    }

    int foo_count = 0;

    const char *end = (const char *)result->source_ptr + result->source_len;

    char *cursor = strnstr((const char *)result->source_ptr, "foo", result->source_len);
    while (cursor != NULL) {
        foo_count++; 
        cursor += 3; 
        if (cursor + 3 < end) {
            cursor = strnstr((const char*) cursor, "foo", (size_t) (end - cursor));
        } else break;
    }

    if (foo_count > 0) {
        char *new_source = (char *)malloc(result->source_len);
        if (new_source == NULL) {
            printf("FUCK\n");
            exit(1);
        }
        memcpy(new_source, result->source_ptr, result->source_len);
        cursor = strnstr(new_source, "foo", result->source_len);
        while (cursor != NULL) {
            *cursor = 'b';
            cursor += 3; 
            if (cursor + 3 < end) {
                cursor = strnstr((const char*) cursor, "foo", (size_t) (end - cursor));
            } else break;
        }
        if (args->external) {
            External *external = (External*)args->external;
            atomic_fetch_add(&external->foo_count, foo_count);
        }
        result->source_ptr = (uint8_t*)new_source;
        result->source_len = result->source_len;
    } else {
        result->source_ptr = NULL;
        result->source_len = 0;
        result->loader = 0;
    }

}

void finalizer(napi_env env, void* data, void* hint) {
    External* external = (External*)data;
    if (external != NULL) {
        free(external);
    }
}

napi_value create_external(napi_env env, napi_callback_info info) {
    napi_status status;
    
    // Allocate the External struct
    External* external = malloc(sizeof(External));
    if (external == NULL) {
        napi_throw_error(env, NULL, "Failed to allocate memory");
        return NULL;
    }

    external->foo_count = 0;

    // Create the external wrapper
    napi_value result;
    status = napi_create_external(env, external, finalizer, NULL, &result);
    if (status != napi_ok) {
        free(external);
        napi_throw_error(env, NULL, "Failed to create external");
        return NULL;
    }

    return result;
}

napi_value set_throws_errors(napi_env env, napi_callback_info info) {
    napi_status status;
    External* external;

    size_t argc = 1;
    napi_value args[1];
    status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to parse arguments");
        return NULL;
    }

    if (argc < 1) {
        napi_throw_error(env, NULL, "Wrong number of arguments");
        return NULL;
    }

    status = napi_get_value_external(env, args[0], (void**)&external);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to get external");
        return NULL;
    }

    bool throws;
    status = napi_get_value_bool(env, args[0], &throws);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to get boolean value");
        return NULL;
    }

    atomic_store(&external->throws_an_error, throws);

    return NULL;
}

napi_value get_foo_count(napi_env env, napi_callback_info info) {
    napi_status status;
    External* external;

    size_t argc = 1;
    napi_value args[1];
    status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to parse arguments");
        return NULL;
    }

    if (argc < 1) {
        napi_throw_error(env, NULL, "Wrong number of arguments");
        return NULL;
    }

    status = napi_get_value_external(env, args[0], (void**)&external);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to get external");
        return NULL;
    }

    size_t foo_count = atomic_load(&external->foo_count);
    if (foo_count > INT32_MAX) {
        napi_throw_error(env, NULL, "Too many foos! This probably means undefined memory or heap corruption.");
        return NULL;
    }

    napi_value result;
    status = napi_create_int32(env, foo_count, &result);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to create array");
        return NULL;
    }


    return result;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_status status;
    napi_value fn_get_names;
    napi_value fn_create_external;
    napi_value fn_set_throws_errors;

    // Register get_names function
    status = napi_create_function(env, NULL, 0, get_foo_count, NULL, &fn_get_names);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to create get_names function");
        return NULL;
    }
    status = napi_set_named_property(env, exports, "getFooCount", fn_get_names);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to add get_names function to exports");
        return NULL;
    }

    // Register set_throws_errors function  
    status = napi_create_function(env, NULL, 0, set_throws_errors, NULL, &fn_set_throws_errors);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to create set_throws_errors function");
        return NULL;
    }
    status = napi_set_named_property(env, exports, "setThrowsErrors", fn_set_throws_errors);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to add set_throws_errors function to exports");
        return NULL;
    }

    // Register create_external function  
    status = napi_create_function(env, NULL, 0, create_external, NULL, &fn_create_external);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to create create_external function");
        return NULL;
    }
    status = napi_set_named_property(env, exports, "createExternal", fn_create_external);
    if (status != napi_ok) {
        napi_throw_error(env, NULL, "Failed to add create_external function to exports");
        return NULL;
    }

    return exports;
}

typedef struct {
    size_t __struct_size;
    void* bun;
    const uint8_t* path_ptr;
    size_t path_len;
    const uint8_t* namespace_ptr;
    size_t namespace_len;
    uint8_t default_loader;
    void *external;
    size_t new_field_one;
    size_t new_field_two;
    size_t new_field_three;
} NewOnBeforeParseArguments;

typedef struct NewOnBeforeParseResult {
    size_t __struct_size;
    uint8_t* source_ptr;
    size_t source_len;
    uint8_t loader;
    int (*fetchSourceCode)(
        const NewOnBeforeParseArguments* args,
        struct NewOnBeforeParseResult* result
    );
    void* plugin_source_code_context;
    void (*free_plugin_source_code_context)(void* ctx);
    void (*log)(const NewOnBeforeParseArguments* args, BunLogOptions* options);
    size_t new_field_one;
    size_t new_field_two;
    size_t new_field_three;
} NewOnBeforeParseResult;


void new_log_error(const NewOnBeforeParseArguments* args, const NewOnBeforeParseResult* result, BunLogLevel level, const char* message, size_t message_len) {
    BunLogOptions options = (BunLogOptions) {
        .message_ptr = (uint8_t*)message,
        .message_len = message_len,
        .path_ptr = args->path_ptr,
        .path_len = args->path_len,
        .source_line_text_ptr = NULL,
        .source_line_text_len = 0,
        .level = level,
        .line = 0,
        .lineEnd = 0,
        .column = 0,
        .columnEnd = 0,
    };
    (result->log)(args, &options);
}

void incompatible_version_plugin_impl(const NewOnBeforeParseArguments* args, NewOnBeforeParseResult* result) {
    if (args->__struct_size < sizeof(NewOnBeforeParseArguments)) {
        const char *msg = "This plugin is built for a newer version of Bun than the one currently running.";
        new_log_error(args, result, BUN_LOG_LEVEL_ERROR, msg, strlen(msg));
        return;
    }

    if (result->__struct_size < sizeof(NewOnBeforeParseResult)) {
        const char *msg = "This plugin is built for a newer version of Bun than the one currently running.";
        new_log_error(args, result, BUN_LOG_LEVEL_ERROR, msg, strlen(msg));
        return;
    }
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
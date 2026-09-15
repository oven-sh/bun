{
    "targets": [
        {
            "target_name": "napitests",
            "cflags!": ["-fno-exceptions"],
            "cflags_cc!": ["-fno-exceptions"],
            "msvs_settings": {
                "VCCLCompilerTool": {
                    "ExceptionHandling": "0",
                    "AdditionalOptions": ["/std:c++20"],
                },
            },
            # leak tests are unused as of #14501
            "sources": ["main.cpp", "async_tests.cpp", "class_test.cpp", "conversion_tests.cpp", "js_test_helpers.cpp", "standalone_tests.cpp", "wrap_tests.cpp", "get_string_tests.cpp"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "second_addon",
            "sources": ["second_addon.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "nullptr_addon",
            "sources": ["null_addon.cpp"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
                "MODULE_INIT_RETURN_NULLPTR=1"
            ],
        },
        {
            "target_name": "null_addon",
            "sources": ["null_addon.cpp"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
                "MODULE_INIT_RETURN_NULL=1"
            ],
        },
        {
            "target_name": "undefined_addon",
            "sources": ["null_addon.cpp"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
                "MODULE_INIT_RETURN_UNDEFINED=1"
            ],
        },
        {
            "target_name": "throw_addon",
            "sources": ["null_addon.cpp"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
                "MODULE_INIT_THROW=1"
            ],
        },
        {
            "target_name": "async_finalize_addon",
            "sources": ["async_finalize_addon.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
            ],
        },
        {
            "target_name": "ffi_addon_1",
            "sources": ["ffi_addon_1.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "ffi_addon_2",
            "sources": ["ffi_addon_2.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "constructor_order_addon",
            "sources": ["constructor_order_addon.cpp"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
            ],
        },
        {
            "target_name": "reentrant_register_addon",
            "sources": ["reentrant_register_addon.cpp"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
            ],
        },
        {
            "target_name": "test_cleanup_hook_order",
            "sources": ["test_cleanup_hook_order.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_cleanup_hook_remove_nonexistent",
            "sources": ["test_cleanup_hook_remove_nonexistent.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_async_cleanup_hook_remove_nonexistent",
            "sources": ["test_async_cleanup_hook_remove_nonexistent.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_async_cleanup_hook_tsfn_release",
            "sources": ["test_async_cleanup_hook_tsfn_release.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_cleanup_hook_duplicates",
            "sources": ["test_cleanup_hook_duplicates.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_cleanup_hook_duplicates_release",
            "sources": ["test_cleanup_hook_duplicates_release.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_cleanup_hook_mixed_order",
            "sources": ["test_cleanup_hook_mixed_order.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_cleanup_hook_modification_during_iteration",
            "sources": ["test_cleanup_hook_modification_during_iteration.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_finalizer_iterator_invalidation",
            "sources": ["test_finalizer_iterator_invalidation.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_reference_unref_in_finalizer",
            "sources": ["test_reference_unref_in_finalizer.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_reference_unref_in_finalizer_experimental",
            "sources": ["test_reference_unref_in_finalizer_experimental.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
                "NAPI_VERSION_EXPERIMENTAL=1",
            ],
        },
        {
            "target_name": "test_wrap_cleanup_order",
            "sources": ["test_wrap_cleanup_order.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_last_error_cannot_run_js",
            "sources": ["test_last_error_cannot_run_js.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_delete_ref_in_finalizer_experimental",
            "sources": ["test_delete_ref_in_finalizer_experimental.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_delete_ref_cancels_finalizer",
            "sources": ["test_delete_ref_cancels_finalizer.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_finalizer_create_error",
            "sources": ["test_finalizer_create_error.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        },
        {
            "target_name": "test_create_reference_primitive_v10",
            "sources": ["test_create_reference_primitive.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NAPI_VERSION=10",
            ],
        },
        {
            "target_name": "test_create_reference_primitive_v8",
            "sources": ["test_create_reference_primitive.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NAPI_VERSION=8",
            ],
        },
        # The five targets below are the Windows link shapes of an addon that names node.exe in its
        # import tables without node-gyp's win_delay_load_hook (https://github.com/oven-sh/bun/issues/10690).
        # napi.test.ts asserts each binary's PE import shape before loading it. On other platforms
        # they are ordinary addons.
        {
            "target_name": "no_delay_load_hook_addon",
            "sources": ["no_delay_load_hook_addon.c"],
            # /DELAYLOAD:node.exe with no hook: cmake-js projects that omit ${CMAKE_JS_SRC}.
            "win_delay_load_hook": "false",
            "conditions": [
                ["OS=='win'", {
                    "msvs_settings": {
                        "VCLinkerTool": {
                            "DelayLoadDLLs": ["node.exe"],
                        },
                    },
                }],
            ],
        },
        {
            "target_name": "regular_node_exe_import_addon",
            "sources": ["no_delay_load_hook_addon.c"],
            # Load-time node.exe import: Zig/Rust prebuilds linked straight against node.lib (#30454).
            "win_delay_load_hook": "false",
        },
        {
            "target_name": "no_delay_load_hook_ctor_addon",
            "sources": ["no_delay_load_hook_addon.c"],
            "defines": ["REGISTER_VIA_CONSTRUCTOR"],
            # As above, registering from a static initializer (node_api.h < 18.17), i.e. inside DllMain.
            "win_delay_load_hook": "false",
            "conditions": [
                ["OS=='win'", {
                    "msvs_settings": {
                        "VCLinkerTool": {
                            "DelayLoadDLLs": ["node.exe"],
                        },
                    },
                }],
            ],
        },
        {
            "target_name": "regular_node_exe_import_ctor_addon",
            "sources": ["no_delay_load_hook_addon.c"],
            "defines": ["REGISTER_VIA_CONSTRUCTOR"],
            "win_delay_load_hook": "false",
        },
        {
            "target_name": "regular_node_exe_import_missing_addon",
            "sources": ["no_delay_load_hook_addon.c"],
            "defines": ["IMPORT_MISSING_FROM_HOST"],
            # Load-time node.exe import of a symbol bun.exe does not export: must fail to load, cleanly.
            "win_delay_load_hook": "false",
        },
    ]
}

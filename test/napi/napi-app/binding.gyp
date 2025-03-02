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
            "sources": ["main.cpp", "async_tests.cpp", "class_test.cpp", "conversion_tests.cpp", "js_test_helpers.cpp", "standalone_tests.cpp", "wrap_tests.cpp"],
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

    ]
}

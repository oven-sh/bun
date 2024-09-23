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
            "sources": ["main.cpp"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
                "NODE_API_EXPERIMENTAL_NOGC_ENV_OPT_OUT=1",
            ],
        }
    ]
}

{
    # Deliberately its own fixture (not test/napi/napi-app): the regression test
    # for #30205 only needs this one plain-C target, so building all of
    # napi-app's targets in its beforeAll was pure waste.
    "targets": [
        {
            "target_name": "isolate_finalizer_addon",
            "sources": ["isolate_finalizer_addon.c"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": [],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": [
                "NAPI_DISABLE_CPP_EXCEPTIONS",
            ],
        },
    ]
}

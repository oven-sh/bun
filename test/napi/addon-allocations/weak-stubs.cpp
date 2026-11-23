// An addon that carries weak stubs of Node-API functions, as the one of Dawn (the webgpu package) does. The loader has
// to put the runtime's functions in their place.
#include <cstdio>
#include <node_api.h>

extern "C" __attribute__((weak)) napi_status napi_create_string_utf8(napi_env, const char*, size_t, napi_value*)
{
    puts("the addon's weak stub of napi_create_string_utf8 ran");
    fflush(stdout);
    return napi_generic_failure;
}

NAPI_MODULE_INIT()
{
    napi_value text;
    if (napi_create_string_utf8(env, "made by the runtime", NAPI_AUTO_LENGTH, &text) == napi_ok)
        napi_set_named_property(env, exports, "text", text);
    return exports;
}

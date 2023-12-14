#include "node.h"

#include <napi.h>
#include <iostream>


napi_value fail(napi_env env, const char *msg)
{
    napi_value result;
    napi_create_string_utf8(env, msg, NAPI_AUTO_LENGTH, &result);
    return result;
}

napi_value ok(napi_env env)
{
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}


napi_value test_napi_get_value_string_utf8_with_buffer(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    // get how many chars we need to copy
    uint32_t _len;
    if (napi_get_value_uint32(env, info[1], &_len) != napi_ok) {
        return fail(env, "call to napi_get_value_uint32 failed");
    }
    size_t len = (size_t)_len;

    if (len == 424242) {
        len = NAPI_AUTO_LENGTH;
    } else if (len > 29) {
        return fail(env, "len > 29");
    }

    size_t copied;
    size_t BUF_SIZE = 30;
    char buf[BUF_SIZE];
    memset(buf, '*', BUF_SIZE);
    buf[BUF_SIZE] = '\0';

    if (napi_get_value_string_utf8(env, info[0], buf, len, &copied) != napi_ok) {
        return fail(env, "call to napi_get_value_string_utf8 failed");
    }

    std::cout << "Chars to copy: " << len << std::endl;
    std::cout << "Copied chars: " << copied << std::endl;
    std::cout << "Buffer: ";
    for (size_t i = 0; i < BUF_SIZE; i++) {
        std::cout << (int)buf[i] << ", ";
    }
    std::cout << std::endl;
    std::cout << "Value str: " << buf << std::endl;
    return ok(env);
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports)
{
    // check that these symbols are defined
    auto *isolate = v8::Isolate::GetCurrent();
    node::AddEnvironmentCleanupHook(
        isolate, [](void *) { }, isolate);
    node::RemoveEnvironmentCleanupHook(
        isolate, [](void *) { }, isolate);

    exports.Set(
        "test_napi_get_value_string_utf8_with_buffer", Napi::Function::New(env, test_napi_get_value_string_utf8_with_buffer));
    return exports;
}

NODE_API_MODULE(napitests, InitAll)

#include <napi.h>

// This reproduces the issue from https://github.com/oven-sh/bun/issues/4526
// where Napi::Error::New(env, "MESSAGE").ThrowAsJavaScriptException() causes SIGSEGV

Napi::Value ThrowException(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // This should cause a SIGSEGV in Bun (but works fine in Node.js)
    Napi::Error::New(env, "Test error message").ThrowAsJavaScriptException();
    
    return env.Null();
}

Napi::Value ThrowExceptionWorkaround(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // This is the workaround mentioned in the issue - throwing in C++ space
    throw Napi::Error::New(env, "Test error message");
    
    return env.Null();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "throwException"), 
                Napi::Function::New(env, ThrowException));
    exports.Set(Napi::String::New(env, "throwExceptionWorkaround"), 
                Napi::Function::New(env, ThrowExceptionWorkaround));
    return exports;
}

NODE_API_MODULE(test_throw_exception_segfault, Init)
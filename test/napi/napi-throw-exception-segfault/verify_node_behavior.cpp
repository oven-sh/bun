#include <napi.h>
#include <iostream>

// Clean test to verify Node.js handles "throw after catch" correctly
// This should work fine in Node.js but crash in Bun

Napi::Value ThrowAfterCatchClean(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "[C++] Starting throw after catch test..." << std::endl;
    
    try {
        std::cout << "[C++] Throwing first exception..." << std::endl;
        Napi::Error::New(env, "First exception").ThrowAsJavaScriptException();
        std::cout << "[C++] ERROR: Should not reach here after first throw!" << std::endl;
    } catch (const Napi::Error& e) {
        std::cout << "[C++] Caught first Napi::Error: " << e.Message() << std::endl;
    } catch (...) {
        std::cout << "[C++] Caught first unknown exception" << std::endl;
    }
    
    std::cout << "[C++] Now throwing second exception..." << std::endl;
    
    // This second throw should work in Node.js but causes assertion failure in Bun
    Napi::Error::New(env, "Second exception after catch").ThrowAsJavaScriptException();
    
    std::cout << "[C++] ERROR: Should not reach here after second throw!" << std::endl;
    return env.Null();
}

Napi::Value SimpleThrow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "[C++] Simple throw test..." << std::endl;
    Napi::Error::New(env, "Simple exception").ThrowAsJavaScriptException();
    
    return env.Null();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "throwAfterCatchClean"), 
                Napi::Function::New(env, ThrowAfterCatchClean));
    exports.Set(Napi::String::New(env, "simpleThrow"), 
                Napi::Function::New(env, SimpleThrow));
    return exports;
}

NODE_API_MODULE(verify_node_behavior, Init)
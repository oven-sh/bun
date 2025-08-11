#include <napi.h>
#include <iostream>

// Reproduces a new issue found in Bun's NAPI exception handling
// The rapid throws test reveals an assertion failure in JavaScriptCore

Napi::Value SimpleRapidThrows(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing simple rapid throws..." << std::endl;
    
    // Try multiple throws in a loop - this causes assertion failure in Bun
    for (int i = 0; i < 10; ++i) {
        try {
            std::string message = "Rapid throw #" + std::to_string(i);
            std::cout << "Throwing: " << message << std::endl;
            Napi::Error::New(env, message).ThrowAsJavaScriptException();
            std::cout << "After throw (should not see this)" << std::endl;
        } catch (...) {
            std::cout << "Caught C++ exception for #" << i << std::endl;
            // Continue to next iteration
        }
    }
    
    return env.Null();
}

Napi::Value SingleThrow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing single throw..." << std::endl;
    Napi::Error::New(env, "Single throw").ThrowAsJavaScriptException();
    
    return env.Null();
}

Napi::Value ThrowAfterCatch(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing throw after catch..." << std::endl;
    
    try {
        Napi::Error::New(env, "First throw").ThrowAsJavaScriptException();
    } catch (...) {
        std::cout << "Caught first exception, throwing second..." << std::endl;
    }
    
    // Second throw after catching the first
    Napi::Error::New(env, "Second throw").ThrowAsJavaScriptException();
    
    return env.Null();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "simpleRapidThrows"), 
                Napi::Function::New(env, SimpleRapidThrows));
    exports.Set(Napi::String::New(env, "singleThrow"), 
                Napi::Function::New(env, SingleThrow));
    exports.Set(Napi::String::New(env, "throwAfterCatch"), 
                Napi::Function::New(env, ThrowAfterCatch));
    return exports;
}

NODE_API_MODULE(test_rapid_throws, Init)
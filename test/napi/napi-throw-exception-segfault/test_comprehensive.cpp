#include <napi.h>
#include <iostream>

// This reproduces issue #4526 more comprehensively using various C++ NAPI patterns

// Test 1: Direct ThrowAsJavaScriptException (the original issue)
Napi::Value DirectThrowException(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing direct ThrowAsJavaScriptException..." << std::endl;
    
    // This was the problematic line from the original issue
    Napi::Error::New(env, "Direct throw error message").ThrowAsJavaScriptException();
    
    // This should never be reached if the exception is thrown properly
    return env.Null();
}

// Test 2: Create error then throw separately
Napi::Value CreateThenThrow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing create then throw..." << std::endl;
    
    auto error = Napi::Error::New(env, "Created then thrown error");
    error.ThrowAsJavaScriptException();
    
    return env.Null();
}

// Test 3: Multiple exception types
Napi::Value ThrowTypeError(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing TypeError throw..." << std::endl;
    
    Napi::TypeError::New(env, "Type error message").ThrowAsJavaScriptException();
    
    return env.Null();
}

Napi::Value ThrowRangeError(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing RangeError throw..." << std::endl;
    
    Napi::RangeError::New(env, "Range error message").ThrowAsJavaScriptException();
    
    return env.Null();
}

// Test 4: C++ exception (the workaround from original issue)
Napi::Value ThrowCppException(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing C++ throw (workaround)..." << std::endl;
    
    // This was mentioned as working in the original issue
    throw Napi::Error::New(env, "C++ thrown error");
    
    return env.Null();
}

// Test 5: Throw with error code
Napi::Value ThrowWithCode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing throw with error code..." << std::endl;
    
    auto error = Napi::Error::New(env, "Error with code");
    error.Set("code", Napi::String::New(env, "TEST_ERROR_CODE"));
    error.ThrowAsJavaScriptException();
    
    return env.Null();
}

// Test 6: Nested function call with exception
Napi::Value NestedThrow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing nested function throw..." << std::endl;
    
    auto throwError = [&env]() {
        Napi::Error::New(env, "Nested error").ThrowAsJavaScriptException();
    };
    
    throwError();
    
    return env.Null();
}

// Test 7: Exception in callback
Napi::Value ThrowInCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing throw in callback..." << std::endl;
    
    if (info.Length() > 0 && info[0].IsFunction()) {
        auto callback = info[0].As<Napi::Function>();
        
        // Call the callback which should trigger an exception
        try {
            callback.Call({});
        } catch (const Napi::Error& e) {
            // Re-throw using ThrowAsJavaScriptException
            Napi::Error::New(env, "Callback error: " + std::string(e.Message())).ThrowAsJavaScriptException();
        }
    } else {
        Napi::Error::New(env, "Callback required").ThrowAsJavaScriptException();
    }
    
    return env.Null();
}

// Test 8: Multiple rapid throws (stress test)
Napi::Value RapidThrows(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing rapid throws..." << std::endl;
    
    for (int i = 0; i < 100; ++i) {
        try {
            std::string message = "Rapid throw #" + std::to_string(i);
            Napi::Error::New(env, message).ThrowAsJavaScriptException();
        } catch (...) {
            // Continue throwing
        }
    }
    
    // Final throw
    Napi::Error::New(env, "Final rapid throw").ThrowAsJavaScriptException();
    
    return env.Null();
}

// Test 9: Empty/null message handling
Napi::Value ThrowEmptyMessage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing empty message throw..." << std::endl;
    
    Napi::Error::New(env, "").ThrowAsJavaScriptException();
    
    return env.Null();
}

// Test 10: Very long message
Napi::Value ThrowLongMessage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::cout << "Testing long message throw..." << std::endl;
    
    std::string longMessage(10000, 'A');
    longMessage += " - End of long message";
    
    Napi::Error::New(env, longMessage).ThrowAsJavaScriptException();
    
    return env.Null();
}

// Initialize the module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "directThrow"), 
                Napi::Function::New(env, DirectThrowException));
    exports.Set(Napi::String::New(env, "createThenThrow"), 
                Napi::Function::New(env, CreateThenThrow));
    exports.Set(Napi::String::New(env, "throwTypeError"), 
                Napi::Function::New(env, ThrowTypeError));
    exports.Set(Napi::String::New(env, "throwRangeError"), 
                Napi::Function::New(env, ThrowRangeError));
    exports.Set(Napi::String::New(env, "throwCppException"), 
                Napi::Function::New(env, ThrowCppException));
    exports.Set(Napi::String::New(env, "throwWithCode"), 
                Napi::Function::New(env, ThrowWithCode));
    exports.Set(Napi::String::New(env, "nestedThrow"), 
                Napi::Function::New(env, NestedThrow));
    exports.Set(Napi::String::New(env, "throwInCallback"), 
                Napi::Function::New(env, ThrowInCallback));
    exports.Set(Napi::String::New(env, "rapidThrows"), 
                Napi::Function::New(env, RapidThrows));
    exports.Set(Napi::String::New(env, "throwEmptyMessage"), 
                Napi::Function::New(env, ThrowEmptyMessage));
    exports.Set(Napi::String::New(env, "throwLongMessage"), 
                Napi::Function::New(env, ThrowLongMessage));
    return exports;
}

NODE_API_MODULE(test_comprehensive, Init)
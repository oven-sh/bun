#include "gc_crash_test.h"

namespace napitests {

// This will be called when the finalizer runs during GC
void TestFinalizer(napi_env env, void* finalize_data, void* finalize_hint) {
    // This should trigger the crash in the original code
    // and return an error in the fixed code
    napi_value result;
    napi_status status = napi_create_object(env, &result);
    
    // With the fix, this should return napi_generic_failure instead of crashing
    // We can't really do much with the error in a finalizer, but at least
    // the process won't crash
}

// Function to create an object with a finalizer that will try to create objects during GC
Napi::Value CreateObjectWithBadFinalizer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // Create a simple object
    Napi::Object obj = Napi::Object::New(env);
    
    // Add a finalizer that will misbehave by trying to create objects during GC
    napi_add_finalizer(env, obj, nullptr, TestFinalizer, nullptr, nullptr);
    
    return obj;
}

void InitGCCrashTest(Napi::Env env, Napi::Object exports) {
    exports.Set("createObjectWithBadFinalizer", 
                Napi::Function::New(env, CreateObjectWithBadFinalizer));
}

}
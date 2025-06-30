#include <v8.h>
#include <iostream>
#include <cassert>

using namespace v8;

void test_object_get_by_key() {
    std::cout << "Testing Object::Get(context, key)..." << std::endl;
    
    Isolate* isolate = Isolate::GetCurrent();
    HandleScope handle_scope(isolate);
    Local<Context> context = isolate->GetCurrentContext();
    
    // Create an object and set a property
    Local<Object> obj = Object::New(isolate);
    Local<String> key = String::NewFromUtf8(isolate, "testKey").ToLocalChecked();
    Local<String> value = String::NewFromUtf8(isolate, "testValue").ToLocalChecked();
    
    // Set the property
    Maybe<bool> set_result = obj->Set(context, key, value);
    assert(set_result.FromJust() == true);
    
    // Get the property back
    MaybeLocal<Value> get_result = obj->Get(context, key);
    assert(!get_result.IsEmpty());
    
    Local<Value> retrieved = get_result.ToLocalChecked();
    assert(retrieved->IsString());
    
    // Verify the values are strictly equal
    assert(retrieved->StrictEquals(value));
    
    std::cout << "✅ Object::Get(context, key) test passed" << std::endl;
}

void test_object_get_by_index() {
    std::cout << "Testing Object::Get(context, index)..." << std::endl;
    
    Isolate* isolate = Isolate::GetCurrent();
    HandleScope handle_scope(isolate);
    Local<Context> context = isolate->GetCurrentContext();
    
    // Create an array and set an element
    Local<Array> arr = Array::New(isolate, 3);
    Local<Number> value = Number::New(isolate, 42.5);
    
    // Set element at index 1
    Maybe<bool> set_result = arr->Set(context, 1, value);
    assert(set_result.FromJust() == true);
    
    // Get element back by index
    MaybeLocal<Value> get_result = arr->Get(context, 1);
    assert(!get_result.IsEmpty());
    
    Local<Value> retrieved = get_result.ToLocalChecked();
    assert(retrieved->IsNumber());
    
    // Verify the values are strictly equal
    assert(retrieved->StrictEquals(value));
    
    std::cout << "✅ Object::Get(context, index) test passed" << std::endl;
}

void test_strict_equals() {
    std::cout << "Testing Value::StrictEquals()..." << std::endl;
    
    Isolate* isolate = Isolate::GetCurrent();
    HandleScope handle_scope(isolate);
    
    // Test number equality
    Local<Number> num1 = Number::New(isolate, 123.45);
    Local<Number> num2 = Number::New(isolate, 123.45);
    Local<Number> num3 = Number::New(isolate, 67.89);
    
    assert(num1->StrictEquals(num2));  // Same values should be equal
    assert(!num1->StrictEquals(num3)); // Different values should not be equal
    
    // Test string equality
    Local<String> str1 = String::NewFromUtf8(isolate, "hello").ToLocalChecked();
    Local<String> str2 = String::NewFromUtf8(isolate, "hello").ToLocalChecked();
    Local<String> str3 = String::NewFromUtf8(isolate, "world").ToLocalChecked();
    
    assert(str1->StrictEquals(str2));  // Same strings should be equal
    assert(!str1->StrictEquals(str3)); // Different strings should not be equal
    
    // Test different types are not equal
    assert(!num1->StrictEquals(str1)); // Number != String
    
    // Test null and undefined
    Local<Value> null_val = Null(isolate);
    Local<Value> undef_val = Undefined(isolate);
    
    assert(!null_val->StrictEquals(undef_val)); // null !== undefined
    
    std::cout << "✅ Value::StrictEquals() test passed" << std::endl;
}

void test_exception_handling() {
    std::cout << "Testing exception handling..." << std::endl;
    
    Isolate* isolate = Isolate::GetCurrent();
    HandleScope handle_scope(isolate);
    Local<Context> context = isolate->GetCurrentContext();
    
    // Test getting property from non-object (should return empty)
    Local<String> str = String::NewFromUtf8(isolate, "not an object").ToLocalChecked();
    Local<String> key = String::NewFromUtf8(isolate, "prop").ToLocalChecked();
    
    // This should not crash but might return empty
    MaybeLocal<Value> result = str->ToObject(context).ToLocalChecked()->Get(context, key);
    // The result might be empty or undefined, but shouldn't crash
    
    std::cout << "✅ Exception handling test passed" << std::endl;
}

int main() {
    // Initialize V8
    v8::V8::InitializeICUDefaultLocation("");
    v8::V8::InitializeExternalStartupData("");
    std::unique_ptr<v8::Platform> platform = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(platform.get());
    v8::V8::Initialize();
    
    // Create isolate and context
    v8::Isolate::CreateParams create_params;
    create_params.array_buffer_allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    v8::Isolate* isolate = v8::Isolate::New(create_params);
    
    {
        v8::Isolate::Scope isolate_scope(isolate);
        v8::HandleScope handle_scope(isolate);
        v8::Local<v8::Context> context = v8::Context::New(isolate);
        v8::Context::Scope context_scope(context);
        
        // Run the tests
        test_object_get_by_key();
        test_object_get_by_index();
        test_strict_equals();
        test_exception_handling();
        
        std::cout << "\n🎉 All V8 Object::Get and Value::StrictEquals tests passed!" << std::endl;
    }
    
    // Cleanup
    isolate->Dispose();
    delete create_params.array_buffer_allocator;
    v8::V8::Dispose();
    v8::V8::ShutdownPlatform();
    
    return 0;
}
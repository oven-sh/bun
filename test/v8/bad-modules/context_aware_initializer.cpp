#include <node.h>

// This module registers ONLY via NODE_MODULE_INITIALIZER (exported
// node_register_module_v<ABI> symbol), with no static-constructor call to
// node_module_register. uWebSockets.js uses this pattern.
//
// Before the fix for https://github.com/oven-sh/bun/issues/9785, loading
// such a module failed with "symbol 'napi_register_module_v1' not found".

using namespace v8;

extern "C" NODE_MODULE_EXPORT void NODE_MODULE_INITIALIZER(Local<Object> exports,
                                                           Local<Value> module,
                                                           Local<Context> context) {
  Isolate *isolate = Isolate::GetCurrent();
  exports
      ->Set(context,
            String::NewFromUtf8(isolate, "hello", NewStringType::kNormal)
                .ToLocalChecked(),
            String::NewFromUtf8(isolate, "world", NewStringType::kNormal)
                .ToLocalChecked())
      .Check();
}

#include <node.h>

// As in uWebSockets.js, the only entry is node_register_module_v<ABI>.

static void hello(const v8::FunctionCallbackInfo<v8::Value> &info) {
  info.GetReturnValue().Set(
      v8::String::NewFromUtf8(info.GetIsolate(), "world").ToLocalChecked());
}

extern "C" NODE_MODULE_EXPORT void
NODE_MODULE_INITIALIZER(v8::Local<v8::Object> exports,
                        v8::Local<v8::Value> module,
                        v8::Local<v8::Context> context) {
  NODE_SET_METHOD(exports, "hello", hello);
}

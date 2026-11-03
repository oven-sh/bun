#include <node.h>

#include <cstdlib>

// As test/addons/hello-world of Node: the module registers itself with another
// module version than that of the runtime, and the runtime then looks for
// node_register_module_v<ABI>.

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

static void never_called(v8::Local<v8::Object> exports,
                         v8::Local<v8::Value> module, void *priv) {
  abort();
}

extern "C" {
static node::node_module _module = {
    3,                              // nm_version
    0,                              // nm_flags
    nullptr,                        // nm_dso_handle
    "registered_other_version.cpp", // nm_filename
    never_called,                   // nm_register_func
    nullptr,                        // nm_context_register_func
    "registered_other_version",     // nm_modname
    nullptr,                        // nm_priv
    nullptr,                        // nm_link
};

NODE_C_CTOR(_register_registered_other_version) {
  node_module_register(&_module);
}
}

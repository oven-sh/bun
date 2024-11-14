#include <node.h>

void init(v8::Local<v8::Object> exports, v8::Local<v8::Value> module,
          void *priv) {
  // this should not even get called
  abort();
}

extern "C" {
static node::node_module _module = {
    // bun expects 127
    42,                           // nm_version
    0,                            // nm_flags
    nullptr,                      // nm_dso_handle
    "mismatched_abi_version.cpp", // nm_filename
    init,                         // nm_register_func
    nullptr,                      // nm_context_register_func
    "mismatched_abi_version",     // nm_modname
    nullptr,                      // nm_priv
    nullptr,                      // nm_link
};

NODE_C_CTOR(_register_mismatched_abi_version) {
  node_module_register(&_module);
}
}

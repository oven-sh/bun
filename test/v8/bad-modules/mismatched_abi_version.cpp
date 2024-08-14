#include <node.h>

void init(v8::Local<v8::Object> exports, v8::Local<v8::Value> module,
          void *priv) {
  // this should not even get called
  abort();
}

extern "C" {
static node::node_module _module = {
    // bun expects 127
    .nm_version = 42,
    .nm_flags = 0,
    .nm_dso_handle = nullptr,
    .nm_filename = "mismatched_abi_version.cpp",
    .nm_register_func = init,
    .nm_context_register_func = nullptr,
    .nm_modname = "mismatched_abi_version",
    .nm_priv = nullptr,
    .nm_link = nullptr,
};

static void _register_mismatched_abi_version(void) __attribute__((constructor));

static void _register_mismatched_abi_version(void) {
  node_module_register(&_module);
}
}

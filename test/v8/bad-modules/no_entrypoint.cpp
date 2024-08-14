#include <node.h>

extern "C" {
static node::node_module _module = {
    .nm_version = 127,
    .nm_flags = 0,
    .nm_dso_handle = nullptr,
    .nm_filename = "no_entrypoint.cpp",
    .nm_register_func = nullptr,
    .nm_context_register_func = nullptr,
    .nm_modname = "no_entrypoint",
    .nm_priv = nullptr,
    .nm_link = nullptr,
};

static void _register_mismatched_abi_version(void) __attribute__((constructor));

static void _register_mismatched_abi_version(void) {
  node_module_register(&_module);
}
}

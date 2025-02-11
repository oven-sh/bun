#include <node.h>

extern "C" {
static node::node_module _module = {
    127,                 // nm_version
    0,                   // nm_flags
    nullptr,             // nm_dso_handle
    "no_entrypoint.cpp", // nm_filename
    nullptr,             // nm_register_func
    nullptr,             // nm_context_register_func
    "no_entrypoint",     // nm_modname
    nullptr,             // nm_priv
    nullptr,             // nm_link
};

NODE_C_CTOR(_register_no_entrypoint) { node_module_register(&_module); }
}

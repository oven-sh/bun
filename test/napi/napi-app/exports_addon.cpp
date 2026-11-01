#include <napi.h>

// binding.gyp builds this file two ways. exports_addon exports the
// napi_register_module_v1 symbol. exports_module_register_addon calls
// napi_module_register from a static constructor. Both run the same Init.
//
// Init stores the `exports` it received in globalThis.exportsSeenByInit. Then
// it fills `exports` in steps: set a function, read it back, call it. C++
// exceptions are disabled, so when `exports` is not an object the failed calls
// leave empty values behind, and node-addon-api ends the process with
// napi_fatal_error.
//
// Init returns `exports`, or globalThis.initReturns when a test has set it.

static Napi::Value Hello(const Napi::CallbackInfo &info) {
  return Napi::String::New(info.Env(), "world");
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  Napi::Object global = env.Global();
  global.Set("exportsSeenByInit", exports);
  Napi::Value init_returns = global.Get("initReturns");

  exports.Set("hello", Napi::Function::New(env, Hello));
  exports.Set("greeting",
              exports.Get("hello").As<Napi::Function>().Call(0, nullptr));

  return init_returns.IsUndefined() ? exports : init_returns.As<Napi::Object>();
}

#ifdef USE_NAPI_MODULE_REGISTER
static napi_value register_cb(napi_env env, napi_value exports) {
  return Napi::RegisterModule(env, exports, Init);
}

static napi_module mod = {
    1,                               // nm_version
    0,                               // nm_flags
    "exports_addon.cpp",             // nm_filename
    register_cb,                     // nm_register_func
    "exports_module_register_addon", // nm_modname
    nullptr,                         // nm_priv
    {nullptr}                        // reserved
};

class call_register {
public:
  call_register() { napi_module_register(&mod); }
};

static call_register constructor1;
#else
NODE_API_MODULE(exports_addon, Init)
#endif

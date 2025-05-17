#include "napi_with_version.h"

#include "async_tests.h"
#include "class_test.h"
#include "conversion_tests.h"
#include "get_string_tests.h"
#include "js_test_helpers.h"
#include "standalone_tests.h"
#include "wrap_tests.h"

namespace napitests {

Napi::Value RunCallback(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  // this function is invoked without the GC callback
  Napi::Function cb = info[0].As<Napi::Function>();
  return cb.Call(env.Global(), {Napi::String::New(env, "hello world")});
}

Napi::Object Init2(Napi::Env env, Napi::Object exports) {
  return Napi::Function::New(env, RunCallback);
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports1) {
  // check that these symbols are defined
  auto *isolate = v8::Isolate::GetCurrent();

  Napi::Object exports = Init2(env, exports1);

  node::AddEnvironmentCleanupHook(isolate, [](void *) {}, isolate);
  node::RemoveEnvironmentCleanupHook(isolate, [](void *) {}, isolate);

  register_standalone_tests(env, exports);
  register_async_tests(env, exports);
  register_class_test(env, exports);
  register_js_test_helpers(env, exports);
  register_wrap_tests(env, exports);
  register_conversion_tests(env, exports);
  register_get_string_tests(env, exports);

  return exports;
}

NODE_API_MODULE(napitests, InitAll)

} // namespace napitests

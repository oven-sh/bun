#include "wrap_tests.h"

#include "utils.h"
#include <cassert>

namespace napitests {

Napi::Value make_weak_ref(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  // weak reference
  auto ref = Napi::Reference<Napi::Value>::New(info[0], 0);
  // destructor will be called
  return env.Undefined();
}

void register_leak_tests(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, make_weak_ref);
}

} // namespace napitests

#pragma once

// Functions exported to JS that make a class available with some interesting
// properties and methods

#include <napi.h>

namespace napitests {

void register_class_test(Napi::Env env, Napi::Object exports);

} // namespace napitests

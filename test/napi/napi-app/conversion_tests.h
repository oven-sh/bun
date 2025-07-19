#pragma once

// Includes both some callbacks for module.js to use, and a long pure-C++ test
// of Node-API conversion functions

#include "napi_with_version.h"

namespace napitests {

void register_conversion_tests(Napi::Env env, Napi::Object exports);

} // namespace napitests

#pragma once

// Exposes functions to JavaScript to test the `napi_get_value_string_*` methods

#include "napi_with_version.h"

namespace napitests {

void register_get_string_tests(Napi::Env env, Napi::Object exports);

} // namespace napitests

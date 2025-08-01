#pragma once

// Helper functions used by JS to test napi_wrap

#include "napi_with_version.h"

namespace napitests {

void register_wrap_tests(Napi::Env env, Napi::Object exports);

} // namespace napitests

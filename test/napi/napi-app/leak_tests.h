#pragma once

// Helper functions used by JS to test that napi_ref, napi_wrap, and
// napi_external don't leak memory

#include "napi_with_version.h"

namespace napitests {

void register_leak_tests(Napi::Env env, Napi::Object exports);

} // namespace napitests

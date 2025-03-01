#pragma once

// Functions that are used by tests implemented in module.js, rather than
// directly used by napi.test.ts, but are not complex enough or do not cleanly
// fit into a category to go in a separate C++ file

#include "napi_with_version.h"

namespace napitests {

void register_js_test_helpers(Napi::Env env, Napi::Object exports);

} // namespace napitests

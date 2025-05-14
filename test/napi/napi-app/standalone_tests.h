#pragma once

// Functions that are run as the entire test by napi.test.ts

#include "napi_with_version.h"

namespace napitests {

void register_standalone_tests(Napi::Env env, Napi::Object exports);

} // namespace napitests

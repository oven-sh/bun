#pragma once

// Tests that use napi_async_work or napi_deferred

#include "napi_with_version.h"

namespace napitests {

void register_async_tests(Napi::Env env, Napi::Object exports);

} // namespace napitests

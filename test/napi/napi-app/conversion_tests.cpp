#include "conversion_tests.h"

#include "utils.h"

#include <array>
#include <utility>

namespace napitests {

// double_to_i32(any): number|undefined
static napi_value double_to_i32(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value input = info[0];

  int32_t integer;
  napi_value result;
  napi_status status = napi_get_value_int32(env, input, &integer);
  if (status == napi_ok) {
    NODE_API_CALL(env, napi_create_int32(env, integer, &result));
  } else {
    NODE_API_ASSERT(env, status == napi_number_expected);
    NODE_API_CALL(env, napi_get_undefined(env, &result));
  }
  return result;
}

// double_to_u32(any): number|undefined
static napi_value double_to_u32(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value input = info[0];

  uint32_t integer;
  napi_value result;
  napi_status status = napi_get_value_uint32(env, input, &integer);
  if (status == napi_ok) {
    NODE_API_CALL(env, napi_create_uint32(env, integer, &result));
  } else {
    NODE_API_ASSERT(env, status == napi_number_expected);
    NODE_API_CALL(env, napi_get_undefined(env, &result));
  }
  return result;
}

// double_to_i64(any): number|undefined
static napi_value double_to_i64(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value input = info[0];

  int64_t integer;
  napi_value result;
  napi_status status = napi_get_value_int64(env, input, &integer);
  if (status == napi_ok) {
    NODE_API_CALL(env, napi_create_int64(env, integer, &result));
  } else {
    NODE_API_ASSERT(env, status == napi_number_expected);
    NODE_API_CALL(env, napi_get_undefined(env, &result));
  }
  return result;
}

// test from the C++ side
static napi_value
test_number_integer_conversions(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  using f64_limits = std::numeric_limits<double>;
  using i32_limits = std::numeric_limits<int32_t>;
  using u32_limits = std::numeric_limits<uint32_t>;
  using i64_limits = std::numeric_limits<int64_t>;

  std::array<std::pair<double, int32_t>, 14> i32_cases{{
      // special values
      {f64_limits::infinity(), 0},
      {-f64_limits::infinity(), 0},
      {f64_limits::quiet_NaN(), 0},
      // normal
      {0.0, 0},
      {1.0, 1},
      {-1.0, -1},
      // truncation
      {1.25, 1},
      {-1.25, -1},
      // limits
      {i32_limits::min(), i32_limits::min()},
      {i32_limits::max(), i32_limits::max()},
      // wrap around
      {static_cast<double>(i32_limits::min()) - 1.0, i32_limits::max()},
      {static_cast<double>(i32_limits::max()) + 1.0, i32_limits::min()},
      {static_cast<double>(i32_limits::min()) - 2.0, i32_limits::max() - 1},
      {static_cast<double>(i32_limits::max()) + 2.0, i32_limits::min() + 1},
  }};

  for (const auto &[in, expected_out] : i32_cases) {
    napi_value js_in;
    NODE_API_CALL(env, napi_create_double(env, in, &js_in));
    int32_t out_from_napi;
    NODE_API_CALL(env, napi_get_value_int32(env, js_in, &out_from_napi));
    NODE_API_ASSERT(env, out_from_napi == expected_out);
  }

  std::array<std::pair<double, uint32_t>, 12> u32_cases{{
      // special values
      {f64_limits::infinity(), 0},
      {-f64_limits::infinity(), 0},
      {f64_limits::quiet_NaN(), 0},
      // normal
      {0.0, 0},
      {1.0, 1},
      // truncation
      {1.25, 1},
      {-1.25, u32_limits::max()},
      // limits
      {u32_limits::max(), u32_limits::max()},
      // wrap around
      {-1.0, u32_limits::max()},
      {static_cast<double>(u32_limits::max()) + 1.0, 0},
      {-2.0, u32_limits::max() - 1},
      {static_cast<double>(u32_limits::max()) + 2.0, 1},

  }};

  for (const auto &[in, expected_out] : u32_cases) {
    napi_value js_in;
    NODE_API_CALL(env, napi_create_double(env, in, &js_in));
    uint32_t out_from_napi;
    NODE_API_CALL(env, napi_get_value_uint32(env, js_in, &out_from_napi));
    NODE_API_ASSERT(env, out_from_napi == expected_out);
  }

  std::array<std::pair<double, int64_t>, 12> i64_cases{
      {// special values
       {f64_limits::infinity(), 0},
       {-f64_limits::infinity(), 0},
       {f64_limits::quiet_NaN(), 0},
       // normal
       {0.0, 0},
       {1.0, 1},
       {-1.0, -1},
       // truncation
       {1.25, 1},
       {-1.25, -1},
       // limits
       // i64 max can't be precisely represented as double so it would round to
       // 1 + i64 max, which would clamp and we don't want that yet. so we test
       // the largest double smaller than i64 max instead (which is i64 max -
       // 1024)
       {i64_limits::min(), i64_limits::min()},
       {std::nextafter(static_cast<double>(i64_limits::max()), 0.0),
        static_cast<int64_t>(
            std::nextafter(static_cast<double>(i64_limits::max()), 0.0))},
       // clamp
       {i64_limits::min() - 4096.0, i64_limits::min()},
       {i64_limits::max() + 4096.0, i64_limits::max()}}};

  for (const auto &[in, expected_out] : i64_cases) {
    napi_value js_in;
    NODE_API_CALL(env, napi_create_double(env, in, &js_in));
    int64_t out_from_napi;
    NODE_API_CALL(env, napi_get_value_int64(env, js_in, &out_from_napi));
    NODE_API_ASSERT(env, out_from_napi == expected_out);
  }

  return ok(env);
}

void register_conversion_tests(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, double_to_i32);
  REGISTER_FUNCTION(env, exports, double_to_u32);
  REGISTER_FUNCTION(env, exports, double_to_i64);
  REGISTER_FUNCTION(env, exports, test_number_integer_conversions);
}

} // namespace napitests

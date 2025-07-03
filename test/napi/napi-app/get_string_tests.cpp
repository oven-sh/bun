#include "conversion_tests.h"

#include "utils.h"
#include <array>
#include <cinttypes>
#include <cstdio>
#include <cstring>
#include <type_traits>

namespace napitests {

template <typename Element,
          napi_status (*get_value_string_fn)(napi_env, napi_value, Element *,
                                             size_t, size_t *)>
static napi_value
test_get_value_string_any_encoding(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  static constexpr size_t BUFSIZE = 32;
  std::array<Element, BUFSIZE> buf;
  napi_value string = info[0];

#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

  size_t full_length;
  NODE_API_CALL(env,
                get_value_string_fn(env, string, nullptr, 0, &full_length));
  printf("full encoded size = %zu\n", full_length);

  // try to write into every subslice of the buffer
  for (size_t len = 0; len < BUFSIZE; len++) {
    // initialize so we can tell which parts of the buffer were overwritten and
    // which were not
    buf.fill(std::is_same_v<Element, char> ? 0xaa : 0xaaaa);

    size_t written = SIZE_MAX;
    NODE_API_CALL(env,
                  get_value_string_fn(env, string, buf.data(), len, &written));
    printf("tried to fill %zu/%zu units of buffer, got %zu (+ terminator)\n",
           len, BUFSIZE, written);
    printf("[");
    for (const auto &elem : buf) {
      size_t i = &elem - buf.data();
      if (i == written) {
        printf("|");
      }
      if (i == len) {
        printf("]");
      }

      if constexpr (std::is_same_v<Element, char>) {
        printf("%02x", reinterpret_cast<const uint8_t &>(elem));
      } else {
        printf("%04x", reinterpret_cast<const uint16_t &>(elem));
      }
    }
    printf("\n");
    if (written == full_length) {
      // at this point we are encoding the whole string, so no need to keep
      // trying larger buffers
      return env.Undefined();
    }
  }

  return env.Undefined();
}

void register_get_string_tests(Napi::Env env, Napi::Object exports) {
  exports.Set(
      "test_get_value_string_latin1",
      Napi::Function::New(env, test_get_value_string_any_encoding<
                                   char, napi_get_value_string_latin1>));
  exports.Set("test_get_value_string_utf8",
              Napi::Function::New(env, test_get_value_string_any_encoding<
                                           char, napi_get_value_string_utf8>));
  exports.Set(
      "test_get_value_string_utf16",
      Napi::Function::New(env, test_get_value_string_any_encoding<
                                   char16_t, napi_get_value_string_utf16>));
}

} // namespace napitests

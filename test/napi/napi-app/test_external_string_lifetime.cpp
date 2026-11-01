#include <node_api.h>
#undef NDEBUG
#include <atomic>
#include <cassert>
#include <cstdlib>
#include <cstring>
#include <thread>

static std::atomic<unsigned> counts[2], nullEnv[2], offThread;

struct StringData {
  unsigned kind;
  std::thread::id owner;
};

static void finalize(napi_env env, void *data, void *hint) {
  auto *string = static_cast<StringData *>(hint);
  if (string->owner != std::this_thread::get_id())
    ++offThread;
  if (!env)
    ++nullEnv[string->kind];
  ++counts[string->kind];
  free(data);
  delete string;
}

static napi_value make(napi_env env, napi_callback_info info) {
  napi_value result;
  assert(napi_create_array_with_length(env, 2, &result) == napi_ok);
  for (unsigned kind = 0; kind < 2; ++kind) {
    auto *hint = new StringData{kind, std::this_thread::get_id()};
    void *bytes = malloc(4096);
    assert(bytes);
    napi_value value;
    bool copied = true;
    if (kind == 0) {
      memset(bytes, 'x', 4096);
      assert(node_api_create_external_string_latin1(
                 env, static_cast<char *>(bytes), 4096, finalize, hint, &value,
                 &copied) == napi_ok);
    } else {
      auto *chars = static_cast<char16_t *>(bytes);
      for (unsigned i = 0; i < 2048; ++i)
        chars[i] = u'λ';
      assert(node_api_create_external_string_utf16(
                 env, chars, 2048, finalize, hint, &value, &copied) == napi_ok);
    }
    assert(!copied);
    assert(napi_set_element(env, result, kind, value) == napi_ok);
  }
  return result;
}

static napi_value stats(napi_env env, napi_callback_info info) {
  napi_value result;
  assert(napi_create_array_with_length(env, 5, &result) == napi_ok);
  const unsigned values[] = {counts[0], counts[1], nullEnv[0], nullEnv[1],
                             offThread};
  for (unsigned i = 0; i < 5; ++i) {
    napi_value value;
    assert(napi_create_uint32(env, values[i], &value) == napi_ok);
    assert(napi_set_element(env, result, i, value) == napi_ok);
  }
  return result;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"make", nullptr, make, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stats", nullptr, stats, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  assert(napi_define_properties(env, exports, 2, properties) == napi_ok);
  return exports;
}

#include "node.h"

#include <iostream>
#include <napi.h>

#include <cassert>

napi_value fail(napi_env env, const char *msg) {
  napi_value result;
  napi_create_string_utf8(env, msg, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value ok(napi_env env) {
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value test_issue_7685(const Napi::CallbackInfo &info) {
  Napi::Env env(info.Env());
  Napi::HandleScope scope(env);
#define napi_assert(expr)                                                      \
  {                                                                            \
    if (!expr) {                                                               \
      Napi::Error::New(env, #expr).ThrowAsJavaScriptException();               \
    }                                                                          \
  }
  napi_assert(info[0].IsNumber());
  napi_assert(info[1].IsNumber());
  napi_assert(info[2].IsNumber());
  napi_assert(info[3].IsNumber());
  napi_assert(info[4].IsNumber());
  napi_assert(info[5].IsNumber());
  napi_assert(info[6].IsNumber());
  napi_assert(info[7].IsNumber());
  return ok(env);
}

napi_value
test_napi_get_value_string_utf8_with_buffer(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // get how many chars we need to copy
  uint32_t _len;
  if (napi_get_value_uint32(env, info[1], &_len) != napi_ok) {
    return fail(env, "call to napi_get_value_uint32 failed");
  }
  size_t len = (size_t)_len;

  if (len == 424242) {
    len = NAPI_AUTO_LENGTH;
  } else if (len > 29) {
    return fail(env, "len > 29");
  }

  size_t copied;
  const size_t BUF_SIZE = 30;
  char buf[BUF_SIZE];
  memset(buf, '*', BUF_SIZE);
  buf[BUF_SIZE - 1] = '\0';

  if (napi_get_value_string_utf8(env, info[0], buf, len, &copied) != napi_ok) {
    return fail(env, "call to napi_get_value_string_utf8 failed");
  }

  std::cout << "Chars to copy: " << len << std::endl;
  std::cout << "Copied chars: " << copied << std::endl;
  std::cout << "Buffer: ";
  for (size_t i = 0; i < BUF_SIZE; i++) {
    std::cout << (int)buf[i] << ", ";
  }
  std::cout << std::endl;
  std::cout << "Value str: " << buf << std::endl;
  return ok(env);
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  // check that these symbols are defined
  auto *isolate = v8::Isolate::GetCurrent();
  node::AddEnvironmentCleanupHook(
      isolate, [](void *) {}, isolate);
  node::RemoveEnvironmentCleanupHook(
      isolate, [](void *) {}, isolate);

  exports.Set("test_issue_7685", Napi::Function::New(env, test_issue_7685));

  exports.Set(
      "test_napi_get_value_string_utf8_with_buffer",
      Napi::Function::New(env, test_napi_get_value_string_utf8_with_buffer));
  return exports;
}

NODE_API_MODULE(napitests, InitAll)

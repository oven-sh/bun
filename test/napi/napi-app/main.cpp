#include <node.h>

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

napi_threadsafe_function tsfn_11949;
napi_value tsfn_name_11949;

static void test_issue_11949_callback(napi_env env, napi_value js_callback,
                                      void *context, void *data) {
  if (data != nullptr) {
    printf("data: %p\n", data);
  } else {
    printf("data: nullptr\n");
  }
  napi_unref_threadsafe_function(env, tsfn_11949);
}

static napi_value test_issue_11949(const Napi::CallbackInfo &info) {
  Napi::Env env(info.Env());
  Napi::HandleScope scope(env);
  napi_status status;
  status = napi_create_string_utf8(env, "TSFN", 4, &tsfn_name_11949);
  assert(status == napi_ok);
  status = napi_create_threadsafe_function(
      env, NULL, NULL, tsfn_name_11949, 0, 1, NULL, NULL, NULL,
      &test_issue_11949_callback, &tsfn_11949);
  assert(status == napi_ok);
  status =
      napi_call_threadsafe_function(tsfn_11949, NULL, napi_tsfn_nonblocking);
  assert(status == napi_ok);
  napi_value result;
  status = napi_get_undefined(env, &result);
  assert(status == napi_ok);
  return result;
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

Napi::Value RunCallback(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Function cb = info[0].As<Napi::Function>();
  return cb.Call(env.Global(), {Napi::String::New(env, "hello world")});
}

Napi::Object Init2(Napi::Env env, Napi::Object exports) {
  return Napi::Function::New(env, RunCallback);
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports1) {
  // check that these symbols are defined
  auto *isolate = v8::Isolate::GetCurrent();

  Napi::Object exports = Init2(env, exports1);

  node::AddEnvironmentCleanupHook(
      isolate, [](void *) {}, isolate);
  node::RemoveEnvironmentCleanupHook(
      isolate, [](void *) {}, isolate);

  exports.Set("test_issue_7685", Napi::Function::New(env, test_issue_7685));
  exports.Set("test_issue_11949", Napi::Function::New(env, test_issue_11949));

  exports.Set(
      "test_napi_get_value_string_utf8_with_buffer",
      Napi::Function::New(env, test_napi_get_value_string_utf8_with_buffer));
  return exports;
}

NODE_API_MODULE(napitests, InitAll)

#include <node.h>

#include <inttypes.h>
#include <iostream>
#include <napi.h>
#include <stdarg.h>
#include <stdio.h>

#include <cassert>

napi_value fail(napi_env env, const char *msg) {
  napi_value result;
  napi_create_string_utf8(env, msg, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value fail_fmt(napi_env env, const char *fmt, ...) {
  char buf[1024];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  return fail(env, buf);
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

#include <v8.h>

napi_value test_v8_number_int(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  v8::Local<v8::Number> integer =
      v8::Number::New(v8::Isolate::GetCurrent(), 123.0);
  if (integer->Value() != 123.0) {
    return fail_fmt(env, "wrong v8 number value: expected 123.0 got %f",
                    integer->Value());
  }

  return ok(env);
}

napi_value test_v8_number_large_int(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  v8::Local<v8::Number> large_int =
      v8::Number::New(v8::Isolate::GetCurrent(), 8589934592);
  if (large_int->Value() != 8589934592) {
    return fail_fmt(env, "wrong v8 number value: expected 8589934592 got %f",
                    large_int->Value());
  }

  return ok(env);
}

napi_value test_v8_number_fraction(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  v8::Local<v8::Number> fraction =
      v8::Number::New(v8::Isolate::GetCurrent(), 2.5);
  if (fraction->Value() != 2.5) {
    return fail_fmt(env, "wrong v8 number value: expected 2.5 got %f",
                    fraction->Value());
  }

  return ok(env);
}

napi_value test_v8_string_ascii(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  v8::Isolate *isolate = v8::Isolate::GetCurrent();

  // simple
  const char string1[] = "hello world";
  // non-ascii characters
  const unsigned char string2[] = {240, 159, 143, 179, 239, 184, 143, 226, 128,
                                   141, 226, 154, 167, 239, 184, 143, 0};
  // mixed valid/invalid utf-8
  const unsigned char string3[] = {'o', 'h',  ' ', 0xc0, 'n',
                                   'o', 0xc2, '!', 0xf5, 0};

  v8::MaybeLocal<v8::String> maybe_str =
      v8::String::NewFromUtf8(isolate, string1, v8::NewStringType::kNormal, -1);
  v8::Local<v8::String> str = maybe_str.ToLocalChecked();
  char buf[64];
  int retval;
  int nchars;

  // explicit length
  // retval counts null terminator
  if ((retval = str->WriteUtf8(isolate, buf, sizeof buf, &nchars)) !=
      strlen(string1) + 1) {
    return fail_fmt(env, "String::WriteUtf8 return: expected %zu got %d",
                    strlen(string1) + 1, retval);
  }
  if (nchars != strlen(string1)) {
    return fail_fmt(
        env, "String::WriteUtf8 set nchars to wrong value: expected %zu got %d",
        strlen(string1), nchars);
  }
  // cmp including terminator
  if (memcmp(buf, string1, strlen(string1) + 1) != 0) {
    return fail_fmt(
        env,
        "String::WriteUtf8 stored wrong data in buffer: expected %s got %s",
        string1, buf);
  }

  // assumed length
  if ((retval = str->WriteUtf8(isolate, buf, -1, &nchars)) !=
      strlen(string1) + 1) {
    return fail_fmt(env, "String::WriteUtf8 return: expected %zu got %d",
                    strlen(string1) + 1, retval);
  }
  if (nchars != strlen(string1)) {
    return fail_fmt(
        env, "String::WriteUtf8 set nchars to wrong value: expected %zu got %d",
        strlen(string1), nchars);
  }
  if (memcmp(buf, string1, strlen(string1) + 1) != 0) {
    return fail_fmt(
        env,
        "String::WriteUtf8 stored wrong data in buffer: expected %s got %s",
        string1, buf);
  }

  // too short length
  memset(buf, 0xaa, sizeof buf);
  if ((retval = str->WriteUtf8(isolate, buf, 5, &nchars)) != 5) {
    return fail_fmt(env, "String::WriteUtf8 return: expected 5 got %d", retval);
  }
  if (nchars != 5) {
    return fail_fmt(
        env, "String::WriteUtf8 set nchars to wrong value: expected 5 got %d",
        nchars);
  }
  // check it did not write a terminator
  if (memcmp(buf, "hello\xaa", 6) != 0) {
    return fail_fmt(env,
                    "String::WriteUtf8 stored wrong data in buffer: expected "
                    "hello\\xaa got %s",
                    buf);
  }

  // nullptr for nchars_ref, just testing it doesn't crash
  (void)str->WriteUtf8(isolate, buf, sizeof buf, nullptr);

  maybe_str =
      v8::String::NewFromUtf8(isolate, reinterpret_cast<const char *>(string2),
                              v8::NewStringType::kNormal, -1);
  str = maybe_str.ToLocalChecked();
  if (str->Length() != 6) {
    return fail_fmt(env, "wrong length: expected 6 got %d", str->Length());
  }

  maybe_str =
      v8::String::NewFromUtf8(isolate, reinterpret_cast<const char *>(string3),
                              v8::NewStringType::kNormal, -1);
  str = maybe_str.ToLocalChecked();
  if (str->Length() != 9) {
    return fail_fmt(env, "wrong length: expected 9 got %d", str->Length());
  }

  return ok(env);
}

napi_value test_v8_external(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  v8::Isolate *isolate = v8::Isolate::GetCurrent();

  int x = 5;
  v8::MaybeLocal<v8::External> maybe_external = v8::External::New(isolate, &x);
  v8::Local<v8::External> external = maybe_external.ToLocalChecked();
  if (external->Value() != &x) {
    return fail_fmt(
        env, "External::Value() returned wrong pointer: expected %p got %p", &x,
        external->Value());
  }
  return ok(env);
}

napi_value test_v8_object(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  v8::Isolate *isolate = v8::Isolate::GetCurrent();

  v8::Local<v8::Object> obj = v8::Object::New(isolate);
  auto key = v8::String::NewFromUtf8(isolate, "key").ToLocalChecked();
  auto val = v8::Number::New(isolate, 5);
  v8::Maybe<bool> retval = v8::Nothing<bool>();
  if ((retval = obj->Set(isolate->GetCurrentContext(), key, val)) !=
      v8::Just<bool>(true)) {
    return fail_fmt(env, "Object::Set wrong return: expected Just(true) got %s",
                    retval.IsNothing() ? "Nothing" : "Just(false)");
  }

  return ok(env);
}

napi_value test_v8_array_new(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  v8::Isolate *isolate = v8::Isolate::GetCurrent();

  v8::Local<v8::Value> vals[2] = {
      v8::Number::New(isolate, 50),
      v8::String::NewFromUtf8(isolate, "meow").ToLocalChecked(),
  };
  v8::Local<v8::Array> v8_array = v8::Array::New(isolate, vals, 2);
  // TODO(@190n) do the rest of this with V8 APIs
  // this test will fail until that is done
  napi_value napi_array;
  static_assert(sizeof v8_array == sizeof napi_array);
  memcpy(&napi_array, &v8_array, sizeof v8_array);

  uint32_t len;
  if (napi_get_array_length(env, napi_array, &len) != napi_ok || len != 2) {
    return fail_fmt(
        env,
        "napi_get_array_length after v8::Array::New: expected 2 got %" PRIu32,
        len);
  }

  napi_value first, second;
  if (napi_get_element(env, napi_array, 0, &first) != napi_ok ||
      napi_get_element(env, napi_array, 1, &second) != napi_ok) {
    return fail(env, "array lookup failed");
  }

  double num;
  if (napi_get_value_double(env, first, &num) != napi_ok || num != 50.0) {
    return fail_fmt(
        env, "first array element has wrong value: expected 50.0 got %f", num);
  }

  char str[5] = {0};
  size_t string_len;
  if (napi_get_value_string_utf8(env, second, str, 5, &string_len) != napi_ok ||
      string_len != 4 || memcmp(str, "meow", 4) != 0) {
    return fail_fmt(
        env, "second array element has wrong value: expected 'meow' got %s",
        str);
  }

  return ok(env);
}

napi_value test_v8_object_template(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  v8::Isolate *isolate = v8::Isolate::GetCurrent();

  v8::Local<v8::ObjectTemplate> obj_template = v8::ObjectTemplate::New(isolate);
  if (obj_template.IsEmpty()) {
    return fail(env, "ObjectTemplate::NewInstance failed");
  }
  obj_template->SetInternalFieldCount(2);
  if (obj_template->InternalFieldCount() != 2) {
    return fail_fmt(env,
                    "ObjectTemplate::InternalFieldCount() returned wrong "
                    "value: expected 2 got %d",
                    obj_template->InternalFieldCount());
  }

  v8::Local<v8::Object> obj1 =
      obj_template->NewInstance(isolate->GetCurrentContext()).ToLocalChecked();
  obj1->SetInternalField(0, v8::Number::New(isolate, 3.0));
  obj1->SetInternalField(1, v8::Number::New(isolate, 4.0));

  v8::Local<v8::Object> obj2 =
      obj_template->NewInstance(isolate->GetCurrentContext()).ToLocalChecked();
  obj2->SetInternalField(0, v8::Number::New(isolate, 5.0));
  obj2->SetInternalField(1, v8::Number::New(isolate, 6.0));

  double value = obj1->GetInternalField(0).As<v8::Number>()->Value();
  if (value != 3.0) {
    return fail_fmt(
        env, "obj1 internal field 0 has wrong value: expected 3.0, got %f",
        value);
  }
  value = obj1->GetInternalField(1).As<v8::Number>()->Value();
  if (value != 4.0) {
    return fail_fmt(
        env, "obj1 internal field 1 has wrong value: expected 4.0, got %f",
        value);
  }
  value = obj2->GetInternalField(0).As<v8::Number>()->Value();
  if (value != 5.0) {
    return fail_fmt(
        env, "obj2 internal field 0 has wrong value: expected 5.0, got %f",
        value);
  }
  value = obj2->GetInternalField(1).As<v8::Number>()->Value();
  if (value != 6.0) {
    return fail_fmt(
        env, "obj2 internal field 1 has wrong value: expected 6.0, got %f",
        value);
  }

  return ok(env);
}

static void callback_1(napi_env env, napi_value js_callback, void *context,
                       void *data) {}

napi_value test_napi_threadsafe_function_does_not_hang_after_finalize(
    const Napi::CallbackInfo &info) {

  Napi::Env env = info.Env();
  napi_status status;

  napi_value resource_name;
  status = napi_create_string_utf8(env, "simple", 6, &resource_name);
  assert(status == napi_ok);

  napi_threadsafe_function cb;
  status = napi_create_threadsafe_function(env, nullptr, nullptr, resource_name,
                                           0, 1, nullptr, nullptr, nullptr,
                                           &callback_1, &cb);
  assert(status == napi_ok);

  status = napi_release_threadsafe_function(cb, napi_tsfn_release);
  assert(status == napi_ok);

  printf("success!");

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

  node::AddEnvironmentCleanupHook(isolate, [](void *) {}, isolate);
  node::RemoveEnvironmentCleanupHook(isolate, [](void *) {}, isolate);

  exports.Set("test_issue_7685", Napi::Function::New(env, test_issue_7685));
  exports.Set("test_issue_11949", Napi::Function::New(env, test_issue_11949));
  exports.Set("test_v8_number_int",
              Napi::Function::New(env, test_v8_number_int));
  exports.Set("test_v8_number_large_int",
              Napi::Function::New(env, test_v8_number_large_int));
  exports.Set("test_v8_number_fraction",
              Napi::Function::New(env, test_v8_number_fraction));
  exports.Set("test_v8_string_ascii",
              Napi::Function::New(env, test_v8_string_ascii));
  exports.Set("test_v8_external", Napi::Function::New(env, test_v8_external));
  exports.Set("test_v8_object", Napi::Function::New(env, test_v8_object));
  exports.Set("test_v8_array_new", Napi::Function::New(env, test_v8_array_new));
  exports.Set("test_v8_object_template",
              Napi::Function::New(env, test_v8_object_template));
  exports.Set(
      "test_napi_get_value_string_utf8_with_buffer",
      Napi::Function::New(env, test_napi_get_value_string_utf8_with_buffer));
  exports.Set(
      "test_napi_threadsafe_function_does_not_hang_after_finalize",
      Napi::Function::New(
          env, test_napi_threadsafe_function_does_not_hang_after_finalize));

  return exports;
}

NODE_API_MODULE(napitests, InitAll)

#include <node.h>

#include <cstdarg>

using namespace v8;

namespace v8tests {

enum class ValueKind : uint16_t {
  Undefined = 1 << 0,
  Null = 1 << 1,
  NullOrUndefined = 1 << 2,
  True = 1 << 3,
  False = 1 << 4,
  Boolean = 1 << 5,
  String = 1 << 6,
  Object = 1 << 7,
  Number = 1 << 8,
};

static bool check_value_kind(const Local<Value> &value, ValueKind kind) {
  uint16_t matched_kinds = 0;
  if (value->IsUndefined()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::Undefined);
  }
  if (value->IsNull()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::Null);
  }
  if (value->IsNullOrUndefined()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::NullOrUndefined);
  }
  if (value->IsTrue()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::True);
  }
  if (value->IsFalse()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::False);
  }
  if (value->IsBoolean()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::Boolean);
  }
  if (value->IsString()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::String);
  }
  if (value->IsObject()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::Object);
  }
  if (value->IsNumber()) {
    matched_kinds |= static_cast<uint16_t>(ValueKind::Number);
  }

  switch (kind) {
  case ValueKind::Undefined:
    return matched_kinds == (static_cast<uint16_t>(ValueKind::Undefined) |
                             static_cast<uint16_t>(ValueKind::NullOrUndefined));
  case ValueKind::Null:
    return matched_kinds == (static_cast<uint16_t>(ValueKind::Null) |
                             static_cast<uint16_t>(ValueKind::NullOrUndefined));
  case ValueKind::True:
    return matched_kinds == (static_cast<uint16_t>(ValueKind::True) |
                             static_cast<uint16_t>(ValueKind::Boolean));
  case ValueKind::False:
    return matched_kinds == (static_cast<uint16_t>(ValueKind::False) |
                             static_cast<uint16_t>(ValueKind::Boolean));
  case ValueKind::String:
    return matched_kinds == static_cast<uint16_t>(ValueKind::String);
  case ValueKind::Object:
    return matched_kinds == static_cast<uint16_t>(ValueKind::Object);
  case ValueKind::Number:
    return matched_kinds == static_cast<uint16_t>(ValueKind::Number);
  case ValueKind::NullOrUndefined:
    return (matched_kinds ==
            (static_cast<uint16_t>(ValueKind::Undefined) |
             static_cast<uint16_t>(ValueKind::NullOrUndefined))) ||
           ((static_cast<uint16_t>(ValueKind::Null) |
             static_cast<uint16_t>(ValueKind::NullOrUndefined)));
  case ValueKind::Boolean:
    return (matched_kinds == (static_cast<uint16_t>(ValueKind::True) |
                              static_cast<uint16_t>(ValueKind::Boolean))) ||
           (matched_kinds == (static_cast<uint16_t>(ValueKind::False) |
                              static_cast<uint16_t>(ValueKind::Boolean)));
  }
}

void fail(const FunctionCallbackInfo<Value> &info, const char *fmt, ...) {
  char buf[1024];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  Local<String> message =
      String::NewFromUtf8(info.GetIsolate(), buf).ToLocalChecked();
  info.GetReturnValue().Set(message);
}

void ok(const FunctionCallbackInfo<Value> &args) {
  args.GetReturnValue().Set(Undefined(args.GetIsolate()));
}

void test_v8_native_call(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Primitive> undefined = Undefined(isolate);
  info.GetReturnValue().Set(undefined);
}

void test_v8_primitives(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<Primitive> v8_undefined = Undefined(isolate);
  if (!check_value_kind(v8_undefined, ValueKind::Undefined)) {
    return fail(info, "undefined is not undefined");
  }

  Local<Primitive> v8_null = Null(isolate);
  if (!check_value_kind(v8_null, ValueKind::Null)) {
    return fail(info, "null is not null");
  }

  Local<Boolean> v8_true = Boolean::New(isolate, true);
  if (!check_value_kind(v8_true, ValueKind::True)) {
    return fail(info, "true is not true");
  }

  Local<Boolean> v8_false = Boolean::New(isolate, false);
  if (!check_value_kind(v8_false, ValueKind::False)) {
    return fail(info, "false is not false");
  }

  return ok(info);
}

static void perform_number_test(const FunctionCallbackInfo<Value> &info,
                                double number) {
  Isolate *isolate = info.GetIsolate();

  Local<Number> v8_number = Number::New(isolate, number);
  if (v8_number->Value() != number) {
    return fail(info, "wrong v8 number value: expected %f got %f", number,
                v8_number->Value());
  }
  if (!check_value_kind(v8_number, ValueKind::Number)) {
    return fail(info, "number is not a number");
  }

  return ok(info);
}

void test_v8_number_int(const FunctionCallbackInfo<Value> &info) {
  perform_number_test(info, 123.0);
}

void test_v8_number_large_int(const FunctionCallbackInfo<Value> &info) {
  // 2^33
  perform_number_test(info, 8589934592.0);
}

void test_v8_number_fraction(const FunctionCallbackInfo<Value> &info) {
  perform_number_test(info, 2.5);
}

static bool perform_string_test(const FunctionCallbackInfo<Value> &info,
                                const char *c_string, int utf_16_code_units,
                                int encoded_utf_8_length,
                                const char *encoded_utf_8_data) {
  Isolate *isolate = info.GetIsolate();
  int len = strlen(c_string);
  char buf[256] = {0};
  int retval;
  int nchars;

  Local<String> v8_string =
      String::NewFromUtf8(isolate, c_string).ToLocalChecked();

  if (!check_value_kind(v8_string, ValueKind::String)) {
    fail(info, "string is not a string");
    return false;
  }

  if (v8_string->Length() != utf_16_code_units) {
    fail(info, "String::Length return: expected %d got %d", utf_16_code_units,
         v8_string->Length());
    return false;
  }

  if ((retval = v8_string->WriteUtf8(isolate, buf, sizeof buf, &nchars)) !=
      encoded_utf_8_length + 1) {
    fail(info, "String::WriteUtf8 return: expected %d got %d",
         encoded_utf_8_length + 1, retval);
    return false;
  }
  if (nchars != utf_16_code_units) {
    fail(info,
         "String::WriteUtf8 set nchars to wrong value: expected %d got %d",
         utf_16_code_units, nchars);
    return false;
  }
  // cmp including terminator
  if (memcmp(buf, encoded_utf_8_data, encoded_utf_8_length + 1) != 0) {
    fail(info,
         "String::WriteUtf8 stored wrong data in buffer: expected %s got %s",
         c_string, buf);
    return false;
  }

  // try with assuming the buffer is large enough
  if ((retval = v8_string->WriteUtf8(isolate, buf, -1, &nchars)) !=
      encoded_utf_8_length + 1) {
    fail(info, "String::WriteUtf8 return: expected %d got %d",
         encoded_utf_8_length + 1, retval);
    return false;
  }
  if (nchars != utf_16_code_units) {
    fail(info,
         "String::WriteUtf8 set nchars to wrong value: expected %d got %d",
         utf_16_code_units, nchars);
    return false;
  }
  // cmp including terminator
  if (memcmp(buf, encoded_utf_8_data, encoded_utf_8_length + 1) != 0) {
    fail(info,
         "String::WriteUtf8 stored wrong data in buffer: expected %s got %s",
         c_string, buf);
    return false;
  }

  // try with ignoring nchars (it should not try to store anything in a nullptr)
  if ((retval = v8_string->WriteUtf8(isolate, buf, sizeof buf, nullptr)) !=
      encoded_utf_8_length + 1) {
    fail(info, "String::WriteUtf8 return: expected %d got %d",
         encoded_utf_8_length + 1, retval);
    return false;
  }
  // cmp including terminator
  if (memcmp(buf, encoded_utf_8_data, encoded_utf_8_length + 1) != 0) {
    fail(info,
         "String::WriteUtf8 stored wrong data in buffer: expected %s got %s",
         c_string, buf);
    return false;
  }

  ok(info);
  return true;
}

void test_v8_string_ascii(const FunctionCallbackInfo<Value> &info) {
  if (!perform_string_test(info, "hello world", 11, 11, "hello world")) {
    // if perform_string_test failed, don't replace the return value with
    // success in the below truncated test
    return;
  }

  // try with a length shorter than the string
  Isolate *isolate = info.GetIsolate();
  Local<String> v8_string =
      String::NewFromUtf8(info.GetIsolate(), "hello world").ToLocalChecked();
  char buf[256];
  memset(buf, 0xaa, sizeof buf);
  int retval;
  int nchars;
  if ((retval = v8_string->WriteUtf8(isolate, buf, 5, &nchars)) != 5) {
    return fail(info, "String::WriteUtf8 return: expected 5 got %d", retval);
  }
  if (nchars != 5) {
    return fail(
        info, "String::WriteUtf8 set nchars to wrong value: expected 5 got %d",
        nchars);
  }
  // check it did not write a terminator
  if (memcmp(buf, "hello\xaa", 6) != 0) {
    return fail(info,
                "String::WriteUtf8 stored wrong data in buffer: expected "
                "hello\\xaa got %s",
                buf);
  }
}

void test_v8_string_utf8(const FunctionCallbackInfo<Value> &info) {
  const unsigned char trans_flag_unsigned[] = {240, 159, 143, 179, 239, 184,
                                               143, 226, 128, 141, 226, 154,
                                               167, 239, 184, 143, 0};
  const char *trans_flag = reinterpret_cast<const char *>(trans_flag_unsigned);
  perform_string_test(info, trans_flag, 6, 16, trans_flag);
}

void test_v8_string_invalid_utf8(const FunctionCallbackInfo<Value> &info) {
  const unsigned char mixed_sequence_unsigned[] = {'o', 'h',  ' ', 0xc0, 'n',
                                                   'o', 0xc2, '!', 0xf5, 0};
  const char *mixed_sequence =
      reinterpret_cast<const char *>(mixed_sequence_unsigned);
  const unsigned char replaced_sequence_unsigned[] = {
      'o',  'h',  ' ',  0xef, 0xbf, 0xbd, 'n',  'o',
      0xef, 0xbf, 0xbd, '!',  0xef, 0xbf, 0xbd, 0};
  const char *replaced_sequence =
      reinterpret_cast<const char *>(replaced_sequence_unsigned);
  perform_string_test(info, mixed_sequence, 9, 15, replaced_sequence);
}

void initialize(Local<Object> exports) {
  NODE_SET_METHOD(exports, "test_v8_native_call", test_v8_native_call);
  NODE_SET_METHOD(exports, "test_v8_primitives", test_v8_primitives);
  NODE_SET_METHOD(exports, "test_v8_number_int", test_v8_number_int);
  NODE_SET_METHOD(exports, "test_v8_number_large_int",
                  test_v8_number_large_int);
  NODE_SET_METHOD(exports, "test_v8_number_fraction", test_v8_number_fraction);
  NODE_SET_METHOD(exports, "test_v8_string_ascii", test_v8_string_ascii);
  NODE_SET_METHOD(exports, "test_v8_string_utf8", test_v8_string_utf8);
  NODE_SET_METHOD(exports, "test_v8_string_invalid_utf8",
                  test_v8_string_invalid_utf8);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, initialize)

} // namespace v8tests

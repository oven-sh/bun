#include <node.h>

#include <cinttypes>
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

static bool check_value_kind(Local<Value> value, ValueKind kind) {
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
  return false;
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

void test_v8_string_write_utf8(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  const unsigned char utf8_data_unsigned[] = {
      'h', 'i', 240, 159, 143, 179, 239, 184, 143,  226,  128, 141,
      226, 154, 167, 239, 184, 143, 'h', 'i', 0xc3, 0xa9, 0};
  const char *utf8_data = reinterpret_cast<const char *>(utf8_data_unsigned);

  constexpr size_t buf_size = sizeof(utf8_data_unsigned) + 3;
  char buf[buf_size] = {0};
  Local<String> s = String::NewFromUtf8(isolate, utf8_data).ToLocalChecked();
  for (int i = buf_size; i >= 0; i--) {
    memset(buf, 0xaa, buf_size);
    int nchars;
    int retval = s->WriteUtf8(isolate, buf, i, &nchars);
    printf("buffer size = %2d, nchars = %2d, returned = %2d, data =", i, nchars,
           retval);
    for (int j = 0; j < buf_size; j++) {
      printf("%c%02x", j == i ? '|' : ' ',
             reinterpret_cast<unsigned char *>(buf)[j]);
    }
    printf("\n");
  }
  return ok(info);
}

void test_v8_external(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  int x = 5;
  Local<External> external = External::New(isolate, &x);
  if (external->Value() != &x) {
    return fail(info,
                "External::Value() returned wrong pointer: expected %p got %p",
                &x, external->Value());
  }
  return ok(info);
}

void test_v8_object(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<Object> obj = Object::New(isolate);
  auto key = String::NewFromUtf8(isolate, "key").ToLocalChecked();
  auto val = Number::New(isolate, 5.0);
  Maybe<bool> retval = Nothing<bool>();
  if ((retval = obj->Set(isolate->GetCurrentContext(), key, val)) !=
      Just<bool>(true)) {
    return fail(info, "Object::Set wrong return: expected Just(true), got %s",
                retval.IsNothing() ? "Nothing" : "Just(false)");
  }

  return ok(info);
}

static std::string describe(Isolate *isolate, Local<Value> value) {
  if (value->IsUndefined()) {
    return "undefined";
  } else if (value->IsNull()) {
    return "null";
  } else if (value->IsTrue()) {
    return "true";
  } else if (value->IsFalse()) {
    return "false";
  } else if (value->IsString()) {
    char buf[1024] = {0};
    value.As<String>()->WriteUtf8(isolate, buf, sizeof(buf) - 1);
    std::string result = "\"";
    result += buf;
    result += "\"";
    return result;
  } else if (value->IsObject()) {
    return "[object Object]";
  } else if (value->IsNumber()) {
    return std::to_string(value.As<Number>()->Value());
  } else {
    return "unknown";
  }
}

void test_v8_array_new(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<Value> vals[5] = {
      Number::New(isolate, 50.0),
      String::NewFromUtf8(isolate, "meow").ToLocalChecked(),
      Number::New(isolate, 8.5),
      Null(isolate),
      Boolean::New(isolate, true),
  };
  Local<Array> v8_array =
      Array::New(isolate, vals, sizeof(vals) / sizeof(Local<Value>));

  if (v8_array->Length() != 5) {
    return fail(info, "Array::Length wrong return: expected 5, got %" PRIu32,
                v8_array->Length());
  }

  for (uint32_t i = 0; i < 5; i++) {
    Local<Value> array_value =
        v8_array->Get(isolate->GetCurrentContext(), i).ToLocalChecked();
    if (!array_value->StrictEquals(vals[i])) {
      return fail(info, "array has wrong value at index %" PRIu32 ": %s", i,
                  describe(isolate, array_value).c_str());
    }
  }

  return ok(info);
}

void test_v8_object_template(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<ObjectTemplate> obj_template = ObjectTemplate::New(isolate);
  obj_template->SetInternalFieldCount(2);
  if (obj_template->InternalFieldCount() != 2) {
    return fail(info,
                "ObjectTemplate did not remember internal field count: "
                "expected 2, got %d",
                obj_template->InternalFieldCount());
  }

  Local<Object> obj1 = obj_template->NewInstance(context).ToLocalChecked();
  obj1->SetInternalField(0, Number::New(isolate, 3.0));
  obj1->SetInternalField(1, Number::New(isolate, 4.0));

  Local<Object> obj2 = obj_template->NewInstance(context).ToLocalChecked();
  obj2->SetInternalField(0, Number::New(isolate, 5.0));
  obj2->SetInternalField(1, Number::New(isolate, 6.0));

  double value = obj1->GetInternalField(0).As<Number>()->Value();
  if (value != 3.0) {
    return fail(info,
                "obj1 internal field 0 has wrong value: expected 3.0, got %f",
                value);
  }
  value = obj1->GetInternalField(1).As<Number>()->Value();
  if (value != 4.0) {
    return fail(info,
                "obj1 internal field 1 has wrong value: expected 4.0, got %f",
                value);
  }
  value = obj2->GetInternalField(0).As<Number>()->Value();
  if (value != 5.0) {
    return fail(info,
                "obj2 internal field 0 has wrong value: expected 5.0, got %f",
                value);
  }
  value = obj2->GetInternalField(1).As<Number>()->Value();
  if (value != 6.0) {
    return fail(info,
                "obj2 internal field 1 has wrong value: expected 6.0, got %f",
                value);
  }
}

void print_values_from_js(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  printf("%d arguments\n", info.Length());
  printf("this = %s\n", describe(isolate, info.This()).c_str());
  for (int i = 0; i < info.Length(); i++) {
    printf("argument %d = %s\n", i, describe(isolate, info[i]).c_str());
  }
  return ok(info);
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
  NODE_SET_METHOD(exports, "test_v8_string_write_utf8",
                  test_v8_string_write_utf8);
  NODE_SET_METHOD(exports, "test_v8_external", test_v8_external);
  NODE_SET_METHOD(exports, "test_v8_object", test_v8_object);
  NODE_SET_METHOD(exports, "test_v8_array_new", test_v8_array_new);
  NODE_SET_METHOD(exports, "test_v8_object_template", test_v8_object_template);
  NODE_SET_METHOD(exports, "print_values_from_js", print_values_from_js);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, initialize)

} // namespace v8tests

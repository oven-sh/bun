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

void initialize(Local<Object> exports) {
  NODE_SET_METHOD(exports, "test_v8_native_call", test_v8_native_call);
  NODE_SET_METHOD(exports, "test_v8_primitives", test_v8_primitives);
  NODE_SET_METHOD(exports, "test_v8_number_int", test_v8_number_int);
  NODE_SET_METHOD(exports, "test_v8_number_large_int",
                  test_v8_number_large_int);
  NODE_SET_METHOD(exports, "test_v8_number_fraction", test_v8_number_fraction);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, initialize)

} // namespace v8tests

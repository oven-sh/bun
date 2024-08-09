#include <node.h>

#include <cstdarg>

using namespace v8;

namespace v8tests {

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
  if (!v8_undefined->IsUndefined() || !v8_undefined->IsNullOrUndefined()) {
    return fail(info, "undefined is not undefined");
  }
  if (v8_undefined->IsNull()) {
    return fail(info, "undefined is null");
  }

  Local<Primitive> v8_null = Null(isolate);
  if (!v8_null->IsNull() || !v8_null->IsNullOrUndefined()) {
    return fail(info, "null is not null");
  }
  if (v8_null->IsUndefined()) {
    return fail(info, "null is undefined");
  }

  Local<Boolean> v8_true = Boolean::New(isolate, true);
  if (!v8_true->IsBoolean() || v8_true->Value() != true || v8_true->IsFalse() ||
      !v8_true->IsTrue() || v8_true->IsUndefined() || v8_true->IsNull()) {
    return fail(info, "true is not true");
  }

  Local<Boolean> v8_false = Boolean::New(isolate, false);
  if (!v8_false->IsBoolean() || v8_false->Value() != false ||
      v8_false->IsTrue() || !v8_false->IsFalse() || v8_false->IsUndefined() ||
      v8_false->IsNull()) {
    return fail(info, "false is not false");
  }

  // check that we are not coercing
  if (v8_undefined->IsFalse() || v8_null->IsFalse()) {
    return fail(info, "non-bools are booleans");
  }

  return ok(info);
}

void initialize(Local<Object> exports) {
  NODE_SET_METHOD(exports, "test_v8_native_call", test_v8_native_call);
  NODE_SET_METHOD(exports, "test_v8_primitives", test_v8_primitives);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, initialize)

} // namespace v8tests

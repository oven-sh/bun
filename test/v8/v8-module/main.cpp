#include <node.h>
#ifndef _WIN32
#include <unistd.h>
#endif
#include <uv.h>

#include <v8-profiler.h>

#include <atomic>
#include <cinttypes>
#include <cstdarg>
#include <iomanip>
#include <iostream>
#include <new>

// V8 14.6's v8-fast-api-calls.h, which Node's headers omit, with public fields.
namespace v8 {

class CTypeInfo {
public:
  enum class Type : uint8_t { kInt32 = 3, kV8Value = 10 };
  enum class Flags : uint8_t { kNone = 0, kClampBit = 1 << 2 };

  Type type_;
  Flags flags_;
};

class CFunctionInfo {
public:
  enum class Int64Representation : uint8_t { kNumber = 0, kBigInt = 1 };

  V8_EXPORT CFunctionInfo(const CTypeInfo &return_info, unsigned int arg_count,
                          const CTypeInfo *arg_info, Int64Representation repr);

  const CTypeInfo return_info_;
  const Int64Representation repr_;
  const unsigned int arg_count_;
  const CTypeInfo *arg_info_;
};

class CFunction {
public:
  V8_EXPORT CFunction(const void *address, const CFunctionInfo *type_info);

  const void *address_;
  const CFunctionInfo *type_info_;
};

} // namespace v8

using namespace v8;

#define LOG_EXPR(e) std::cout << #e << " = " << (e) << std::endl

#define LOG_VALUE_KIND(v)                                                      \
  do {                                                                         \
    LOG_EXPR(v->IsUndefined());                                                \
    LOG_EXPR(v->IsNull());                                                     \
    LOG_EXPR(v->IsNullOrUndefined());                                          \
    LOG_EXPR(v->IsTrue());                                                     \
    LOG_EXPR(v->IsFalse());                                                    \
    LOG_EXPR(v->IsBoolean());                                                  \
    LOG_EXPR(v->IsString());                                                   \
    LOG_EXPR(v->IsObject());                                                   \
    LOG_EXPR(v->IsNumber());                                                   \
  } while (0)

namespace v8tests {

static void log_buffer(const char *buf, int len) {
  for (int i = 0; i < len; i++) {
    printf("buf[%d] = 0x%02x\n", i, buf[i]);
  }
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
    value.As<String>()->WriteUtf8V2(isolate, buf, sizeof(buf) - 1);
    std::string result = "\"";
    result += buf;
    result += "\"";
    return result;
  } else if (value->IsFunction()) {
    char buf[1024] = {0};
    value.As<Function>()->GetName().As<String>()->WriteUtf8V2(
        isolate, buf, sizeof(buf) - 1);
    std::string result = "function ";
    result += buf;
    result += "()";
    return result;
  } else if (value->IsObject()) {
    return "[object Object]";
  } else if (value->IsNumber()) {
    return std::to_string(value.As<Number>()->Value());
  } else {
    return "unknown";
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
  LOG_VALUE_KIND(v8_undefined);
  Local<Primitive> v8_null = Null(isolate);
  LOG_VALUE_KIND(v8_null);
  Local<Boolean> v8_true = Boolean::New(isolate, true);
  LOG_VALUE_KIND(v8_true);
  Local<Boolean> v8_false = Boolean::New(isolate, false);
  LOG_VALUE_KIND(v8_false);

  return ok(info);
}

static void perform_number_test(const FunctionCallbackInfo<Value> &info,
                                double number) {
  Isolate *isolate = info.GetIsolate();

  Local<Number> v8_number = Number::New(isolate, number);
  LOG_EXPR(v8_number->Value());
  LOG_VALUE_KIND(v8_number);

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

static void perform_string_test(const FunctionCallbackInfo<Value> &info,
                                Local<String> v8_string) {
  Isolate *isolate = info.GetIsolate();
  char buf[256] = {0x7f};
  size_t retval;
  size_t nchars;

  LOG_VALUE_KIND(v8_string);
  LOG_EXPR(v8_string->Length());
  LOG_EXPR(v8_string->Utf8LengthV2(isolate));
  LOG_EXPR(v8_string->IsOneByte());
  LOG_EXPR(v8_string->ContainsOnlyOneByte());
  LOG_EXPR(v8_string->IsExternal());
  LOG_EXPR(v8_string->IsExternalTwoByte());
  LOG_EXPR(v8_string->IsExternalOneByte());

  // check string has the right contents. The legacy WriteUtf8 null-terminated
  // by default; with WriteUtf8V2 that behavior is requested explicitly via
  // kNullTerminate so the buffer contents stay the same.
  LOG_EXPR(retval = v8_string->WriteUtf8V2(isolate, buf, sizeof buf,
                                           String::WriteFlags::kNullTerminate,
                                           &nchars));
  LOG_EXPR(nchars);
  log_buffer(buf, static_cast<int>(retval) + 1);

  memset(buf, 0x7f, sizeof buf);

  // legacy WriteUtf8 accepted length = -1 to assume the buffer is large
  // enough; WriteUtf8V2 always takes an explicit capacity
  LOG_EXPR(retval = v8_string->WriteUtf8V2(isolate, buf, sizeof buf,
                                           String::WriteFlags::kNullTerminate,
                                           &nchars));
  LOG_EXPR(nchars);
  log_buffer(buf, static_cast<int>(retval) + 1);

  memset(buf, 0x7f, sizeof buf);

  // try with ignoring nchars (it should not try to store anything in a
  // nullptr)
  LOG_EXPR(retval = v8_string->WriteUtf8V2(isolate, buf, sizeof buf,
                                           String::WriteFlags::kNullTerminate,
                                           nullptr));
  log_buffer(buf, static_cast<int>(retval) + 1);

  memset(buf, 0x7f, sizeof buf);

  return ok(info);
}

template <typename T>
void perform_string_test_normal_and_internalized(
    const FunctionCallbackInfo<Value> &info, const T *string_literal,
    bool latin1 = false) {
  Isolate *isolate = info.GetIsolate();

  if (latin1) {
    const uint8_t *string = reinterpret_cast<const uint8_t *>(string_literal);
    perform_string_test(
        info, String::NewFromOneByte(isolate, string, NewStringType::kNormal)
                  .ToLocalChecked());
    perform_string_test(info, String::NewFromOneByte(
                                  isolate, string, NewStringType::kInternalized)
                                  .ToLocalChecked());

  } else {
    const char *string = reinterpret_cast<const char *>(string_literal);
    perform_string_test(
        info, String::NewFromUtf8(isolate, string, NewStringType::kNormal)
                  .ToLocalChecked());
    perform_string_test(
        info, String::NewFromUtf8(isolate, string, NewStringType::kInternalized)
                  .ToLocalChecked());
  }
}

void test_v8_string_ascii(const FunctionCallbackInfo<Value> &info) {
  perform_string_test_normal_and_internalized(info, "hello world");
}

void test_v8_string_utf8(const FunctionCallbackInfo<Value> &info) {
  const unsigned char trans_flag_unsigned[] = {240, 159, 143, 179, 239, 184,
                                               143, 226, 128, 141, 226, 154,
                                               167, 239, 184, 143, 0};
  perform_string_test_normal_and_internalized(info, trans_flag_unsigned);
}

void test_v8_string_invalid_utf8(const FunctionCallbackInfo<Value> &info) {
  const unsigned char mixed_sequence_unsigned[] = {'o', 'h',  ' ', 0xc0, 'n',
                                                   'o', 0xc2, '!', 0xf5, 0};
  perform_string_test_normal_and_internalized(info, mixed_sequence_unsigned);
}

void test_v8_string_latin1(const FunctionCallbackInfo<Value> &info) {
  const unsigned char latin1[] = {0xa1, 'b', 'u', 'n', '!', 0};
  perform_string_test_normal_and_internalized(info, latin1, true);
  auto string = String::NewFromOneByte(info.GetIsolate(), latin1,
                                       NewStringType::kNormal, 1)
                    .ToLocalChecked();
  perform_string_test(info, string);
}

void test_v8_string_write_utf8(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  const unsigned char utf8_data_unsigned[] = {
      'h', 'i', 240, 159, 143, 179, 239, 184, 143,  226,  128, 141,
      226, 154, 167, 239, 184, 143, 'h', 'i', 0xc3, 0xa9, 0};
  const char *utf8_data = reinterpret_cast<const char *>(utf8_data_unsigned);

  constexpr int buf_size = sizeof(utf8_data_unsigned) + 3;
  char buf[buf_size] = {0};
  Local<String> s = String::NewFromUtf8(isolate, utf8_data).ToLocalChecked();
  for (int i = buf_size; i >= 0; i--) {
    memset(buf, 0xaa, buf_size);
    size_t nchars;
    // WriteUtf8V2 requires capacity >= 1 when null termination is requested,
    // so only ask for it when the buffer is non-empty (legacy WriteUtf8 also
    // wrote nothing for a zero-sized buffer).
    size_t retval = s->WriteUtf8V2(isolate, buf, static_cast<size_t>(i),
                                   i > 0 ? String::WriteFlags::kNullTerminate
                                         : String::WriteFlags::kNone,
                                   &nchars);
    printf("buffer size = %2d, nchars = %2zu, returned = %2zu, data =", i,
           nchars, retval);
    for (int j = 0; j < buf_size; j++) {
      printf("%c%02x", j == i ? '|' : ' ',
             reinterpret_cast<unsigned char *>(buf)[j]);
    }
    printf("\n");
  }
  return ok(info);
}

// Regression test for writing UTF-8 when a valid surrogate pair (astral
// character) does not fit in the remaining buffer. V8's legacy WriteUtf8
// encoded the unpaired lead surrogate as WTF-8 (3 bytes, 0xED 0xA0-0xAF ...)
// in that case; WriteUtf8V2 instead refuses to write partial sequences and
// stops before the astral character. The encoder that backs this on Bun
// previously wrote U+FFFD (0xEF 0xBF 0xBD) here, diverging from V8.
void test_v8_string_write_utf8_surrogate(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  struct {
    const char *label;
    const char *utf8;
  } inputs[] = {
      // "😀" = U+1F600 (surrogate pair D83D DE00), leading astral character
      {"emoji", "\xF0\x9F\x98\x80"},
      // "a😀" — one ASCII byte then the astral character
      {"a+emoji", "a\xF0\x9F\x98\x80"},
  };

  constexpr int total = 8;
  char buf[total];
  for (auto &in : inputs) {
    Local<String> s = String::NewFromUtf8(isolate, in.utf8).ToLocalChecked();
    for (int i = total; i >= 0; i--) {
      memset(buf, 0xaa, total);
      size_t nchars;
      size_t retval = s->WriteUtf8V2(isolate, buf, static_cast<size_t>(i),
                                     i > 0 ? String::WriteFlags::kNullTerminate
                                           : String::WriteFlags::kNone,
                                     &nchars);
      printf("%-7s size = %d, nchars = %zu, returned = %zu, data =", in.label,
             i, nchars, retval);
      for (int j = 0; j < total; j++) {
        printf("%c%02x", j == i ? '|' : ' ',
               reinterpret_cast<unsigned char *>(buf)[j]);
      }
      printf("\n");
    }
  }
  return ok(info);
}

void test_v8_external(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  int x = 5;
  Local<External> external = External::New(isolate, &x);
  LOG_EXPR(*reinterpret_cast<int *>(external->Value()));
  if (external->Value() != &x) {
    return fail(info,
                "External::Value() returned wrong pointer: expected %p got %p",
                &x, external->Value());
  }
  return ok(info);
}

void test_v8_object(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<Object> obj = Object::New(isolate);
  auto key = String::NewFromUtf8(isolate, "key").ToLocalChecked();
  auto val = Number::New(isolate, 5.0);
  Maybe<bool> set_status = obj->Set(context, key, val);
  LOG_EXPR(set_status.IsJust());
  LOG_EXPR(set_status.FromJust());

  Local<Value> retval = obj->Get(context, key).ToLocalChecked();
  LOG_EXPR(describe(isolate, retval));

  return ok(info);
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

  LOG_EXPR(v8_array->Length());

  for (uint32_t i = 0; i < 5; i++) {
    Local<Value> array_value =
        v8_array->Get(isolate->GetCurrentContext(), i).ToLocalChecked();
    if (!array_value->StrictEquals(vals[i])) {
      printf("array[%u] does not match\n", i);
    }
    LOG_EXPR(describe(isolate, array_value));
  }

  return ok(info);
}

void test_v8_object_template(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<ObjectTemplate> obj_template = ObjectTemplate::New(isolate);
  obj_template->SetInternalFieldCount(2);
  LOG_EXPR(obj_template->InternalFieldCount());

  Local<Object> obj1 = obj_template->NewInstance(context).ToLocalChecked();
  obj1->SetInternalField(0, Number::New(isolate, 3.0));
  obj1->SetInternalField(1, Number::New(isolate, 4.0));

  Local<Object> obj2 = obj_template->NewInstance(context).ToLocalChecked();
  obj2->SetInternalField(0, Number::New(isolate, 5.0));
  obj2->SetInternalField(1, Number::New(isolate, 6.0));

  LOG_EXPR(obj1->GetInternalField(0).As<Number>()->Value());
  LOG_EXPR(obj1->GetInternalField(1).As<Number>()->Value());
  LOG_EXPR(obj2->GetInternalField(0).As<Number>()->Value());
  LOG_EXPR(obj2->GetInternalField(1).As<Number>()->Value());
}

// create_objects_with_internal_fields(count, fieldCount): creates `count`
// instances of an ObjectTemplate with `fieldCount` internal fields and drops
// them all, so the caller can check that collecting them releases their
// internal field storage.
void create_objects_with_internal_fields(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t count = info[0]->Uint32Value(context).FromJust();
  int field_count = static_cast<int>(info[1]->Uint32Value(context).FromJust());

  Local<ObjectTemplate> obj_template = ObjectTemplate::New(isolate);
  obj_template->SetInternalFieldCount(field_count);
  for (uint32_t i = 0; i < count; i++) {
    HandleScope handle_scope(isolate);
    obj_template->NewInstance(context).ToLocalChecked();
  }
  return ok(info);
}

void return_data_callback(const FunctionCallbackInfo<Value> &info) {
  info.GetReturnValue().Set(info.Data());
}

void create_function_with_data(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<String> s =
      String::NewFromUtf8(isolate, "hello world").ToLocalChecked();
  Local<FunctionTemplate> tmp =
      FunctionTemplate::New(isolate, return_data_callback, s);
  Local<Function> f = tmp->GetFunction(context).ToLocalChecked();
  Local<String> name =
      String::NewFromUtf8(isolate, "function_with_data").ToLocalChecked();
  f->SetName(name);
  info.GetReturnValue().Set(f);
}

void test_v8_function_template_set_class_name(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<FunctionTemplate> tmp =
      FunctionTemplate::New(isolate, return_data_callback);
  Local<String> class_name =
      String::NewFromUtf8(isolate, "MyNamedClass").ToLocalChecked();
  tmp->SetClassName(class_name);

  Local<Function> f = tmp->GetFunction(context).ToLocalChecked();
  LOG_EXPR(describe(isolate, f->GetName()));
  info.GetReturnValue().Set(f);
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

void return_this(const FunctionCallbackInfo<Value> &info) {
  info.GetReturnValue().Set(info.This());
}

class GlobalTestWrapper {
public:
  static void set(const FunctionCallbackInfo<Value> &info);
  static void get(const FunctionCallbackInfo<Value> &info);
  static void store(Isolate *isolate, Local<Value> new_value);
  static void cleanup(void *unused);

private:
  static Global<Value> value;
};

Global<Value> GlobalTestWrapper::value;

void GlobalTestWrapper::set(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  if (value.IsEmpty()) {
    info.GetReturnValue().Set(Undefined(isolate));
  } else {
    info.GetReturnValue().Set(value.Get(isolate));
  }
  const auto new_value = info[0];
  value.Reset(isolate, new_value);
}

void GlobalTestWrapper::get(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  if (value.IsEmpty()) {
    info.GetReturnValue().Set(Undefined(isolate));
  } else {
    info.GetReturnValue().Set(value.Get(isolate));
  }
}

void GlobalTestWrapper::store(Isolate *isolate, Local<Value> new_value) {
  value.Reset(isolate, new_value);
}

void GlobalTestWrapper::cleanup(void *unused) { value.Reset(); }

// Native data property whose getter returns the holder it was invoked on and
// whose setter stores it where global_get() can read it, so JS can check what
// receiver the accessor callbacks see for different ways of reaching them.
static void holder_getter(Local<Name> property,
                          const PropertyCallbackInfo<Value> &info) {
  info.GetReturnValue().Set(info.HolderV2());
}

static void holder_setter(Local<Name> property, Local<Value> value,
                          const PropertyCallbackInfo<void> &info) {
  GlobalTestWrapper::store(info.GetIsolate(), info.HolderV2());
}

void create_object_with_holder_accessor(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<ObjectTemplate> obj_t = ObjectTemplate::New(isolate);
  obj_t->SetNativeDataProperty(String::NewFromUtf8Literal(isolate, "holder"),
                               holder_getter, holder_setter);

  info.GetReturnValue().Set(obj_t->NewInstance(context).ToLocalChecked());
}

void test_many_v8_locals(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Number> nums[1000];
  for (int i = 0; i < 1000; i++) {
    nums[i] = Number::New(isolate, (double)i + 0.5);
  }
  // try accessing them all to make sure the pointers are stable
  for (int i = 0; i < 1000; i++) {
    LOG_EXPR(nums[i]->Value());
  }
}

void print_cell_location(Local<Data> v8_value, const char *fmt, ...) {
  (void)v8_value;
  (void)fmt;
  // va_list ap;
  // va_start(ap, fmt);
  // vprintf(fmt, ap);
  // va_end(ap);

  // uintptr_t *slot = *reinterpret_cast<uintptr_t **>(&v8_value);
  // uintptr_t tagged = *slot;
  // uintptr_t addr = tagged & ~3;
  // struct ObjectLayout {
  //   uintptr_t map;
  //   void *cell;
  // };
  // void *cell = reinterpret_cast<ObjectLayout *>(addr)->cell;
  // printf(" = %p\n", cell);
}

static Local<Object> setup_object_with_string_field(Isolate *isolate,
                                                    Local<Context> context,
                                                    Local<ObjectTemplate> tmp,
                                                    int i,
                                                    const std::string &str) {
  EscapableHandleScope ehs(isolate);
  Local<Object> o = tmp->NewInstance(context).ToLocalChecked();
  print_cell_location(o, "objects[%3d]   ", i);
  Local<String> value =
      String::NewFromUtf8(isolate, str.c_str()).ToLocalChecked();
  print_cell_location(value, "objects[%3d]->0", i);

  o->SetInternalField(0, value);
  return ehs.Escape(o);
}

static void examine_object_fields(Isolate *isolate, Local<Object> o,
                                  int expected_field0, int expected_field1) {
  char buf[16];
  HandleScope hs(isolate);
  o->GetInternalField(0).As<String>()->WriteUtf8V2(
      isolate, buf, sizeof buf, String::WriteFlags::kNullTerminate);
  assert(atoi(buf) == expected_field0);

  Local<Value> field1 = o->GetInternalField(1).As<Value>();
  if (field1->IsString()) {
    field1.As<String>()->WriteUtf8V2(isolate, buf, sizeof buf,
                                     String::WriteFlags::kNullTerminate);
    assert(atoi(buf) == expected_field1);
  } else {
    assert(field1->IsUndefined());
  }
}

void test_handle_scope_gc(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  // allocate a ton of objects
  constexpr size_t num_small_allocs = 500;

  Local<String> mini_strings[num_small_allocs];
  for (size_t i = 0; i < num_small_allocs; i++) {
    std::string cpp_str = std::to_string(i);
    mini_strings[i] =
        String::NewFromUtf8(isolate, cpp_str.c_str()).ToLocalChecked();
    print_cell_location(mini_strings[i], "mini_strings[%3d]", i);
  }

  // allocate some objects with internal fields, to check that those are
  // traced
  Local<ObjectTemplate> tmp = ObjectTemplate::New(isolate);
  tmp->SetInternalFieldCount(2);
  print_cell_location(tmp, "object template");
  print_cell_location(context, "context");
  Local<Object> objects[num_small_allocs];

  for (size_t i = 0; i < num_small_allocs; i++) {
    std::string cpp_str = std::to_string(i + num_small_allocs);
    // this uses a function so that the strings aren't kept alive by the
    // current handle scope
    objects[i] =
        setup_object_with_string_field(isolate, context, tmp, i, cpp_str);
  }

  // allocate some massive strings
  // this should cause GC to start looking for objects to free
  // after each big string allocation, we try reading all of the strings we
  // created above to ensure they are still alive
  constexpr size_t num_strings = 50;
  constexpr size_t string_size = 20 * 1000 * 1000;

  auto string_data = new char[string_size];
  string_data[string_size - 1] = 0;

  Local<String> huge_strings[num_strings];
  for (size_t i = 0; i < num_strings; i++) {
    printf("%zu\n", i);
    memset(string_data, i + 1, string_size - 1);
    huge_strings[i] =
        String::NewFromUtf8(isolate, string_data).ToLocalChecked();

    // try to use all mini strings
    for (size_t j = 0; j < num_small_allocs; j++) {
      char buf[16];
      mini_strings[j]->WriteUtf8V2(isolate, buf, sizeof buf,
                                   String::WriteFlags::kNullTerminate);
      assert(atoi(buf) == (int)j);
    }

    for (size_t j = 0; j < num_small_allocs; j++) {
      examine_object_fields(isolate, objects[j], j + num_small_allocs,
                            j + 2 * num_small_allocs);
    }

    if (i == 1) {
      // add more internal fields to the objects a long time after they were
      // created, to ensure these can also be traced
      // make a new handlescope here so that the new strings we allocate are
      // only referenced by the objects
      HandleScope inner_hs(isolate);
      for (auto &o : objects) {
        int i = &o - &objects[0];
        auto cpp_str = std::to_string(i + 2 * num_small_allocs);
        Local<String> field =
            String::NewFromUtf8(isolate, cpp_str.c_str()).ToLocalChecked();
        o->SetInternalField(1, field);
      }
    }
  }

  memset(string_data, 0, string_size);
  for (size_t i = 0; i < num_strings; i++) {
    huge_strings[i]->WriteUtf8V2(isolate, string_data, string_size,
                                 String::WriteFlags::kNullTerminate);
    for (size_t j = 0; j < string_size - 1; j++) {
      assert(string_data[j] == (char)(i + 1));
    }
  }

  delete[] string_data;
}

Local<String> escape_object(Isolate *isolate) {
  EscapableHandleScope ehs(isolate);
  Local<String> invalidated =
      String::NewFromUtf8(isolate, "hello").ToLocalChecked();
  Local<String> escaped = ehs.Escape(invalidated);
  return escaped;
}

Local<Number> escape_smi(Isolate *isolate) {
  EscapableHandleScope ehs(isolate);
  Local<Number> invalidated = Number::New(isolate, 3.0);
  Local<Number> escaped = ehs.Escape(invalidated);
  return escaped;
}

Local<Boolean> escape_true(Isolate *isolate) {
  EscapableHandleScope ehs(isolate);
  Local<Boolean> invalidated = v8::True(isolate);
  Local<Boolean> escaped = ehs.Escape(invalidated);
  return escaped;
}

void test_v8_escapable_handle_scope(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<String> s = escape_object(isolate);
  Local<Number> n = escape_smi(isolate);
  Local<Boolean> t = escape_true(isolate);

  LOG_VALUE_KIND(s);
  LOG_VALUE_KIND(n);
  LOG_VALUE_KIND(t);

  char buf[16];
  s->WriteUtf8V2(isolate, buf, sizeof buf, String::WriteFlags::kNullTerminate);
  LOG_EXPR(buf);
  LOG_EXPR(n->Value());
}

// Regression test: the escape slot must be reserved when the escapable scope
// opens, not when Escape() is called. With Node 26 headers the inline
// ~HandleScope calls DeleteExtensions, which frees every handle created
// inside the scope — including, before the fix, an escape handle allocated at
// Escape() time after in-scope Local copies.
Local<String> escape_after_inline_handles(Isolate *isolate) {
  EscapableHandleScope ehs(isolate);
  Local<String> value =
      String::NewFromUtf8(isolate, "escaped-after-inline").ToLocalChecked();
  // These go through the headers' inline CreateHandle (HandleScope::Extend
  // grants) and are swept by DeleteExtensions when the scope closes.
  Local<Value> copy1 = Local<Value>::New(isolate, Local<Value>::Cast(value));
  Local<Value> copy2 = Local<Value>::New(isolate, copy1);
  (void)copy2;
  Local<String> escaped = ehs.Escape(value);
  return escaped;
}

void test_v8_escapable_handle_scope_inline_grants(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<String> s = escape_after_inline_handles(isolate);
  // Create more handles so a freed escape slot would be overwritten before we
  // read it back.
  for (int i = 0; i < 16; i++) {
    (void)Number::New(isolate, i * 1.5);
  }
  LOG_VALUE_KIND(s);
  char buf[32];
  s->WriteUtf8V2(isolate, buf, sizeof buf, String::WriteFlags::kNullTerminate);
  LOG_EXPR(buf);
}

// Regression test: handles created through the headers' inline CreateHandle
// must survive a Bun-internal HandleScope push/pop (Array::Iterate pushes one
// around the iteration callback). If the pop leaves the isolate's
// HandleScopeData pointing into the popped scope's buffer, a later inline
// v8::HandleScope snapshots that stale limit and its DeleteExtensions sweeps
// the enclosing buffer's grants — including `kept`.
void test_v8_locals_survive_nested_call(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<String> value =
      String::NewFromUtf8(isolate, "kept-across-call").ToLocalChecked();
  // Inline grant before the nested scope push.
  Local<Value> kept = Local<Value>::New(isolate, Local<Value>::Cast(value));
  Local<Array> array = Array::New(isolate, 3);
  // Array::Iterate pushes (and pops) a Bun-internal handle scope around the
  // callback; the inline Local::New inside makes Extend run while that scope
  // is current.
  (void)array->Iterate(
      context,
      [](uint32_t index, Local<Value> element, void *data) {
        Isolate *iso = static_cast<Isolate *>(data);
        Local<Value> copy = Local<Value>::New(iso, element);
        (void)copy;
        return Array::CallbackResult::kContinue;
      },
      isolate);
  // Inline scope after the pop: snapshots whatever HandleScopeData now holds.
  {
    HandleScope inner(isolate);
    Local<Value> tmp = Local<Value>::New(isolate, kept);
    (void)tmp;
  } // ~HandleScope → DeleteExtensions
  char buf[32];
  Local<String>::Cast(kept)->WriteUtf8V2(isolate, buf, sizeof buf,
                                         String::WriteFlags::kNullTerminate);
  LOG_EXPR(buf);
}

// Regression tests: GetReturnValue().Set() copies the Local's value into the
// callback frame, and V8 guarantees the returned value outlives any handle
// scope that closes before the callback returns (the stock nan idiom opens a
// HandleScope, materializes a persistent with Nan::New, and returns a local
// made inside that scope). The inline grant forces the scope's inline
// destructor to run DeleteExtensions.

// Calls info[1] (the JS driver passes a function that forces GC under bun)
// while the callback is still on the stack, after the inner scope already
// closed: the preserved return value must stay GC-visited until the runtime
// reads the callback frame.
static void call_gc_callback(const FunctionCallbackInfo<Value> &info) {
  if (info.Length() > 1 && info[1]->IsFunction()) {
    Isolate *isolate = info.GetIsolate();
    Local<Context> context = isolate->GetCurrentContext();
    (void)info[1].As<Function>()->Call(context, Undefined(isolate), 0, nullptr);
  }
}

void return_string_from_inner_scope(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  {
    HandleScope hs(isolate);
    Local<Value> grant = Local<Value>::New(isolate, info[0]);
    (void)grant;
    info.GetReturnValue().Set(
        String::NewFromUtf8(isolate, "returned-from-inner-scope")
            .ToLocalChecked());
  }
  call_gc_callback(info);
}

void return_heap_number_from_inner_scope(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  {
    HandleScope hs(isolate);
    Local<Value> grant = Local<Value>::New(isolate, info[0]);
    (void)grant;
    info.GetReturnValue().Set(Number::New(isolate, 3.25));
  }
  call_gc_callback(info);
}

// The return value must also survive runtime-internal scopes that pop while
// the callback frame is live: Array::Iterate runs the iteration callback
// inside one, and the element locals it passes are created there.
void return_array_element_from_iterate(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Array> array = info[0].As<Array>();
  (void)array->Iterate(
      context,
      [](uint32_t index, Local<Value> element, void *data) {
        auto *outer = static_cast<const FunctionCallbackInfo<Value> *>(data);
        if (index == 1) {
          outer->GetReturnValue().Set(element);
        }
        return Array::CallbackResult::kContinue;
      },
      const_cast<void *>(static_cast<const void *>(&info)));
  call_gc_callback(info);
}

static void inner_scope_native_getter(Local<Name> property,
                                      const PropertyCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  HandleScope hs(isolate);
  Local<Value> grant = Local<Value>::New(isolate, Local<Value>::Cast(property));
  (void)grant;
  info.GetReturnValue().Set(
      String::NewFromUtf8(isolate, "accessor-from-inner-scope")
          .ToLocalChecked());
}

// Same scenario through a native-data-property accessor's
// PropertyCallbackInfo.
void return_accessor_value_from_inner_scope(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<FunctionTemplate> ctor_t = FunctionTemplate::New(isolate);
  ctor_t->PrototypeTemplate()->SetNativeDataProperty(
      String::NewFromUtf8Literal(isolate, "prop"), inner_scope_native_getter);
  Local<Function> ctor = ctor_t->GetFunction(context).ToLocalChecked();
  Local<Object> inst = ctor->NewInstance(context).ToLocalChecked();
  Local<Value> value =
      inst->Get(context, String::NewFromUtf8(isolate, "prop").ToLocalChecked())
          .ToLocalChecked();
  info.GetReturnValue().Set(value);
}

void test_uv_os_getpid(const FunctionCallbackInfo<Value> &info) {
#ifndef _WIN32
  assert(getpid() == uv_os_getpid());
#else
  assert(0 && "unreachable");
#endif
  return ok(info);
}

void test_uv_os_getppid(const FunctionCallbackInfo<Value> &info) {
#ifndef _WIN32
  assert(getppid() == uv_os_getppid());
#else
  assert(0 && "unreachable");
#endif
  return ok(info);
}

struct QueuedWork {
  uv_work_t req;
  Isolate *isolate;
  Global<Function> callback;
  int result = 0;
};

// Queues work the way Nan::AsyncQueueWorker does. after_work_cb only opens a
// v8::HandleScope, like Nan::AsyncExecuteComplete.
void queue_work_and_call(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  auto *work = new QueuedWork;
  work->req.data = work;
  work->isolate = isolate;
  work->callback.Reset(isolate, info[0].As<Function>());
  int rc = uv_queue_work(
      node::GetCurrentEventLoop(isolate), &work->req,
      [](uv_work_t *req) { static_cast<QueuedWork *>(req->data)->result = 42; },
      [](uv_work_t *req, int status) {
        auto *work = static_cast<QueuedWork *>(req->data);
        Isolate *isolate = work->isolate;
        {
          HandleScope scope(isolate);
          Local<Value> args[] = {
              String::NewFromUtf8(isolate, "done").ToLocalChecked(),
              Number::New(isolate, status),
              Number::New(isolate, work->result),
          };
          Local<Function>::New(isolate, work->callback)
              ->Call(isolate->GetCurrentContext(), Undefined(isolate), 3, args)
              .ToLocalChecked();
        }
        delete work;
      });
  info.GetReturnValue().Set(Number::New(isolate, rc));
}

void test_v8_object_get_by_key(const FunctionCallbackInfo<Value> &info) {
  printf("Testing Object::Get(context, key)...\n");

  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  // Create an object and set multiple properties
  Local<Object> obj = Object::New(isolate);

  // Test string property
  auto str_key = String::NewFromUtf8(isolate, "stringProp").ToLocalChecked();
  auto str_val = String::NewFromUtf8(isolate, "test_value").ToLocalChecked();
  Maybe<bool> set_result = obj->Set(context, str_key, str_val);
  LOG_EXPR(set_result.FromJust());

  // Test number property
  auto num_key = String::NewFromUtf8(isolate, "numberProp").ToLocalChecked();
  auto num_val = Number::New(isolate, 42.5);
  set_result = obj->Set(context, num_key, num_val);
  LOG_EXPR(set_result.FromJust());

  // Test boolean property
  auto bool_key = String::NewFromUtf8(isolate, "boolProp").ToLocalChecked();
  auto bool_val = Boolean::New(isolate, true);
  set_result = obj->Set(context, bool_key, bool_val);
  LOG_EXPR(set_result.FromJust());

  // Get the properties back using Object::Get(context, key)
  MaybeLocal<Value> str_result = obj->Get(context, str_key);
  if (str_result.IsEmpty()) {
    return fail(info, "Object::Get returned empty for string property");
  }
  Local<Value> str_retrieved = str_result.ToLocalChecked();
  LOG_EXPR(describe(isolate, str_retrieved));

  MaybeLocal<Value> num_result = obj->Get(context, num_key);
  if (num_result.IsEmpty()) {
    return fail(info, "Object::Get returned empty for number property");
  }
  Local<Value> num_retrieved = num_result.ToLocalChecked();
  LOG_EXPR(describe(isolate, num_retrieved));

  MaybeLocal<Value> bool_result = obj->Get(context, bool_key);
  if (bool_result.IsEmpty()) {
    return fail(info, "Object::Get returned empty for boolean property");
  }
  Local<Value> bool_retrieved = bool_result.ToLocalChecked();
  LOG_EXPR(describe(isolate, bool_retrieved));

  // Verify values are strictly equal
  if (!str_retrieved->StrictEquals(str_val)) {
    return fail(info, "String property not strictly equal after Get");
  }
  if (!num_retrieved->StrictEquals(num_val)) {
    return fail(info, "Number property not strictly equal after Get");
  }
  if (!bool_retrieved->StrictEquals(bool_val)) {
    return fail(info, "Boolean property not strictly equal after Get");
  }

  return ok(info);
}

void test_v8_object_get_by_index(const FunctionCallbackInfo<Value> &info) {
  printf("Testing Object::Get(context, index)...\n");

  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  // Create an array and set elements at various indices
  Local<Array> arr = Array::New(isolate, 5);

  // Set elements at different indices
  auto val0 = String::NewFromUtf8(isolate, "index_0").ToLocalChecked();
  auto val2 = Number::New(isolate, 123.45);
  auto val4 = Boolean::New(isolate, false);

  Maybe<bool> set_result = arr->Set(context, 0, val0);
  LOG_EXPR(set_result.FromJust());
  set_result = arr->Set(context, 2, val2);
  LOG_EXPR(set_result.FromJust());
  set_result = arr->Set(context, 4, val4);
  LOG_EXPR(set_result.FromJust());

  // Get elements back using Object::Get(context, index)
  MaybeLocal<Value> result0 = arr->Get(context, 0);
  if (result0.IsEmpty()) {
    return fail(info, "Object::Get returned empty for index 0");
  }
  Local<Value> retrieved0 = result0.ToLocalChecked();
  LOG_EXPR(describe(isolate, retrieved0));

  MaybeLocal<Value> result1 = arr->Get(context, 1); // Should be undefined
  if (result1.IsEmpty()) {
    return fail(info, "Object::Get returned empty for index 1");
  }
  Local<Value> retrieved1 = result1.ToLocalChecked();
  LOG_EXPR(describe(isolate, retrieved1));

  MaybeLocal<Value> result2 = arr->Get(context, 2);
  if (result2.IsEmpty()) {
    return fail(info, "Object::Get returned empty for index 2");
  }
  Local<Value> retrieved2 = result2.ToLocalChecked();
  LOG_EXPR(describe(isolate, retrieved2));

  MaybeLocal<Value> result4 = arr->Get(context, 4);
  if (result4.IsEmpty()) {
    return fail(info, "Object::Get returned empty for index 4");
  }
  Local<Value> retrieved4 = result4.ToLocalChecked();
  LOG_EXPR(describe(isolate, retrieved4));

  // Verify values are correct
  if (!retrieved0->StrictEquals(val0)) {
    return fail(info, "Index 0 value not strictly equal after Get");
  }
  if (!retrieved1->IsUndefined()) {
    return fail(info, "Index 1 should be undefined");
  }
  if (!retrieved2->StrictEquals(val2)) {
    return fail(info, "Index 2 value not strictly equal after Get");
  }
  if (!retrieved4->StrictEquals(val4)) {
    return fail(info, "Index 4 value not strictly equal after Get");
  }

  return ok(info);
}

void test_v8_strict_equals(const FunctionCallbackInfo<Value> &info) {
  printf("Testing Value::StrictEquals()...\n");

  Isolate *isolate = info.GetIsolate();

  // Test number equality
  auto num1 = Number::New(isolate, 123.45);
  auto num2 = Number::New(isolate, 123.45);
  auto num3 = Number::New(isolate, 67.89);

  LOG_EXPR(num1->StrictEquals(num2)); // Should be true
  LOG_EXPR(num1->StrictEquals(num3)); // Should be false

  if (!num1->StrictEquals(num2)) {
    return fail(info, "Same numbers should be strictly equal");
  }
  if (num1->StrictEquals(num3)) {
    return fail(info, "Different numbers should not be strictly equal");
  }

  // Test string equality
  auto str1 = String::NewFromUtf8(isolate, "hello").ToLocalChecked();
  auto str2 = String::NewFromUtf8(isolate, "hello").ToLocalChecked();
  auto str3 = String::NewFromUtf8(isolate, "world").ToLocalChecked();

  LOG_EXPR(str1->StrictEquals(str2)); // Should be true
  LOG_EXPR(str1->StrictEquals(str3)); // Should be false

  if (!str1->StrictEquals(str2)) {
    return fail(info, "Same strings should be strictly equal");
  }
  if (str1->StrictEquals(str3)) {
    return fail(info, "Different strings should not be strictly equal");
  }

  // Test boolean equality
  auto bool1 = Boolean::New(isolate, true);
  auto bool2 = Boolean::New(isolate, true);
  auto bool3 = Boolean::New(isolate, false);

  LOG_EXPR(bool1->StrictEquals(bool2)); // Should be true
  LOG_EXPR(bool1->StrictEquals(bool3)); // Should be false

  if (!bool1->StrictEquals(bool2)) {
    return fail(info, "Same booleans should be strictly equal");
  }
  if (bool1->StrictEquals(bool3)) {
    return fail(info, "Different booleans should not be strictly equal");
  }

  // Test different types are not equal
  LOG_EXPR(num1->StrictEquals(str1)); // Should be false

  if (num1->StrictEquals(str1)) {
    return fail(info, "Number and string should not be strictly equal");
  }

  // Test null and undefined
  auto null_val = Null(isolate);
  auto undef_val = Undefined(isolate);

  LOG_EXPR(null_val->StrictEquals(undef_val)); // Should be false

  if (null_val->StrictEquals(undef_val)) {
    return fail(info, "null and undefined should not be strictly equal");
  }

  // Test same null/undefined values
  auto null_val2 = Null(isolate);
  auto undef_val2 = Undefined(isolate);

  LOG_EXPR(null_val->StrictEquals(null_val2));   // Should be true
  LOG_EXPR(undef_val->StrictEquals(undef_val2)); // Should be true

  if (!null_val->StrictEquals(null_val2)) {
    return fail(info, "null values should be strictly equal");
  }
  if (!undef_val->StrictEquals(undef_val2)) {
    return fail(info, "undefined values should be strictly equal");
  }

  return ok(info);
}

// Test Array::New with just length parameter
void test_v8_array_new_with_length(const FunctionCallbackInfo<Value> &info) {
  printf("Testing Array::New(isolate, length)...\n");
  Isolate *isolate = info.GetIsolate();

  // Test creating array with length 0
  Local<Array> empty_array = Array::New(isolate, 0);
  LOG_EXPR(empty_array->Length());
  if (empty_array->Length() != 0) {
    return fail(info, "Empty array should have length 0");
  }

  // Test creating array with positive length
  Local<Array> array_with_length = Array::New(isolate, 10);
  LOG_EXPR(array_with_length->Length());
  if (array_with_length->Length() != 10) {
    return fail(info, "Array should have length 10");
  }

  // Check that all elements are undefined
  Local<Context> context = isolate->GetCurrentContext();
  for (uint32_t i = 0; i < 10; i++) {
    Local<Value> element = array_with_length->Get(context, i).ToLocalChecked();
    if (!element->IsUndefined()) {
      return fail(info, "Array elements should be undefined initially");
    }
  }

  // Test negative length (should be treated as 0)
  Local<Array> array_negative = Array::New(isolate, -5);
  LOG_EXPR(array_negative->Length());
  if (array_negative->Length() != 0) {
    return fail(info, "Array with negative length should have length 0");
  }

  return ok(info);
}

void test_v8_array_new_with_callback(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t i = 0;

  // TODO: check returning empty from the callback (we can't right now because
  // V8 asserts that you have also thrown an exception when you do that, but Bun
  // doesn't implement the V8 APIs to throw exceptions
  Local<Array> array =
      Array::New(context, 10, [&i, isolate]() -> MaybeLocal<Value> {
        return Number::New(isolate, ++i);
      }).ToLocalChecked();

  LOG_EXPR(i);
  LOG_EXPR(array->Length());
  for (i = 0; i < 10; i++) {
    LOG_EXPR(describe(isolate, array->Get(context, i).ToLocalChecked()));
  }
}

// Test Array::Length method
void test_v8_array_length(const FunctionCallbackInfo<Value> &info) {
  printf("Testing Array::Length()...\n");
  Isolate *isolate = info.GetIsolate();

  // Create arrays with different lengths and verify
  Local<Array> arr1 = Array::New(isolate, 0);
  Local<Array> arr2 = Array::New(isolate, 5);
  Local<Array> arr3 = Array::New(isolate, 100);

  LOG_EXPR(arr1->Length());
  LOG_EXPR(arr2->Length());
  LOG_EXPR(arr3->Length());

  if (arr1->Length() != 0) {
    return fail(info, "Array 1 should have length 0");
  }
  if (arr2->Length() != 5) {
    return fail(info, "Array 2 should have length 5");
  }
  if (arr3->Length() != 100) {
    return fail(info, "Array 3 should have length 100");
  }

  // Test with array created from elements
  Local<Value> elements[3] = {Number::New(isolate, 1), Number::New(isolate, 2),
                              Number::New(isolate, 3)};
  Local<Array> arr_from_elements = Array::New(isolate, elements, 3);
  LOG_EXPR(arr_from_elements->Length());

  if (arr_from_elements->Length() != 3) {
    return fail(info, "Array from elements should have length 3");
  }

  return ok(info);
}

// Test Array::Iterate method
void test_v8_array_iterate(const FunctionCallbackInfo<Value> &info) {
  printf("Testing Array::Iterate()...\n");
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  // Create an array with known values
  Local<Value> elements[5] = {
      Number::New(isolate, 10),
      String::NewFromUtf8(isolate, "hello").ToLocalChecked(),
      Boolean::New(isolate, true), Null(isolate), Number::New(isolate, 42)};
  Local<Array> array = Array::New(isolate, elements, 5);

  // Test normal iteration
  struct IterationData {
    uint32_t count;
    bool values_match;
    Local<Value> *expected_values;
  } iter_data = {0, true, elements};

  Maybe<void> result = array->Iterate(
      context,
      [](uint32_t index, Local<Value> element,
         void *data) -> Array::CallbackResult {
        IterationData *iter_data = static_cast<IterationData *>(data);
        printf("Iterating index %u\n", index);

        if (index != iter_data->count) {
          iter_data->values_match = false;
          return Array::CallbackResult::kException;
        }

        if (!element->StrictEquals(iter_data->expected_values[index])) {
          iter_data->values_match = false;
          return Array::CallbackResult::kException;
        }

        iter_data->count++;
        return Array::CallbackResult::kContinue;
      },
      &iter_data);

  if (result.IsNothing()) {
    return fail(info, "Array iteration failed");
  }

  if (iter_data.count != 5) {
    return fail(info, "Should have iterated over all 5 elements");
  }

  if (!iter_data.values_match) {
    return fail(info, "Array elements did not match expected values");
  }

  // Test early exit with kBreak
  struct BreakData {
    int count;
  } break_data = {0};

  result = array->Iterate(
      context,
      [](uint32_t index, Local<Value> element,
         void *data) -> Array::CallbackResult {
        BreakData *break_data = static_cast<BreakData *>(data);
        break_data->count++;

        if (index == 2) {
          return Array::CallbackResult::kBreak; // Exit early
        }

        return Array::CallbackResult::kContinue;
      },
      &break_data);

  if (result.IsNothing()) {
    return fail(info, "Array iteration with break failed");
  }

  LOG_EXPR(break_data.count);
  if (break_data.count != 3) { // Should have processed indices 0, 1, 2
    return fail(info, "Should have stopped at index 2");
  }

  return ok(info);
}

// Test MaybeLocal functionality
void test_v8_maybe_local(const FunctionCallbackInfo<Value> &info) {
  printf("Testing MaybeLocal...\n");
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  // Test with Array::New callback that can fail
  size_t counter = 0;

  // Test successful creation
  MaybeLocal<Array> maybe_array =
      Array::New(context, 3, [&counter, isolate]() -> MaybeLocal<Value> {
        counter++;
        return Number::New(isolate, counter * 10);
      });

  if (maybe_array.IsEmpty()) {
    return fail(info, "Array creation should have succeeded");
  }

  Local<Array> array = maybe_array.ToLocalChecked();
  LOG_EXPR(array->Length());

  if (array->Length() != 3) {
    return fail(info, "Array should have length 3");
  }

  // Verify elements
  for (uint32_t i = 0; i < 3; i++) {
    Local<Value> element = array->Get(context, i).ToLocalChecked();
    double expected = (i + 1) * 10.0;
    if (!element->IsNumber() || element.As<Number>()->Value() != expected) {
      return fail(info, "Array element has wrong value");
    }
  }

  // Test ToLocal pattern
  counter = 0;
  MaybeLocal<Array> maybe_array2 =
      Array::New(context, 2, [&counter, isolate]() -> MaybeLocal<Value> {
        counter++;
        return String::NewFromUtf8(isolate, counter == 1 ? "first" : "second");
      });

  Local<Array> array2;
  if (!maybe_array2.ToLocal(&array2)) {
    return fail(info, "ToLocal should have succeeded");
  }

  LOG_EXPR(array2->Length());
  if (array2->Length() != 2) {
    return fail(info, "Array2 should have length 2");
  }

  // Test empty MaybeLocal
  MaybeLocal<Array> empty_maybe;
  if (!empty_maybe.IsEmpty()) {
    return fail(info, "Empty MaybeLocal should be empty");
  }

  Local<Array> empty_result;
  if (empty_maybe.ToLocal(&empty_result)) {
    return fail(info, "ToLocal on empty MaybeLocal should return false");
  }

  // Verify that empty_result was set to nullptr
  if (!empty_result.IsEmpty()) {
    return fail(info, "ToLocal should set output to nullptr when empty");
  }

  return ok(info);
}

void perform_object_get_by_index(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> object = info[0].As<Object>();
  uint32_t index = static_cast<uint32_t>(info[1].As<Number>()->Value());
  MaybeLocal<Value> get_result = object->Get(context, index);
  LOG_EXPR(get_result.IsEmpty());
  if (!get_result.IsEmpty()) {
    LOG_EXPR(describe(isolate, get_result.ToLocalChecked()));
  }
}

void perform_object_set_by_index(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> object = info[0].As<Object>();
  uint32_t index = static_cast<uint32_t>(info[1].As<Number>()->Value());
  Local<Value> value = info[2];
  Maybe<bool> set_result = object->Set(context, index, value);
  LOG_EXPR(set_result.IsJust());
  if (set_result.IsJust()) {
    LOG_EXPR(set_result.FromJust());
  }
}

void perform_object_get_by_key(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> object = info[0].As<Object>();
  Local<Value> key = info[1];
  MaybeLocal<Value> get_result = object->Get(context, key);
  LOG_EXPR(get_result.IsEmpty());
  if (!get_result.IsEmpty()) {
    LOG_EXPR(describe(isolate, get_result.ToLocalChecked()));
  }
}

void perform_object_set_by_key(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> object = info[0].As<Object>();
  Local<Value> key = info[1];
  Local<Value> value = info[2];
  Maybe<bool> set_result = object->Set(context, key, value);
  LOG_EXPR(set_result.IsJust());
  if (set_result.IsJust()) {
    LOG_EXPR(set_result.FromJust());
  }
}

void test_v8_value_type_checks(const FunctionCallbackInfo<Value> &info) {
  if (info.Length() < 1) {
    return fail(info, "Expected 1 argument");
  }

  Local<Value> value = info[0];

  // Test all type checks
  printf("IsMap: %s\n", value->IsMap() ? "true" : "false");
  printf("IsArray: %s\n", value->IsArray() ? "true" : "false");
  printf("IsInt32: %s\n", value->IsInt32() ? "true" : "false");
  printf("IsBigInt: %s\n", value->IsBigInt() ? "true" : "false");

  // Also test some existing checks for comparison
  printf("IsNumber: %s\n", value->IsNumber() ? "true" : "false");
  printf("IsUint32: %s\n", value->IsUint32() ? "true" : "false");
  printf("IsObject: %s\n", value->IsObject() ? "true" : "false");
  printf("IsBoolean: %s\n", value->IsBoolean() ? "true" : "false");
  printf("IsString: %s\n", value->IsString() ? "true" : "false");
  printf("IsFunction: %s\n", value->IsFunction() ? "true" : "false");

  return ok(info);
}

void print_external_and_buffer_type_checks(
    const FunctionCallbackInfo<Value> &info) {
  Local<Value> value = info[0];
  char label[128] = {0};
  info[1].As<String>()->WriteUtf8V2(info.GetIsolate(), label,
                                    sizeof(label) - 1);
  std::cout << label << ": IsExternal=" << value->IsExternal()
            << " IsArrayBuffer=" << value->IsArrayBuffer()
            << " IsArrayBufferView=" << value->IsArrayBufferView()
            << " IsSharedArrayBuffer=" << value->IsSharedArrayBuffer()
            << std::endl;
}

void create_external_and_template_instance(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  static int target;
  Local<ObjectTemplate> obj_template = ObjectTemplate::New(isolate);
  obj_template->SetInternalFieldCount(2);
  Local<Value> values[] = {
      External::New(isolate, &target),
      obj_template->NewInstance(context).ToLocalChecked(),
  };
  info.GetReturnValue().Set(Array::New(isolate, values, 2));
}

void test_v8_integer(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<Integer> small_int = Integer::New(isolate, 42);
  LOG_EXPR(small_int->Value());
  LOG_EXPR(small_int->IsNumber());
  LOG_EXPR(small_int->IsInt32());

  Local<Integer> neg = Integer::New(isolate, -7);
  LOG_EXPR(neg->Value());

  Local<Integer> int32_max = Integer::New(isolate, 2147483647);
  LOG_EXPR(int32_max->Value());

  Local<Integer> int32_min = Integer::New(isolate, -2147483647 - 1);
  LOG_EXPR(int32_min->Value());

  // Round-trip through Value -> ToInteger
  Local<Context> context = isolate->GetCurrentContext();
  Local<Value> as_value = small_int;
  Local<Integer> back = as_value->ToInteger(context).ToLocalChecked();
  LOG_EXPR(back->Value());

  return ok(info);
}

// Returns ToInt32 of the first argument. Leaves the exception pending when the
// conversion throws, so the JS caller sees it.
void perform_to_int32(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  MaybeLocal<Int32> maybe = info[0]->ToInt32(context);
  LOG_EXPR(maybe.IsEmpty());
  if (maybe.IsEmpty()) {
    return;
  }
  Local<Int32> result = maybe.ToLocalChecked();
  LOG_EXPR(result->Value());
  LOG_EXPR(result->IsInt32());
  info.GetReturnValue().Set(result);
}

// Returns { file, line, column } for the function passed as the first argument,
// as @newrelic/fn-inspect does. file is undefined when the resource name is an
// empty handle.
void get_function_script_origin(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (!info[0]->IsFunction()) {
    return fail(info, "argument is not a function");
  }
  Local<Function> fn = info[0].As<Function>();

  ScriptOrigin origin = fn->GetScriptOrigin();
  Local<Value> resource_name = origin.ResourceName();
  LOG_EXPR(resource_name.IsEmpty());
  LOG_EXPR(origin.LineOffset());
  LOG_EXPR(origin.ColumnOffset());
  int line = fn->GetScriptLineNumber();
  int column = fn->GetScriptColumnNumber();
  LOG_EXPR(line);
  LOG_EXPR(column);

  Local<Object> result = Object::New(isolate);
  Local<Value> file = resource_name.IsEmpty() ? Local<Value>(Undefined(isolate))
                                              : resource_name;
  result
      ->Set(context, String::NewFromUtf8(isolate, "file").ToLocalChecked(),
            file)
      .FromJust();
  result
      ->Set(context, String::NewFromUtf8(isolate, "line").ToLocalChecked(),
            Integer::New(isolate, line))
      .FromJust();
  result
      ->Set(context, String::NewFromUtf8(isolate, "column").ToLocalChecked(),
            Integer::New(isolate, column))
      .FromJust();
  info.GetReturnValue().Set(result);
}

void test_v8_define_own_property(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<Object> obj = Object::New(isolate);

  Local<String> key_rw =
      String::NewFromUtf8(isolate, "writable").ToLocalChecked();
  Maybe<bool> r = obj->DefineOwnProperty(context, key_rw,
                                         Number::New(isolate, 1.0), v8::None);
  LOG_EXPR(r.IsJust());
  LOG_EXPR(r.FromJust());

  Local<String> key_ro =
      String::NewFromUtf8(isolate, "readonly").ToLocalChecked();
  r = obj->DefineOwnProperty(
      context, key_ro, Number::New(isolate, 2.0),
      static_cast<PropertyAttribute>(v8::ReadOnly | v8::DontDelete));
  LOG_EXPR(r.FromJust());

  Local<String> key_hidden =
      String::NewFromUtf8(isolate, "hidden").ToLocalChecked();
  r = obj->DefineOwnProperty(context, key_hidden, Number::New(isolate, 3.0),
                             v8::DontEnum);
  LOG_EXPR(r.FromJust());

  LOG_EXPR(describe(isolate, obj->Get(context, key_rw).ToLocalChecked()));
  LOG_EXPR(describe(isolate, obj->Get(context, key_ro).ToLocalChecked()));
  LOG_EXPR(describe(isolate, obj->Get(context, key_hidden).ToLocalChecked()));

  // GetIdentityHash: stable across calls on the same object, non-zero, and
  // survives property definition. The actual value is engine-specific so only
  // assert on the invariants, not the number.
  int hash1 = obj->GetIdentityHash();
  int hash2 = obj->GetIdentityHash();
  LOG_EXPR(hash1 != 0);
  LOG_EXPR(hash1 == hash2);
  r = obj->DefineOwnProperty(
      context, String::NewFromUtf8(isolate, "late").ToLocalChecked(),
      Number::New(isolate, 4.0), v8::None);
  LOG_EXPR(r.FromJust());
  int hash3 = obj->GetIdentityHash();
  LOG_EXPR(hash1 == hash3);
  // A fresh, distinct object must also have a non-zero hash.
  Local<Object> other = Object::New(isolate);
  LOG_EXPR(other->GetIdentityHash() != 0);

  // Let JS assert writability/enumerability/configurability by returning obj.
  info.GetReturnValue().Set(obj);
}

void test_v8_bigint(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<BigInt> big = BigInt::New(isolate, 123456789012345LL);
  LOG_EXPR(big->IsBigInt());
  LOG_EXPR(big->IsNumber());

  Local<BigInt> neg = BigInt::New(isolate, -987654321098765LL);
  LOG_EXPR(neg->IsBigInt());

  Local<BigInt> zero = BigInt::New(isolate, 0);
  LOG_EXPR(zero->IsBigInt());

  // Return the first BigInt so JS can assert the numeric value exactly.
  info.GetReturnValue().Set(big);
}

// 0, 1 and values that a uint32_t, a double or an int64_t cannot hold.
static const uint64_t uint64_boundary_values[] = {
    0,
    1,
    uint64_t{1} << 32,
    (uint64_t{1} << 53) + 1,
    uint64_t{1} << 63,
    UINT64_MAX,
};

static Local<BigInt> log_bigint_from_unsigned(Isolate *isolate,
                                              uint64_t value) {
  Local<BigInt> big = BigInt::NewFromUnsigned(isolate, value);
  std::cout << "NewFromUnsigned(" << value
            << "): IsBigInt() = " << big->IsBigInt()
            << ", IsNumber() = " << big->IsNumber() << std::endl;
  return big;
}

void create_bigints_from_unsigned(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  constexpr size_t count =
      sizeof(uint64_boundary_values) / sizeof(uint64_boundary_values[0]);
  Local<Value> bigints[count];
  for (size_t i = 0; i < count; i++) {
    bigints[i] = log_bigint_from_unsigned(isolate, uint64_boundary_values[i]);
  }
  // Return them so JS can print the type and the exact value of each.
  info.GetReturnValue().Set(Array::New(isolate, bigints, count));
}

// An addon does not check the Local that BigInt::NewFromUnsigned returns.
void create_bigints_from_unsigned_with_pending_exception(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  isolate->ThrowError(String::NewFromUtf8(isolate, "pending").ToLocalChecked());

  for (uint64_t value : uint64_boundary_values) {
    log_bigint_from_unsigned(isolate, value);
  }
}

void test_v8_string_from_utf8_literal(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<String> s = String::NewFromUtf8Literal(isolate, "hello literal");
  LOG_EXPR(s->IsString());
  LOG_EXPR(s->Length());
  LOG_EXPR(describe(isolate, s));

  // Internalized (interned) variant must also produce an equal string.
  Local<String> interned = String::NewFromUtf8Literal(
      isolate, "hello literal", NewStringType::kInternalized);
  LOG_EXPR(s->StrictEquals(interned));

  // Literal with embedded UTF-8 (non-ASCII) bytes.
  Local<String> utf8 = String::NewFromUtf8Literal(isolate, "caf\xc3\xa9");
  LOG_EXPR(utf8->Length());
  LOG_EXPR(describe(isolate, utf8));

  return ok(info);
}

static void proto_method_callback(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  info.GetReturnValue().Set(
      String::NewFromUtf8(isolate, "proto-method-called").ToLocalChecked());
}

static void native_data_getter(Local<Name> property,
                               const PropertyCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  // Returning a fixed value proves the native-data-property getter was wired
  // through Template::SetNativeDataProperty and invoked on property access.
  info.GetReturnValue().Set(
      String::NewFromUtf8(isolate, "native-getter-value").ToLocalChecked());
}

void test_v8_prototype_template(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<FunctionTemplate> ctor_t = FunctionTemplate::New(isolate);
  ctor_t->InstanceTemplate()->SetInternalFieldCount(1);

  // PrototypeTemplate()->Set: install a method on the prototype via a nested
  // FunctionTemplate.
  Local<ObjectTemplate> proto_t = ctor_t->PrototypeTemplate();
  proto_t->Set(String::NewFromUtf8Literal(isolate, "protoMethod"),
               FunctionTemplate::New(isolate, proto_method_callback));

  // SetNativeDataProperty: install a native getter with a data payload on the
  // prototype.
  proto_t->SetNativeDataProperty(
      String::NewFromUtf8Literal(isolate, "nativeProp"), native_data_getter,
      nullptr, String::NewFromUtf8(isolate, "payload").ToLocalChecked());

  Local<Function> ctor = ctor_t->GetFunction(context).ToLocalChecked();
  Local<Object> inst = ctor->NewInstance(context).ToLocalChecked();
  LOG_EXPR(inst->InternalFieldCount());

  // Read the prototype method and accessor back from C++ to prove the
  // template wiring resolved to real properties.
  Local<Value> method =
      inst->Get(context,
                String::NewFromUtf8(isolate, "protoMethod").ToLocalChecked())
          .ToLocalChecked();
  LOG_EXPR(method->IsFunction());

  Local<Value> native_prop =
      inst->Get(context,
                String::NewFromUtf8(isolate, "nativeProp").ToLocalChecked())
          .ToLocalChecked();
  LOG_EXPR(describe(isolate, native_prop));

  // Return the instance so the JS driver can call protoMethod() and read
  // nativeProp, asserting behavior matches Node.
  info.GetReturnValue().Set(inst);
}

void test_v8_arraybuffer(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, 16);
  LOG_EXPR(ab->IsObject());

  std::shared_ptr<BackingStore> store = ab->GetBackingStore();
  if (store->Data() == nullptr) {
    return fail(info, "BackingStore::Data() returned null for 16-byte buffer");
  }
  // Zero-initialized by default; write through the backing store and read
  // it back through a Uint8Array view.
  uint8_t *data = static_cast<uint8_t *>(store->Data());
  for (size_t i = 0; i < 16; i++) {
    LOG_EXPR((int)data[i]);
  }
  for (size_t i = 0; i < 16; i++) {
    data[i] = static_cast<uint8_t>(i + 1);
  }

  Local<Uint8Array> u8 = Uint8Array::New(ab, 4, 8);
  LOG_EXPR(u8->ByteOffset());
  LOG_EXPR(u8->ByteLength());
  LOG_EXPR(u8->IsUint8Array());
  Local<ArrayBuffer> underlying = u8->Buffer();
  LOG_EXPR(underlying->StrictEquals(ab));

  return ok(info);
}

void test_v8_typedarray(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, 32);
  Local<Uint8Array> u8 = Uint8Array::New(ab, 0, 32);
  LOG_EXPR(u8->ByteLength());
  LOG_EXPR(u8->ByteOffset());
  LOG_EXPR(u8->IsUint8Array());

  Local<Uint32Array> u32 = Uint32Array::New(ab, 0, 8);
  LOG_EXPR(u32->ByteLength());
  LOG_EXPR(u32->ByteOffset());
  LOG_EXPR(u32->IsUint8Array());

  // view at nonzero offset
  Local<Uint8Array> tail = Uint8Array::New(ab, 8, 24);
  LOG_EXPR(tail->ByteOffset());
  LOG_EXPR(tail->ByteLength());

  return ok(info);
}

// JS prints this text: Node drops a native write to a full non-blocking stdout.
static void return_description(const FunctionCallbackInfo<Value> &info,
                               const std::string &description) {
  info.GetReturnValue().Set(
      String::NewFromUtf8(info.GetIsolate(), description.c_str())
          .ToLocalChecked());
}

// Also writes 0xee to the last byte through Data(), which the JS caller reads.
template <typename BufferType>
static std::string describe_buffer_accessors(Local<BufferType> buffer) {
  size_t length = buffer->ByteLength();
  uint8_t *data = static_cast<uint8_t *>(buffer->Data());
  std::string description = "ByteLength() = " + std::to_string(length);
  description += "\nData() != nullptr = " + std::to_string(data != nullptr);
  for (size_t i = 0; data != nullptr && i < length && i < 4; i++) {
    description +=
        "\nData()[" + std::to_string(i) + "] = " + std::to_string(data[i]);
  }
  if (data != nullptr && length > 0) {
    data[length - 1] = 0xee;
  }
  return description;
}

void describe_array_buffer(const FunctionCallbackInfo<Value> &info) {
  Local<ArrayBuffer> buffer = info[0].As<ArrayBuffer>();
  std::string description = describe_buffer_accessors(buffer);
  description +=
      "\nData() == GetBackingStore()->Data() = " +
      std::to_string(buffer->Data() == buffer->GetBackingStore()->Data());
  return_description(info, description);
}

void describe_shared_array_buffer(const FunctionCallbackInfo<Value> &info) {
  return_description(
      info, describe_buffer_accessors(info[0].As<SharedArrayBuffer>()));
}

// Reads and writes a view like uWebSockets.js: Buffer()->Data() + ByteOffset().
void describe_array_buffer_view_bytes(const FunctionCallbackInfo<Value> &info) {
  Local<ArrayBufferView> view = info[0].As<ArrayBufferView>();
  Local<ArrayBuffer> buffer = view->Buffer();
  size_t length = view->ByteLength();
  size_t offset = view->ByteOffset();
  uint8_t *data = static_cast<uint8_t *>(buffer->Data());
  std::string description = "view ByteLength() = " + std::to_string(length);
  description += "\nview ends within Buffer()->ByteLength() = " +
                 std::to_string(offset + length <= buffer->ByteLength());
  for (size_t i = 0; data != nullptr && i < length && i < 4; i++) {
    description += "\n(Buffer()->Data() + ByteOffset())[" + std::to_string(i) +
                   "] = " + std::to_string(data[offset + i]);
  }
  if (data != nullptr && length > 0) {
    data[offset] = 0xdd;
  }
  return_description(info, description);
}

void detach_array_buffer(const FunctionCallbackInfo<Value> &info) {
  Local<ArrayBuffer> buffer = info[0].As<ArrayBuffer>();
  std::string description =
      "ByteLength() before Detach() = " + std::to_string(buffer->ByteLength());
  buffer->Detach();
  description +=
      "\nByteLength() after Detach() = " + std::to_string(buffer->ByteLength());
  description += "\nData() != nullptr after Detach() = " +
                 std::to_string(buffer->Data() != nullptr);
  return_description(info, description);
}

// uWebSockets.js detaches the buffer it lent to a JS handler that threw.
void read_store_after_detach(const FunctionCallbackInfo<Value> &info) {
  Local<ArrayBuffer> buffer = info[0].As<ArrayBuffer>();
  std::shared_ptr<BackingStore> store = buffer->GetBackingStore();
  const uint8_t *bytes = static_cast<const uint8_t *>(store->Data());
  size_t length = buffer->ByteLength();
  buffer->Detach();
  std::string description = "the store has the same memory after Detach() = " +
                            std::to_string(store->Data() == bytes) +
                            "\nbytes read through the store =";
  for (size_t i = 0; i < length; i++) {
    description += " " + std::to_string(bytes[i]);
  }
  return_description(info, description);
}

void detach_array_buffer_with_pending_exception(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  isolate->ThrowError(String::NewFromUtf8(isolate, "pending").ToLocalChecked());
  info[0].As<ArrayBuffer>()->Detach();
}

// The deleter only counts: an engine may call it on a GC thread or at exit.
struct WrappedMemory {
  uint8_t bytes[8];
  size_t wrapped_length;
  // Calls with `bytes` and `wrapped_length`, and calls with anything else.
  std::atomic<int> deleter_calls;
  std::atomic<int> unexpected_deleter_calls;
};
constexpr uint32_t wrapped_memory_slots = 80;
static WrappedMemory wrapped_memory[wrapped_memory_slots];

static WrappedMemory *wrapped_memory_at(uint32_t slot) {
  if (slot >= wrapped_memory_slots) {
    fprintf(stderr, "there is no wrapped_memory slot %u\n", slot);
    abort();
  }
  return &wrapped_memory[slot];
}

static void count_wrapped_memory_deleter(void *data, size_t length,
                                         void *deleter_data) {
  auto *memory = static_cast<WrappedMemory *>(deleter_data);
  if (data == memory->bytes && length == memory->wrapped_length) {
    memory->deleter_calls++;
  } else {
    memory->unexpected_deleter_calls++;
  }
}

static std::unique_ptr<BackingStore> wrap_memory(
    uint32_t slot, size_t length = sizeof(WrappedMemory::bytes),
    BackingStore::DeleterCallback deleter = count_wrapped_memory_deleter) {
  WrappedMemory *memory = wrapped_memory_at(slot);
  if (length > sizeof(memory->bytes)) {
    fprintf(stderr, "a wrapped_memory slot has no %zu bytes\n", length);
    abort();
  }
  memory->wrapped_length = length;
  return ArrayBuffer::NewBackingStore(memory->bytes, length, deleter, memory);
}

// One ArrayBuffer per slot. Returns the last: nothing refers to the others.
static Local<ArrayBuffer>
create_wrapped_buffers(Isolate *isolate, uint32_t first_slot, uint32_t count,
                       size_t length, BackingStore::DeleterCallback deleter) {
  Local<ArrayBuffer> buffer;
  for (uint32_t i = 0; i < count; i++) {
    buffer = ArrayBuffer::New(
        isolate, std::shared_ptr<BackingStore>(
                     wrap_memory(first_slot + i, length, deleter).release()));
  }
  return buffer;
}

// The addon destroys stores that no ArrayBuffer was made from.
void test_v8_new_backing_store(const FunctionCallbackInfo<Value> &info) {
  {
    WrappedMemory &unique_owned = wrapped_memory[0];
    std::unique_ptr<BackingStore> store = wrap_memory(0);
    LOG_EXPR(store->Data() == unique_owned.bytes);
    LOG_EXPR(unique_owned.deleter_calls);
    store.reset();
    LOG_EXPR(unique_owned.deleter_calls);
  }

  // uWebSockets.js moves the store into a std::shared_ptr.
  {
    WrappedMemory &shared_owned = wrapped_memory[1];
    std::shared_ptr<BackingStore> store(wrap_memory(1).release());
    std::shared_ptr<BackingStore> copy = store;
    LOG_EXPR(copy->Data() == shared_owned.bytes);
    store.reset();
    LOG_EXPR(shared_owned.deleter_calls);
    copy.reset();
    LOG_EXPR(shared_owned.deleter_calls);
  }

  // A store over zero bytes of the addon's memory hands that memory back too.
  {
    WrappedMemory &zero_length = wrapped_memory[2];
    std::unique_ptr<BackingStore> store = wrap_memory(2, 0);
    LOG_EXPR(store->Data() == zero_length.bytes);
    store.reset();
    LOG_EXPR(zero_length.deleter_calls);
  }

  // A store over no memory has nothing to hand back.
  {
    WrappedMemory &no_memory = wrapped_memory[3];
    std::unique_ptr<BackingStore> store = ArrayBuffer::NewBackingStore(
        nullptr, 0, count_wrapped_memory_deleter, &no_memory);
    LOG_EXPR(store->Data() == nullptr);
    store.reset();
    LOG_EXPR(no_memory.deleter_calls + no_memory.unexpected_deleter_calls);
  }

  int unexpected_deleter_calls = 0;
  for (WrappedMemory &memory : wrapped_memory) {
    unexpected_deleter_calls += memory.unexpected_deleter_calls;
  }
  LOG_EXPR(unexpected_deleter_calls);

  return ok(info);
}

void wrapped_buffers_create(const FunctionCallbackInfo<Value> &info) {
  uint32_t first_slot = static_cast<uint32_t>(info[0].As<Number>()->Value());
  uint32_t count = static_cast<uint32_t>(info[1].As<Number>()->Value());
  size_t length = info.Length() > 2
                      ? static_cast<size_t>(info[2].As<Number>()->Value())
                      : sizeof(WrappedMemory::bytes);
  info.GetReturnValue().Set(
      create_wrapped_buffers(info.GetIsolate(), first_slot, count, length,
                             count_wrapped_memory_deleter));
}

// wrapped_buffer_create_without_memory(slot): the slot only counts the calls.
void wrapped_buffer_create_without_memory(
    const FunctionCallbackInfo<Value> &info) {
  WrappedMemory *memory =
      wrapped_memory_at(static_cast<uint32_t>(info[0].As<Number>()->Value()));
  std::shared_ptr<BackingStore> store(
      ArrayBuffer::NewBackingStore(nullptr, 0, count_wrapped_memory_deleter,
                                   memory)
          .release());
  info.GetReturnValue().Set(ArrayBuffer::New(info.GetIsolate(), store));
}

static std::shared_ptr<BackingStore> kept_wrapped_store;

void wrapped_buffer_create_keeping_store(
    const FunctionCallbackInfo<Value> &info) {
  kept_wrapped_store =
      wrap_memory(static_cast<uint32_t>(info[0].As<Number>()->Value()));
  info.GetReturnValue().Set(
      ArrayBuffer::New(info.GetIsolate(), kept_wrapped_store));
}

void wrapped_kept_store_has_memory(const FunctionCallbackInfo<Value> &info) {
  WrappedMemory *memory =
      wrapped_memory_at(static_cast<uint32_t>(info[0].As<Number>()->Value()));
  info.GetReturnValue().Set(Boolean::New(
      info.GetIsolate(),
      kept_wrapped_store && kept_wrapped_store->Data() == memory->bytes));
}

void wrapped_kept_store_release(const FunctionCallbackInfo<Value> &info) {
  kept_wrapped_store.reset();
}

void wrapped_buffer_pair(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  std::shared_ptr<BackingStore> store =
      wrap_memory(static_cast<uint32_t>(info[0].As<Number>()->Value()));
  Local<Value> buffers[] = {ArrayBuffer::New(isolate, store),
                            ArrayBuffer::New(isolate, store)};
  info.GetReturnValue().Set(Array::New(isolate, buffers, 2));
}

void wrapped_buffer_store_has_memory(const FunctionCallbackInfo<Value> &info) {
  WrappedMemory *memory =
      wrapped_memory_at(static_cast<uint32_t>(info[1].As<Number>()->Value()));
  std::shared_ptr<BackingStore> store =
      info[0].As<ArrayBuffer>()->GetBackingStore();
  info.GetReturnValue().Set(
      Boolean::New(info.GetIsolate(), store->Data() == memory->bytes));
}

void wrapped_memory_get(const FunctionCallbackInfo<Value> &info) {
  WrappedMemory *memory =
      wrapped_memory_at(static_cast<uint32_t>(info[0].As<Number>()->Value()));
  uint32_t index = static_cast<uint32_t>(info[1].As<Number>()->Value());
  if (index >= sizeof(memory->bytes)) {
    fprintf(stderr, "a wrapped_memory slot has no byte %u\n", index);
    abort();
  }
  info.GetReturnValue().Set(
      Number::New(info.GetIsolate(), memory->bytes[index]));
}

void wrapped_memory_set(const FunctionCallbackInfo<Value> &info) {
  WrappedMemory *memory =
      wrapped_memory_at(static_cast<uint32_t>(info[0].As<Number>()->Value()));
  uint32_t index = static_cast<uint32_t>(info[1].As<Number>()->Value());
  if (index >= sizeof(memory->bytes)) {
    fprintf(stderr, "a wrapped_memory slot has no byte %u\n", index);
    abort();
  }
  memory->bytes[index] = static_cast<uint8_t>(info[2].As<Number>()->Value());
}

void wrapped_memory_deleter_calls(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Value> calls[wrapped_memory_slots];
  for (uint32_t slot = 0; slot < wrapped_memory_slots; slot++) {
    calls[slot] =
        Number::New(isolate, wrapped_memory[slot].deleter_calls.load());
  }
  info.GetReturnValue().Set(Array::New(isolate, calls, wrapped_memory_slots));
}

void wrapped_memory_unexpected_deleter_calls(
    const FunctionCallbackInfo<Value> &info) {
  int calls = 0;
  for (WrappedMemory &memory : wrapped_memory) {
    calls += memory.unexpected_deleter_calls;
  }
  info.GetReturnValue().Set(Number::New(info.GetIsolate(), calls));
}

// A full collection that is over when this returns, in V8 and in JSC.
void wrapped_memory_collect_garbage(const FunctionCallbackInfo<Value> &info) {
  info.GetIsolate()->LowMemoryNotification();
}

void wrapped_store_destroy_with_null_deleter(
    const FunctionCallbackInfo<Value> &info) {
  uint32_t slot = static_cast<uint32_t>(info[0].As<Number>()->Value());
  std::unique_ptr<BackingStore> store =
      wrap_memory(slot, sizeof(WrappedMemory::bytes), nullptr);
  store.reset();
}

void wrapped_buffers_create_with_null_deleter(
    const FunctionCallbackInfo<Value> &info) {
  uint32_t first_slot = static_cast<uint32_t>(info[0].As<Number>()->Value());
  uint32_t count = static_cast<uint32_t>(info[1].As<Number>()->Value());
  info.GetReturnValue().Set(
      create_wrapped_buffers(info.GetIsolate(), first_slot, count,
                             sizeof(WrappedMemory::bytes), nullptr));
}

void test_v8_function_call(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (info.Length() < 1 || !info[0]->IsFunction()) {
    return fail(info, "expected a function argument");
  }
  Local<Function> f = info[0].As<Function>();

  Local<Value> argv[3] = {
      Number::New(isolate, 7.0),
      String::NewFromUtf8(isolate, "hello").ToLocalChecked(),
      Boolean::New(isolate, true),
  };
  MaybeLocal<Value> result =
      f->Call(context, Undefined(isolate), 3, argv);
  LOG_EXPR(result.IsEmpty());
  if (!result.IsEmpty()) {
    LOG_EXPR(describe(isolate, result.ToLocalChecked()));
  }

  Local<Object> recv = Object::New(isolate);
  (void)recv->Set(context,
                  String::NewFromUtf8(isolate, "tag").ToLocalChecked(),
                  Number::New(isolate, 99.0));
  MaybeLocal<Value> result2 = f->Call(context, recv, 0, nullptr);
  LOG_EXPR(result2.IsEmpty());
  if (!result2.IsEmpty()) {
    LOG_EXPR(describe(isolate, result2.ToLocalChecked()));
  }

  return ok(info);
}

static void construct_callback(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> self = info.This();
  (void)self->Set(context,
                  String::NewFromUtf8(isolate, "constructed").ToLocalChecked(),
                  Boolean::New(isolate, true));
  if (info.Length() > 0) {
    (void)self->Set(context,
                    String::NewFromUtf8(isolate, "arg0").ToLocalChecked(),
                    info[0]);
  }
}

void test_v8_function_new_instance(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<FunctionTemplate> tmp =
      FunctionTemplate::New(isolate, construct_callback);
  tmp->InstanceTemplate()->SetInternalFieldCount(1);
  Local<Function> ctor = tmp->GetFunction(context).ToLocalChecked();

  Local<Value> argv[1] = {Number::New(isolate, 123.0)};
  MaybeLocal<Object> maybe_inst = ctor->NewInstance(context, 1, argv);
  LOG_EXPR(maybe_inst.IsEmpty());
  Local<Object> inst = maybe_inst.ToLocalChecked();
  LOG_EXPR(inst->IsObject());
  LOG_EXPR(inst->InternalFieldCount());

  Local<Value> constructed =
      inst->Get(context,
                String::NewFromUtf8(isolate, "constructed").ToLocalChecked())
          .ToLocalChecked();
  LOG_EXPR(describe(isolate, constructed));
  Local<Value> arg0 =
      inst->Get(context,
                String::NewFromUtf8(isolate, "arg0").ToLocalChecked())
          .ToLocalChecked();
  LOG_EXPR(describe(isolate, arg0));

  // zero-arg overload
  MaybeLocal<Object> maybe_inst2 = ctor->NewInstance(context);
  LOG_EXPR(maybe_inst2.IsEmpty());

  return ok(info);
}

void test_v8_getfunction_memoized(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<FunctionTemplate> tmp =
      FunctionTemplate::New(isolate, construct_callback);
  tmp->InstanceTemplate()->SetInternalFieldCount(1);
  tmp->PrototypeTemplate()->Set(
      String::NewFromUtf8(isolate, "tag").ToLocalChecked(),
      Number::New(isolate, 7.0));

  Local<Function> ctor1 = tmp->GetFunction(context).ToLocalChecked();
  Local<Function> ctor2 = tmp->GetFunction(context).ToLocalChecked();

  // V8 memoizes GetFunction per context, so repeat calls return the same
  // Function with the same .prototype.
  LOG_EXPR(ctor1->StrictEquals(ctor2));

  Local<Value> proto1 =
      ctor1
          ->Get(context,
                String::NewFromUtf8(isolate, "prototype").ToLocalChecked())
          .ToLocalChecked();
  Local<Value> proto2 =
      ctor2
          ->Get(context,
                String::NewFromUtf8(isolate, "prototype").ToLocalChecked())
          .ToLocalChecked();
  LOG_EXPR(proto1->StrictEquals(proto2));

  return ok(info);
}

void test_v8_map(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (info.Length() < 1 || !info[0]->IsMap()) {
    return fail(info, "expected a Map argument");
  }
  Local<Map> map = info[0].As<Map>();

  Local<String> key_a = String::NewFromUtf8(isolate, "a").ToLocalChecked();
  Local<String> key_b = String::NewFromUtf8(isolate, "b").ToLocalChecked();

  MaybeLocal<Map> set1 = map->Set(context, key_a, Number::New(isolate, 1.0));
  LOG_EXPR(set1.IsEmpty());
  MaybeLocal<Map> set2 = map->Set(context, key_b, Number::New(isolate, 2.0));
  LOG_EXPR(set2.IsEmpty());
  // Set must return the same Map (for chaining).
  if (!set2.IsEmpty() &&
      !set2.ToLocalChecked().As<Value>()->StrictEquals(info[0])) {
    return fail(info, "Map::Set did not return the receiver map");
  }

  Maybe<bool> del_a = map->Delete(context, key_a);
  LOG_EXPR(del_a.IsJust());
  LOG_EXPR(del_a.FromJust());

  Maybe<bool> del_missing = map->Delete(
      context, String::NewFromUtf8(isolate, "missing").ToLocalChecked());
  LOG_EXPR(del_missing.IsJust());
  LOG_EXPR(del_missing.FromJust());

  info.GetReturnValue().Set(map);
}

void test_v8_exception(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  Local<String> msg =
      String::NewFromUtf8(isolate, "boom from native").ToLocalChecked();

  Local<Value> err = Exception::Error(msg);
  LOG_EXPR(err->IsObject());
  LOG_EXPR(
      describe(isolate,
               err.As<Object>()
                   ->Get(isolate->GetCurrentContext(),
                         String::NewFromUtf8(isolate, "message").ToLocalChecked())
                   .ToLocalChecked()));

  Local<Value> type_err = Exception::TypeError(
      String::NewFromUtf8(isolate, "wrong type").ToLocalChecked());
  LOG_EXPR(type_err->IsObject());

  // Throw the Error so the JS driver can observe it.
  isolate->ThrowException(err);
}

void test_v8_exception_empty_message(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<String> empty = String::NewFromUtf8(isolate, "").ToLocalChecked();

  Local<Value> errors[] = {Exception::Error(empty),
                           Exception::TypeError(empty)};
  info.GetReturnValue().Set(Array::New(isolate, errors, 2));
}

void test_v8_throw_error_empty_message(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  isolate->ThrowError(String::NewFromUtf8(isolate, "").ToLocalChecked());
}

// These return a Local, not a MaybeLocal, so an addon does not check them.
void test_v8_new_values_with_pending_exception(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  isolate->ThrowError(String::NewFromUtf8(isolate, "pending").ToLocalChecked());

  LOG_EXPR(Array::New(isolate, 3)->Length());
  Local<Value> elements[] = {Number::New(isolate, 1), Number::New(isolate, 2)};
  LOG_EXPR(Array::New(isolate, elements, 2)->Length());
  Local<ArrayBuffer> buffer = ArrayBuffer::New(isolate, 16);
  LOG_EXPR(Uint8Array::New(buffer, 0, 8)->IsUint8Array());
  LOG_EXPR(Uint32Array::New(buffer, 0, 2)->IsObject());
  LOG_EXPR(BigInt::New(isolate, 5)->IsBigInt());
}

void test_v8_aligned_pointer_in_internal_field(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<ObjectTemplate> tmp = ObjectTemplate::New(isolate);
  tmp->SetInternalFieldCount(2);
  Local<Object> obj = tmp->NewInstance(context).ToLocalChecked();
  LOG_EXPR(obj->InternalFieldCount());

  static int target_a = 111;
  static int target_b = 222;

  obj->SetAlignedPointerInInternalField(0, &target_a,
                                        kEmbedderDataTypeTagDefault);
  obj->SetAlignedPointerInInternalField(1, &target_b,
                                        kEmbedderDataTypeTagDefault);

  void *got_a =
      obj->GetAlignedPointerFromInternalField(0, kEmbedderDataTypeTagDefault);
  void *got_b =
      obj->GetAlignedPointerFromInternalField(1, kEmbedderDataTypeTagDefault);

  if (got_a != &target_a) {
    return fail(info, "aligned pointer slot 0 round-trip failed");
  }
  if (got_b != &target_b) {
    return fail(info, "aligned pointer slot 1 round-trip failed");
  }
  LOG_EXPR(*static_cast<int *>(got_a));
  LOG_EXPR(*static_cast<int *>(got_b));

  // nullptr must round-trip too.
  obj->SetAlignedPointerInInternalField(0, nullptr,
                                        kEmbedderDataTypeTagDefault);
  if (obj->GetAlignedPointerFromInternalField(0, kEmbedderDataTypeTagDefault) !=
      nullptr) {
    return fail(info, "aligned pointer slot 0 should be null after reset");
  }

  return ok(info);
}

void test_v8_cpu_profiler(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  CpuProfiler *profiler = CpuProfiler::New(isolate);
  if (profiler == nullptr) {
    return fail(info, "CpuProfiler::New returned null");
  }
  profiler->SetSamplingInterval(100);

  Local<String> title =
      String::NewFromUtf8(isolate, "bun-v8-test").ToLocalChecked();
  CpuProfilingResult start_result = profiler->Start(
      title, kLeafNodeLineNumbers, true, CpuProfilingOptions::kNoSampleLimit);
  LOG_EXPR((int)start_result.status);

  // Do a little work so at least the root node exists; do NOT assert on sample
  // counts because those are timing-dependent and differ across engines.
  volatile double sink = 0;
  for (int i = 0; i < 100000; i++) sink += i * 0.5;
  (void)sink;

  CpuProfile *profile = profiler->Stop(start_result.id);
  if (profile == nullptr) {
    return fail(info, "CpuProfiler::Stop returned null");
  }
  const CpuProfileNode *root = profile->GetTopDownRoot();
  if (root == nullptr) {
    return fail(info, "CpuProfile::GetTopDownRoot returned null");
  }
  LOG_EXPR(root->GetChildrenCount() >= 0);
  LOG_EXPR(profile->GetSamplesCount() >= 0);
  LOG_EXPR(profile->GetStartTime() <= profile->GetEndTime());

  profile->Delete();
  profiler->Dispose();

  return ok(info);
}

// @datadog/pprof's restart path (used by dd-trace on every upload cycle) starts
// the next profile *before* stopping the current one, ignores the status, and
// then calls Stop() with whatever id Start() handed back. Overlapping sessions
// must therefore be accepted and each Stop() must return its own profile.
void test_v8_cpu_profiler_overlapping_sessions(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  CpuProfiler *profiler = CpuProfiler::New(isolate);
  if (profiler == nullptr) {
    return fail(info, "CpuProfiler::New returned null");
  }
  profiler->SetSamplingInterval(100);

  auto busy = [] {
    volatile double sink = 0;
    for (int i = 0; i < 100000; i++) sink += i * 0.5;
    (void)sink;
  };

  Local<String> title_a =
      String::NewFromUtf8(isolate, "bun-v8-test-a").ToLocalChecked();
  Local<String> title_b =
      String::NewFromUtf8(isolate, "bun-v8-test-b").ToLocalChecked();

  CpuProfilingResult a = profiler->Start(
      title_a, kLeafNodeLineNumbers, true, CpuProfilingOptions::kNoSampleLimit);
  LOG_EXPR((int)a.status);
  busy();

  // Second session while the first is still running.
  CpuProfilingResult b = profiler->Start(
      title_b, kLeafNodeLineNumbers, true, CpuProfilingOptions::kNoSampleLimit);
  LOG_EXPR((int)b.status);
  LOG_EXPR(a.id != b.id);

  CpuProfile *profile_a = profiler->Stop(a.id);
  if (profile_a == nullptr) {
    return fail(info, "Stop(a) returned null while b was running");
  }
  if (profile_a->GetTopDownRoot() == nullptr) {
    return fail(info, "profile a has no root");
  }
  busy();

  CpuProfile *profile_b = profiler->Stop(b.id);
  if (profile_b == nullptr) {
    return fail(info, "Stop(b) returned null after a was stopped");
  }
  if (profile_b->GetTopDownRoot() == nullptr) {
    return fail(info, "profile b has no root");
  }

  // b started after a, and neither profile runs backwards in time.
  LOG_EXPR(profile_b->GetStartTime() >= profile_a->GetStartTime());
  LOG_EXPR(profile_a->GetStartTime() <= profile_a->GetEndTime());
  LOG_EXPR(profile_b->GetStartTime() <= profile_b->GetEndTime());
  // No sample recorded for b may predate b's start.
  bool b_samples_in_range = true;
  for (int i = 0; i < profile_b->GetSamplesCount(); i++) {
    if (profile_b->GetSampleTimestamp(i) < profile_b->GetStartTime()) {
      b_samples_in_range = false;
      break;
    }
  }
  LOG_EXPR(b_samples_in_range);

  // Stopping an id that was already stopped is not a session.
  LOG_EXPR(profiler->Stop(a.id) == nullptr);

  profile_a->Delete();
  profile_b->Delete();
  profiler->Dispose();

  return ok(info);
}

// google's pprof (and older addons such as v8-profiler-next) drive the
// profiler through the title-keyed StartProfiling()/StopProfiling() overloads
// and read the title back with CpuProfile::GetTitle(). Bun used to export only
// the id-keyed Start()/Stop(), so loading pprof failed on these symbols
// (oven-sh/bun#19678).
void test_v8_cpu_profiler_title_api(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  CpuProfiler *profiler = CpuProfiler::New(isolate);
  if (profiler == nullptr) {
    return fail(info, "CpuProfiler::New returned null");
  }
  profiler->SetSamplingInterval(100);

  auto busy = [] {
    volatile double sink = 0;
    for (int i = 0; i < 100000; i++) sink += i * 0.5;
    (void)sink;
  };

  Local<String> title_a =
      String::NewFromUtf8(isolate, "pprof-a").ToLocalChecked();
  Local<String> title_b =
      String::NewFromUtf8(isolate, "pprof-b").ToLocalChecked();
  Local<String> empty_title = String::NewFromUtf8(isolate, "").ToLocalChecked();
  Local<String> unknown_title =
      String::NewFromUtf8(isolate, "never-started").ToLocalChecked();

  // pprof uses the two-argument overload, or the mode overload when line
  // numbers were requested.
  LOG_EXPR((int)profiler->StartProfiling(title_a, false));
  LOG_EXPR((int)profiler->StartProfiling(title_b, kCallerLineNumbers, false));
  // A title that is already running is not started a second time.
  LOG_EXPR((int)profiler->StartProfiling(title_a, false));
  busy();

  LOG_EXPR(profiler->StopProfiling(unknown_title) == nullptr);

  CpuProfile *profile_a = profiler->StopProfiling(title_a);
  if (profile_a == nullptr) {
    return fail(info, "StopProfiling(a) returned null");
  }
  LOG_EXPR(describe(isolate, profile_a->GetTitle()));
  LOG_EXPR(profile_a->GetTopDownRoot() != nullptr);
  LOG_EXPR(profile_a->GetStartTime() <= profile_a->GetEndTime());
  // a is no longer running, so its title can neither be stopped again nor
  // collide with a new session.
  LOG_EXPR(profiler->StopProfiling(title_a) == nullptr);
  LOG_EXPR((int)profiler->StartProfiling(title_a, false));
  busy();

  // An empty title stops the most recently started session: the restarted a,
  // then b.
  CpuProfile *profile_a2 = profiler->StopProfiling(empty_title);
  if (profile_a2 == nullptr) {
    return fail(info, "StopProfiling(\"\") returned null with two sessions");
  }
  LOG_EXPR(describe(isolate, profile_a2->GetTitle()));
  CpuProfile *profile_b = profiler->StopProfiling(empty_title);
  if (profile_b == nullptr) {
    return fail(info, "StopProfiling(\"\") returned null with one session");
  }
  LOG_EXPR(describe(isolate, profile_b->GetTitle()));
  LOG_EXPR(profiler->StopProfiling(empty_title) == nullptr);

  // Both APIs share one set of sessions: a session started by id carries its
  // title, blocks a title-keyed start, and can be stopped by title.
  CpuProfilingResult by_id = profiler->Start(
      title_b, kLeafNodeLineNumbers, true, CpuProfilingOptions::kNoSampleLimit);
  LOG_EXPR((int)by_id.status);
  LOG_EXPR((int)profiler->StartProfiling(title_b, false));
  busy();
  CpuProfile *profile_by_id = profiler->StopProfiling(title_b);
  if (profile_by_id == nullptr) {
    return fail(info, "StopProfiling(b) returned null for a session started "
                      "with Start()");
  }
  LOG_EXPR(describe(isolate, profile_by_id->GetTitle()));
  LOG_EXPR(profiler->Stop(by_id.id) == nullptr);

  profile_a->Delete();
  profile_a2->Delete();
  profile_b->Delete();
  profile_by_id->Delete();
  profiler->Dispose();

  return ok(info);
}

// Leaves the exception of a conversion that throws pending for the JS caller.
void perform_uint32_value(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Maybe<uint32_t> maybe = info[0]->Uint32Value(context);
  LOG_EXPR(maybe.IsNothing());
  if (maybe.IsNothing()) {
    return;
  }
  LOG_EXPR(maybe.FromJust());
}

void perform_int32_value(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Maybe<int32_t> maybe = info[0]->Int32Value(context);
  LOG_EXPR(maybe.IsNothing());
  if (maybe.IsNothing()) {
    return;
  }
  LOG_EXPR(maybe.FromJust());
}

// V8 converts a number without running JS, also while an exception is pending.
void perform_uint32_value_with_pending_exception(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  isolate->ThrowError(String::NewFromUtf8(isolate, "pending").ToLocalChecked());
  perform_uint32_value(info);
}

// Prints every digit of the double. A conversion's exception stays pending.
void perform_number_value(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Maybe<double> maybe = info[0]->NumberValue(context);
  LOG_EXPR(maybe.IsNothing());
  if (maybe.IsNothing()) {
    return;
  }
  double number = maybe.FromJust();
  char buf[32];
  if (number != number) {
    // the sign bit of a NaN is not part of the conversion's result
    snprintf(buf, sizeof(buf), "NaN");
  } else {
    snprintf(buf, sizeof(buf), "%.17g", number);
  }
  std::cout << "maybe.FromJust() = " << buf << std::endl;
}

void perform_boolean_value(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();

  LOG_EXPR(info[0]->BooleanValue(isolate));
}

// Room for one T between guard bytes. T's own bytes start as guard bytes too.
template <typename T> class GuardedStorage {
public:
  GuardedStorage() { memset(bytes_, kGuardByte, sizeof(bytes_)); }

  void *object() { return bytes_ + kGuardSize; }

  bool guards_intact() const {
    for (size_t i = 0; i < kGuardSize; i++) {
      if (bytes_[i] != kGuardByte ||
          bytes_[kGuardSize + sizeof(T) + i] != kGuardByte) {
        return false;
      }
    }
    return true;
  }

private:
  static constexpr size_t kGuardSize = 16;
  static constexpr unsigned char kGuardByte = 0xa5;
  static_assert(kGuardSize % alignof(T) == 0);

  alignas(T) unsigned char bytes_[kGuardSize + sizeof(T) + kGuardSize];
};

// As in V8's CFunction::Make(), an addon imports the base object constructor.
class DerivedFunctionInfo : public CFunctionInfo {
public:
  using CFunctionInfo::CFunctionInfo;
};

static int32_t fast_add(Local<Object> receiver, int32_t a, int32_t b) {
  return a + b;
}

static void slow_add(const FunctionCallbackInfo<Value> &info) {
  double a = info[0].As<Number>()->Value();
  double b = info[1].As<Number>()->Value();
  std::cout << "slow callback called with " << a << " and " << b << std::endl;
  info.GetReturnValue().Set(Number::New(info.GetIsolate(), a + b));
}

void create_function_with_c_function(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  // static: V8 keeps these pointers for as long as the function exists
  static const CTypeInfo arg_info[] = {
      {CTypeInfo::Type::kV8Value, CTypeInfo::Flags::kNone},
      {CTypeInfo::Type::kInt32, CTypeInfo::Flags::kNone},
      {CTypeInfo::Type::kInt32, CTypeInfo::Flags::kNone},
  };
  static GuardedStorage<DerivedFunctionInfo> type_info_storage;
  static GuardedStorage<CFunction> c_function_storage;

  // every field gets a value that is neither zero nor the guard byte
  const CTypeInfo return_info = {CTypeInfo::Type::kInt32,
                                 CTypeInfo::Flags::kClampBit};
  const CFunctionInfo *type_info = new (type_info_storage.object())
      DerivedFunctionInfo(return_info, 3, arg_info,
                          CFunctionInfo::Int64Representation::kBigInt);
  LOG_EXPR(type_info->return_info_.type_ == CTypeInfo::Type::kInt32);
  LOG_EXPR(type_info->return_info_.flags_ == CTypeInfo::Flags::kClampBit);
  LOG_EXPR(type_info->repr_ == CFunctionInfo::Int64Representation::kBigInt);
  LOG_EXPR(type_info->arg_count_);
  LOG_EXPR(type_info->arg_info_ == arg_info);
  LOG_EXPR(type_info_storage.guards_intact());

  const void *address = reinterpret_cast<const void *>(fast_add);
  const CFunction *c_function =
      new (c_function_storage.object()) CFunction(address, type_info);
  LOG_EXPR(c_function->address_ == address);
  LOG_EXPR(c_function->type_info_ == type_info);
  LOG_EXPR(c_function_storage.guards_intact());

  // V8 refuses a CFunction for a function that can be a constructor
  Local<FunctionTemplate> tmp = FunctionTemplate::New(
      isolate, slow_add, Local<Value>(), Local<Signature>(), 0,
      ConstructorBehavior::kThrow, SideEffectType::kHasSideEffect, c_function);
  info.GetReturnValue().Set(tmp->GetFunction(context).ToLocalChecked());
}

// module.js passes PropertyFilter and KeyConversionMode values as numbers.
static_assert(ALL_PROPERTIES == 0 && ONLY_WRITABLE == 1 &&
              ONLY_ENUMERABLE == 2 && ONLY_CONFIGURABLE == 4 &&
              SKIP_STRINGS == 8 && SKIP_SYMBOLS == 16);
static_assert(static_cast<int>(KeyConversionMode::kConvertToString) == 0 &&
              static_cast<int>(KeyConversionMode::kKeepNumbers) == 1 &&
              static_cast<int>(KeyConversionMode::kNoNumbers) == 2);

void perform_get_own_property_names(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> object = info[0].As<Object>();

  MaybeLocal<Array> maybe_names;
  if (info.Length() < 2) {
    maybe_names = object->GetOwnPropertyNames(context);
  } else {
    PropertyFilter filter =
        static_cast<PropertyFilter>(info[1].As<Int32>()->Value());
    if (info.Length() < 3) {
      maybe_names = object->GetOwnPropertyNames(context, filter);
    } else {
      KeyConversionMode conversion =
          static_cast<KeyConversionMode>(info[2].As<Int32>()->Value());
      maybe_names = object->GetOwnPropertyNames(context, filter, conversion);
    }
  }

  Local<Array> names;
  if (!maybe_names.ToLocal(&names)) {
    std::cout << "GetOwnPropertyNames returned an empty MaybeLocal"
              << std::endl;
    return;
  }
  info.GetReturnValue().Set(names);
}

#if defined(_MSC_VER)
#define V8TESTS_NOINLINE __declspec(noinline)
#else
#define V8TESTS_NOINLINE __attribute__((noinline))
#endif

struct BackingStoreTally {
  int stores;
  size_t bytes;
};

static void tally_deleted_backing_store(void *data, size_t length,
                                        void *deleter_data) {
  BackingStoreTally *deleted = static_cast<BackingStoreTally *>(deleter_data);
  deleted->stores++;
  deleted->bytes += length;
}

// ASAN keeps an id of the allocating stack before the block: one per depth.
V8TESTS_NOINLINE static std::unique_ptr<BackingStore>
new_backing_store_at_depth(int depth, void *data, size_t length,
                           BackingStoreTally *deleted, int *frames) {
  if (depth == 0) {
    return ArrayBuffer::NewBackingStore(data, length,
                                        tally_deleted_backing_store, deleted);
  }
  std::unique_ptr<BackingStore> store =
      new_backing_store_at_depth(depth - 1, data, length, deleted, frames);
  // Written after the call, so that the call is no tail call.
  ++*frames;
  return store;
}

// Dies if the runtime's allocator does not pair with this addon's `delete`.
void test_v8_backing_store_deleted_by_addon(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  static char memory[24];
  static BackingStoreTally made;
  static BackingStoreTally deleted;
  int frames = 0;

  for (int round = 0; round < 4; round++) {
    for (int depth = 0; depth < static_cast<int>(sizeof(memory)); depth++) {
      HandleScope scope(isolate);
      // the deleters add up the lengths, which differ from depth to depth
      size_t length = depth + 1;
      auto new_store = [&]() {
        made.stores++;
        made.bytes += length;
        return new_backing_store_at_depth(depth, memory, length, &deleted,
                                          &frames);
      };

      std::unique_ptr<BackingStore> unique = new_store();
      if (unique->Data() != memory) {
        return fail(info, "BackingStore::Data() is not the wrapped memory");
      }
      unique.reset();

      // uWebSockets.js: the `delete` is in a shared_ptr's control block.
      std::shared_ptr<BackingStore> shared(new_store().release());
      std::shared_ptr<BackingStore> second_owner = shared;
      shared.reset();
      second_owner.reset();

      // The runtime drops the last reference.
      std::shared_ptr<BackingStore> for_buffer(new_store().release());
      Local<ArrayBuffer> buffer = ArrayBuffer::New(isolate, for_buffer);
      for_buffer.reset();
      buffer->Detach();

      // The ArrayBuffer is the only owner of a store that came in a unique_ptr.
      Local<ArrayBuffer> only_owner = ArrayBuffer::New(isolate, new_store());
      only_owner->Detach();

      // The addon drops the last reference, after an ArrayBuffer used it.
      std::shared_ptr<BackingStore> kept(new_store().release());
      ArrayBuffer::New(isolate, kept)->Detach();
      if (kept->Data() != memory) {
        return fail(info, "BackingStore::Data() is not the wrapped memory "
                          "after its ArrayBuffer was detached");
      }
      kept.reset();
    }
  }

  LOG_EXPR(made.stores);
  LOG_EXPR(deleted.stores);
  LOG_EXPR(made.bytes);
  LOG_EXPR(deleted.bytes);
  LOG_EXPR(frames);
  return ok(info);
}

void perform_object_clone(const FunctionCallbackInfo<Value> &info) {
  info.GetReturnValue().Set(info[0].As<Object>()->Clone());
}

// What the aligned pointers in the Object::Clone tests point at.
static int clone_target_a;
static int clone_target_b;
static int clone_target_c;

// As in uWebSockets.js, field 0 holds an aligned pointer and field 1 a value.
static std::string describe_internal_fields(Isolate *isolate,
                                            Local<Object> object) {
  void *pointer = object->GetAlignedPointerFromInternalField(
      0, kEmbedderDataTypeTagDefault);
  const char *target = pointer == &clone_target_a   ? "&a"
                       : pointer == &clone_target_b ? "&b"
                       : pointer == &clone_target_c ? "&c"
                       : pointer == nullptr         ? "nullptr"
                                                    : "an unknown address";
  return std::to_string(object->InternalFieldCount()) +
         " internal fields: " + target + ", " +
         describe(isolate, object->GetInternalField(1).As<Value>());
}

// Like uWebSockets.js's response methods, reads the fields of its receiver.
static void
describe_internal_fields_callback(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  info.GetReturnValue().Set(
      String::NewFromUtf8(
          isolate, describe_internal_fields(isolate, info.This()).c_str())
          .ToLocalChecked());
}

// clone_template_instance(use_function_template): returns [original, copy].
void clone_template_instance(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<String> method_name =
      String::NewFromUtf8Literal(isolate, "describeInternalFields");
  Local<FunctionTemplate> method =
      FunctionTemplate::New(isolate, describe_internal_fields_callback);

  Local<ObjectTemplate> object_template;
  Local<Function> constructor;
  if (info[0]->IsTrue()) {
    Local<FunctionTemplate> function_template = FunctionTemplate::New(isolate);
    function_template->InstanceTemplate()->SetInternalFieldCount(2);
    function_template->PrototypeTemplate()->Set(method_name, method);
    constructor = function_template->GetFunction(context).ToLocalChecked();
  } else {
    object_template = ObjectTemplate::New(isolate);
    object_template->SetInternalFieldCount(2);
    object_template->Set(method_name, method);
  }
  auto new_instance = [&]() {
    return constructor.IsEmpty()
               ? object_template->NewInstance(context).ToLocalChecked()
               : constructor->NewInstance(context).ToLocalChecked();
  };
  auto new_string = [&](const std::string &text) {
    return String::NewFromUtf8(isolate, text.c_str()).ToLocalChecked();
  };
  auto log_fields = [&](const char *label, Local<Object> object) {
    std::cout << label << ": " << describe_internal_fields(isolate, object)
              << std::endl;
  };

  Local<Object> original = new_instance();
  original->SetAlignedPointerInInternalField(0, &clone_target_a,
                                             kEmbedderDataTypeTagDefault);
  original->SetInternalField(1, new_string("set on the original"));
  original->Set(context, new_string("own"), new_string("set before Clone()"))
      .Check();
  log_fields("original", original);

  Local<Object> copy = original->Clone();
  log_fields("copy", copy);

  copy->SetAlignedPointerInInternalField(0, &clone_target_b,
                                         kEmbedderDataTypeTagDefault);
  copy->SetInternalField(1, new_string("set on the copy"));
  log_fields("original after writing the copy's fields", original);
  log_fields("copy after writing its fields", copy);

  original->SetAlignedPointerInInternalField(0, &clone_target_c,
                                             kEmbedderDataTypeTagDefault);
  original->SetInternalField(1, new_string("set on the original again"));
  log_fields("copy after writing the original's fields", copy);

  constexpr int count = 100;

  // uWebSockets.js per request: clone, store state in the copy, let it go.
  for (int i = 0; i < count; i++) {
    HandleScope scope(isolate);
    Local<Object> request = original->Clone();
    request->SetAlignedPointerInInternalField(0, &clone_target_b,
                                              kEmbedderDataTypeTagDefault);
    request->SetInternalField(1, new_string("request " + std::to_string(i)));
  }
  isolate->LowMemoryNotification();
  log_fields("original after collecting copies of it", original);

  // Each copy keeps what it holds once its original and that scope are gone.
  Local<Object> survivors[count];
  for (int i = 0; i < count; i++) {
    EscapableHandleScope scope(isolate);
    Local<Object> temporary = new_instance();
    temporary->SetAlignedPointerInInternalField(0, &clone_target_a,
                                                kEmbedderDataTypeTagDefault);
    temporary->SetInternalField(1, new_string("survivor " + std::to_string(i)));
    survivors[i] = scope.Escape(temporary->Clone());
  }
  isolate->LowMemoryNotification();
  int intact = 0;
  for (int i = 0; i < count; i++) {
    HandleScope scope(isolate);
    intact += describe_internal_fields(isolate, survivors[i]) ==
              "2 internal fields: &a, \"survivor " + std::to_string(i) + "\"";
  }
  std::cout << "copies intact after collecting their originals: " << intact
            << " of " << count << std::endl;

  Local<Value> objects[] = {original, copy};
  info.GetReturnValue().Set(Array::New(isolate, objects, 2));
}

// uWebSockets.js clones for the next request after a handler threw.
void perform_object_clone_with_pending_exception(
    const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<Object> original = info[0].As<Object>();
  isolate->ThrowError(String::NewFromUtf8(isolate, "pending").ToLocalChecked());
  Local<Object> copy = original->Clone();
  std::cout << "copy made while an exception is pending: "
            << copy->InternalFieldCount() << " internal fields";
  // Only an object with internal fields has an aligned pointer to read.
  if (original->InternalFieldCount() > 0) {
    std::cout << ", same aligned pointer: "
              << (copy->GetAlignedPointerFromInternalField(
                      0, kEmbedderDataTypeTagDefault) ==
                  original->GetAlignedPointerFromInternalField(
                      0, kEmbedderDataTypeTagDefault));
  }
  std::cout << std::endl;
}

void initialize(Local<Object> exports, Local<Value> module,
                Local<Context> context) {
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
  NODE_SET_METHOD(exports, "test_v8_string_latin1", test_v8_string_latin1);
  NODE_SET_METHOD(exports, "test_v8_string_write_utf8",
                  test_v8_string_write_utf8);
  NODE_SET_METHOD(exports, "test_v8_string_write_utf8_surrogate",
                  test_v8_string_write_utf8_surrogate);
  NODE_SET_METHOD(exports, "test_v8_external", test_v8_external);
  NODE_SET_METHOD(exports, "test_v8_object", test_v8_object);
  NODE_SET_METHOD(exports, "test_v8_array_new", test_v8_array_new);
  NODE_SET_METHOD(exports, "test_v8_object_template", test_v8_object_template);
  NODE_SET_METHOD(exports, "create_function_with_data",
                  create_function_with_data);
  NODE_SET_METHOD(exports, "test_v8_function_template_set_class_name",
                  test_v8_function_template_set_class_name);
  NODE_SET_METHOD(exports, "print_values_from_js", print_values_from_js);
  NODE_SET_METHOD(exports, "return_this", return_this);
  NODE_SET_METHOD(exports, "create_object_with_holder_accessor",
                  create_object_with_holder_accessor);
  NODE_SET_METHOD(exports, "create_objects_with_internal_fields",
                  create_objects_with_internal_fields);
  NODE_SET_METHOD(exports, "global_get", GlobalTestWrapper::get);
  NODE_SET_METHOD(exports, "global_set", GlobalTestWrapper::set);
  NODE_SET_METHOD(exports, "test_many_v8_locals", test_many_v8_locals);
  NODE_SET_METHOD(exports, "test_handle_scope_gc", test_handle_scope_gc);
  NODE_SET_METHOD(exports, "test_v8_escapable_handle_scope",
                  test_v8_escapable_handle_scope);
  NODE_SET_METHOD(exports, "test_v8_escapable_handle_scope_inline_grants",
                  test_v8_escapable_handle_scope_inline_grants);
  NODE_SET_METHOD(exports, "test_v8_locals_survive_nested_call",
                  test_v8_locals_survive_nested_call);
  NODE_SET_METHOD(exports, "return_string_from_inner_scope",
                  return_string_from_inner_scope);
  NODE_SET_METHOD(exports, "return_heap_number_from_inner_scope",
                  return_heap_number_from_inner_scope);
  NODE_SET_METHOD(exports, "return_array_element_from_iterate",
                  return_array_element_from_iterate);
  NODE_SET_METHOD(exports, "return_accessor_value_from_inner_scope",
                  return_accessor_value_from_inner_scope);
  NODE_SET_METHOD(exports, "test_uv_os_getpid", test_uv_os_getpid);
  NODE_SET_METHOD(exports, "test_uv_os_getppid", test_uv_os_getppid);
  NODE_SET_METHOD(exports, "queue_work_and_call", queue_work_and_call);
  NODE_SET_METHOD(exports, "test_v8_object_get_by_key",
                  test_v8_object_get_by_key);
  NODE_SET_METHOD(exports, "test_v8_object_get_by_index",
                  test_v8_object_get_by_index);
  NODE_SET_METHOD(exports, "test_v8_strict_equals", test_v8_strict_equals);
  NODE_SET_METHOD(exports, "test_v8_array_new_with_length",
                  test_v8_array_new_with_length);
  NODE_SET_METHOD(exports, "test_v8_array_new_with_callback",
                  test_v8_array_new_with_callback);
  NODE_SET_METHOD(exports, "test_v8_array_length", test_v8_array_length);
  NODE_SET_METHOD(exports, "test_v8_array_iterate", test_v8_array_iterate);
  NODE_SET_METHOD(exports, "test_v8_maybe_local", test_v8_maybe_local);
  NODE_SET_METHOD(exports, "perform_object_get_by_index",
                  perform_object_get_by_index);
  NODE_SET_METHOD(exports, "perform_object_set_by_index",
                  perform_object_set_by_index);
  NODE_SET_METHOD(exports, "perform_object_get_by_key",
                  perform_object_get_by_key);
  NODE_SET_METHOD(exports, "perform_object_set_by_key",
                  perform_object_set_by_key);
  NODE_SET_METHOD(exports, "test_v8_value_type_checks",
                  test_v8_value_type_checks);
  NODE_SET_METHOD(exports, "print_external_and_buffer_type_checks",
                  print_external_and_buffer_type_checks);
  NODE_SET_METHOD(exports, "create_external_and_template_instance",
                  create_external_and_template_instance);
  NODE_SET_METHOD(exports, "test_v8_integer", test_v8_integer);
  NODE_SET_METHOD(exports, "perform_to_int32", perform_to_int32);
  NODE_SET_METHOD(exports, "get_function_script_origin",
                  get_function_script_origin);
  NODE_SET_METHOD(exports, "test_v8_define_own_property",
                  test_v8_define_own_property);
  NODE_SET_METHOD(exports, "test_v8_bigint", test_v8_bigint);
  NODE_SET_METHOD(exports, "create_bigints_from_unsigned",
                  create_bigints_from_unsigned);
  NODE_SET_METHOD(exports,
                  "create_bigints_from_unsigned_with_pending_exception",
                  create_bigints_from_unsigned_with_pending_exception);
  NODE_SET_METHOD(exports, "test_v8_string_from_utf8_literal",
                  test_v8_string_from_utf8_literal);
  NODE_SET_METHOD(exports, "test_v8_prototype_template",
                  test_v8_prototype_template);
  NODE_SET_METHOD(exports, "test_v8_arraybuffer", test_v8_arraybuffer);
  NODE_SET_METHOD(exports, "test_v8_typedarray", test_v8_typedarray);
  NODE_SET_METHOD(exports, "describe_array_buffer", describe_array_buffer);
  NODE_SET_METHOD(exports, "describe_shared_array_buffer",
                  describe_shared_array_buffer);
  NODE_SET_METHOD(exports, "describe_array_buffer_view_bytes",
                  describe_array_buffer_view_bytes);
  NODE_SET_METHOD(exports, "detach_array_buffer", detach_array_buffer);
  NODE_SET_METHOD(exports, "read_store_after_detach", read_store_after_detach);
  NODE_SET_METHOD(exports, "detach_array_buffer_with_pending_exception",
                  detach_array_buffer_with_pending_exception);
  NODE_SET_METHOD(exports, "test_v8_new_backing_store",
                  test_v8_new_backing_store);
  NODE_SET_METHOD(exports, "wrapped_buffers_create", wrapped_buffers_create);
  NODE_SET_METHOD(exports, "wrapped_buffer_create_without_memory",
                  wrapped_buffer_create_without_memory);
  NODE_SET_METHOD(exports, "wrapped_buffer_create_keeping_store",
                  wrapped_buffer_create_keeping_store);
  NODE_SET_METHOD(exports, "wrapped_kept_store_has_memory",
                  wrapped_kept_store_has_memory);
  NODE_SET_METHOD(exports, "wrapped_kept_store_release",
                  wrapped_kept_store_release);
  NODE_SET_METHOD(exports, "wrapped_buffer_pair", wrapped_buffer_pair);
  NODE_SET_METHOD(exports, "wrapped_buffer_store_has_memory",
                  wrapped_buffer_store_has_memory);
  NODE_SET_METHOD(exports, "wrapped_memory_get", wrapped_memory_get);
  NODE_SET_METHOD(exports, "wrapped_memory_set", wrapped_memory_set);
  NODE_SET_METHOD(exports, "wrapped_memory_deleter_calls",
                  wrapped_memory_deleter_calls);
  NODE_SET_METHOD(exports, "wrapped_memory_unexpected_deleter_calls",
                  wrapped_memory_unexpected_deleter_calls);
  NODE_SET_METHOD(exports, "wrapped_memory_collect_garbage",
                  wrapped_memory_collect_garbage);
  NODE_SET_METHOD(exports, "wrapped_store_destroy_with_null_deleter",
                  wrapped_store_destroy_with_null_deleter);
  NODE_SET_METHOD(exports, "wrapped_buffers_create_with_null_deleter",
                  wrapped_buffers_create_with_null_deleter);
  NODE_SET_METHOD(exports, "test_v8_function_call", test_v8_function_call);
  NODE_SET_METHOD(exports, "test_v8_function_new_instance",
                  test_v8_function_new_instance);
  NODE_SET_METHOD(exports, "test_v8_getfunction_memoized",
                  test_v8_getfunction_memoized);
  NODE_SET_METHOD(exports, "test_v8_map", test_v8_map);
  NODE_SET_METHOD(exports, "test_v8_exception", test_v8_exception);
  NODE_SET_METHOD(exports, "test_v8_exception_empty_message",
                  test_v8_exception_empty_message);
  NODE_SET_METHOD(exports, "test_v8_throw_error_empty_message",
                  test_v8_throw_error_empty_message);
  NODE_SET_METHOD(exports, "test_v8_new_values_with_pending_exception",
                  test_v8_new_values_with_pending_exception);
  NODE_SET_METHOD(exports, "test_v8_aligned_pointer_in_internal_field",
                  test_v8_aligned_pointer_in_internal_field);
  NODE_SET_METHOD(exports, "test_v8_cpu_profiler", test_v8_cpu_profiler);
  NODE_SET_METHOD(exports, "test_v8_cpu_profiler_overlapping_sessions",
                  test_v8_cpu_profiler_overlapping_sessions);
  NODE_SET_METHOD(exports, "test_v8_cpu_profiler_title_api",
                  test_v8_cpu_profiler_title_api);
  NODE_SET_METHOD(exports, "perform_uint32_value", perform_uint32_value);
  NODE_SET_METHOD(exports, "perform_int32_value", perform_int32_value);
  NODE_SET_METHOD(exports, "perform_uint32_value_with_pending_exception",
                  perform_uint32_value_with_pending_exception);
  NODE_SET_METHOD(exports, "perform_number_value", perform_number_value);
  NODE_SET_METHOD(exports, "perform_boolean_value", perform_boolean_value);
  NODE_SET_METHOD(exports, "create_function_with_c_function",
                  create_function_with_c_function);
  NODE_SET_METHOD(exports, "perform_get_own_property_names",
                  perform_get_own_property_names);
  NODE_SET_METHOD(exports, "test_v8_backing_store_deleted_by_addon",
                  test_v8_backing_store_deleted_by_addon);
  NODE_SET_METHOD(exports, "perform_object_clone", perform_object_clone);
  NODE_SET_METHOD(exports, "clone_template_instance", clone_template_instance);
  NODE_SET_METHOD(exports, "perform_object_clone_with_pending_exception",
                  perform_object_clone_with_pending_exception);

  // without this, node hits a UAF deleting the Global
  // (Context::GetIsolate was removed in V8 14.6; the module initializer runs
  // with the isolate entered, so take the current one)
  node::AddEnvironmentCleanupHook(Isolate::GetCurrent(),
                                  GlobalTestWrapper::cleanup, nullptr);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace v8tests

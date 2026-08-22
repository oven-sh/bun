#include <node.h>
#ifndef _WIN32
#include <unistd.h>
#endif
#include <uv.h>

#include <v8-profiler.h>

#include <cinttypes>
#include <cstdarg>
#include <iomanip>
#include <iostream>

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
  // title, blocks a second start of that title through either API (which
  // reports the running session), and can be stopped by title.
  CpuProfilingResult by_id = profiler->Start(
      title_b, kLeafNodeLineNumbers, true, CpuProfilingOptions::kNoSampleLimit);
  LOG_EXPR((int)by_id.status);
  CpuProfilingResult by_id_again = profiler->Start(
      title_b, kLeafNodeLineNumbers, true, CpuProfilingOptions::kNoSampleLimit);
  LOG_EXPR((int)by_id_again.status);
  LOG_EXPR(by_id_again.id == by_id.id);
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
  NODE_SET_METHOD(exports, "test_v8_integer", test_v8_integer);
  NODE_SET_METHOD(exports, "test_v8_define_own_property",
                  test_v8_define_own_property);
  NODE_SET_METHOD(exports, "test_v8_bigint", test_v8_bigint);
  NODE_SET_METHOD(exports, "test_v8_string_from_utf8_literal",
                  test_v8_string_from_utf8_literal);
  NODE_SET_METHOD(exports, "test_v8_prototype_template",
                  test_v8_prototype_template);
  NODE_SET_METHOD(exports, "test_v8_arraybuffer", test_v8_arraybuffer);
  NODE_SET_METHOD(exports, "test_v8_typedarray", test_v8_typedarray);
  NODE_SET_METHOD(exports, "test_v8_function_call", test_v8_function_call);
  NODE_SET_METHOD(exports, "test_v8_function_new_instance",
                  test_v8_function_new_instance);
  NODE_SET_METHOD(exports, "test_v8_getfunction_memoized",
                  test_v8_getfunction_memoized);
  NODE_SET_METHOD(exports, "test_v8_map", test_v8_map);
  NODE_SET_METHOD(exports, "test_v8_exception", test_v8_exception);
  NODE_SET_METHOD(exports, "test_v8_aligned_pointer_in_internal_field",
                  test_v8_aligned_pointer_in_internal_field);
  NODE_SET_METHOD(exports, "test_v8_cpu_profiler", test_v8_cpu_profiler);
  NODE_SET_METHOD(exports, "test_v8_cpu_profiler_overlapping_sessions",
                  test_v8_cpu_profiler_overlapping_sessions);
  NODE_SET_METHOD(exports, "test_v8_cpu_profiler_title_api",
                  test_v8_cpu_profiler_title_api);

  // without this, node hits a UAF deleting the Global
  // (Context::GetIsolate was removed in V8 14.6; the module initializer runs
  // with the isolate entered, so take the current one)
  node::AddEnvironmentCleanupHook(Isolate::GetCurrent(),
                                  GlobalTestWrapper::cleanup, nullptr);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace v8tests

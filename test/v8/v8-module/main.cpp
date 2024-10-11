#include <node.h>
#ifndef _WIN32
#include <unistd.h>
#endif
#include <uv.h>

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

static void run_gc(const FunctionCallbackInfo<Value> &info) {
  auto *isolate = info.GetIsolate();
  auto context = isolate->GetCurrentContext();
  (void)info[0].As<Function>()->Call(context, Null(isolate), 0, nullptr);
}

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
    value.As<String>()->WriteUtf8(isolate, buf, sizeof(buf) - 1);
    std::string result = "\"";
    result += buf;
    result += "\"";
    return result;
  } else if (value->IsFunction()) {
    char buf[1024] = {0};
    value.As<Function>()->GetName().As<String>()->WriteUtf8(isolate, buf,
                                                            sizeof(buf) - 1);
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
  int retval;
  int nchars;

  LOG_VALUE_KIND(v8_string);
  LOG_EXPR(v8_string->Length());
  LOG_EXPR(v8_string->Utf8Length(isolate));
  LOG_EXPR(v8_string->IsOneByte());
  LOG_EXPR(v8_string->ContainsOnlyOneByte());
  LOG_EXPR(v8_string->IsExternal());
  LOG_EXPR(v8_string->IsExternalTwoByte());
  LOG_EXPR(v8_string->IsExternalOneByte());

  // check string has the right contents
  LOG_EXPR(retval = v8_string->WriteUtf8(isolate, buf, sizeof buf, &nchars));
  LOG_EXPR(nchars);
  log_buffer(buf, retval + 1);

  memset(buf, 0x7f, sizeof buf);

  // try with assuming the buffer is large enough
  LOG_EXPR(retval = v8_string->WriteUtf8(isolate, buf, -1, &nchars));
  LOG_EXPR(nchars);
  log_buffer(buf, retval + 1);

  memset(buf, 0x7f, sizeof buf);

  // try with ignoring nchars (it should not try to store anything in a
  // nullptr)
  LOG_EXPR(retval = v8_string->WriteUtf8(isolate, buf, sizeof buf, nullptr));
  log_buffer(buf, retval + 1);

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

  // Local<Value> retval = obj->Get(context, key).ToLocalChecked();
  // LOG_EXPR(describe(isolate, retval));

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

void GlobalTestWrapper::cleanup(void *unused) { value.Reset(); }

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
  o->GetInternalField(0).As<String>()->WriteUtf8(isolate, buf);
  assert(atoi(buf) == expected_field0);

  Local<Value> field1 = o->GetInternalField(1).As<Value>();
  if (field1->IsString()) {
    field1.As<String>()->WriteUtf8(isolate, buf);
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
      mini_strings[j]->WriteUtf8(isolate, buf);
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
    huge_strings[i]->WriteUtf8(isolate, string_data);
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
  s->WriteUtf8(isolate, buf);
  LOG_EXPR(buf);
  LOG_EXPR(n->Value());
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
  NODE_SET_METHOD(exports, "test_v8_external", test_v8_external);
  NODE_SET_METHOD(exports, "test_v8_object", test_v8_object);
  NODE_SET_METHOD(exports, "test_v8_array_new", test_v8_array_new);
  NODE_SET_METHOD(exports, "test_v8_object_template", test_v8_object_template);
  NODE_SET_METHOD(exports, "create_function_with_data",
                  create_function_with_data);
  NODE_SET_METHOD(exports, "print_values_from_js", print_values_from_js);
  NODE_SET_METHOD(exports, "return_this", return_this);
  NODE_SET_METHOD(exports, "global_get", GlobalTestWrapper::get);
  NODE_SET_METHOD(exports, "global_set", GlobalTestWrapper::set);
  NODE_SET_METHOD(exports, "test_many_v8_locals", test_many_v8_locals);
  NODE_SET_METHOD(exports, "test_handle_scope_gc", test_handle_scope_gc);
  NODE_SET_METHOD(exports, "test_v8_escapable_handle_scope",
                  test_v8_escapable_handle_scope);
  NODE_SET_METHOD(exports, "test_uv_os_getpid", test_uv_os_getpid);
  NODE_SET_METHOD(exports, "test_uv_os_getppid", test_uv_os_getppid);

  // without this, node hits a UAF deleting the Global
  node::AddEnvironmentCleanupHook(context->GetIsolate(),
                                  GlobalTestWrapper::cleanup, nullptr);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace v8tests

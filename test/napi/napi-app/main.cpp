#include <node.h>

#include <napi.h>

#include <array>
#include <cassert>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <thread>

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

static void run_gc(const Napi::CallbackInfo &info) {
  info[0].As<Napi::Function>().Call(0, nullptr);
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
  // info[0] is a function to run the GC
  napi_assert(info[1].IsNumber());
  napi_assert(info[2].IsNumber());
  napi_assert(info[3].IsNumber());
  napi_assert(info[4].IsNumber());
  napi_assert(info[5].IsNumber());
  napi_assert(info[6].IsNumber());
  napi_assert(info[7].IsNumber());
  napi_assert(info[8].IsNumber());
#undef napi_assert
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

  // info[0] is a function to run the GC
  napi_value string_js = info[1];
  napi_value chars_to_copy_js = info[2];

  // get how many chars we need to copy
  uint32_t _len;
  if (napi_get_value_uint32(env, chars_to_copy_js, &_len) != napi_ok) {
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

  if (napi_get_value_string_utf8(env, string_js, buf, len, &copied) !=
      napi_ok) {
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

napi_value test_napi_handle_scope_string(const Napi::CallbackInfo &info) {
  // this is mostly a copy of test_handle_scope_gc from
  // test/v8/v8-module/main.cpp -- see comments there for explanation
  Napi::Env env = info.Env();

  constexpr size_t num_small_strings = 10000;

  auto *small_strings = new napi_value[num_small_strings];

  for (size_t i = 0; i < num_small_strings; i++) {
    std::string cpp_str = std::to_string(i);
    assert(napi_create_string_utf8(env, cpp_str.c_str(), cpp_str.size(),
                                   &small_strings[i]) == napi_ok);
  }

  run_gc(info);

  for (size_t j = 0; j < num_small_strings; j++) {
    char buf[16];
    size_t result;
    assert(napi_get_value_string_utf8(env, small_strings[j], buf, sizeof buf,
                                      &result) == napi_ok);
    printf("%s\n", buf);
    assert(atoi(buf) == (int)j);
  }

  delete[] small_strings;
  return ok(env);
}

napi_value test_napi_handle_scope_bigint(const Napi::CallbackInfo &info) {
  // this is mostly a copy of test_handle_scope_gc from
  // test/v8/v8-module/main.cpp -- see comments there for explanation
  Napi::Env env = info.Env();

  constexpr size_t num_small_ints = 10000;
  constexpr size_t small_int_size = 100;

  auto *small_ints = new napi_value[num_small_ints];

  for (size_t i = 0; i < num_small_ints; i++) {
    std::array<uint64_t, small_int_size> words;
    words.fill(i + 1);
    assert(napi_create_bigint_words(env, 0, small_int_size, words.data(),
                                    &small_ints[i]) == napi_ok);
  }

  run_gc(info);

  for (size_t j = 0; j < num_small_ints; j++) {
    std::array<uint64_t, small_int_size> words;
    int sign;
    size_t word_count = words.size();
    assert(napi_get_value_bigint_words(env, small_ints[j], &sign, &word_count,
                                       words.data()) == napi_ok);
    printf("%d, %zu\n", sign, word_count);
    assert(sign == 0 && word_count == words.size());
    assert(std::all_of(words.begin(), words.end(),
                       [j](const uint64_t &w) { return w == j + 1; }));
  }

  delete[] small_ints;
  return ok(env);
}

napi_value test_napi_delete_property(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // info[0] is a function to run the GC
  napi_value object = info[1];
  napi_valuetype type;
  assert(napi_typeof(env, object, &type) == napi_ok);
  assert(type == napi_object);

  napi_value key;
  assert(napi_create_string_utf8(env, "foo", 3, &key) == napi_ok);

  napi_value non_configurable_key;
  assert(napi_create_string_utf8(env, "bar", 3, &non_configurable_key) ==
         napi_ok);

  napi_value val;
  assert(napi_create_int32(env, 42, &val) == napi_ok);

  bool delete_result;
  assert(napi_delete_property(env, object, non_configurable_key,
                              &delete_result) == napi_ok);
  assert(delete_result == false);

  assert(napi_delete_property(env, object, key, &delete_result) == napi_ok);
  assert(delete_result == true);

  bool has_property;
  assert(napi_has_property(env, object, key, &has_property) == napi_ok);
  assert(has_property == false);

  return ok(env);
}

void store_escaped_handle(napi_env env, napi_value *out, const char *str) {
  // Allocate these values on the heap so they cannot be seen by stack scanning
  // after this function returns. An earlier version tried putting them on the
  // stack and using volatile stores to set them to nullptr, but that wasn't
  // effective when the NAPI module was built in release mode as extra copies of
  // the pointers would still be left in uninitialized stack memory.
  napi_escapable_handle_scope *ehs = new napi_escapable_handle_scope;
  napi_value *s = new napi_value;
  napi_value *escaped = new napi_value;
  assert(napi_open_escapable_handle_scope(env, ehs) == napi_ok);
  assert(napi_create_string_utf8(env, str, NAPI_AUTO_LENGTH, s) == napi_ok);
  assert(napi_escape_handle(env, *ehs, *s, escaped) == napi_ok);
  // can't call a second time
  assert(napi_escape_handle(env, *ehs, *s, escaped) ==
         napi_escape_called_twice);
  assert(napi_close_escapable_handle_scope(env, *ehs) == napi_ok);
  *out = *escaped;

  delete escaped;
  delete s;
  delete ehs;
}

napi_value test_napi_escapable_handle_scope(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // allocate space for a napi_value on the heap
  // use store_escaped_handle to put the value into it
  // trigger GC
  // the napi_value should still be valid even though it can't be found on the
  // stack, because it escaped into the current handle scope

  constexpr const char *str = "this is a long string meow meow meow";

  napi_value *hidden = new napi_value;
  store_escaped_handle(env, hidden, str);

  run_gc(info);

  char buf[64];
  size_t len;
  assert(napi_get_value_string_utf8(env, *hidden, buf, sizeof(buf), &len) ==
         napi_ok);
  assert(len == strlen(str));
  assert(strcmp(buf, str) == 0);

  delete hidden;
  return ok(env);
}

napi_value test_napi_handle_scope_nesting(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  constexpr const char *str = "this is a long string meow meow meow";

  // Create an outer handle scope, hidden on the heap (the one created in
  // NAPIFunction::call is still on the stack
  napi_handle_scope *outer_hs = new napi_handle_scope;
  assert(napi_open_handle_scope(env, outer_hs) == napi_ok);

  // Make a handle in the outer scope, on the heap so stack scanning can't see
  // it
  napi_value *outer_scope_handle = new napi_value;
  assert(napi_create_string_utf8(env, str, NAPI_AUTO_LENGTH,
                                 outer_scope_handle) == napi_ok);

  // Make a new handle scope on the heap
  napi_handle_scope *inner_hs = new napi_handle_scope;
  assert(napi_open_handle_scope(env, inner_hs) == napi_ok);

  // Force GC
  run_gc(info);

  // Try to read our first handle. Did the outer handle scope get
  // collected now that it's not on the global object?
  char buf[64];
  size_t len;
  assert(napi_get_value_string_utf8(env, *outer_scope_handle, buf, sizeof(buf),
                                    &len) == napi_ok);
  assert(len == strlen(str));
  assert(strcmp(buf, str) == 0);

  // Clean up
  assert(napi_close_handle_scope(env, *inner_hs) == napi_ok);
  delete inner_hs;
  assert(napi_close_handle_scope(env, *outer_hs) == napi_ok);
  delete outer_hs;
  delete outer_scope_handle;
  return ok(env);
}

napi_value constructor(napi_env env, napi_callback_info info) {
  napi_value this_value;
  assert(napi_get_cb_info(env, info, nullptr, nullptr, &this_value, nullptr) ==
         napi_ok);
  napi_value property_value;
  assert(napi_create_string_utf8(env, "meow", NAPI_AUTO_LENGTH,
                                 &property_value) == napi_ok);
  assert(napi_set_named_property(env, this_value, "foo", property_value) ==
         napi_ok);
  napi_value undefined;
  assert(napi_get_undefined(env, &undefined) == napi_ok);
  return undefined;
}

napi_value get_class_with_constructor(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value napi_class;
  assert(napi_define_class(env, "NapiClass", NAPI_AUTO_LENGTH, constructor,
                           nullptr, 0, nullptr, &napi_class) == napi_ok);
  return napi_class;
}

struct AsyncWorkData {
  int result;
  napi_deferred deferred;
  napi_async_work work;

  AsyncWorkData() : result(0), deferred(nullptr), work(nullptr) {}

  static void execute(napi_env env, void *data) {
    AsyncWorkData *async_work_data = reinterpret_cast<AsyncWorkData *>(data);
    async_work_data->result = 42;
  }

  static void complete(napi_env env, napi_status status, void *data) {
    AsyncWorkData *async_work_data = reinterpret_cast<AsyncWorkData *>(data);
    assert(status == napi_ok);

    napi_value result;
    char buf[64] = {0};
    snprintf(buf, sizeof(buf), "the number is %d", async_work_data->result);
    assert(napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &result) ==
           napi_ok);
    assert(napi_resolve_deferred(env, async_work_data->deferred, result) ==
           napi_ok);
    assert(napi_delete_async_work(env, async_work_data->work) == napi_ok);
    delete async_work_data;
  }
};

napi_value create_promise(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  auto *data = new AsyncWorkData();

  napi_value promise;

  assert(napi_create_promise(env, &data->deferred, &promise) == napi_ok);

  napi_value resource_name;
  assert(napi_create_string_utf8(env, "napitests::create_promise",
                                 NAPI_AUTO_LENGTH, &resource_name) == napi_ok);
  assert(napi_create_async_work(env, nullptr, resource_name,
                                AsyncWorkData::execute, AsyncWorkData::complete,
                                data, &data->work) == napi_ok);

  assert(napi_queue_async_work(env, data->work) == napi_ok);
  return promise;
}

struct ThreadsafeFunctionData {
  napi_threadsafe_function tsfn;
  napi_deferred deferred;

  static void thread_entry(ThreadsafeFunctionData *data) {
    using namespace std::chrono_literals;
    std::this_thread::sleep_for(10ms);
    // nonblocking means it will return an error if the threadsafe function's
    // queue is full, which it should never do because we only use it once and
    // we init with a capacity of 1
    assert(napi_call_threadsafe_function(data->tsfn, nullptr,
                                         napi_tsfn_nonblocking) == napi_ok);
  }

  static void tsfn_finalize_callback(napi_env env, void *finalize_data,
                                     void *finalize_hint) {
    printf("tsfn_finalize_callback\n");
    ThreadsafeFunctionData *data =
        reinterpret_cast<ThreadsafeFunctionData *>(finalize_data);
    delete data;
  }

  static void tsfn_callback(napi_env env, napi_value js_callback, void *context,
                            void *data) {
    // context == ThreadsafeFunctionData pointer
    // data == nullptr
    printf("tsfn_callback\n");
    ThreadsafeFunctionData *tsfn_data =
        reinterpret_cast<ThreadsafeFunctionData *>(context);

    napi_value recv;
    assert(napi_get_undefined(env, &recv) == napi_ok);

    // call our JS function with undefined for this and no arguments
    napi_value js_result;
    assert(napi_call_function(env, recv, js_callback, 0, nullptr, &js_result) ==
           napi_ok);

    // resolve the promise with the return value of the JS function
    assert(napi_resolve_deferred(env, tsfn_data->deferred, js_result) ==
           napi_ok);

    // clean up the threadsafe function
    assert(napi_release_threadsafe_function(tsfn_data->tsfn, napi_tsfn_abort) ==
           napi_ok);
  }
};

napi_value
create_promise_with_threadsafe_function(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  ThreadsafeFunctionData *tsfn_data = new ThreadsafeFunctionData;

  napi_value async_resource_name;
  assert(napi_create_string_utf8(
             env, "napitests::create_promise_with_threadsafe_function",
             NAPI_AUTO_LENGTH, &async_resource_name) == napi_ok);

  // this is called directly, without the GC callback, so argument 0 is a JS
  // callback used to resolve the promise
  assert(napi_create_threadsafe_function(
             env, info[0], nullptr, async_resource_name,
             // max_queue_size, initial_thread_count
             1, 1,
             // thread_finalize_data, thread_finalize_cb
             tsfn_data, ThreadsafeFunctionData::tsfn_finalize_callback,
             // context
             tsfn_data, ThreadsafeFunctionData::tsfn_callback,
             &tsfn_data->tsfn) == napi_ok);
  // create a promise we can return to JS and put the deferred counterpart in
  // tsfn_data
  napi_value promise;
  assert(napi_create_promise(env, &tsfn_data->deferred, &promise) == napi_ok);

  // spawn and release std::thread
  std::thread secondary_thread(ThreadsafeFunctionData::thread_entry, tsfn_data);
  secondary_thread.detach();
  // return the promise to javascript
  return promise;
}

napi_value test_napi_ref(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value object;
  assert(napi_create_object(env, &object) == napi_ok);

  napi_ref ref;
  assert(napi_create_reference(env, object, 0, &ref) == napi_ok);

  napi_value from_ref;
  assert(napi_get_reference_value(env, ref, &from_ref) == napi_ok);
  assert(from_ref != nullptr);
  napi_valuetype typeof_result;
  assert(napi_typeof(env, from_ref, &typeof_result) == napi_ok);
  assert(typeof_result == napi_object);
  return ok(env);
}

static bool finalize_called = false;

void finalize_cb(napi_env env, void *finalize_data, void *finalize_hint) {
  // only do this in bun
  bool &create_handle_scope = *reinterpret_cast<bool *>(finalize_hint);
  if (create_handle_scope) {
    napi_handle_scope hs;
    assert(napi_open_handle_scope(env, &hs) == napi_ok);
    assert(napi_close_handle_scope(env, hs) == napi_ok);
  }
  delete &create_handle_scope;
  finalize_called = true;
}

napi_value create_ref_with_finalizer(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value create_handle_scope_in_finalizer = info[0];

  napi_value object;
  assert(napi_create_object(env, &object) == napi_ok);

  bool *finalize_hint = new bool;
  assert(napi_get_value_bool(env, create_handle_scope_in_finalizer,
                             finalize_hint) == napi_ok);

  napi_ref ref;

  assert(napi_wrap(env, object, nullptr, finalize_cb,
                   reinterpret_cast<bool *>(finalize_hint), &ref) == napi_ok);

  return ok(env);
}

napi_value was_finalize_called(const Napi::CallbackInfo &info) {
  napi_value ret;
  assert(napi_get_boolean(info.Env(), finalize_called, &ret) == napi_ok);
  return ret;
}

Napi::Value RunCallback(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  // this function is invoked without the GC callback
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
  exports.Set(
      "test_napi_get_value_string_utf8_with_buffer",
      Napi::Function::New(env, test_napi_get_value_string_utf8_with_buffer));
  exports.Set(
      "test_napi_threadsafe_function_does_not_hang_after_finalize",
      Napi::Function::New(
          env, test_napi_threadsafe_function_does_not_hang_after_finalize));
  exports.Set("test_napi_handle_scope_string",
              Napi::Function::New(env, test_napi_handle_scope_string));
  exports.Set("test_napi_handle_scope_bigint",
              Napi::Function::New(env, test_napi_handle_scope_bigint));
  exports.Set("test_napi_delete_property",
              Napi::Function::New(env, test_napi_delete_property));
  exports.Set("test_napi_escapable_handle_scope",
              Napi::Function::New(env, test_napi_escapable_handle_scope));
  exports.Set("test_napi_handle_scope_nesting",
              Napi::Function::New(env, test_napi_handle_scope_nesting));
  exports.Set("get_class_with_constructor",
              Napi::Function::New(env, get_class_with_constructor));
  exports.Set("create_promise", Napi::Function::New(env, create_promise));
  exports.Set(
      "create_promise_with_threadsafe_function",
      Napi::Function::New(env, create_promise_with_threadsafe_function));
  exports.Set("test_napi_ref", Napi::Function::New(env, test_napi_ref));
  exports.Set("create_ref_with_finalizer",
              Napi::Function::New(env, create_ref_with_finalizer));
  exports.Set("was_finalize_called",
              Napi::Function::New(env, was_finalize_called));

  return exports;
}

NODE_API_MODULE(napitests, InitAll)

#include "napi_with_version.h"
#include "utils.h"
#include "wrap_tests.h"

#include <array>
#include <cassert>
#include <cinttypes>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <limits>
#include <map>
#include <string>
#include <thread>
#include <utility>

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
  napi_valuetype type = get_typeof(env, object);
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
  bool do_throw;

  AsyncWorkData()
      : result(0), deferred(nullptr), work(nullptr), do_throw(false) {}

  static void execute(napi_env env, void *data) {
    AsyncWorkData *async_work_data = reinterpret_cast<AsyncWorkData *>(data);
    async_work_data->result = 42;
  }

  static void complete(napi_env env, napi_status status, void *data) {
    AsyncWorkData *async_work_data = reinterpret_cast<AsyncWorkData *>(data);
    assert(status == napi_ok);

    if (async_work_data->do_throw) {
      // still have to resolve/reject otherwise the process times out
      // we should not see the resolution as our unhandled exception handler
      // exits the process before that can happen
      napi_value result;
      assert(napi_get_undefined(env, &result) == napi_ok);
      assert(napi_resolve_deferred(env, async_work_data->deferred, result) ==
             napi_ok);

      napi_value err;
      napi_value msg;
      assert(napi_create_string_utf8(env, "error from napi", NAPI_AUTO_LENGTH,
                                     &msg) == napi_ok);
      assert(napi_create_error(env, nullptr, msg, &err) == napi_ok);
      assert(napi_throw(env, err) == napi_ok);
    } else {
      napi_value result;
      char buf[64] = {0};
      snprintf(buf, sizeof(buf), "the number is %d", async_work_data->result);
      assert(napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &result) ==
             napi_ok);
      assert(napi_resolve_deferred(env, async_work_data->deferred, result) ==
             napi_ok);
    }

    assert(napi_delete_async_work(env, async_work_data->work) == napi_ok);
    delete async_work_data;
  }
};

// create_promise(void *unused_run_gc_callback, bool do_throw): makes a promise
// using napi_Async_work that either resolves or throws in the complete callback
napi_value create_promise(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  auto *data = new AsyncWorkData();
  // info[0] is a callback to run the GC
  assert(napi_get_value_bool(env, info[1], &data->do_throw) == napi_ok);

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
    napi_status call_result =
        napi_call_function(env, recv, js_callback, 0, nullptr, &js_result);
    // assert(call_result == napi_ok || call_result == napi_pending_exception);

    if (call_result == napi_ok) {
      // only resolve if js_callback did not return an error
      // resolve the promise with the return value of the JS function
      napi_status defer_result =
          napi_resolve_deferred(env, tsfn_data->deferred, js_result);
      printf("%d\n", defer_result);
      assert(defer_result == napi_ok);
    }

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
  napi_valuetype typeof_result = get_typeof(env, from_ref);
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

// calls a function (the sole argument) which must throw. catches and returns
// the thrown error
napi_value call_and_get_exception(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value fn = info[0];
  napi_value undefined;
  assert(napi_get_undefined(env, &undefined) == napi_ok);

  (void)napi_call_function(env, undefined, fn, 0, nullptr, nullptr);

  bool is_pending;
  assert(napi_is_exception_pending(env, &is_pending) == napi_ok);
  assert(is_pending);

  napi_value exception;
  assert(napi_get_and_clear_last_exception(env, &exception) == napi_ok);

  napi_valuetype type = get_typeof(env, exception);
  printf("typeof thrown exception = %s\n", napi_valuetype_to_string(type));

  assert(napi_is_exception_pending(env, &is_pending) == napi_ok);
  assert(!is_pending);

  return exception;
}

// throw_error(code: string|undefined, msg: string|undefined,
// error_kind: 'error'|'type_error'|'range_error'|'syntax_error')
// if code and msg are JS undefined then change them to nullptr
napi_value throw_error(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value js_code = info[0];
  napi_value js_msg = info[1];
  napi_value js_error_kind = info[2];
  const char *code = nullptr;
  const char *msg = nullptr;
  char code_buf[256] = {0}, msg_buf[256] = {0}, error_kind_buf[256] = {0};

  if (get_typeof(env, js_code) == napi_string) {
    assert(napi_get_value_string_utf8(env, js_code, code_buf, sizeof code_buf,
                                      nullptr) == napi_ok);
    code = code_buf;
  }
  if (get_typeof(env, js_msg) == napi_string) {
    assert(napi_get_value_string_utf8(env, js_msg, msg_buf, sizeof msg_buf,
                                      nullptr) == napi_ok);
    msg = msg_buf;
  }
  assert(napi_get_value_string_utf8(env, js_error_kind, error_kind_buf,
                                    sizeof error_kind_buf, nullptr) == napi_ok);

  std::map<std::string,
           napi_status (*)(napi_env, const char *code, const char *msg)>
      functions{{"error", napi_throw_error},
                {"type_error", napi_throw_type_error},
                {"range_error", napi_throw_range_error},
                {"syntax_error", node_api_throw_syntax_error}};

  auto throw_function = functions[error_kind_buf];

  if (msg == nullptr) {
    assert(throw_function(env, code, msg) == napi_invalid_arg);
    return ok(env);
  } else {
    assert(throw_function(env, code, msg) == napi_ok);
    return nullptr;
  }
}

// create_and_throw_error(code: any, msg: any,
// error_kind: 'error'|'type_error'|'range_error'|'syntax_error')
// if code and msg are JS null then change them to nullptr
napi_value create_and_throw_error(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value js_code = info[0];
  napi_value js_msg = info[1];
  napi_value js_error_kind = info[2];
  char error_kind_buf[256] = {0};

  if (get_typeof(env, js_code) == napi_null) {
    js_code = nullptr;
  }
  if (get_typeof(env, js_msg) == napi_null) {
    js_msg = nullptr;
  }

  assert(napi_get_value_string_utf8(env, js_error_kind, error_kind_buf,
                                    sizeof error_kind_buf, nullptr) == napi_ok);

  std::map<std::string, napi_status (*)(napi_env, napi_value code,
                                        napi_value msg, napi_value *)>
      functions{{"error", napi_create_error},
                {"type_error", napi_create_type_error},
                {"range_error", napi_create_range_error},
                {"syntax_error", node_api_create_syntax_error}};

  auto create_error_function = functions[error_kind_buf];

  napi_value err;
  napi_status create_status = create_error_function(env, js_code, js_msg, &err);
  // cases that should fail:
  // - js_msg is nullptr
  // - js_msg is not a string
  // - js_code is not nullptr and not a string
  // also we need to make sure not to call get_typeof with nullptr, since it
  // asserts that napi_typeof succeeded
  if (!js_msg || get_typeof(env, js_msg) != napi_string ||
      (js_code && get_typeof(env, js_code) != napi_string)) {
    // bun and node may return different errors here depending on in what order
    // the parameters are checked, but what's important is that there is an
    // error
    assert(create_status == napi_string_expected ||
           create_status == napi_invalid_arg);
    return ok(env);
  } else {
    assert(create_status == napi_ok);
    assert(napi_throw(env, err) == napi_ok);
    return nullptr;
  }
}

napi_value eval_wrapper(const Napi::CallbackInfo &info) {
  napi_value ret = nullptr;
  // info[0] is the GC callback
  (void)napi_run_script(info.Env(), info[1], &ret);
  return ret;
}

// perform_get(object, key)
napi_value perform_get(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value obj = info[0];
  napi_value key = info[1];
  napi_status status;
  napi_value value;

  // if key is a string, try napi_get_named_property
  napi_valuetype type = get_typeof(env, key);
  if (type == napi_string) {
    char buf[1024];
    assert(napi_get_value_string_utf8(env, key, buf, 1024, nullptr) == napi_ok);
    status = napi_get_named_property(env, obj, buf, &value);
    printf("get_named_property status is pending_exception or generic_failure "
           "= %d\n",
           status == napi_pending_exception || status == napi_generic_failure);
    if (status == napi_ok) {
      assert(value != nullptr);
      printf("value type = %d\n", get_typeof(env, value));
    } else {
      return ok(env);
    }
  }

  status = napi_get_property(env, obj, key, &value);
  printf("get_property status is pending_exception or generic_failure  = %d\n",
         status == napi_pending_exception || status == napi_generic_failure);
  if (status == napi_ok) {
    assert(value != nullptr);
    printf("value type = %d\n", get_typeof(env, value));
    return value;
  } else {
    return ok(env);
  }
}

// double_to_i32(any): number|undefined
napi_value double_to_i32(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value input = info[0];

  int32_t integer;
  napi_value result;
  napi_status status = napi_get_value_int32(env, input, &integer);
  if (status == napi_ok) {
    assert(napi_create_int32(env, integer, &result) == napi_ok);
  } else {
    assert(status == napi_number_expected);
    assert(napi_get_undefined(env, &result) == napi_ok);
  }
  return result;
}

// double_to_u32(any): number|undefined
napi_value double_to_u32(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value input = info[0];

  uint32_t integer;
  napi_value result;
  napi_status status = napi_get_value_uint32(env, input, &integer);
  if (status == napi_ok) {
    assert(napi_create_uint32(env, integer, &result) == napi_ok);
  } else {
    assert(status == napi_number_expected);
    assert(napi_get_undefined(env, &result) == napi_ok);
  }
  return result;
}

// double_to_i64(any): number|undefined
napi_value double_to_i64(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value input = info[0];

  int64_t integer;
  napi_value result;
  napi_status status = napi_get_value_int64(env, input, &integer);
  if (status == napi_ok) {
    assert(napi_create_int64(env, integer, &result) == napi_ok);
  } else {
    assert(status == napi_number_expected);
    assert(napi_get_undefined(env, &result) == napi_ok);
  }
  return result;
}

// test from the C++ side
napi_value test_number_integer_conversions(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  using f64_limits = std::numeric_limits<double>;
  using i32_limits = std::numeric_limits<int32_t>;
  using u32_limits = std::numeric_limits<uint32_t>;
  using i64_limits = std::numeric_limits<int64_t>;

  std::array<std::pair<double, int32_t>, 14> i32_cases{{
      // special values
      {f64_limits::infinity(), 0},
      {-f64_limits::infinity(), 0},
      {f64_limits::quiet_NaN(), 0},
      // normal
      {0.0, 0},
      {1.0, 1},
      {-1.0, -1},
      // truncation
      {1.25, 1},
      {-1.25, -1},
      // limits
      {i32_limits::min(), i32_limits::min()},
      {i32_limits::max(), i32_limits::max()},
      // wrap around
      {static_cast<double>(i32_limits::min()) - 1.0, i32_limits::max()},
      {static_cast<double>(i32_limits::max()) + 1.0, i32_limits::min()},
      {static_cast<double>(i32_limits::min()) - 2.0, i32_limits::max() - 1},
      {static_cast<double>(i32_limits::max()) + 2.0, i32_limits::min() + 1},
  }};

  for (const auto &[in, expected_out] : i32_cases) {
    napi_value js_in;
    assert(napi_create_double(env, in, &js_in) == napi_ok);
    int32_t out_from_napi;
    assert(napi_get_value_int32(env, js_in, &out_from_napi) == napi_ok);
    assert(out_from_napi == expected_out);
  }

  std::array<std::pair<double, uint32_t>, 12> u32_cases{{
      // special values
      {f64_limits::infinity(), 0},
      {-f64_limits::infinity(), 0},
      {f64_limits::quiet_NaN(), 0},
      // normal
      {0.0, 0},
      {1.0, 1},
      // truncation
      {1.25, 1},
      {-1.25, u32_limits::max()},
      // limits
      {u32_limits::max(), u32_limits::max()},
      // wrap around
      {-1.0, u32_limits::max()},
      {static_cast<double>(u32_limits::max()) + 1.0, 0},
      {-2.0, u32_limits::max() - 1},
      {static_cast<double>(u32_limits::max()) + 2.0, 1},

  }};

  for (const auto &[in, expected_out] : u32_cases) {
    napi_value js_in;
    assert(napi_create_double(env, in, &js_in) == napi_ok);
    uint32_t out_from_napi;
    assert(napi_get_value_uint32(env, js_in, &out_from_napi) == napi_ok);
    assert(out_from_napi == expected_out);
  }

  std::array<std::pair<double, int64_t>, 12> i64_cases{
      {// special values
       {f64_limits::infinity(), 0},
       {-f64_limits::infinity(), 0},
       {f64_limits::quiet_NaN(), 0},
       // normal
       {0.0, 0},
       {1.0, 1},
       {-1.0, -1},
       // truncation
       {1.25, 1},
       {-1.25, -1},
       // limits
       // i64 max can't be precisely represented as double so it would round to
       // 1
       // + i64 max, which would clamp and we don't want that yet. so we test
       // the
       // largest double smaller than i64 max instead (which is i64 max - 1024)
       {i64_limits::min(), i64_limits::min()},
       {std::nextafter(static_cast<double>(i64_limits::max()), 0.0),
        static_cast<int64_t>(
            std::nextafter(static_cast<double>(i64_limits::max()), 0.0))},
       // clamp
       {i64_limits::min() - 4096.0, i64_limits::min()},
       {i64_limits::max() + 4096.0, i64_limits::max()}}};

  for (const auto &[in, expected_out] : i64_cases) {
    napi_value js_in;
    assert(napi_create_double(env, in, &js_in) == napi_ok);
    int64_t out_from_napi;
    assert(napi_get_value_int64(env, js_in, &out_from_napi) == napi_ok);
    assert(out_from_napi == expected_out);
  }

  return ok(env);
}

napi_value make_empty_array(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value js_size = info[0];
  uint32_t size;
  assert(napi_get_value_uint32(env, js_size, &size) == napi_ok);
  napi_value array;
  assert(napi_create_array_with_length(env, size, &array) == napi_ok);
  return array;
}

// add_tag(object, lower, upper)
static napi_value add_tag(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value object = info[0];

  uint32_t lower, upper;
  assert(napi_get_value_uint32(env, info[1], &lower) == napi_ok);
  assert(napi_get_value_uint32(env, info[2], &upper) == napi_ok);
  napi_type_tag tag = {.lower = lower, .upper = upper};

  napi_status status = napi_type_tag_object(env, object, &tag);
  if (status != napi_ok) {
    char buf[1024];
    snprintf(buf, sizeof buf, "status = %d", status);
    napi_throw_error(env, nullptr, buf);
  }
  return env.Undefined();
}

// check_tag(object, lower, upper): bool
static napi_value check_tag(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value object = info[0];

  uint32_t lower, upper;
  assert(napi_get_value_uint32(env, info[1], &lower) == napi_ok);
  assert(napi_get_value_uint32(env, info[2], &upper) == napi_ok);

  napi_type_tag tag = {.lower = lower, .upper = upper};
  bool matches;
  assert(napi_check_object_type_tag(env, object, &tag, &matches) == napi_ok);
  return Napi::Boolean::New(env, matches);
}

// try_add_tag(object, lower, upper): bool
// true if success
static napi_value try_add_tag(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value object = info[0];

  uint32_t lower, upper;
  assert(napi_get_value_uint32(env, info[1], &lower) == napi_ok);
  assert(napi_get_value_uint32(env, info[2], &upper) == napi_ok);

  napi_type_tag tag = {.lower = lower, .upper = upper};

  napi_status status = napi_type_tag_object(env, object, &tag);
  bool pending;
  assert(napi_is_exception_pending(env, &pending) == napi_ok);
  if (pending) {
    napi_value ignore_exception;
    assert(napi_get_and_clear_last_exception(env, &ignore_exception) ==
           napi_ok);
    (void)ignore_exception;
  }

  return Napi::Boolean::New(env, status == napi_ok);
}

static napi_value bigint_to_i64(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  // start at 1 is intentional, since argument 0 is the callback to run GC
  // passed to every function
  // perform test on all arguments
  for (size_t i = 1; i < info.Length(); i++) {
    napi_value bigint = info[i];

    napi_valuetype type;
    NODE_API_CALL(env, napi_typeof(env, bigint, &type));

    int64_t result = 0;
    bool lossless = false;

    if (type != napi_bigint) {
      printf("napi_get_value_bigint_int64 return for non-bigint: %d\n",
             napi_get_value_bigint_int64(env, bigint, &result, &lossless));
    } else {
      NODE_API_CALL(
          env, napi_get_value_bigint_int64(env, bigint, &result, &lossless));
      printf("napi_get_value_bigint_int64 result: %" PRId64 "\n", result);
      printf("lossless: %s\n", lossless ? "true" : "false");
    }
  }

  return ok(env);
}

static napi_value bigint_to_u64(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  // start at 1 is intentional, since argument 0 is the callback to run GC
  // passed to every function
  // perform test on all arguments
  for (size_t i = 1; i < info.Length(); i++) {
    napi_value bigint = info[i];

    napi_valuetype type;
    NODE_API_CALL(env, napi_typeof(env, bigint, &type));

    uint64_t result;
    bool lossless;

    if (type != napi_bigint) {
      printf("napi_get_value_bigint_uint64 return for non-bigint: %d\n",
             napi_get_value_bigint_uint64(env, bigint, &result, &lossless));
    } else {
      NODE_API_CALL(
          env, napi_get_value_bigint_uint64(env, bigint, &result, &lossless));
      printf("napi_get_value_bigint_uint64 result: %" PRIu64 "\n", result);
      printf("lossless: %s\n", lossless ? "true" : "false");
    }
  }

  return ok(env);
}

static napi_value bigint_to_64_null(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value bigint;
  NODE_API_CALL(env, napi_create_bigint_int64(env, 5, &bigint));

  int64_t result_signed;
  uint64_t result_unsigned;
  bool lossless;

  printf("status (int64, null result) = %d\n",
         napi_get_value_bigint_int64(env, bigint, nullptr, &lossless));
  printf("status (int64, null lossless) = %d\n",
         napi_get_value_bigint_int64(env, bigint, &result_signed, nullptr));
  printf("status (uint64, null result) = %d\n",
         napi_get_value_bigint_uint64(env, bigint, nullptr, &lossless));
  printf("status (uint64, null lossless) = %d\n",
         napi_get_value_bigint_uint64(env, bigint, &result_unsigned, nullptr));

  return ok(env);
}

static napi_value create_weird_bigints(const Napi::CallbackInfo &info) {
  // create bigints by passing weird parameters to napi_create_bigint_words
  napi_env env = info.Env();

  std::array<napi_value, 5> bigints;
  std::array<uint64_t, 4> words{{123, 0, 0, 0}};

  NODE_API_CALL(env, napi_create_bigint_int64(env, 0, &bigints[0]));
  NODE_API_CALL(env, napi_create_bigint_uint64(env, 0, &bigints[1]));
  // sign is not 0 or 1 (should be interpreted as negative)
  NODE_API_CALL(env,
                napi_create_bigint_words(env, 2, 1, words.data(), &bigints[2]));
  // leading zeroes in word representation
  NODE_API_CALL(env,
                napi_create_bigint_words(env, 0, 4, words.data(), &bigints[3]));
  // zero
  NODE_API_CALL(env,
                napi_create_bigint_words(env, 1, 0, words.data(), &bigints[4]));

  napi_value array;
  NODE_API_CALL(env,
                napi_create_array_with_length(env, bigints.size(), &array));
  for (size_t i = 0; i < bigints.size(); i++) {
    NODE_API_CALL(env, napi_set_element(env, array, (uint32_t)i, bigints[i]));
  }
  return array;
}

// Call Node-API functions in ways that result in different error handling
// (erroneous call, valid call, or valid call while an exception is pending) and
// log information from napi_get_last_error_info
static napi_value test_extended_error_messages(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  const napi_extended_error_info *error;

  // this function is implemented in C++
  // error because the result pointer is null
  printf("erroneous napi_create_double returned code %d\n",
         napi_create_double(env, 1.0, nullptr));
  NODE_API_CALL(env, napi_get_last_error_info(env, &error));
  printf("erroneous napi_create_double info: code = %d, message = %s\n",
         error->error_code, error->error_message);

  // this function should succeed and the success should overwrite the error
  // from the last call
  napi_value js_number;
  printf("successful napi_create_double returned code %d\n",
         napi_create_double(env, 5.0, &js_number));
  NODE_API_CALL(env, napi_get_last_error_info(env, &error));
  printf("successful napi_create_double info: code = %d, message = %s\n",
         error->error_code,
         error->error_message ? error->error_message : "(null)");

  // this function is implemented in zig
  // error because the value is not an array
  unsigned int len;
  printf("erroneous napi_get_array_length returned code %d\n",
         napi_get_array_length(env, js_number, &len));
  NODE_API_CALL(env, napi_get_last_error_info(env, &error));
  printf("erroneous napi_get_array_length info: code = %d, message = %s\n",
         error->error_code, error->error_message);

  // throw an exception
  NODE_API_CALL(env, napi_throw_type_error(env, nullptr, "oops!"));
  // nothing is wrong with this call by itself, but it should return
  // napi_pending_exception without doing anything because an exception is
  // pending
  napi_value coerced_string;
  printf("napi_coerce_to_string with pending exception returned code %d\n",
         napi_coerce_to_string(env, js_number, &coerced_string));
  NODE_API_CALL(env, napi_get_last_error_info(env, &error));
  printf(
      "napi_coerce_to_string with pending exception info: code = %d, message = "
      "%s\n",
      error->error_code, error->error_message);

  // clear the exception
  napi_value exception;
  NODE_API_CALL(env, napi_get_and_clear_last_exception(env, &exception));

  return ok(env);
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
  exports.Set("call_and_get_exception",
              Napi::Function::New(env, call_and_get_exception));
  exports.Set("eval_wrapper", Napi::Function::New(env, eval_wrapper));
  exports.Set("perform_get", Napi::Function::New(env, perform_get));
  exports.Set("double_to_i32", Napi::Function::New(env, double_to_i32));
  exports.Set("double_to_u32", Napi::Function::New(env, double_to_u32));
  exports.Set("double_to_i64", Napi::Function::New(env, double_to_i64));
  exports.Set("test_number_integer_conversions",
              Napi::Function::New(env, test_number_integer_conversions));
  exports.Set("make_empty_array", Napi::Function::New(env, make_empty_array));
  exports.Set("throw_error", Napi::Function::New(env, throw_error));
  exports.Set("create_and_throw_error",
              Napi::Function::New(env, create_and_throw_error));
  exports.Set("add_tag", Napi::Function::New(env, add_tag));
  exports.Set("try_add_tag", Napi::Function::New(env, try_add_tag));
  exports.Set("check_tag", Napi::Function::New(env, check_tag));
  exports.Set("bigint_to_i64", Napi::Function::New(env, bigint_to_i64));
  exports.Set("bigint_to_u64", Napi::Function::New(env, bigint_to_u64));
  exports.Set("bigint_to_64_null", Napi::Function::New(env, bigint_to_64_null));
  exports.Set("create_weird_bigints",
              Napi::Function::New(env, create_weird_bigints));
  exports.Set("test_extended_error_messages",
              Napi::Function::New(env, test_extended_error_messages));

  napitests::register_wrap_tests(env, exports);

  return exports;
}

NODE_API_MODULE(napitests, InitAll)

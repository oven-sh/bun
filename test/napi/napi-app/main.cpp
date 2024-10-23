#include <node.h>

#include <napi.h>

#include <array>
#include <cassert>
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

// e.g NODE_API_CALL(env, napi_create_int32(env, 5, &my_napi_integer))
#define NODE_API_CALL(env, call) NODE_API_CALL_CUSTOM_RETURN(env, NULL, call)

// Version of NODE_API_CALL for functions not returning napi_value
#define NODE_API_CALL_CUSTOM_RETURN(env, value_to_return_if_threw, call)       \
  do {                                                                         \
    napi_status status = (call);                                               \
    if (status != napi_ok) {                                                   \
      const napi_extended_error_info *error_info = NULL;                       \
      napi_get_last_error_info((env), &error_info);                            \
      const char *err_message = error_info->error_message;                     \
      bool is_pending;                                                         \
      napi_is_exception_pending((env), &is_pending);                           \
      /* If an exception is already pending, don't rethrow it */               \
      if (!is_pending) {                                                       \
        char buf[4096] = {0};                                                  \
        snprintf(buf, sizeof(buf) - 1, "%s (%s:%d): Call %s failed: %s",       \
                 __PRETTY_FUNCTION__, __FILE__, __LINE__, #call,               \
                 (err_message == NULL) ? "empty error message" : err_message); \
        napi_throw_error((env), NULL, buf);                                    \
      }                                                                        \
      return (value_to_return_if_threw);                                       \
    }                                                                          \
  } while (0)

// Throw an error in the given napi_env and return if expr is false
#define NODE_API_ASSERT(env, expr)                                             \
  NODE_API_ASSERT_CUSTOM_RETURN(env, NULL, expr)

#define STRINGIFY(x) #x

// Version of NODE_API_ASSERT for functions not returning napi_value
#define NODE_API_ASSERT_CUSTOM_RETURN(env, value_to_return_if_threw, expr)     \
  do {                                                                         \
    if (!(expr)) {                                                             \
      bool is_pending;                                                         \
      napi_is_exception_pending((env), &is_pending);                           \
      /* If an exception is already pending, don't rethrow it */               \
      if (!is_pending) {                                                       \
        char buf[4096] = {0};                                                  \
        snprintf(buf, sizeof(buf) - 1, "%s (%s:%d): Assertion failed: %s",     \
                 __PRETTY_FUNCTION__, __FILE__, __LINE__, #expr);              \
        napi_throw_error((env), NULL, buf);                                    \
      }                                                                        \
      return (value_to_return_if_threw);                                       \
    }                                                                          \
  } while (0)

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

// calls napi_typeof and asserts it returns napi_ok
static napi_valuetype get_typeof(napi_env env, napi_value value) {
  napi_valuetype result;
  // return an invalid napi_valuetype if the call to napi_typeof fails
  NODE_API_CALL_CUSTOM_RETURN(env, static_cast<napi_valuetype>(INT_MAX),
                              napi_typeof(env, value, &result));
  return result;
}

static const char *napi_valuetype_to_string(napi_valuetype type) {
  switch (type) {
  case napi_undefined:
    return "undefined";
  case napi_null:
    return "null";
  case napi_boolean:
    return "boolean";
  case napi_number:
    return "number";
  case napi_string:
    return "string";
  case napi_symbol:
    return "symbol";
  case napi_object:
    return "object";
  case napi_function:
    return "function";
  case napi_external:
    return "external";
  case napi_bigint:
    return "bigint";
  default:
    return "unknown";
  }
}

napi_value test_issue_7685(const Napi::CallbackInfo &info) {
  Napi::Env env(info.Env());
  Napi::HandleScope scope(env);
  // info[0] is a function to run the GC
  NODE_API_ASSERT(env, info[1].IsNumber());
  NODE_API_ASSERT(env, info[2].IsNumber());
  NODE_API_ASSERT(env, info[3].IsNumber());
  NODE_API_ASSERT(env, info[4].IsNumber());
  NODE_API_ASSERT(env, info[5].IsNumber());
  NODE_API_ASSERT(env, info[6].IsNumber());
  NODE_API_ASSERT(env, info[7].IsNumber());
  NODE_API_ASSERT(env, info[8].IsNumber());
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
  NODE_API_CALL(env, napi_create_string_utf8(env, "TSFN", 4, &tsfn_name_11949));
  NODE_API_CALL(env, napi_create_threadsafe_function(
                         env, NULL, NULL, tsfn_name_11949, 0, 1, NULL, NULL,
                         NULL, &test_issue_11949_callback, &tsfn_11949));
  NODE_API_CALL(env, napi_call_threadsafe_function(tsfn_11949, NULL,
                                                   napi_tsfn_nonblocking));
  napi_value result;
  NODE_API_CALL(env, napi_get_undefined(env, &result));
  return result;
}

static void callback_1(napi_env env, napi_value js_callback, void *context,
                       void *data) {}

napi_value test_napi_threadsafe_function_does_not_hang_after_finalize(
    const Napi::CallbackInfo &info) {

  Napi::Env env = info.Env();

  napi_value resource_name;
  NODE_API_CALL(env, napi_create_string_utf8(env, "simple", 6, &resource_name));

  napi_threadsafe_function cb;
  NODE_API_CALL(env, napi_create_threadsafe_function(
                         env, nullptr, nullptr, resource_name, 0, 1, nullptr,
                         nullptr, nullptr, &callback_1, &cb));

  NODE_API_CALL(env, napi_release_threadsafe_function(cb, napi_tsfn_release));

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
  NODE_API_CALL(env, napi_get_value_uint32(env, chars_to_copy_js, &_len));
  size_t len = (size_t)_len;

  if (len == 424242) {
    len = NAPI_AUTO_LENGTH;
  } else {
    NODE_API_ASSERT(env, "len <= 29");
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
    NODE_API_CALL(env,
                  napi_create_string_utf8(env, cpp_str.c_str(), cpp_str.size(),
                                          &small_strings[i]));
  }

  run_gc(info);

  for (size_t j = 0; j < num_small_strings; j++) {
    char buf[16];
    size_t result;
    NODE_API_CALL(env, napi_get_value_string_utf8(env, small_strings[j], buf,
                                                  sizeof buf, &result));
    printf("%s\n", buf);
    NODE_API_ASSERT(env, atoi(buf) == (int)j);
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
    NODE_API_CALL(env, napi_create_bigint_words(env, 0, small_int_size,
                                                words.data(), &small_ints[i]));
  }

  run_gc(info);

  for (size_t j = 0; j < num_small_ints; j++) {
    std::array<uint64_t, small_int_size> words;
    int sign;
    size_t word_count = words.size();
    NODE_API_CALL(env, napi_get_value_bigint_words(env, small_ints[j], &sign,
                                                   &word_count, words.data()));
    printf("%d, %zu\n", sign, word_count);
    NODE_API_ASSERT(env, sign == 0 && word_count == words.size());
    NODE_API_ASSERT(env,
                    std::all_of(words.begin(), words.end(),
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
  NODE_API_ASSERT(env, type == napi_object);

  napi_value key;
  NODE_API_CALL(env, napi_create_string_utf8(env, "foo", 3, &key));

  napi_value non_configurable_key;
  NODE_API_CALL(env,
                napi_create_string_utf8(env, "bar", 3, &non_configurable_key));

  napi_value val;
  NODE_API_CALL(env, napi_create_int32(env, 42, &val));

  bool delete_result;
  NODE_API_CALL(env, napi_delete_property(env, object, non_configurable_key,
                                          &delete_result));
  NODE_API_ASSERT(env, delete_result == false);

  NODE_API_CALL(env, napi_delete_property(env, object, key, &delete_result));
  NODE_API_ASSERT(env, delete_result == true);

  bool has_property;
  NODE_API_CALL(env, napi_has_property(env, object, key, &has_property));
  NODE_API_ASSERT(env, has_property == false);

  return ok(env);
}

// Returns false if any napi function failed
bool store_escaped_handle(napi_env env, napi_value *out, const char *str) {
  // Allocate these values on the heap so they cannot be seen by stack scanning
  // after this function returns. An earlier version tried putting them on the
  // stack and using volatile stores to set them to nullptr, but that wasn't
  // effective when the NAPI module was built in release mode as extra copies of
  // the pointers would still be left in uninitialized stack memory.
  napi_escapable_handle_scope *ehs = new napi_escapable_handle_scope;
  napi_value *s = new napi_value;
  napi_value *escaped = new napi_value;
  NODE_API_CALL_CUSTOM_RETURN(env, false,
                              napi_open_escapable_handle_scope(env, ehs));
  NODE_API_CALL_CUSTOM_RETURN(
      env, false, napi_create_string_utf8(env, str, NAPI_AUTO_LENGTH, s));
  NODE_API_CALL_CUSTOM_RETURN(env, false,
                              napi_escape_handle(env, *ehs, *s, escaped));
  // can't call a second time
  NODE_API_ASSERT_CUSTOM_RETURN(env, false,
                                napi_escape_handle(env, *ehs, *s, escaped) ==
                                    napi_escape_called_twice);
  NODE_API_CALL_CUSTOM_RETURN(env, false,
                              napi_close_escapable_handle_scope(env, *ehs));
  *out = *escaped;

  delete escaped;
  delete s;
  delete ehs;
  return true;
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
  NODE_API_ASSERT(env, store_escaped_handle(env, hidden, str));

  run_gc(info);

  char buf[64];
  size_t len;
  NODE_API_CALL(
      env, napi_get_value_string_utf8(env, *hidden, buf, sizeof(buf), &len));
  NODE_API_ASSERT(env, len == strlen(str));
  NODE_API_ASSERT(env, strcmp(buf, str) == 0);

  delete hidden;
  return ok(env);
}

napi_value test_napi_handle_scope_nesting(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  constexpr const char *str = "this is a long string meow meow meow";

  // Create an outer handle scope, hidden on the heap (the one created in
  // NAPIFunction::call is still on the stack
  napi_handle_scope *outer_hs = new napi_handle_scope;
  NODE_API_CALL(env, napi_open_handle_scope(env, outer_hs));

  // Make a handle in the outer scope, on the heap so stack scanning can't see
  // it
  napi_value *outer_scope_handle = new napi_value;
  NODE_API_CALL(env, napi_create_string_utf8(env, str, NAPI_AUTO_LENGTH,
                                             outer_scope_handle));

  // Make a new handle scope on the heap
  napi_handle_scope *inner_hs = new napi_handle_scope;
  NODE_API_CALL(env, napi_open_handle_scope(env, inner_hs));

  // Force GC
  run_gc(info);

  // Try to read our first handle. Did the outer handle scope get
  // collected now that it's not on the global object?
  char buf[64];
  size_t len;
  NODE_API_CALL(env, napi_get_value_string_utf8(env, *outer_scope_handle, buf,
                                                sizeof(buf), &len));
  NODE_API_ASSERT(env, len == strlen(str));
  NODE_API_ASSERT(env, strcmp(buf, str) == 0);

  // Clean up
  NODE_API_CALL(env, napi_close_handle_scope(env, *inner_hs));
  delete inner_hs;
  NODE_API_CALL(env, napi_close_handle_scope(env, *outer_hs));
  delete outer_hs;
  delete outer_scope_handle;
  return ok(env);
}

// call this with a bunch (>10) of string arguments representing increasing
// decimal numbers. ensures that the runtime does not let these arguments be
// freed.
//
// test_napi_handle_scope_many_args(() => gc(), '1', '2', '3', ...)
napi_value test_napi_handle_scope_many_args(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  run_gc(info);
  // now if bun is broken a bunch of our args are dead
  for (size_t i = 1; i < info.Length(); i++) {
    Napi::String s = info[i].As<Napi::String>();
    NODE_API_ASSERT(env, s.Utf8Value() == std::to_string(i));
  }
  return env.Undefined();
}

napi_value constructor(napi_env env, napi_callback_info info) {
  napi_value this_value;
  void *data;
  NODE_API_CALL(
      env, napi_get_cb_info(env, info, nullptr, nullptr, &this_value, &data));

  printf("in constructor, data = \"%s\"\n",
         reinterpret_cast<const char *>(data));

  napi_value new_target;
  NODE_API_CALL(env, napi_get_new_target(env, info, &new_target));
  printf("typeof new.target = %s\n",
         new_target ? napi_valuetype_to_string(get_typeof(env, new_target))
                    : "[nullptr]");

  printf("typeof this = %s\n",
         napi_valuetype_to_string(get_typeof(env, this_value)));

  napi_value global;
  NODE_API_CALL(env, napi_get_global(env, &global));
  bool equal;
  NODE_API_CALL(env, napi_strict_equals(env, this_value, global, &equal));
  printf("this == global = %s\n", equal ? "true" : "false");

  napi_value property_value;
  NODE_API_CALL(env, napi_create_string_utf8(env, "meow", NAPI_AUTO_LENGTH,
                                             &property_value));
  napi_set_named_property(env, this_value, "foo", property_value);

  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

napi_value getData_callback(napi_env env, napi_callback_info info) {
  void *data;

  NODE_API_CALL(env,
                napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data));
  const char *str_data = reinterpret_cast<const char *>(data);

  napi_value ret;
  NODE_API_CALL(env,
                napi_create_string_utf8(env, str_data, NAPI_AUTO_LENGTH, &ret));
  return ret;
}

napi_value get_class_with_constructor(const Napi::CallbackInfo &info) {
  static char constructor_data[] = "constructor data";
  static char method_data[] = "method data";
  static char wrap_data[] = "wrap data";

  napi_env env = info.Env();
  napi_value napi_class;

  const napi_property_descriptor properties[] = {{
      .utf8name = "getData",
      .name = nullptr,
      .method = getData_callback,
      .getter = nullptr,
      .setter = nullptr,
      .value = nullptr,
      .attributes = napi_default_method,
      .data = reinterpret_cast<void *>(method_data),
  }};

  NODE_API_CALL(
      env, napi_define_class(env, "NapiClass", NAPI_AUTO_LENGTH, constructor,
                             reinterpret_cast<void *>(constructor_data), 1,
                             properties, &napi_class));
  NODE_API_CALL(env,
                napi_wrap(env, napi_class, reinterpret_cast<void *>(wrap_data),
                          nullptr, nullptr, nullptr));
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
    NODE_API_ASSERT_CUSTOM_RETURN(env, void(), status == napi_ok);

    if (async_work_data->do_throw) {
      // still have to resolve/reject otherwise the process times out
      // we should not see the resolution as our unhandled exception handler
      // exits the process before that can happen
      napi_value result;
      NODE_API_CALL_CUSTOM_RETURN(env, void(),
                                  napi_get_undefined(env, &result));
      NODE_API_CALL_CUSTOM_RETURN(
          env, void(),
          napi_resolve_deferred(env, async_work_data->deferred, result));

      napi_value err;
      napi_value msg;
      NODE_API_CALL_CUSTOM_RETURN(
          env, void(),
          napi_create_string_utf8(env, "error from napi", NAPI_AUTO_LENGTH,
                                  &msg));
      NODE_API_CALL_CUSTOM_RETURN(env, void(),
                                  napi_create_error(env, nullptr, msg, &err));
      NODE_API_CALL_CUSTOM_RETURN(env, void(), napi_throw(env, err));
    } else {
      napi_value result;
      char buf[64] = {0};
      snprintf(buf, sizeof(buf), "the number is %d", async_work_data->result);
      NODE_API_CALL_CUSTOM_RETURN(
          env, void(),
          napi_create_string_utf8(env, buf, NAPI_AUTO_LENGTH, &result));
      NODE_API_CALL_CUSTOM_RETURN(
          env, void(),
          napi_resolve_deferred(env, async_work_data->deferred, result));
    }

    NODE_API_CALL_CUSTOM_RETURN(
        env, void(), napi_delete_async_work(env, async_work_data->work));
    delete async_work_data;
  }
};

// create_promise(void *unused_run_gc_callback, bool do_throw): makes a promise
// using napi_Async_work that either resolves or throws in the complete callback
napi_value create_promise(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  auto *data = new AsyncWorkData();
  // info[0] is a callback to run the GC
  NODE_API_CALL(env, napi_get_value_bool(env, info[1], &data->do_throw));

  napi_value promise;

  NODE_API_CALL(env, napi_create_promise(env, &data->deferred, &promise));

  napi_value resource_name;
  NODE_API_CALL(env, napi_create_string_utf8(env, "napitests::create_promise",
                                             NAPI_AUTO_LENGTH, &resource_name));
  NODE_API_CALL(env, napi_create_async_work(
                         env, nullptr, resource_name, AsyncWorkData::execute,
                         AsyncWorkData::complete, data, &data->work));

  NODE_API_CALL(env, napi_queue_async_work(env, data->work));
  return promise;
}

class EchoWorker : public Napi::AsyncWorker {
public:
  EchoWorker(Napi::Env env, Napi::Promise::Deferred deferred,
             const std::string &&echo)
      : Napi::AsyncWorker(env), m_echo(echo), m_deferred(deferred) {}
  ~EchoWorker() override {}

  void Execute() override {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }

  void OnOK() override { m_deferred.Resolve(Napi::String::New(Env(), m_echo)); }

private:
  std::string m_echo;
  Napi::Promise::Deferred m_deferred;
};

Napi::Value create_promise_with_napi_cpp(const Napi::CallbackInfo &info) {
  auto deferred = Napi::Promise::Deferred::New(info.Env());
  auto *work = new EchoWorker(info.Env(), deferred, "hello world");
  work->Queue();
  return deferred.Promise();
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
    NODE_API_CALL_CUSTOM_RETURN(env, void(), napi_get_undefined(env, &recv));

    // call our JS function with undefined for this and no arguments
    napi_value js_result;
    napi_status call_result =
        napi_call_function(env, recv, js_callback, 0, nullptr, &js_result);
    NODE_API_ASSERT_CUSTOM_RETURN(env, void(),
                                  call_result == napi_ok ||
                                      call_result == napi_pending_exception);

    if (call_result == napi_ok) {
      // only resolve if js_callback did not return an error
      // resolve the promise with the return value of the JS function
      NODE_API_CALL_CUSTOM_RETURN(
          env, void(),
          napi_resolve_deferred(env, tsfn_data->deferred, js_result));
    }

    // clean up the threadsafe function
    NODE_API_CALL_CUSTOM_RETURN(
        env, void(),
        napi_release_threadsafe_function(tsfn_data->tsfn, napi_tsfn_abort));
  }
};

napi_value
create_promise_with_threadsafe_function(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  ThreadsafeFunctionData *tsfn_data = new ThreadsafeFunctionData;

  napi_value async_resource_name;
  NODE_API_CALL(env,
                napi_create_string_utf8(
                    env, "napitests::create_promise_with_threadsafe_function",
                    NAPI_AUTO_LENGTH, &async_resource_name));

  // this is called directly, without the GC callback, so argument 0 is a JS
  // callback used to resolve the promise
  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, info[0], nullptr, async_resource_name,
                    // max_queue_size, initial_thread_count
                    1, 1,
                    // thread_finalize_data, thread_finalize_cb
                    tsfn_data, ThreadsafeFunctionData::tsfn_finalize_callback,
                    // context
                    tsfn_data, ThreadsafeFunctionData::tsfn_callback,
                    &tsfn_data->tsfn));
  // create a promise we can return to JS and put the deferred counterpart in
  // tsfn_data
  napi_value promise;
  NODE_API_CALL(env, napi_create_promise(env, &tsfn_data->deferred, &promise));

  // spawn and release std::thread
  std::thread secondary_thread(ThreadsafeFunctionData::thread_entry, tsfn_data);
  secondary_thread.detach();
  // return the promise to javascript
  return promise;
}

napi_value test_napi_ref(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value object;
  NODE_API_CALL(env, napi_create_object(env, &object));

  napi_ref ref;
  NODE_API_CALL(env, napi_create_reference(env, object, 0, &ref));

  napi_value from_ref;
  NODE_API_CALL(env, napi_get_reference_value(env, ref, &from_ref));
  NODE_API_ASSERT(env, from_ref != nullptr);
  napi_valuetype typeof_result = get_typeof(env, from_ref);
  NODE_API_ASSERT(env, typeof_result == napi_object);
  return ok(env);
}

static bool finalize_called = false;

void finalize_cb(napi_env env, void *finalize_data, void *finalize_hint) {
  // only do this in bun
  bool &create_handle_scope = *reinterpret_cast<bool *>(finalize_hint);
  if (create_handle_scope) {
    napi_handle_scope hs;
    NODE_API_CALL_CUSTOM_RETURN(env, void(), napi_open_handle_scope(env, &hs));
    NODE_API_CALL_CUSTOM_RETURN(env, void(), napi_close_handle_scope(env, hs));
  }
  delete &create_handle_scope;
  finalize_called = true;
}

napi_value create_ref_with_finalizer(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value create_handle_scope_in_finalizer = info[0];

  napi_value object;
  NODE_API_CALL(env, napi_create_object(env, &object));

  bool *finalize_hint = new bool;
  NODE_API_CALL(env, napi_get_value_bool(env, create_handle_scope_in_finalizer,
                                         finalize_hint));

  napi_ref ref;

  NODE_API_CALL(env, napi_wrap(env, object, nullptr, finalize_cb,
                               reinterpret_cast<bool *>(finalize_hint), &ref));

  return ok(env);
}

napi_value was_finalize_called(const Napi::CallbackInfo &info) {
  napi_value ret;
  NODE_API_CALL(info.Env(),
                napi_get_boolean(info.Env(), finalize_called, &ret));
  return ret;
}

// calls a function (the sole argument) which must throw. catches and returns
// the thrown error
napi_value call_and_get_exception(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value fn = info[0];
  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));

  NODE_API_ASSERT(env, napi_call_function(env, undefined, fn, 0, nullptr,
                                          nullptr) == napi_pending_exception);

  bool is_pending;
  NODE_API_CALL(env, napi_is_exception_pending(env, &is_pending));
  NODE_API_ASSERT(env, is_pending);

  napi_value exception;
  NODE_API_CALL(env, napi_get_and_clear_last_exception(env, &exception));

  napi_valuetype type = get_typeof(env, exception);
  printf("typeof thrown exception = %s\n", napi_valuetype_to_string(type));

  NODE_API_CALL(env, napi_is_exception_pending(env, &is_pending));
  NODE_API_ASSERT(env, !is_pending);

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
    NODE_API_CALL(env, napi_get_value_string_utf8(env, js_code, code_buf,
                                                  sizeof code_buf, nullptr));
    code = code_buf;
  }
  if (get_typeof(env, js_msg) == napi_string) {
    NODE_API_CALL(env, napi_get_value_string_utf8(env, js_msg, msg_buf,
                                                  sizeof msg_buf, nullptr));
    msg = msg_buf;
  }
  NODE_API_CALL(env,
                napi_get_value_string_utf8(env, js_error_kind, error_kind_buf,
                                           sizeof error_kind_buf, nullptr));

  std::map<std::string,
           napi_status (*)(napi_env, const char *code, const char *msg)>
      functions{{"error", napi_throw_error},
                {"type_error", napi_throw_type_error},
                {"range_error", napi_throw_range_error},
                {"syntax_error", node_api_throw_syntax_error}};

  auto throw_function = functions[error_kind_buf];

  if (msg == nullptr) {
    NODE_API_ASSERT(env, throw_function(env, code, msg) == napi_invalid_arg);
    return ok(env);
  } else {
    NODE_API_ASSERT(env, throw_function(env, code, msg) == napi_ok);
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

  NODE_API_CALL(env,
                napi_get_value_string_utf8(env, js_error_kind, error_kind_buf,
                                           sizeof error_kind_buf, nullptr));

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
    NODE_API_ASSERT(env, create_status == napi_string_expected ||
                             create_status == napi_invalid_arg);
    return ok(env);
  } else {
    NODE_API_ASSERT(env, create_status == napi_ok);
    NODE_API_CALL(env, napi_throw(env, err));
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
    NODE_API_CALL(env,
                  napi_get_value_string_utf8(env, key, buf, 1024, nullptr));
    status = napi_get_named_property(env, obj, buf, &value);
    if (status == napi_ok) {
      NODE_API_ASSERT(env, value != nullptr);
      printf("value type = %d\n", get_typeof(env, value));
    } else {
      NODE_API_ASSERT(env, status == napi_pending_exception);
      return ok(env);
    }
  }

  status = napi_get_property(env, obj, key, &value);
  NODE_API_ASSERT(env, status == napi_pending_exception);
  if (status == napi_ok) {
    NODE_API_ASSERT(env, value != nullptr);
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
    NODE_API_CALL(env, napi_create_int32(env, integer, &result));
  } else {
    NODE_API_ASSERT(env, status == napi_number_expected);
    NODE_API_CALL(env, napi_get_undefined(env, &result));
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
    NODE_API_CALL(env, napi_create_uint32(env, integer, &result));
  } else {
    NODE_API_ASSERT(env, status == napi_number_expected);
    NODE_API_CALL(env, napi_get_undefined(env, &result));
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
    NODE_API_CALL(env, napi_create_int64(env, integer, &result));
  } else {
    NODE_API_ASSERT(env, status == napi_number_expected);
    NODE_API_CALL(env, napi_get_undefined(env, &result));
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
    NODE_API_CALL(env, napi_create_double(env, in, &js_in));
    int32_t out_from_napi;
    NODE_API_CALL(env, napi_get_value_int32(env, js_in, &out_from_napi));
    NODE_API_ASSERT(env, out_from_napi == expected_out);
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
    NODE_API_CALL(env, napi_create_double(env, in, &js_in));
    uint32_t out_from_napi;
    NODE_API_CALL(env, napi_get_value_uint32(env, js_in, &out_from_napi));
    NODE_API_ASSERT(env, out_from_napi == expected_out);
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
    NODE_API_CALL(env, napi_create_double(env, in, &js_in));
    int64_t out_from_napi;
    NODE_API_CALL(env, napi_get_value_int64(env, js_in, &out_from_napi));
    NODE_API_ASSERT(env, out_from_napi == expected_out);
  }

  return ok(env);
}

napi_value make_empty_array(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value js_size = info[0];
  uint32_t size;
  NODE_API_CALL(env, napi_get_value_uint32(env, js_size, &size));
  napi_value array;
  NODE_API_CALL(env, napi_create_array_with_length(env, size, &array));
  return array;
}

static napi_ref ref_to_wrapped_object = nullptr;

void delete_the_ref(napi_env env, void *_data, void *_hint) {
  printf("delete_the_ref\n");
  // not using NODE_API_ASSERT as this runs in a finalizer where allocating an
  // error might cause a harder-to-debug crash
  assert(ref_to_wrapped_object);
  napi_delete_reference(env, ref_to_wrapped_object);
  ref_to_wrapped_object = nullptr;
}

void finalize_for_create_wrap(napi_env env, void *opaque_data,
                              void *opaque_hint) {
  int *data = reinterpret_cast<int *>(opaque_data);
  int *hint = reinterpret_cast<int *>(opaque_hint);
  printf("finalize_for_create_wrap, data = %d, hint = %d\n", *data, *hint);
  delete data;
  delete hint;
  if (ref_to_wrapped_object) {
    // TODO(@190n) implement this api in bun
    // node_api_post_finalizer(env, delete_the_ref, nullptr, nullptr);
  }
}

// create_wrap(js_object: object, ask_for_ref: boolean, strong: boolean): object
napi_value create_wrap(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value js_object = info[0];

  napi_value js_ask_for_ref = info[1];
  bool ask_for_ref;
  NODE_API_CALL(env, napi_get_value_bool(env, js_ask_for_ref, &ask_for_ref));
  napi_value js_strong = info[2];
  bool strong;
  NODE_API_CALL(env, napi_get_value_bool(env, js_strong, &strong));

  // wrap it
  int *wrap_data = new int(42);
  int *wrap_hint = new int(123);

  NODE_API_CALL(env, napi_wrap(env, js_object, wrap_data,
                               finalize_for_create_wrap, wrap_hint,
                               ask_for_ref ? &ref_to_wrapped_object : nullptr));
  if (ask_for_ref && strong) {
    uint32_t new_refcount;
    NODE_API_CALL(
        env, napi_reference_ref(env, ref_to_wrapped_object, &new_refcount));
    NODE_API_ASSERT(env, new_refcount == 1);
  }

  if (!ask_for_ref) {
    ref_to_wrapped_object = nullptr;
  }

  return js_object;
}

// get_wrap_data(js_object: object): number
napi_value get_wrap_data(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value js_object = info[0];

  void *wrapped_data;
  NODE_API_CALL(env, napi_unwrap(env, js_object, &wrapped_data));

  napi_value js_number;
  NODE_API_CALL(env,
                napi_create_int32(env, *reinterpret_cast<int *>(wrapped_data),
                                  &js_number));
  return js_number;
}

// get_object_from_ref(): object
napi_value get_object_from_ref(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value wrapped_object;
  NODE_API_CALL(env, napi_get_reference_value(env, ref_to_wrapped_object,
                                              &wrapped_object));

  return wrapped_object;
}

// get_wrap_data_from_ref(): number|undefined
napi_value get_wrap_data_from_ref(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value wrapped_object;
  NODE_API_CALL(env, napi_get_reference_value(env, ref_to_wrapped_object,
                                              &wrapped_object));

  void *wrapped_data;
  napi_status status = napi_unwrap(env, wrapped_object, &wrapped_data);
  if (status == napi_ok) {
    napi_value js_number;
    NODE_API_CALL(env,
                  napi_create_int32(env, *reinterpret_cast<int *>(wrapped_data),
                                    &js_number));
    return js_number;
  } else if (status == napi_invalid_arg) {
    // no longer wrapped
    napi_value undefined;
    NODE_API_CALL(env, napi_get_undefined(env, &undefined));
    return undefined;
  } else {
    NODE_API_ASSERT(env, false && "this should not be reached");
    return nullptr;
  }
}

// remove_wrap_data(js_object: object): undefined
napi_value remove_wrap(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value js_object = info[0];

  void *wrap_data;
  NODE_API_CALL(env, napi_remove_wrap(env, js_object, &wrap_data));

  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

// unref_wrapped_value(): undefined
napi_value unref_wrapped_value(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  uint32_t new_refcount;
  NODE_API_CALL(
      env, napi_reference_unref(env, ref_to_wrapped_object, &new_refcount));
  // should never have been set higher than 1
  NODE_API_ASSERT(env, new_refcount == 0);

  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
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
  exports.Set("create_wrap", Napi::Function::New(env, create_wrap));
  exports.Set("unref_wrapped_value",
              Napi::Function::New(env, unref_wrapped_value));
  exports.Set("get_wrap_data", Napi::Function::New(env, get_wrap_data));
  exports.Set("remove_wrap", Napi::Function::New(env, remove_wrap));
  exports.Set("get_wrap_data_from_ref",
              Napi::Function::New(env, get_wrap_data_from_ref));
  exports.Set("get_object_from_ref",
              Napi::Function::New(env, get_object_from_ref));
  exports.Set("create_promise_with_napi_cpp",
              Napi::Function::New(env, create_promise_with_napi_cpp));
  exports.Set("test_napi_handle_scope_many_args",
              Napi::Function::New(env, test_napi_handle_scope_many_args));

  return exports;
}

NODE_API_MODULE(napitests, InitAll)

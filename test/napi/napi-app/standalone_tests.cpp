#include "standalone_tests.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cinttypes>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

#include "utils.h"

namespace napitests {

// https://github.com/oven-sh/bun/issues/7685
static napi_value test_issue_7685(const Napi::CallbackInfo &info) {
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

static napi_threadsafe_function tsfn_11949 = nullptr;

static void test_issue_11949_callback(napi_env env, napi_value js_callback,
                                      void *opaque_context, void *opaque_data) {
  int *context = reinterpret_cast<int *>(opaque_context);
  int *data = reinterpret_cast<int *>(opaque_data);
  printf("data = %d, context = %d\n", *data, *context);
  delete context;
  delete data;
  napi_unref_threadsafe_function(env, tsfn_11949);
  tsfn_11949 = nullptr;
}

// https://github.com/oven-sh/bun/issues/11949
static napi_value test_issue_11949(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);
  napi_value name = Napi::String::New(env, "TSFN");

  int *context = new int(42);
  int *data = new int(1234);

  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, /* JavaScript function */ nullptr,
                    /* async resource */ nullptr, name,
                    /* max queue size (unlimited) */ 0,
                    /* initial thread count */ 1, /* finalize data */ nullptr,
                    /* finalize callback */ nullptr, context,
                    &test_issue_11949_callback, &tsfn_11949));
  NODE_API_CALL(env, napi_call_threadsafe_function(tsfn_11949, data,
                                                   napi_tsfn_nonblocking));
  return env.Undefined();
}

static void noop_callback(napi_env env, napi_value js_callback, void *context,
                          void *data) {}

static napi_value test_napi_threadsafe_function_does_not_hang_after_finalize(
    const Napi::CallbackInfo &info) {

  Napi::Env env = info.Env();

  napi_value resource_name = Napi::String::New(env, "simple");

  napi_threadsafe_function cb;
  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, /* JavaScript function */ nullptr,
                    /* async resource */ nullptr, resource_name,
                    /* max queue size (unlimited) */ 0,
                    /* initial thread count */ 1, /* finalize data */ nullptr,
                    /* finalize callback */ nullptr, /* context */ nullptr,
                    &noop_callback, &cb));

  NODE_API_CALL(env, napi_release_threadsafe_function(cb, napi_tsfn_release));
  printf("success!\n");
  return env.Undefined();
}

static napi_threadsafe_function tsfn_abort_release = nullptr;
static bool tsfn_abort_release_finalized = false;

static void tsfn_abort_release_finalize(napi_env env, void *finalize_data,
                                        void *finalize_hint) {
  tsfn_abort_release_finalized = true;
}

// Create a tsfn (thread_count=1), acquire a second reference (thread_count=2),
// optionally queue some items, then abort it (thread_count=1, closing). The
// abort's dispatch runs on the next event-loop turn, sees thread_count!=0, and
// returns without finalizing.
static napi_value test_napi_threadsafe_function_abort_then_last_release(
    const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value resource_name = Napi::String::New(env, "abort_then_last_release");
  int queued = info[0].IsNumber() ? info[0].As<Napi::Number>().Int32Value() : 0;
  tsfn_abort_release_finalized = false;
  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, /* JavaScript function */ nullptr,
                    /* async resource */ nullptr, resource_name,
                    /* max queue size (unlimited) */ 0,
                    /* initial thread count */ 1, /* finalize data */ nullptr,
                    tsfn_abort_release_finalize, /* context */ nullptr,
                    &noop_callback, &tsfn_abort_release));
  NODE_API_CALL(env, napi_acquire_threadsafe_function(tsfn_abort_release));
  for (int i = 0; i < queued; i++) {
    NODE_API_CALL(env, napi_call_threadsafe_function(
                           tsfn_abort_release, nullptr, napi_tsfn_nonblocking));
  }
  NODE_API_CALL(env, napi_release_threadsafe_function(tsfn_abort_release,
                                                      napi_tsfn_abort));
  return env.Undefined();
}

// Releases the last reference of the already-closing tsfn. The finalizer must
// run and the event-loop keepalive must drop so the process exits.
static napi_value test_napi_threadsafe_function_abort_then_last_release_drop(
    const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  NODE_API_CALL(env, napi_release_threadsafe_function(tsfn_abort_release,
                                                      napi_tsfn_release));
  tsfn_abort_release = nullptr;
  return env.Undefined();
}

static napi_value
test_napi_threadsafe_function_abort_then_last_release_finalized(
    const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), tsfn_abort_release_finalized);
}

static napi_threadsafe_function tsfn_abort_blocked = nullptr;
static bool tsfn_abort_blocked_finalized = false;
static std::atomic<int> tsfn_abort_blocked_about_to_call{0};

static void tsfn_abort_blocked_finalize(napi_env env, void *finalize_data,
                                        void *finalize_hint) {
  tsfn_abort_blocked_finalized = true;
}

static void tsfn_abort_blocked_producer() {
  napi_threadsafe_function tsfn = tsfn_abort_blocked;
  tsfn_abort_blocked_about_to_call.fetch_add(1);
  napi_call_threadsafe_function(tsfn, nullptr, napi_tsfn_blocking);
}

// Create a tsfn with max_queue_size=1 and initial_thread_count=3, fill the
// queue, spawn two producers that block in napi_call_threadsafe_function
// (napi_tsfn_blocking), then abort. Both producers must wake, observe
// napi_closing, and the finalizer must run so the process exits.
static napi_value test_napi_threadsafe_function_abort_blocked_producers(
    const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value resource_name = Napi::String::New(env, "abort_blocked_producers");
  tsfn_abort_blocked_finalized = false;
  tsfn_abort_blocked_about_to_call.store(0);
  NODE_API_CALL(
      env, napi_create_threadsafe_function(
               env, /* JavaScript function */ nullptr,
               /* async resource */ nullptr, resource_name,
               /* max queue size */ 1,
               /* initial thread count */ 3, /* finalize data */ nullptr,
               tsfn_abort_blocked_finalize, /* context */ nullptr,
               &noop_callback, &tsfn_abort_blocked));
  // Fill the queue so both producer threads block on the condvar. The JS
  // thread is parked in this function, so dispatch cannot drain it yet.
  NODE_API_CALL(env, napi_call_threadsafe_function(tsfn_abort_blocked, nullptr,
                                                   napi_tsfn_nonblocking));
  std::thread(tsfn_abort_blocked_producer).detach();
  std::thread(tsfn_abort_blocked_producer).detach();
  while (tsfn_abort_blocked_about_to_call.load() < 2) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  NODE_API_CALL(env, napi_release_threadsafe_function(tsfn_abort_blocked,
                                                      napi_tsfn_abort));
  return env.Undefined();
}

static napi_value
test_napi_threadsafe_function_abort_blocked_producers_finalized(
    const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), tsfn_abort_blocked_finalized);
}

static napi_threadsafe_function tsfn_abort_full = nullptr;
static bool tsfn_abort_full_finalized = false;

static void tsfn_abort_full_finalize(napi_env env, void *finalize_data,
                                     void *finalize_hint) {
  tsfn_abort_full_finalized = true;
}

// Abort a tsfn whose bounded queue is full, then call it without blocking. A
// full queue must not hide that it is closing: the call has to report
// napi_closing and consume this thread's reference, or nothing is left to
// finalize it and the event-loop keepalive pins the process forever. Returns
// the call's status.
static napi_value
test_napi_threadsafe_function_abort_full_queue(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value resource_name = Napi::String::New(env, "abort_full_queue");
  tsfn_abort_full_finalized = false;
  NODE_API_CALL(env, napi_create_threadsafe_function(
                         env, /* JavaScript function */ nullptr,
                         /* async resource */ nullptr, resource_name,
                         /* max queue size */ 1,
                         /* initial thread count */ 2,
                         /* finalize data */ nullptr, tsfn_abort_full_finalize,
                         /* context */ nullptr, &noop_callback,
                         &tsfn_abort_full));
  // The JS thread is parked in here, so nothing drains the queue: it is still
  // full at the abort and at the call below.
  NODE_API_CALL(env, napi_call_threadsafe_function(tsfn_abort_full, nullptr,
                                                   napi_tsfn_nonblocking));
  NODE_API_CALL(env, napi_release_threadsafe_function(tsfn_abort_full,
                                                      napi_tsfn_abort));
  napi_status status = napi_call_threadsafe_function(tsfn_abort_full, nullptr,
                                                     napi_tsfn_nonblocking);
  tsfn_abort_full = nullptr;
  return Napi::Number::New(env, static_cast<double>(status));
}

static napi_value test_napi_threadsafe_function_abort_full_queue_finalized(
    const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), tsfn_abort_full_finalized);
}

// Queue several items while the JS thread is parked here, so all of them run in
// one dispatch. Microtasks queued by one callback must be drained before the
// next callback runs (https://github.com/nodejs/node/pull/38506), and must not
// be drained before the first one.
static napi_value test_napi_threadsafe_function_microtask_order(
    const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value resource_name = Napi::String::New(env, "microtask_order");
  napi_threadsafe_function tsfn;
  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, /* JavaScript function */ info[1],
                    /* async resource */ nullptr, resource_name,
                    /* max queue size (unlimited) */ 0,
                    /* initial thread count */ 1, /* finalize data */ nullptr,
                    /* finalize callback */ nullptr, /* context */ nullptr,
                    /* call_js_cb: default, calls info[1] */ nullptr, &tsfn));
  for (int i = 0; i < 3; i++) {
    NODE_API_CALL(env, napi_call_threadsafe_function(tsfn, nullptr,
                                                     napi_tsfn_nonblocking));
  }
  NODE_API_CALL(env, napi_release_threadsafe_function(tsfn, napi_tsfn_release));
  return env.Undefined();
}

static napi_value
test_napi_get_value_string_utf8_with_buffer(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // info[0] is a function to run the GC
  napi_value string_js = info[1];
  // get how many chars we need to copy
  size_t len = info[2].As<Napi::Number>().Uint32Value();

  if (len == 424242) {
    len = NAPI_AUTO_LENGTH;
  } else {
    NODE_API_ASSERT(env, len <= 29);
  }

  size_t copied;
  const size_t BUF_SIZE = 30;
  char buf[BUF_SIZE];
  memset(buf, '*', BUF_SIZE);
  buf[BUF_SIZE - 1] = '\0';

  NODE_API_CALL(env,
                napi_get_value_string_utf8(env, string_js, buf, len, &copied));
#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

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

static napi_value
test_napi_handle_scope_string(const Napi::CallbackInfo &info) {
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
    NODE_API_ASSERT(env, atoi(buf) == (int)j);
  }

  delete[] small_strings;
  return ok(env);
}

static napi_value
test_napi_handle_scope_bigint(const Napi::CallbackInfo &info) {
  // this is mostly a copy of test_handle_scope_gc from
  // test/v8/v8-module/main.cpp -- see comments there for explanation
  Napi::Env env = info.Env();

  constexpr size_t num_small_ints = 10000;
  constexpr size_t small_int_size = 100;

  auto *small_ints = new napi_value[num_small_ints];

  for (size_t i = 0, small_int_index = 1; i < num_small_ints;
       i++, small_int_index++) {
    uint64_t words[small_int_size];
    for (size_t j = 0; j < small_int_size; j++) {
      words[j] = small_int_index;
    }

    NODE_API_CALL(env, napi_create_bigint_words(env, 0, small_int_size, words,
                                                &small_ints[i]));
  }

  run_gc(info);

#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

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

static napi_value test_napi_delete_property(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // info[0] is a function to run the GC
  napi_value object = info[1];
  napi_valuetype type = get_typeof(env, object);
  NODE_API_ASSERT(env, type == napi_object);

  napi_value key = Napi::String::New(env, "foo");

  napi_value non_configurable_key = Napi::String::New(env, "bar");

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
static bool store_escaped_handle(napi_env env, napi_value *out,
                                 const char *str) {
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

static napi_value
test_napi_escapable_handle_scope(const Napi::CallbackInfo &info) {
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

static napi_value
test_napi_handle_scope_nesting(const Napi::CallbackInfo &info) {
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

  // Make a new handle scope on the heap so that the outer handle scope isn't
  // active anymore
  napi_handle_scope *inner_hs = new napi_handle_scope;
  NODE_API_CALL(env, napi_open_handle_scope(env, inner_hs));

  // Force GC
  run_gc(info);

  // Try to read our first handle. Did the outer handle scope get
  // collected now that it's not on the global object? The inner handle scope
  // should be keeping it alive even though it's not on the stack.
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
static napi_value
test_napi_handle_scope_many_args(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  run_gc(info);
  // now if bun is broken a bunch of our args are dead, because node-addon-api
  // uses a heap array for >6 args
  for (size_t i = 1; i < info.Length(); i++) {
    Napi::String s = info[i].As<Napi::String>();
    NODE_API_ASSERT(env, s.Utf8Value() == std::to_string(i));
  }
  return env.Undefined();
}

static napi_value test_napi_ref(const Napi::CallbackInfo &info) {
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

static napi_value test_napi_run_script(const Napi::CallbackInfo &info) {
  napi_value ret = nullptr;
  // info[0] is the GC callback
  (void)napi_run_script(info.Env(), info[1], &ret);
  return ret;
}

static napi_value test_napi_throw_with_nullptr(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  const napi_status status = napi_throw(env, nullptr);
  printf("napi_throw -> %d\n", status);

  bool is_exception_pending;
  NODE_API_CALL(env, napi_is_exception_pending(env, &is_exception_pending));
  printf("napi_is_exception_pending -> %s\n",
         is_exception_pending ? "true" : "false");

  return ok(env);
}

// Call Node-API functions in ways that result in different error handling
// (erroneous call, valid call, or valid call while an exception is pending) and
// log information from napi_get_last_error_info
static napi_value test_extended_error_messages(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  const napi_extended_error_info *error;

#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

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

static napi_value bigint_to_i64(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

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
#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

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

#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

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

static napi_value test_is_buffer(const Napi::CallbackInfo &info) {
  bool result;
  napi_env env = info.Env();
  NODE_API_CALL(info.Env(), napi_is_buffer(env, info[1], &result));
  printf("napi_is_buffer -> %s\n", result ? "true" : "false");
  return ok(env);
}

static napi_value test_is_typedarray(const Napi::CallbackInfo &info) {
  bool result;
  napi_env env = info.Env();
  NODE_API_CALL(info.Env(), napi_is_typedarray(env, info[1], &result));
  printf("napi_is_typedarray -> %s\n", result ? "true" : "false");
  return ok(env);
}

// https://github.com/oven-sh/bun/issues/32624
// info[0] is the GC callback; the values to classify start at info[1]. For each
// one, print napi_is_arraybuffer and the raw napi_get_arraybuffer_info status so
// the output can be diffed against Node (napi_ok is 0, napi_invalid_arg is 1).
static napi_value test_is_arraybuffer(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  for (size_t i = 1; i < info.Length(); i++) {
    napi_value value = info[i];

    bool is_ab = false;
    NODE_API_CALL(env, napi_is_arraybuffer(env, value, &is_ab));

    void *data = nullptr;
    size_t length = 0;
    napi_status info_status =
        napi_get_arraybuffer_info(env, value, &data, &length);

    printf("napi_is_arraybuffer=%s napi_get_arraybuffer_info=%d\n",
           is_ab ? "true" : "false", static_cast<int>(info_status));
  }
  return ok(env);
}

static napi_value test_napi_get_default_values(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

  napi_value obj;
  NODE_API_CALL(env, napi_create_object(env, &obj));

  // Test 1: Get property that doesn't exist (should return undefined)
  napi_value unknown_key;
  NODE_API_CALL(env, napi_create_string_utf8(env, "nonexistent",
                                             NAPI_AUTO_LENGTH, &unknown_key));

  napi_value result;
  napi_status get_status = napi_get_property(env, obj, unknown_key, &result);

  if (get_status == napi_ok) {
    napi_valuetype result_type;
    napi_status type_status = napi_typeof(env, result, &result_type);

    if (type_status == napi_ok && result_type == napi_undefined) {
      printf("PASS: napi_get_property for unknown key returned undefined\n");
    } else {
      printf("FAIL: napi_get_property for unknown key returned type %d "
             "(expected napi_undefined)\n",
             result_type);
    }
  } else {
    printf("FAIL: napi_get_property for unknown key failed with status %d\n",
           get_status);
  }

  // Test 2: Get element at index that doesn't exist on array
  napi_value array;
  NODE_API_CALL(env, napi_create_array_with_length(env, 2, &array));

  napi_value element_result;
  napi_status element_status = napi_get_element(env, array, 5, &element_result);

  if (element_status == napi_ok) {
    napi_valuetype element_type;
    napi_status element_type_status =
        napi_typeof(env, element_result, &element_type);

    if (element_type_status == napi_ok && element_type == napi_undefined) {
      printf("PASS: napi_get_element for out-of-bounds index returned "
             "undefined\n");
    } else {
      printf("FAIL: napi_get_element for out-of-bounds index returned type %d "
             "(expected napi_undefined)\n",
             element_type);
    }
  } else {
    printf("FAIL: napi_get_element for out-of-bounds index failed with status "
           "%d\n",
           element_status);
  }

  // Test 3: Get named property that doesn't exist
  napi_value named_result;
  napi_status named_status =
      napi_get_named_property(env, obj, "missing_prop", &named_result);

  if (named_status == napi_ok) {
    napi_valuetype named_type;
    napi_status named_type_status = napi_typeof(env, named_result, &named_type);

    if (named_type_status == napi_ok && named_type == napi_undefined) {
      printf("PASS: napi_get_named_property for unknown property returned "
             "undefined\n");
    } else {
      printf("FAIL: napi_get_named_property for unknown property returned type "
             "%d (expected napi_undefined)\n",
             named_type);
    }
  } else {
    printf("FAIL: napi_get_named_property for unknown property failed with "
           "status %d\n",
           named_status);
  }

  // Test 4: Set a property and verify we can get it back
  napi_value test_key;
  napi_value test_value;
  NODE_API_CALL(env, napi_create_string_utf8(env, "test_key", NAPI_AUTO_LENGTH,
                                             &test_key));
  NODE_API_CALL(env, napi_create_int32(env, 42, &test_value));

  NODE_API_CALL(env, napi_set_property(env, obj, test_key, test_value));

  napi_value retrieved_value;
  NODE_API_CALL(env, napi_get_property(env, obj, test_key, &retrieved_value));

  int32_t retrieved_int;
  napi_status int_status =
      napi_get_value_int32(env, retrieved_value, &retrieved_int);

  if (int_status == napi_ok && retrieved_int == 42) {
    printf("PASS: napi_get_property correctly retrieved set value: %d\n",
           retrieved_int);
  } else {
    printf("FAIL: napi_get_property did not retrieve correct value (got %d, "
           "expected 42)\n",
           retrieved_int);
  }

  // Test 5: Use integer as property key (should be converted to string)
  napi_value int_key;
  napi_value int_key_value;
  NODE_API_CALL(env, napi_create_int32(env, 123, &int_key));
  NODE_API_CALL(env, napi_create_string_utf8(env, "integer_key_value",
                                             NAPI_AUTO_LENGTH, &int_key_value));

  // Set property using integer key
  napi_status int_key_set_status =
      napi_set_property(env, obj, int_key, int_key_value);

  if (int_key_set_status == napi_ok) {
    printf("PASS: napi_set_property with integer key succeeded\n");

    // Try to get it back using the same integer key
    napi_value int_key_result;
    napi_status int_key_get_status =
        napi_get_property(env, obj, int_key, &int_key_result);

    if (int_key_get_status == napi_ok) {
      // Check if we got back a string
      napi_valuetype int_key_result_type;
      napi_status int_key_type_status =
          napi_typeof(env, int_key_result, &int_key_result_type);

      if (int_key_type_status == napi_ok &&
          int_key_result_type == napi_string) {
        char buffer[256];
        size_t copied;
        napi_status str_status = napi_get_value_string_utf8(
            env, int_key_result, buffer, sizeof(buffer), &copied);

        if (str_status == napi_ok && strcmp(buffer, "integer_key_value") == 0) {
          printf("PASS: napi_get_property with integer key retrieved correct "
                 "value: %s\n",
                 buffer);
        } else {
          printf("FAIL: napi_get_property with integer key retrieved wrong "
                 "value: %s\n",
                 buffer);
        }
      } else {
        printf("FAIL: napi_get_property with integer key returned type %d "
               "(expected string)\n",
               int_key_result_type);
      }
    } else {
      printf("FAIL: napi_get_property with integer key failed with status %d\n",
             int_key_get_status);
    }

    // Also try to get it using string "123"
    napi_value string_123_key;
    NODE_API_CALL(env, napi_create_string_utf8(env, "123", NAPI_AUTO_LENGTH,
                                               &string_123_key));

    napi_value string_key_result;
    napi_status string_key_get_status =
        napi_get_property(env, obj, string_123_key, &string_key_result);

    if (string_key_get_status == napi_ok) {
      napi_valuetype string_key_result_type;
      napi_status string_key_type_status =
          napi_typeof(env, string_key_result, &string_key_result_type);

      if (string_key_type_status == napi_ok &&
          string_key_result_type == napi_string) {
        char buffer2[256];
        size_t copied2;
        napi_status str_status2 = napi_get_value_string_utf8(
            env, string_key_result, buffer2, sizeof(buffer2), &copied2);

        if (str_status2 == napi_ok &&
            strcmp(buffer2, "integer_key_value") == 0) {
          printf("PASS: napi_get_property with string '123' key also retrieved "
                 "correct value: %s\n",
                 buffer2);
        } else {
          printf("FAIL: napi_get_property with string '123' key retrieved "
                 "wrong value: %s\n",
                 buffer2);
        }
      } else {
        printf("FAIL: napi_get_property with string '123' key returned type %d "
               "(expected string)\n",
               string_key_result_type);
      }
    } else {
      printf("FAIL: napi_get_property with string '123' key failed with status "
             "%d\n",
             string_key_get_status);
    }
  } else {
    printf("FAIL: napi_set_property with integer key failed with status %d\n",
           int_key_set_status);
  }

  return ok(env);
}

static napi_value
test_napi_numeric_string_keys(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

#ifndef _WIN32
  BlockingStdoutScope stdout_scope;
#endif

  napi_value obj;
  NODE_API_CALL(env, napi_create_object(env, &obj));

  // Test setting property with numeric string key "0"
  napi_value value_123;
  NODE_API_CALL(env, napi_create_int32(env, 123, &value_123));

  napi_status set_status = napi_set_named_property(env, obj, "0", value_123);
  if (set_status == napi_ok) {
    printf("PASS: napi_set_named_property with key '0' succeeded\n");
  } else {
    printf("FAIL: napi_set_named_property with key '0' failed: %d\n",
           set_status);
  }

  // Test has property with numeric string key "0"
  bool has_prop;
  napi_status has_status = napi_has_named_property(env, obj, "0", &has_prop);
  if (has_status == napi_ok && has_prop) {
    printf("PASS: napi_has_named_property with key '0' returned true\n");
  } else {
    printf("FAIL: napi_has_named_property with key '0' failed or returned "
           "false: status=%d, has=%s\n",
           has_status, has_prop ? "true" : "false");
  }

  // Test getting property with numeric string key "0"
  napi_value retrieved_value;
  napi_status get_status =
      napi_get_named_property(env, obj, "0", &retrieved_value);
  if (get_status == napi_ok) {
    int32_t retrieved_int;
    napi_status int_status =
        napi_get_value_int32(env, retrieved_value, &retrieved_int);
    if (int_status == napi_ok && retrieved_int == 123) {
      printf("PASS: napi_get_named_property with key '0' returned correct "
             "value: %d\n",
             retrieved_int);
    } else {
      printf("FAIL: napi_get_named_property with key '0' returned wrong value: "
             "status=%d, value=%d\n",
             int_status, retrieved_int);
    }
  } else {
    printf("FAIL: napi_get_named_property with key '0' failed: %d\n",
           get_status);
  }

  // Test with another numeric string key "1"
  napi_value value_456;
  NODE_API_CALL(env, napi_create_int32(env, 456, &value_456));

  set_status = napi_set_named_property(env, obj, "1", value_456);
  if (set_status == napi_ok) {
    printf("PASS: napi_set_named_property with key '1' succeeded\n");
  } else {
    printf("FAIL: napi_set_named_property with key '1' failed: %d\n",
           set_status);
  }

  has_status = napi_has_named_property(env, obj, "1", &has_prop);
  if (has_status == napi_ok && has_prop) {
    printf("PASS: napi_has_named_property with key '1' returned true\n");
  } else {
    printf("FAIL: napi_has_named_property with key '1' failed or returned "
           "false: status=%d, has=%s\n",
           has_status, has_prop ? "true" : "false");
  }

  get_status = napi_get_named_property(env, obj, "1", &retrieved_value);
  if (get_status == napi_ok) {
    int32_t retrieved_int;
    napi_status int_status =
        napi_get_value_int32(env, retrieved_value, &retrieved_int);
    if (int_status == napi_ok && retrieved_int == 456) {
      printf("PASS: napi_get_named_property with key '1' returned correct "
             "value: %d\n",
             retrieved_int);
    } else {
      printf("FAIL: napi_get_named_property with key '1' returned wrong value: "
             "status=%d, value=%d\n",
             int_status, retrieved_int);
    }
  } else {
    printf("FAIL: napi_get_named_property with key '1' failed: %d\n",
           get_status);
  }

  // Test with napi_get_property using numeric string keys
  napi_value key_0, key_1;
  NODE_API_CALL(env,
                napi_create_string_utf8(env, "0", NAPI_AUTO_LENGTH, &key_0));
  NODE_API_CALL(env,
                napi_create_string_utf8(env, "1", NAPI_AUTO_LENGTH, &key_1));

  napi_value prop_value;
  napi_status prop_status = napi_get_property(env, obj, key_0, &prop_value);
  if (prop_status == napi_ok) {
    int32_t prop_int;
    napi_status int_status = napi_get_value_int32(env, prop_value, &prop_int);
    if (int_status == napi_ok && prop_int == 123) {
      printf(
          "PASS: napi_get_property with key '0' returned correct value: %d\n",
          prop_int);
    } else {
      printf("FAIL: napi_get_property with key '0' returned wrong value: "
             "status=%d, value=%d\n",
             int_status, prop_int);
    }
  } else {
    printf("FAIL: napi_get_property with key '0' failed: %d\n", prop_status);
  }

  // Test napi_has_property
  bool has_property;
  napi_status has_prop_status =
      napi_has_property(env, obj, key_1, &has_property);
  if (has_prop_status == napi_ok && has_property) {
    printf("PASS: napi_has_property with key '1' returned true\n");
  } else {
    printf("FAIL: napi_has_property with key '1' failed or returned false: "
           "status=%d, has=%s\n",
           has_prop_status, has_property ? "true" : "false");
  }

  // Test napi_has_own_property
  bool has_own_property;
  napi_status has_own_status =
      napi_has_own_property(env, obj, key_0, &has_own_property);
  if (has_own_status == napi_ok && has_own_property) {
    printf("PASS: napi_has_own_property with key '0' returned true\n");
  } else {
    printf("FAIL: napi_has_own_property with key '0' failed or returned false: "
           "status=%d, has=%s\n",
           has_own_status, has_own_property ? "true" : "false");
  }

  // Test napi_delete_property
  bool delete_result;
  napi_status delete_status =
      napi_delete_property(env, obj, key_1, &delete_result);
  if (delete_status == napi_ok) {
    printf("PASS: napi_delete_property with key '1' succeeded, result=%s\n",
           delete_result ? "true" : "false");

    // Verify the property was actually deleted
    bool still_has_property;
    napi_status verify_status =
        napi_has_property(env, obj, key_1, &still_has_property);
    if (verify_status == napi_ok && !still_has_property) {
      printf("PASS: Property '1' was successfully deleted\n");
    } else {
      printf(
          "FAIL: Property '1' still exists after deletion: status=%d, has=%s\n",
          verify_status, still_has_property ? "true" : "false");
    }
  } else {
    printf("FAIL: napi_delete_property with key '1' failed: %d\n",
           delete_status);
  }

  return ok(env);
}

static napi_value test_deferred_exceptions(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  auto do_throw = [&] {
    if (!info.Env().IsExceptionPending()) {
      Napi::Error::New(env,
                       "Creating empty object failed while exception pending")
          .ThrowAsJavaScriptException();
    }
  };

  auto clear = [&] { info.Env().GetAndClearPendingException(); };

  auto expect_failure_during_exception = [&](const char *name, const auto &fn) {
    do_throw();
    napi_status status = fn();
    if (status == napi_ok) {
      printf("expected failure for %s, but got success\n", name);
      return false;
    }
    clear();
    status = fn();
    if (status != napi_ok) {
      printf("expected success for %s, but got failure (%d)\n", name, status);
      return false;
    }
    return true;
  };

  do_throw();

  napi_value object;
  napi_status status = napi_create_object(env, &object);

  if (status != napi_ok) {
    printf("napi_create_object failed: %d\n", status);
    return nullptr;
  }

  puts("napi_create_object succeeded");

  napi_valuetype type;
  status = napi_typeof(env, object, &type);

  if (status != napi_ok) {
    printf("napi_typeof failed: %d\n", status);
    return nullptr;
  }

  if (type != napi_object) {
    printf("napi_typeof produced %d\n", type);
    return nullptr;
  }

  napi_value string;
  status = napi_create_string_utf8(env, "hej", 3, &string);

  if (status != napi_ok) {
    printf("napi_create_string_utf8 failed: %d\n", status);
    return nullptr;
  }

  status = napi_typeof(env, string, &type);

  if (status != napi_ok) {
    printf("napi_typeof failed: %d\n", status);
    return nullptr;
  }

  if (type != napi_string) {
    printf("napi_typeof produced %d\n", type);
    return nullptr;
  }

  char buffer[4];
  size_t written;
  status =
      napi_get_value_string_utf8(env, string, buffer, sizeof(buffer), &written);

  if (status != napi_ok) {
    printf("napi_get_value_string_utf8 failed: %d\n", status);
    return nullptr;
  }

  if (sizeof(buffer) <= written) {
    printf("retrieved too many characters: %zu\n", written);
    return nullptr;
  }

  buffer[written] = '\0';

  if (strcmp(buffer, "hej") != 0) {
    printf("invalid string: \"%s\"\n", buffer);
    return nullptr;
  }

  puts("string retrieval succeeded");

  napi_value function;

  expect_failure_during_exception("napi_create_function", [&] {
    return napi_create_function(
        env, "thing", 5,
        +[](napi_env env, napi_callback_info info) {
          puts("thing called");
          return ok(env);
        },
        nullptr, &function);
  });

  napi_value result;

  expect_failure_during_exception("napi_call_function", [&] {
    return napi_call_function(env, function, function, 0, nullptr, &result);
  });

  expect_failure_during_exception("napi_set_named_property", [&] {
    return napi_set_named_property(env, object, "hej", result);
  });

  expect_failure_during_exception("napi_get_named_property", [&] {
    return napi_get_named_property(env, object, "hej", &result);
  });

  bool has_own_property;

  expect_failure_during_exception("napi_has_own_property", [&] {
    return napi_has_own_property(env, object, string, &has_own_property);
  });

  if (!has_own_property) {
    puts("object does not have own property \"result\"");
    return nullptr;
  }

  napi_value keys;

  expect_failure_during_exception("napi_get_property_names", [&] {
    return napi_get_property_names(env, object, &keys);
  });

  expect_failure_during_exception("napi_delete_property", [&] {
    return napi_delete_property(env, object, string, nullptr);
  });

  expect_failure_during_exception("napi_has_own_property", [&] {
    return napi_has_own_property(env, object, string, &has_own_property);
  });

  if (has_own_property) {
    puts("object still has own property \"result\"");
    return nullptr;
  }

  napi_property_descriptor desc[2]{
      {
          .utf8name = "foo",
          .name = nullptr,
          .method = nullptr,
          .getter =
              +[](napi_env env, napi_callback_info info) {
                puts("foo getter");
                napi_value result;
                napi_create_int32(env, 42, &result);
                return result;
              },
          .setter = nullptr,
          .value = nullptr,
          .attributes = static_cast<napi_property_attributes>(napi_default),
          .data = nullptr,
      },
      {
          .utf8name = "bar",
          .name = nullptr,
          .method = nullptr,
          .getter = nullptr,
          .setter =
              +[](napi_env env, napi_callback_info info) {
                size_t argc = 0;
                assert(napi_ok == napi_get_cb_info(env, info, &argc, nullptr,
                                                   nullptr, nullptr));
                printf("bar setter: argc == %zu\n", argc);
                assert(argc == 1);
                return ok(env);
              },
          .value = nullptr,
          .attributes = static_cast<napi_property_attributes>(napi_default |
                                                              napi_writable),
          .data = nullptr,
      },
  };

  expect_failure_during_exception("napi_define_properties", [&] {
    return napi_define_properties(env, object, 2, desc);
  });

  do_throw();

  napi_value two;
  status = napi_create_int32(env, 2, &two);

  if (status != napi_ok) {
    printf("napi_create_int32 failed: %d\n", status);
    return nullptr;
  }

  expect_failure_during_exception("napi_set_element", [&] {
    return napi_set_element(env, object, 0, two);
  });

  expect_failure_during_exception("napi_get_named_property", [&] {
    return napi_get_named_property(env, object, "foo", &result);
  });

  do_throw();

  int32_t n;

  status = napi_get_value_int32(env, result, &n);

  if (status != napi_ok) {
    printf("napi_get_value_int32 failed: %d\n", status);
    return nullptr;
  }

  assert(n == 42);

  expect_failure_during_exception("napi_set_named_property", [&] {
    return napi_set_named_property(env, object, "bar", result);
  });

  clear();

  napi_ref object_ref;
  status = napi_wrap(
      env, object, nullptr,
      +[](napi_env env, void *data, void *finalize_hint) {
        puts("finalizer start");
        printf("napi_throw status: %d\n", napi_throw(env, ok(env)));
        puts("finalizer end");
      },
      nullptr, &object_ref);

  if (status != napi_ok) {
    printf("napi_wrap failed: %d\n", status);
    return nullptr;
  }

  // Pin the wrapped object for the rest of the process. Under Node >= 26 a
  // finalizer that calls napi_throw aborts if it runs from GC (it would need
  // node_api_post_finalizer), but running it at env teardown is allowed and
  // prints napi_cannot_run_js. Keeping the object strongly referenced makes
  // the finalizer timing deterministic on both runtimes.
  uint32_t refcount;
  status = napi_reference_ref(env, object_ref, &refcount);

  if (status != napi_ok) {
    printf("napi_reference_ref failed: %d\n", status);
    return nullptr;
  }

  clear();

  puts("ok");
  return ok(env);
}

// Test for napi_create_array_with_length boundary handling
// Bun converts out-of-bounds lengths to 0, Node may handle differently
static napi_value
test_napi_create_array_boundary(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Test with negative length
  napi_value array_neg;
  napi_status status = napi_create_array_with_length(env, -1, &array_neg);

  if (status == napi_ok) {
    uint32_t length;
    NODE_API_CALL(env, napi_get_array_length(env, array_neg, &length));
    printf("PASS: napi_create_array_with_length(-1) created array with length "
           "%u\n",
           length);
  } else {
    printf("FAIL: napi_create_array_with_length(-1) failed with status %d\n",
           status);
  }

  // Test with very large length (larger than max u32)
  napi_value array_large;
  size_t huge_length = (size_t)0xFFFFFFFF + 100;
  status = napi_create_array_with_length(env, huge_length, &array_large);

  if (status == napi_ok) {
    uint32_t length;
    NODE_API_CALL(env, napi_get_array_length(env, array_large, &length));
    printf("PASS: napi_create_array_with_length(0x%zx) created array with "
           "length %u\n",
           huge_length, length);
  } else if (status == napi_invalid_arg || status == napi_generic_failure) {
    printf(
        "PASS: napi_create_array_with_length(0x%zx) rejected with status %d\n",
        huge_length, status);
  } else {
    printf("FAIL: napi_create_array_with_length(0x%zx) returned unexpected "
           "status %d\n",
           huge_length, status);
  }

  // Test with value that becomes negative when cast to i32 (should become 0)
  napi_value array_negative;
  size_t negative_when_signed = 0x80000000; // 2^31 - becomes negative in i32
  status =
      napi_create_array_with_length(env, negative_when_signed, &array_negative);

  if (status == napi_ok) {
    uint32_t length;
    NODE_API_CALL(env, napi_get_array_length(env, array_negative, &length));
    if (length == 0) {
      printf("PASS: napi_create_array_with_length(0x%zx) created array with "
             "length 0 (clamped negative)\n",
             negative_when_signed);
    } else {
      printf("FAIL: napi_create_array_with_length(0x%zx) created array with "
             "length %u (expected 0)\n",
             negative_when_signed, length);
    }
  } else {
    printf("FAIL: napi_create_array_with_length(0x%zx) failed with status %d\n",
           negative_when_signed, status);
  }

  // Test with normal length to ensure it still works
  napi_value array_normal;
  status = napi_create_array_with_length(env, 10, &array_normal);

  if (status == napi_ok) {
    uint32_t length;
    NODE_API_CALL(env, napi_get_array_length(env, array_normal, &length));
    if (length == 10) {
      printf("PASS: napi_create_array_with_length(10) created array with "
             "correct length\n");
    } else {
      printf("FAIL: napi_create_array_with_length(10) created array with "
             "length %u\n",
             length);
    }
  } else {
    printf("FAIL: napi_create_array_with_length(10) failed with status %d\n",
           status);
  }

  return ok(env);
}

// Test for napi_call_function recv parameter validation
// Node validates recv parameter, Bun might not
static napi_value
test_napi_call_function_recv_null(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Create a simple function
  napi_value global, function_val;
  NODE_API_CALL(env, napi_get_global(env, &global));

  // Get Array constructor as our test function
  napi_value array_constructor;
  NODE_API_CALL(
      env, napi_get_named_property(env, global, "Array", &array_constructor));

  // Try to call with null recv (this) parameter
  napi_value result;
  napi_status status =
      napi_call_function(env, nullptr, array_constructor, 0, nullptr, &result);

  if (status == napi_ok) {
    printf("PASS: napi_call_function with null recv succeeded\n");
  } else if (status == napi_invalid_arg) {
    printf(
        "PASS: napi_call_function with null recv returned napi_invalid_arg\n");
  } else {
    printf("FAIL: napi_call_function with null recv returned unexpected "
           "status: %d\n",
           status);
  }

  // Also test with a valid recv to ensure normal operation works
  status =
      napi_call_function(env, global, array_constructor, 0, nullptr, &result);
  if (status == napi_ok) {
    printf("PASS: napi_call_function with valid recv succeeded\n");
  } else {
    printf("FAIL: napi_call_function with valid recv failed with status: %d\n",
           status);
  }

  return ok(env);
}

// Test for napi_strict_equals - should match JavaScript === operator behavior
// This tests that NaN !== NaN and -0 === 0
static napi_value test_napi_strict_equals(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Test NaN !== NaN
  napi_value nan1, nan2;
  NODE_API_CALL(env, napi_create_double(
                         env, std::numeric_limits<double>::quiet_NaN(), &nan1));
  NODE_API_CALL(env, napi_create_double(
                         env, std::numeric_limits<double>::quiet_NaN(), &nan2));

  bool nan_equals;
  NODE_API_CALL(env, napi_strict_equals(env, nan1, nan2, &nan_equals));

  if (nan_equals) {
    printf("FAIL: NaN === NaN returned true, expected false\n");
  } else {
    printf("PASS: NaN !== NaN\n");
  }

  // Test -0 === 0
  napi_value neg_zero, pos_zero;
  NODE_API_CALL(env, napi_create_double(env, -0.0, &neg_zero));
  NODE_API_CALL(env, napi_create_double(env, 0.0, &pos_zero));

  bool zero_equals;
  NODE_API_CALL(env, napi_strict_equals(env, neg_zero, pos_zero, &zero_equals));

  if (!zero_equals) {
    printf("FAIL: -0 === 0 returned false, expected true\n");
  } else {
    printf("PASS: -0 === 0\n");
  }

  // Test normal values work correctly
  napi_value val1, val2, val3;
  NODE_API_CALL(env, napi_create_double(env, 42.0, &val1));
  NODE_API_CALL(env, napi_create_double(env, 42.0, &val2));
  NODE_API_CALL(env, napi_create_double(env, 43.0, &val3));

  bool same_equals, diff_equals;
  NODE_API_CALL(env, napi_strict_equals(env, val1, val2, &same_equals));
  NODE_API_CALL(env, napi_strict_equals(env, val1, val3, &diff_equals));

  if (!same_equals) {
    printf("FAIL: 42 === 42 returned false, expected true\n");
  } else {
    printf("PASS: 42 === 42\n");
  }

  if (diff_equals) {
    printf("FAIL: 42 === 43 returned true, expected false\n");
  } else {
    printf("PASS: 42 !== 43\n");
  }

  return ok(env);
}

// Test for dataview bounds checking and error messages
static napi_value
test_napi_dataview_bounds_errors(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Create an ArrayBuffer
  napi_value arraybuffer;
  void *data = nullptr;
  NODE_API_CALL(env, napi_create_arraybuffer(env, 100, &data, &arraybuffer));

  // Test 1: DataView exceeding buffer bounds
  napi_value dataview;
  napi_status status = napi_create_dataview(env, 50, arraybuffer, 60,
                                            &dataview); // 60 + 50 = 110 > 100

  if (status == napi_ok) {
    printf("FAIL: napi_create_dataview allowed DataView exceeding buffer "
           "bounds\n");
  } else {
    printf("PASS: napi_create_dataview rejected DataView exceeding buffer "
           "bounds\n");

    // Check if an exception was thrown with the expected error
    bool is_exception_pending = false;
    NODE_API_CALL(env, napi_is_exception_pending(env, &is_exception_pending));

    if (is_exception_pending) {
      napi_value exception;
      NODE_API_CALL(env, napi_get_and_clear_last_exception(env, &exception));

      // Try to get error message
      napi_value message_val;
      napi_status msg_status =
          napi_get_named_property(env, exception, "message", &message_val);

      if (msg_status == napi_ok) {
        char message[256];
        size_t message_len;
        napi_get_value_string_utf8(env, message_val, message, sizeof(message),
                                   &message_len);
        printf("  Error message: %s\n", message);
      }
    }
  }

  // Test 2: DataView at exact boundary (should work)
  napi_value boundary_dataview;
  status = napi_create_dataview(env, 40, arraybuffer, 60,
                                &boundary_dataview); // 60 + 40 = 100 exactly

  if (status != napi_ok) {
    printf("FAIL: napi_create_dataview rejected valid DataView at exact "
           "boundary\n");
  } else {
    printf("PASS: napi_create_dataview accepted valid DataView at exact "
           "boundary\n");
  }

  // Test 3: DataView with offset beyond buffer
  napi_value beyond_dataview;
  status = napi_create_dataview(env, 1, arraybuffer, 101,
                                &beyond_dataview); // offset 101 > 100

  if (status == napi_ok) {
    printf("FAIL: napi_create_dataview allowed DataView with offset beyond "
           "buffer\n");
  } else {
    printf("PASS: napi_create_dataview rejected DataView with offset beyond "
           "buffer\n");
  }

  return ok(env);
}

// Test for napi_typeof with potentially empty/invalid values
static napi_value test_napi_typeof_empty_value(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Test 1: Create an uninitialized napi_value (simulating empty JSValue)
  // This is technically undefined behavior but can reveal differences
  napi_value uninit_value;
  memset(&uninit_value, 0, sizeof(uninit_value));

  napi_valuetype type;
  napi_status status = napi_typeof(env, uninit_value, &type);

  if (status == napi_ok) {
    if (type == napi_undefined) {
      printf("PASS: napi_typeof(zero-initialized value) returned "
             "napi_undefined (Bun behavior)\n");
    } else {
      printf("FAIL: napi_typeof(zero-initialized value) returned %d\n", type);
    }
  } else {
    printf("PASS: napi_typeof(zero-initialized value) returned error status %d "
           "(Node behavior)\n",
           status);
  }

  // Test 2: Try accessing deleted reference (undefined behavior per spec)
  // This is actually undefined behavior according to N-API documentation
  // Both Node.js and Bun may crash or behave unpredictably
  printf("INFO: Accessing deleted reference is undefined behavior - test "
         "skipped\n");
  // After napi_delete_reference, the ref is invalid and should not be used

  // Test 3: Check with reinterpret_cast of nullptr
  // This is the most likely way to get an empty JSValue
  napi_value *null_ptr = nullptr;
  napi_value null_value = reinterpret_cast<napi_value>(null_ptr);

  status = napi_typeof(env, null_value, &type);
  if (status == napi_ok) {
    if (type == napi_undefined) {
      printf("WARN: napi_typeof(nullptr) returned napi_undefined - Bun's "
             "isEmpty() check\n");
    } else {
      printf("INFO: napi_typeof(nullptr) returned type %d\n", type);
    }
  } else {
    printf("INFO: napi_typeof(nullptr) returned error %d (safer behavior)\n",
           status);
  }

  return ok(env);
}

// Test for Object.freeze and Object.seal with indexed properties
static napi_value
test_napi_freeze_seal_indexed(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Test 1: Freeze array (has indexed properties)
  napi_value array;
  NODE_API_CALL(env, napi_create_array_with_length(env, 3, &array));

  // Set some values
  napi_value val;
  NODE_API_CALL(env, napi_create_int32(env, 42, &val));
  NODE_API_CALL(env, napi_set_element(env, array, 0, val));

  // Try to freeze the array
  napi_status freeze_status = napi_object_freeze(env, array);

  if (freeze_status == napi_ok) {
    // Try to modify after freeze
    napi_value new_val;
    NODE_API_CALL(env, napi_create_int32(env, 99, &new_val));
    napi_status set_status = napi_set_element(env, array, 1, new_val);

    if (set_status != napi_ok) {
      printf("PASS: Array was frozen - cannot modify elements\n");
    } else {
      // Check if it actually changed
      napi_value get_val;
      NODE_API_CALL(env, napi_get_element(env, array, 1, &get_val));
      int32_t num;
      NODE_API_CALL(env, napi_get_value_int32(env, get_val, &num));

      if (num == 99) {
        printf("FAIL: Array with indexed properties was NOT actually frozen "
               "(Bun behavior?)\n");
      } else {
        printf("INFO: Array freeze had partial effect\n");
      }
    }
  } else {
    printf("INFO: napi_object_freeze failed on array with status %d\n",
           freeze_status);
  }

  // Test 2: Seal array (has indexed properties)
  napi_value array2;
  NODE_API_CALL(env, napi_create_array_with_length(env, 3, &array2));
  NODE_API_CALL(env, napi_set_element(env, array2, 0, val));

  // Try to seal the array
  napi_status seal_status = napi_object_seal(env, array2);

  if (seal_status == napi_ok) {
    // Try to add new property after seal
    napi_value prop_val;
    NODE_API_CALL(
        env, napi_create_string_utf8(env, "test", NAPI_AUTO_LENGTH, &prop_val));
    napi_status set_status =
        napi_set_named_property(env, array2, "newProp", prop_val);

    if (set_status != napi_ok) {
      printf("PASS: Array was sealed - cannot add new properties\n");
    } else {
      // Check if it actually was added
      napi_value get_prop;
      napi_status get_status =
          napi_get_named_property(env, array2, "newProp", &get_prop);

      if (get_status == napi_ok) {
        printf("FAIL: Array with indexed properties was NOT actually sealed "
               "(Bun behavior?)\n");
      } else {
        printf("INFO: Array seal had partial effect\n");
      }
    }
  } else {
    printf("INFO: napi_object_seal failed on array with status %d\n",
           seal_status);
  }

  // Test 3: Freeze regular object (no indexed properties)
  napi_value obj;
  NODE_API_CALL(env, napi_create_object(env, &obj));
  NODE_API_CALL(env, napi_set_named_property(env, obj, "prop", val));

  napi_status obj_freeze_status = napi_object_freeze(env, obj);

  if (obj_freeze_status == napi_ok) {
    // Try to modify after freeze
    napi_value new_val;
    NODE_API_CALL(env, napi_create_int32(env, 999, &new_val));
    napi_status set_status = napi_set_named_property(env, obj, "prop", new_val);

    if (set_status != napi_ok) {
      printf("PASS: Regular object was frozen correctly\n");
    } else {
      // Check if it actually changed
      napi_value get_val;
      NODE_API_CALL(env, napi_get_named_property(env, obj, "prop", &get_val));
      int32_t num;
      NODE_API_CALL(env, napi_get_value_int32(env, get_val, &num));

      if (num == 999) {
        printf("FAIL: Regular object was not frozen\n");
      } else {
        printf("PASS: Regular object freeze prevented modification\n");
      }
    }
  }

  return ok(env);
}

// Prints "<label>: status=<n> pending=<0|1>" and clears any pending exception
// so the next call starts clean.
static void report_status(napi_env env, const char *label, napi_status status) {
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  printf("%s: status=%d pending=%d\n", label, (int)status, pending ? 1 : 0);
  if (pending) {
    napi_value exc;
    napi_get_and_clear_last_exception(env, &exc);
  }
}

// Verifies that the element / property-name / prototype N-API family follows
// Node's CHECK_TO_OBJECT semantics: primitives are coerced via ToObject and
// succeed, null/undefined fail with napi_object_expected and a pending
// TypeError, napi_get_all_property_names validates its enum arguments, and
// napi_key_keep_numbers yields numeric (not string) index keys.
static napi_value test_napi_object_coercion(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
#ifndef _WIN32
  BlockingStdoutScope blocking_stdout;
#endif

  napi_value v_null, v_undef, v_num, v_str, v_true, v_one, out;
  bool bresult;
  NODE_API_CALL(env, napi_get_null(env, &v_null));
  NODE_API_CALL(env, napi_get_undefined(env, &v_undef));
  NODE_API_CALL(env, napi_create_double(env, 42.5, &v_num));
  NODE_API_CALL(env,
                napi_create_string_utf8(env, "abc", NAPI_AUTO_LENGTH, &v_str));
  NODE_API_CALL(env, napi_get_boolean(env, true, &v_true));
  NODE_API_CALL(env, napi_create_int32(env, 1, &v_one));

  // napi_set_element
  report_status(env, "set_element(number)",
                napi_set_element(env, v_num, 0, v_one));
  report_status(env, "set_element(string)",
                napi_set_element(env, v_str, 0, v_one));
  report_status(env, "set_element(null)",
                napi_set_element(env, v_null, 0, v_one));
  report_status(env, "set_element(undefined)",
                napi_set_element(env, v_undef, 0, v_one));

  // napi_has_element
  report_status(env, "has_element(string)",
                napi_has_element(env, v_str, 1, &bresult));
  report_status(env, "has_element(null)",
                napi_has_element(env, v_null, 0, &bresult));

  // napi_get_element
  {
    napi_value r = nullptr;
    napi_status s = napi_get_element(env, v_str, 1, &r);
    report_status(env, "get_element(string,1)", s);
    if (s == napi_ok) {
      char buf[8] = {0};
      size_t len = 0;
      if (napi_get_value_string_utf8(env, r, buf, sizeof(buf), &len) ==
          napi_ok) {
        printf("get_element(string,1) value=%s\n", buf);
      }
    }
  }
  report_status(env, "get_element(number)",
                napi_get_element(env, v_num, 0, &out));
  report_status(env, "get_element(null)",
                napi_get_element(env, v_null, 0, &out));
  report_status(env, "get_element(undefined)",
                napi_get_element(env, v_undef, 0, &out));

  // napi_delete_element
  report_status(env, "delete_element(number)",
                napi_delete_element(env, v_num, 0, &bresult));
  report_status(env, "delete_element(null)",
                napi_delete_element(env, v_null, 0, &bresult));
  {
    // result may be NULL; the delete must still happen.
    napi_value arr;
    NODE_API_CALL(env, napi_create_array_with_length(env, 1, &arr));
    NODE_API_CALL(env, napi_set_element(env, arr, 0, v_one));
    report_status(env, "delete_element(array,result=NULL)",
                  napi_delete_element(env, arr, 0, nullptr));
    bool has = true;
    NODE_API_CALL(env, napi_has_element(env, arr, 0, &has));
    printf("delete_element(array,result=NULL) has[0]=%d\n", has ? 1 : 0);
  }

  // napi_get_property_names
  report_status(env, "get_property_names(string)",
                napi_get_property_names(env, v_str, &out));
  report_status(env, "get_property_names(number)",
                napi_get_property_names(env, v_num, &out));
  report_status(env, "get_property_names(null)",
                napi_get_property_names(env, v_null, &out));

  // napi_get_prototype
  {
    napi_value r = nullptr;
    napi_status s = napi_get_prototype(env, v_num, &r);
    report_status(env, "get_prototype(number)", s);
    if (s == napi_ok) {
      napi_value number_ctor, number_proto;
      NODE_API_CALL(env, napi_get_global(env, &out));
      NODE_API_CALL(env,
                    napi_get_named_property(env, out, "Number", &number_ctor));
      NODE_API_CALL(env, napi_get_named_property(env, number_ctor, "prototype",
                                                 &number_proto));
      bool eq = false;
      NODE_API_CALL(env, napi_strict_equals(env, r, number_proto, &eq));
      printf("get_prototype(number) is Number.prototype=%d\n", eq ? 1 : 0);
    }
  }
  report_status(env, "get_prototype(string)",
                napi_get_prototype(env, v_str, &out));
  report_status(env, "get_prototype(bool)",
                napi_get_prototype(env, v_true, &out));
  report_status(env, "get_prototype(null)",
                napi_get_prototype(env, v_null, &out));
  report_status(env, "get_prototype(undefined)",
                napi_get_prototype(env, v_undef, &out));

  // by-key property siblings: also route through CHECK_TO_OBJECT in Node
  {
    napi_value key;
    NODE_API_CALL(env,
                  napi_create_string_utf8(env, "k", NAPI_AUTO_LENGTH, &key));
    report_status(env, "set_property(null)",
                  napi_set_property(env, v_null, key, v_one));
    report_status(env, "get_property(null)",
                  napi_get_property(env, v_null, key, &out));
    report_status(env, "has_property(null)",
                  napi_has_property(env, v_null, key, &bresult));
    report_status(env, "delete_property(null)",
                  napi_delete_property(env, v_null, key, &bresult));
    report_status(env, "has_own_property(null)",
                  napi_has_own_property(env, v_null, key, &bresult));
    report_status(env, "set_named_property(null)",
                  napi_set_named_property(env, v_null, "k", v_one));
    report_status(env, "get_named_property(null)",
                  napi_get_named_property(env, v_null, "k", &out));
    report_status(env, "has_named_property(null)",
                  napi_has_named_property(env, v_null, "k", &bresult));
  }

  // napi_get_all_property_names enum validation
  napi_value obj;
  NODE_API_CALL(env, napi_create_object(env, &obj));
  report_status(env, "get_all_property_names(key_mode=99)",
                napi_get_all_property_names(
                    env, obj, static_cast<napi_key_collection_mode>(99),
                    napi_key_all_properties, napi_key_numbers_to_strings,
                    &out));
  report_status(
      env, "get_all_property_names(key_conversion=99)",
      napi_get_all_property_names(env, obj, napi_key_own_only,
                                  napi_key_all_properties,
                                  static_cast<napi_key_conversion>(99), &out));
  report_status(env, "get_all_property_names(string)",
                napi_get_all_property_names(
                    env, v_str, napi_key_own_only, napi_key_all_properties,
                    napi_key_numbers_to_strings, &out));
  report_status(env, "get_all_property_names(null)",
                napi_get_all_property_names(
                    env, v_null, napi_key_own_only, napi_key_all_properties,
                    napi_key_numbers_to_strings, &out));
  report_status(env, "get_all_property_names(null,key_mode=99)",
                napi_get_all_property_names(
                    env, v_null, static_cast<napi_key_collection_mode>(99),
                    napi_key_all_properties, napi_key_numbers_to_strings,
                    &out));

  // napi_key_keep_numbers vs napi_key_numbers_to_strings
  {
    napi_value arr;
    NODE_API_CALL(env, napi_create_array_with_length(env, 1, &arr));
    NODE_API_CALL(env, napi_set_element(env, arr, 0, v_one));

    napi_value keys;
    NODE_API_CALL(env, napi_get_all_property_names(
                           env, arr, napi_key_own_only, napi_key_skip_symbols,
                           napi_key_keep_numbers, &keys));
    napi_value key0;
    NODE_API_CALL(env, napi_get_element(env, keys, 0, &key0));
    printf("keep_numbers key0 typeof=%s\n",
           napi_valuetype_to_string(get_typeof(env, key0)));

    NODE_API_CALL(env, napi_get_all_property_names(
                           env, arr, napi_key_own_only, napi_key_skip_symbols,
                           napi_key_numbers_to_strings, &keys));
    NODE_API_CALL(env, napi_get_element(env, keys, 0, &key0));
    printf("numbers_to_strings key0 typeof=%s\n",
           napi_valuetype_to_string(get_typeof(env, key0)));
  }

  return ok(env);
}

// Test for napi_create_external_buffer with empty/null data
static void empty_buffer_finalizer(napi_env env, void *data, void *hint) {
  // No-op finalizer for empty buffers
}

static napi_value
test_napi_create_external_buffer_empty(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Test 1: nullptr data with zero length
  {
    napi_value buffer;
    napi_status status = napi_create_external_buffer(
        env, 0, nullptr, empty_buffer_finalizer, nullptr, &buffer);

    if (status != napi_ok) {
      printf("FAIL: napi_create_external_buffer with nullptr and zero length "
             "failed with status %d\n",
             status);
      return env.Undefined();
    }

    // Verify it's a buffer
    bool is_buffer;
    NODE_API_CALL(env, napi_is_buffer(env, buffer, &is_buffer));
    if (!is_buffer) {
      printf("FAIL: Created value is not a buffer\n");
      return env.Undefined();
    }

    // Verify length is 0
    size_t length;
    void *data;
    NODE_API_CALL(env, napi_get_buffer_info(env, buffer, &data, &length));
    if (length != 0) {
      printf("FAIL: Buffer length is %zu instead of 0\n", length);
      return env.Undefined();
    }

    printf("PASS: napi_create_external_buffer with nullptr and zero length\n");
  }

  // Test 2: non-null data with zero length
  {
    char dummy = 0;
    napi_value buffer;
    napi_status status = napi_create_external_buffer(
        env, 0, &dummy, empty_buffer_finalizer, nullptr, &buffer);

    if (status != napi_ok) {
      printf("FAIL: napi_create_external_buffer with non-null data and zero "
             "length failed with status %d\n",
             status);
      return env.Undefined();
    }

    // Verify it's a buffer
    bool is_buffer;
    NODE_API_CALL(env, napi_is_buffer(env, buffer, &is_buffer));
    if (!is_buffer) {
      printf("FAIL: Created value is not a buffer\n");
      return env.Undefined();
    }

    // Verify length is 0
    size_t length;
    void *data;
    NODE_API_CALL(env, napi_get_buffer_info(env, buffer, &data, &length));
    if (length != 0) {
      printf("FAIL: Buffer length is %zu instead of 0\n", length);
      return env.Undefined();
    }

    printf("PASS: napi_create_external_buffer with non-null data and zero "
           "length\n");
  }

  // Test 3: nullptr finalizer
  {
    char dummy = 0;
    napi_value buffer;
    napi_status status =
        napi_create_external_buffer(env, 0, &dummy, nullptr, nullptr, &buffer);

    if (status != napi_ok) {
      printf("FAIL: napi_create_external_buffer with nullptr finalizer failed "
             "with status %d\n",
             status);
      return env.Undefined();
    }

    printf("PASS: napi_create_external_buffer with nullptr finalizer\n");
  }

  return ok(env);
}

static napi_value test_napi_empty_buffer_info(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  // Test: Create an empty external buffer and verify napi_get_buffer_info and
  // napi_get_typedarray_info
  {
    napi_value buffer;
    napi_status status =
        napi_create_external_buffer(env, 0, nullptr, nullptr, nullptr, &buffer);

    if (status != napi_ok) {
      printf("FAIL: napi_create_external_buffer with nullptr and zero length "
             "failed with status %d\n",
             status);
      return env.Undefined();
    }

    // Test napi_get_buffer_info
    void *buffer_data = reinterpret_cast<void *>(
        0xDEADBEEF); // Initialize to non-null to ensure it's set to null
    size_t buffer_length =
        999; // Initialize to non-zero to ensure it's set to 0

    status = napi_get_buffer_info(env, buffer, &buffer_data, &buffer_length);
    if (status != napi_ok) {
      printf("FAIL: napi_get_buffer_info failed with status %d\n", status);
      return env.Undefined();
    }

    if (buffer_data != nullptr) {
      printf("FAIL: napi_get_buffer_info returned non-null data pointer: %p\n",
             buffer_data);
      return env.Undefined();
    }

    if (buffer_length != 0) {
      printf("FAIL: napi_get_buffer_info returned non-zero length: %zu\n",
             buffer_length);
      return env.Undefined();
    }

    printf("PASS: napi_get_buffer_info returns null pointer and 0 length for "
           "empty buffer\n");

    // Test napi_get_typedarray_info
    napi_typedarray_type type;
    size_t typedarray_length = 999; // Initialize to non-zero
    void *typedarray_data =
        reinterpret_cast<void *>(0xDEADBEEF); // Initialize to non-null
    napi_value arraybuffer;
    size_t byte_offset;

    status =
        napi_get_typedarray_info(env, buffer, &type, &typedarray_length,
                                 &typedarray_data, &arraybuffer, &byte_offset);
    if (status != napi_ok) {
      printf("FAIL: napi_get_typedarray_info failed with status %d\n", status);
      return env.Undefined();
    }

    if (typedarray_data != nullptr) {
      printf(
          "FAIL: napi_get_typedarray_info returned non-null data pointer: %p\n",
          typedarray_data);
      return env.Undefined();
    }

    if (typedarray_length != 0) {
      printf("FAIL: napi_get_typedarray_info returned non-zero length: %zu\n",
             typedarray_length);
      return env.Undefined();
    }

    printf("PASS: napi_get_typedarray_info returns null pointer and 0 length "
           "for empty buffer\n");

    // Test napi_is_detached_arraybuffer
    // First get the underlying arraybuffer from the buffer
    napi_value arraybuffer_from_buffer;
    status = napi_get_typedarray_info(env, buffer, nullptr, nullptr, nullptr,
                                      &arraybuffer_from_buffer, nullptr);
    if (status != napi_ok) {
      printf("FAIL: Could not get arraybuffer from buffer, status %d\n",
             status);
      return env.Undefined();
    }

    bool is_detached = false;
    status = napi_is_detached_arraybuffer(env, arraybuffer_from_buffer,
                                          &is_detached);
    if (status != napi_ok) {
      printf("FAIL: napi_is_detached_arraybuffer failed with status %d\n",
             status);
      return env.Undefined();
    }

    if (!is_detached) {
      printf("FAIL: napi_is_detached_arraybuffer returned false for empty "
             "buffer's arraybuffer, expected true\n");
      return env.Undefined();
    }

    printf("PASS: napi_is_detached_arraybuffer returns true for empty buffer's "
           "arraybuffer\n");
  }

  return ok(env);
}

// Test for napi_typeof with boxed primitive objects (String, Number, Boolean)
// See: https://github.com/oven-sh/bun/issues/25351
static napi_value napi_get_typeof(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1) {
    printf("FAIL: Expected 1 argument\n");
    return env.Undefined();
  }

  napi_value value = info[0];
  napi_valuetype type;
  napi_status status = napi_typeof(env, value, &type);

  if (status != napi_ok) {
    printf("FAIL: napi_typeof failed with status %d\n", status);
    return env.Undefined();
  }

  napi_value result;
  status = napi_create_int32(env, static_cast<int32_t>(type), &result);

  if (status != napi_ok) {
    printf("FAIL: napi_create_int32 failed\n");
    return env.Undefined();
  }

  return result;
}

// Regression test: napi_create_external_buffer must tie the finalize callback
// to the ArrayBuffer's destructor, not addFinalizer on the JSUint8Array.
// With addFinalizer, extracting .buffer (the ArrayBuffer) and then letting the
// Buffer get GC'd would call finalize_cb and free the data while the ArrayBuffer
// still references it.
static napi_value test_external_buffer_data_lifetime(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  // Allocate data with a known pattern.
  const size_t data_size = 4;
  uint8_t* ext_data = (uint8_t*)malloc(data_size);
  ext_data[0] = 0xDE; ext_data[1] = 0xAD; ext_data[2] = 0xBE; ext_data[3] = 0xEF;

  napi_ref ab_ref = nullptr;

  // Create the buffer inside a handle scope we'll close before GC,
  // so the JSUint8Array handle becomes eligible for collection.
  napi_handle_scope *hs = new napi_handle_scope;
  NODE_API_CALL(env, napi_open_handle_scope(env, hs));

  // Allocate on the heap so conservative stack scanning can't find it.
  napi_value *buffer = new napi_value;
  NODE_API_CALL(env, napi_create_external_buffer(env, data_size, ext_data,
    +[](napi_env, void* data, void*) {
      // Poison the data then free — detectable as use-after-free if
      // the ArrayBuffer still tries to read through this pointer.
      memset(data, 0x00, 4);
      free(data);
    }, nullptr, buffer));

  // Extract the underlying ArrayBuffer and prevent it from being GC'd.
  napi_value *arraybuffer = new napi_value;
  NODE_API_CALL(env, napi_get_typedarray_info(env, *buffer, nullptr, nullptr,
                                               nullptr, arraybuffer, nullptr));
  NODE_API_CALL(env, napi_create_reference(env, *arraybuffer, 1, &ab_ref));

  // Drop heap pointers before closing the scope so the stack scanner
  // can't keep the Buffer alive.
  delete arraybuffer;
  delete buffer;

  NODE_API_CALL(env, napi_close_handle_scope(env, *hs));
  delete hs;

  // GC: with the old bug (addFinalizer), collecting the JSUint8Array would
  // call finalize_cb and poison the data even though the ArrayBuffer is alive.
  run_gc(info);
  run_gc(info);

  // Read data through the ArrayBuffer — should still be 0xDEADBEEF.
  napi_value ab_value;
  NODE_API_CALL(env, napi_get_reference_value(env, ab_ref, &ab_value));

  void* ab_data;
  size_t ab_len;
  NODE_API_CALL(env, napi_get_arraybuffer_info(env, ab_value, &ab_data, &ab_len));

  uint8_t* bytes = (uint8_t*)ab_data;
  if (ab_len >= data_size &&
      bytes[0] == 0xDE && bytes[1] == 0xAD &&
      bytes[2] == 0xBE && bytes[3] == 0xEF) {
    printf("PASS: external buffer data intact through ArrayBuffer after GC\n");
  } else {
    printf("FAIL: external buffer data was corrupted (finalize_cb ran too early)\n");
  }

  NODE_API_CALL(env, napi_delete_reference(env, ab_ref));
  return ok(env);
}

// Regression test: napi_create_external_arraybuffer uses the armable
// NapiExternalBufferDestructor so that if the wrapping JSArrayBuffer fails
// to be created, finalize_cb is not invoked (per the Node-API contract the
// caller retains ownership on failure). The JSArrayBuffer::create(vm, ...)
// path cannot currently fail without crashing, so the failure branch is not
// directly reachable from a test; this covers the success path to guard
// against the refactor breaking finalize_cb delivery (forgetting arm()) or
// firing it prematurely.
static int external_arraybuffer_finalize_count = 0;

static napi_value
test_external_arraybuffer_finalizer(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  external_arraybuffer_finalize_count = 0;

  const size_t data_size = 16;
  uint8_t *ext_data = (uint8_t *)malloc(data_size);
  for (size_t i = 0; i < data_size; i++)
    ext_data[i] = (uint8_t)(0xA0 + i);

  napi_value arraybuffer;
  NODE_API_CALL(
      env, napi_create_external_arraybuffer(
               env, ext_data, data_size,
               +[](napi_env, void *data, void *) {
                 external_arraybuffer_finalize_count++;
                 free(data);
               },
               nullptr, &arraybuffer));

  // The finalizer must not have run yet: the ArrayBuffer is still live.
  if (external_arraybuffer_finalize_count != 0) {
    printf("FAIL: napi_create_external_arraybuffer finalizer ran before "
           "ArrayBuffer was collected\n");
    return ok(env);
  }

  // Verify the backing store is the caller's pointer and the bytes match.
  void *ab_data;
  size_t ab_len;
  NODE_API_CALL(
      env, napi_get_arraybuffer_info(env, arraybuffer, &ab_data, &ab_len));

  bool bytes_ok = ab_len == data_size;
  for (size_t i = 0; bytes_ok && i < data_size; i++)
    bytes_ok = ((uint8_t *)ab_data)[i] == (uint8_t)(0xA0 + i);

  if (ab_data == ext_data && bytes_ok) {
    printf("PASS: napi_create_external_arraybuffer wraps caller data "
           "without copying\n");
  } else {
    printf("FAIL: napi_create_external_arraybuffer data mismatch\n");
  }

  // Pin the ArrayBuffer across several GC cycles and verify the finalizer
  // does not fire while it is reachable.
  napi_ref ab_ref;
  NODE_API_CALL(env, napi_create_reference(env, arraybuffer, 1, &ab_ref));

  run_gc(info);
  run_gc(info);
  run_gc(info);

  if (external_arraybuffer_finalize_count == 0) {
    printf("PASS: napi_create_external_arraybuffer finalizer not called "
           "while ArrayBuffer is alive\n");
  } else {
    printf("FAIL: napi_create_external_arraybuffer finalizer called %d "
           "time(s) while ArrayBuffer is alive\n",
           external_arraybuffer_finalize_count);
  }

  // The data must still be intact.
  napi_value ab_value;
  NODE_API_CALL(env, napi_get_reference_value(env, ab_ref, &ab_value));
  NODE_API_CALL(env,
                napi_get_arraybuffer_info(env, ab_value, &ab_data, &ab_len));
  bytes_ok = ab_len == data_size;
  for (size_t i = 0; bytes_ok && i < data_size; i++)
    bytes_ok = ((uint8_t *)ab_data)[i] == (uint8_t)(0xA0 + i);
  if (bytes_ok) {
    printf("PASS: napi_create_external_arraybuffer data intact after GC\n");
  } else {
    printf("FAIL: napi_create_external_arraybuffer data corrupted after "
           "GC\n");
  }

  NODE_API_CALL(env, napi_delete_reference(env, ab_ref));

  // Do not assert on post-release finalizer timing: both V8 and JSC may
  // defer it past the synchronous GC calls above. Any double-invocation or
  // use-after-free will be caught by ASAN when the process tears down.
  return ok(env);
}

// Regression test: napi_create_external_arraybuffer while a napi exception
// is pending (via napi_throw_error). Whatever status is returned, the
// function must not adopt external_data and then leave the destructor
// disarmed (which would leak the caller's buffer forever or leave a
// dangling pointer in an orphaned JSArrayBuffer if the caller frees on
// failure per the Node-API contract).
static napi_value test_external_arraybuffer_with_pending_exception(
    const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  external_arraybuffer_finalize_count = 0;

  const size_t data_size = 8;
  uint8_t *ext_data = (uint8_t *)malloc(data_size);
  memset(ext_data, 0x5A, data_size);

  // Stash a napi-level pending exception (no VM exception is raised yet).
  NODE_API_CALL(env,
                napi_throw_error(env, nullptr, "stashed before create"));

  napi_value arraybuffer = nullptr;
  napi_status status = napi_create_external_arraybuffer(
      env, ext_data, data_size,
      +[](napi_env, void *data, void *) {
        external_arraybuffer_finalize_count++;
        free(data);
      },
      nullptr, &arraybuffer);

  // Clear the pending exception so the rest of the test can run cleanly.
  napi_value exc;
  napi_get_and_clear_last_exception(env, &exc);

  printf("napi_create_external_arraybuffer with pending exception: "
         "status=%d\n",
         (int)status);

  if (status == napi_ok) {
    // Ownership transferred: the ArrayBuffer must wrap our pointer and the
    // finalizer must eventually free ext_data. It must not have fired yet.
    if (external_arraybuffer_finalize_count != 0) {
      printf("FAIL: finalizer ran before ArrayBuffer was collected\n");
      return ok(env);
    }
    void *ab_data;
    size_t ab_len;
    NODE_API_CALL(env, napi_get_arraybuffer_info(env, arraybuffer, &ab_data,
                                                 &ab_len));
    if (ab_data == ext_data && ab_len == data_size) {
      printf("PASS: ownership transferred on napi_ok with pending "
             "exception\n");
    } else {
      printf("FAIL: napi_ok but arraybuffer does not wrap caller data\n");
    }
  } else {
    // Caller retains ownership on failure. The finalizer must not have
    // run (that would be the double-free the armable destructor guards
    // against).
    if (external_arraybuffer_finalize_count == 0) {
      printf("PASS: caller retains ownership on failure with pending "
             "exception\n");
    } else {
      printf("FAIL: finalizer ran %d time(s) even though the call "
             "failed\n",
             external_arraybuffer_finalize_count);
    }
    free(ext_data);
  }

  return ok(env);
}

// Same as above, for napi_create_external_buffer: the post-create
// NAPI_RETURN_IF_EXCEPTION check in that function also consults
// hasPendingException(), so a stashed napi_throw* exception must be
// rejected up front rather than after createFromBytes has adopted data.
static int external_buffer_finalize_count = 0;

static napi_value test_external_buffer_with_pending_exception(
    const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  external_buffer_finalize_count = 0;

  const size_t data_size = 8;
  uint8_t *ext_data = (uint8_t *)malloc(data_size);
  memset(ext_data, 0x5A, data_size);

  NODE_API_CALL(env,
                napi_throw_error(env, nullptr, "stashed before create"));

  napi_value buffer = nullptr;
  napi_status status = napi_create_external_buffer(
      env, data_size, ext_data,
      +[](napi_env, void *data, void *) {
        external_buffer_finalize_count++;
        free(data);
      },
      nullptr, &buffer);

  napi_value exc;
  napi_get_and_clear_last_exception(env, &exc);

  printf("napi_create_external_buffer with pending exception: status=%d\n",
         (int)status);

  if (status == napi_ok) {
    if (external_buffer_finalize_count != 0) {
      printf("FAIL: finalizer ran before Buffer was collected\n");
      return ok(env);
    }
    void *buf_data;
    size_t buf_len;
    NODE_API_CALL(env,
                  napi_get_buffer_info(env, buffer, &buf_data, &buf_len));
    if (buf_data == ext_data && buf_len == data_size) {
      printf("PASS: ownership transferred on napi_ok with pending "
             "exception\n");
    } else {
      printf("FAIL: napi_ok but buffer does not wrap caller data\n");
    }
  } else {
    if (external_buffer_finalize_count == 0) {
      printf("PASS: caller retains ownership on failure with pending "
             "exception\n");
    } else {
      printf("FAIL: finalizer ran %d time(s) even though the call "
             "failed\n",
             external_buffer_finalize_count);
    }
    free(ext_data);
  }

  return ok(env);
}

// Regression test: PROPERTY_NAME_FROM_UTF8 must copy string data.
// Previously it used StringImpl::createWithoutCopying for ASCII strings,
// which could leave dangling pointers in JSC's atom string table.
//
// This replicates the pattern from napi-rs / impit that caused a crash:
// napi-rs creates a CString (heap-allocated) for each property name,
// passes it to napi_get_named_property, then frees the CString.
// With createWithoutCopying, the atom table retains a reference to the
// freed CString memory. On the next lookup of the same property name,
// Identifier::fromString compares against the stale atom -> use-after-free.
static napi_value test_napi_get_named_property_copied_string(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value global;
  NODE_API_CALL(env, napi_get_global(env, &global));

  // Simulate what impit does: look up properties on JS objects using
  // heap-allocated keys (like napi-rs CString), then free them.
  // The property names here match what impit uses in its response handling.
  const char *property_names[] = {
    "ReadableStream", "Response", "arrayBuffer", "then", "eval",
    "enqueue", "bind", "close",
  };
  const int num_names = sizeof(property_names) / sizeof(property_names[0]);

  // First round: each strdup'd key goes through PROPERTY_NAME_FROM_UTF8 then
  // is freed. With createWithoutCopying, the atom table entries now have
  // dangling data pointers.
  for (int i = 0; i < num_names; i++) {
    char *key = strdup(property_names[i]);
    napi_value result;
    NODE_API_CALL(env, napi_get_named_property(env, global, key, &result));
    free(key);
  }

  // Trigger GC - this is critical. In the impit crash, GC occurs between
  // the first and second lookups due to many object allocations (ReadableStream
  // chunks, Response objects, promises). GC may cause the atom table to
  // drop or recreate atoms, exposing the dangling pointers.
  run_gc(info);

  // Churn through more strdup/free cycles to increase the chance that
  // malloc reuses memory from the freed keys above.
  for (int round = 0; round < 30; round++) {
    for (int i = 0; i < num_names; i++) {
      char *key = strdup(property_names[i]);
      napi_value result;
      NODE_API_CALL(env, napi_get_named_property(env, global, key, &result));
      free(key);
    }
    if (round % 10 == 0) {
      run_gc(info);
    }
  }

  run_gc(info);

  // Second round: look up the same property names again.
  // With the bug, Identifier::fromString finds stale atoms in the table
  // and reads their freed backing memory -> ASAN heap-use-after-free.
  for (int i = 0; i < num_names; i++) {
    char *key = strdup(property_names[i]);
    napi_value result;
    NODE_API_CALL(env, napi_get_named_property(env, global, key, &result));
    free(key);
  }

  printf("PASS\n");
  return ok(env);
}

// https://github.com/oven-sh/bun/issues/25933
// When a threadsafe function is created inside AsyncLocalStorage.run(),
// the js_callback gets wrapped in AsyncContextFrame. napi_typeof must
// still report it as napi_function, not napi_object.
static napi_threadsafe_function tsfn_25933 = nullptr;

static void test_issue_25933_callback(napi_env env, napi_value js_callback,
                                      void *context, void *data) {
  napi_valuetype type;
  napi_status status = napi_typeof(env, js_callback, &type);
  if (status != napi_ok) {
    printf("FAIL: napi_typeof returned error status %d\n", status);
  } else if (type == napi_function) {
    printf("PASS: napi_typeof returned napi_function\n");
  } else {
    printf("FAIL: napi_typeof returned %d, expected napi_function (%d)\n",
           type, napi_function);
  }
  napi_release_threadsafe_function(tsfn_25933, napi_tsfn_release);
  tsfn_25933 = nullptr;
}

static napi_value test_issue_25933(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);

  // The first argument is the JS callback function.
  // When called inside AsyncLocalStorage.run(), Bun wraps this in
  // AsyncContextFrame via withAsyncContextIfNeeded.
  napi_value js_cb = info[0];
  napi_value name = Napi::String::New(env, "tsfn_typeof_test");

  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, js_cb, nullptr, name, 0, 1, nullptr, nullptr,
                    nullptr, &test_issue_25933_callback, &tsfn_25933));
  NODE_API_CALL(env, napi_call_threadsafe_function(tsfn_25933, nullptr,
                                                   napi_tsfn_nonblocking));
  return env.Undefined();
}

// When a threadsafe function's call_js_cb receives a js_callback that is an
// AsyncContextFrame, calling napi_make_callback on it should work (not fail
// with function_expected).
static napi_threadsafe_function tsfn_make_callback = nullptr;

static void test_make_callback_tsfn_cb(napi_env env, napi_value js_callback,
                                       void *context, void *data) {
  napi_value recv;
  napi_get_global(env, &recv);

  napi_value result;
  napi_status status = napi_make_callback(env, nullptr, recv, js_callback, 0, nullptr, &result);
  if (status == napi_ok) {
    printf("PASS: napi_make_callback succeeded\n");
  } else {
    printf("FAIL: napi_make_callback returned status %d\n", status);
  }
  napi_release_threadsafe_function(tsfn_make_callback, napi_tsfn_release);
  tsfn_make_callback = nullptr;
}

static napi_value test_napi_make_callback_async_context_frame(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);

  napi_value js_cb = info[0];
  napi_value name = Napi::String::New(env, "tsfn_make_callback_test");

  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, js_cb, nullptr, name, 0, 1, nullptr, nullptr,
                    nullptr, &test_make_callback_tsfn_cb, &tsfn_make_callback));
  NODE_API_CALL(env, napi_call_threadsafe_function(tsfn_make_callback, nullptr,
                                                   napi_tsfn_nonblocking));
  return env.Undefined();
}

// When a threadsafe function's call_js_cb receives a js_callback that is an
// AsyncContextFrame, passing it to a second napi_create_threadsafe_function
// with call_js_cb=NULL should succeed (not fail with function_expected).
static napi_threadsafe_function tsfn_create_outer = nullptr;

static void test_create_tsfn_outer_cb(napi_env env, napi_value js_callback,
                                      void *context, void *data) {
  // js_callback here is an AsyncContextFrame in Bun.
  // Try to create a new threadsafe function with it and call_js_cb=NULL.
  napi_value name;
  napi_create_string_utf8(env, "inner_tsfn", NAPI_AUTO_LENGTH, &name);

  napi_threadsafe_function inner_tsfn = nullptr;
  napi_status status = napi_create_threadsafe_function(
      env, js_callback, nullptr, name, 0, 1, nullptr, nullptr,
      nullptr, /* call_js_cb */ nullptr, &inner_tsfn);
  if (status != napi_ok) {
    printf("FAIL: napi_create_threadsafe_function returned status %d\n", status);
  } else {
    printf("PASS: napi_create_threadsafe_function accepted AsyncContextFrame\n");
    // Release immediately — we only needed to verify creation succeeds.
    napi_release_threadsafe_function(inner_tsfn, napi_tsfn_release);
  }
  napi_release_threadsafe_function(tsfn_create_outer, napi_tsfn_release);
  tsfn_create_outer = nullptr;
}

static napi_value test_napi_create_tsfn_async_context_frame(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::HandleScope scope(env);

  napi_value js_cb = info[0];
  napi_value name = Napi::String::New(env, "tsfn_create_test");

  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, js_cb, nullptr, name, 0, 1, nullptr, nullptr,
                    nullptr, &test_create_tsfn_outer_cb, &tsfn_create_outer));
  NODE_API_CALL(env, napi_call_threadsafe_function(tsfn_create_outer, nullptr,
                                                   napi_tsfn_nonblocking));
  return env.Undefined();
}

static napi_value
test_typedarray_info_byte_offset(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value typedarray = info[1];

  napi_typedarray_type type;
  size_t length = 0;
  void *data = nullptr;
  napi_value arraybuffer = nullptr;
  size_t byte_offset = SIZE_MAX;
  NODE_API_CALL(env,
                napi_get_typedarray_info(env, typedarray, &type, &length, &data,
                                         &arraybuffer, &byte_offset));

  void *arraybuffer_data = nullptr;
  size_t arraybuffer_byte_length = 0;
  NODE_API_CALL(env,
                napi_get_arraybuffer_info(env, arraybuffer, &arraybuffer_data,
                                          &arraybuffer_byte_length));

  bool data_at_offset =
      static_cast<uint8_t *>(arraybuffer_data) + byte_offset ==
      static_cast<uint8_t *>(data);
  printf("byte_offset=%zu length=%zu arraybuffer_byte_length=%zu "
         "data_is_arraybuffer_data_plus_byte_offset=%s\n",
         byte_offset, length, arraybuffer_byte_length,
         data_at_offset ? "true" : "false");
  return ok(env);
}

static napi_value
test_dataview_info_byte_offset(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value dataview = info[1];

  size_t byte_length = 0;
  void *data = nullptr;
  napi_value arraybuffer = nullptr;
  size_t byte_offset = SIZE_MAX;
  NODE_API_CALL(env, napi_get_dataview_info(env, dataview, &byte_length, &data,
                                            &arraybuffer, &byte_offset));

  void *arraybuffer_data = nullptr;
  size_t arraybuffer_byte_length = 0;
  NODE_API_CALL(env,
                napi_get_arraybuffer_info(env, arraybuffer, &arraybuffer_data,
                                          &arraybuffer_byte_length));

  bool data_at_offset =
      static_cast<uint8_t *>(arraybuffer_data) + byte_offset ==
      static_cast<uint8_t *>(data);
  printf("byte_offset=%zu byte_length=%zu arraybuffer_byte_length=%zu "
         "data_is_arraybuffer_data_plus_byte_offset=%s\n",
         byte_offset, byte_length, arraybuffer_byte_length,
         data_at_offset ? "true" : "false");
  return ok(env);
}

static void print_pending_exception_code(napi_env env) {
  bool is_pending = false;
  napi_is_exception_pending(env, &is_pending);
  if (!is_pending) {
    printf("  no pending exception\n");
    return;
  }
  napi_value exception;
  napi_get_and_clear_last_exception(env, &exception);
  napi_value code_val;
  char code[128] = "(no .code)";
  if (napi_get_named_property(env, exception, "code", &code_val) == napi_ok) {
    size_t len;
    napi_get_value_string_utf8(env, code_val, code, sizeof(code), &len);
  }
  bool is_range = false;
  napi_value global, range_ctor;
  napi_get_global(env, &global);
  napi_get_named_property(env, global, "RangeError", &range_ctor);
  napi_instanceof(env, exception, range_ctor, &is_range);
  printf("  code=%s instanceof RangeError=%d\n", code, is_range ? 1 : 0);
}

static napi_value
test_napi_create_typedarray_errors(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  napi_value arraybuffer;
  void *data = nullptr;
  NODE_API_CALL(env, napi_create_arraybuffer(env, 16, &data, &arraybuffer));

  napi_value ta = nullptr;
  napi_status s =
      napi_create_typedarray(env, napi_int32_array, 2, arraybuffer, 2, &ta);
  printf("misaligned int32 offset=2: status=%d\n", s);
  print_pending_exception_code(env);

  // A subsequent call must succeed; there must be no leftover VM exception.
  napi_value str = nullptr;
  napi_status s2 =
      napi_create_string_utf8(env, "hello", NAPI_AUTO_LENGTH, &str);
  printf("create_string_utf8 after misalign: status=%d\n", s2);

  s = napi_create_typedarray(env, napi_float64_array, 2, arraybuffer, 4, &ta);
  printf("misaligned float64 offset=4: status=%d\n", s);
  print_pending_exception_code(env);

  s = napi_create_typedarray(env, napi_uint8_array, 32, arraybuffer, 0, &ta);
  printf("uint8 length=32 over 16-byte buffer: status=%d\n", s);
  print_pending_exception_code(env);

  s = napi_create_typedarray(env, napi_int32_array, 4, arraybuffer, 4, &ta);
  printf("int32 length=4 offset=4 over 16-byte buffer: status=%d\n", s);
  print_pending_exception_code(env);

  napi_value not_a_buffer;
  NODE_API_CALL(env, napi_create_object(env, &not_a_buffer));
  s = napi_create_typedarray(env, napi_uint8_array, 4, not_a_buffer, 0, &ta);
  printf("create_typedarray(non-buffer): status=%d\n", s);
  napi_value dv;
  s = napi_create_dataview(env, 4, not_a_buffer, 0, &dv);
  printf("create_dataview(non-buffer): status=%d\n", s);

  s = napi_create_typedarray(env, napi_int32_array, 4, arraybuffer, 0, &ta);
  printf("int32 length=4 offset=0 exact fit: status=%d\n", s);

  return ok(env);
}

static napi_value
test_napi_view_info_type_check(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  napi_value arraybuffer;
  void *data = nullptr;
  NODE_API_CALL(env, napi_create_arraybuffer(env, 16, &data, &arraybuffer));
  napi_value uint8;
  NODE_API_CALL(env, napi_create_typedarray(env, napi_uint8_array, 8,
                                            arraybuffer, 0, &uint8));
  napi_value dataview;
  NODE_API_CALL(env, napi_create_dataview(env, 8, arraybuffer, 0, &dataview));
  napi_value plain;
  NODE_API_CALL(env, napi_create_object(env, &plain));
  napi_value float16 = info[1];

  size_t len = 12345;
  void *p = nullptr;
  napi_value ab = nullptr;
  size_t off = 12345;
  napi_status s;

  s = napi_get_dataview_info(env, uint8, &len, &p, &ab, &off);
  printf("get_dataview_info(Uint8Array): status=%d\n", s);
  s = napi_get_dataview_info(env, arraybuffer, &len, &p, &ab, &off);
  printf("get_dataview_info(ArrayBuffer): status=%d\n", s);
  s = napi_get_dataview_info(env, plain, &len, &p, &ab, &off);
  printf("get_dataview_info(Object): status=%d\n", s);
  s = napi_get_dataview_info(env, dataview, &len, &p, &ab, &off);
  printf("get_dataview_info(DataView): status=%d len=%zu off=%zu\n", s, len,
         off);

  napi_typedarray_type ty;
  s = napi_get_typedarray_info(env, dataview, &ty, &len, &p, &ab, &off);
  printf("get_typedarray_info(DataView): status=%d\n", s);
  s = napi_get_typedarray_info(env, arraybuffer, &ty, &len, &p, &ab, &off);
  printf("get_typedarray_info(ArrayBuffer): status=%d\n", s);
  s = napi_get_typedarray_info(env, dataview, nullptr, nullptr, nullptr,
                               nullptr, nullptr);
  printf("get_typedarray_info(DataView, all-null out): status=%d\n", s);
  s = napi_get_typedarray_info(env, float16, nullptr, &len, nullptr, nullptr,
                               &off);
  printf("get_typedarray_info(Float16Array, type=null): status=%d len=%zu\n", s,
         len);
  s = napi_get_typedarray_info(env, plain, &ty, &len, &p, &ab, &off);
  printf("get_typedarray_info(Object): status=%d\n", s);
  s = napi_get_typedarray_info(env, uint8, &ty, &len, &p, &ab, &off);
  printf("get_typedarray_info(Uint8Array): status=%d type=%d len=%zu\n", s,
         static_cast<int>(ty), len);

  return ok(env);
}

static napi_value
test_create_arraybuffer_zeroed(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  const size_t size = 1024;
  const int rounds = 1024;
  int buffers_with_nonzero_bytes = 0;

  for (int i = 0; i < rounds; i++) {
    napi_value scratch;
    void *scratch_data = nullptr;
    NODE_API_CALL(env,
                  napi_create_arraybuffer(env, size, &scratch_data, &scratch));
    memset(scratch_data, 0xEE, size);
    NODE_API_CALL(env, napi_detach_arraybuffer(env, scratch));

    napi_value probe;
    void *probe_data = nullptr;
    NODE_API_CALL(env, napi_create_arraybuffer(env, size, &probe_data, &probe));
    const uint8_t *bytes = static_cast<const uint8_t *>(probe_data);
    bool all_zero = true;
    for (size_t j = 0; j < size; j++) {
      if (bytes[j] != 0) {
        all_zero = false;
        break;
      }
    }
    if (!all_zero) {
      buffers_with_nonzero_bytes++;
    }
    NODE_API_CALL(env, napi_detach_arraybuffer(env, probe));
  }

  if (buffers_with_nonzero_bytes == 0) {
    printf("PASS: napi_create_arraybuffer memory is zero-filled\n");
  } else {
    printf("FAIL: napi_create_arraybuffer returned memory with nonzero "
           "bytes\n");
  }
  return ok(env);
}

void register_standalone_tests(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, test_typedarray_info_byte_offset);
  REGISTER_FUNCTION(env, exports, test_dataview_info_byte_offset);
  REGISTER_FUNCTION(env, exports, test_napi_create_typedarray_errors);
  REGISTER_FUNCTION(env, exports, test_napi_view_info_type_check);
  REGISTER_FUNCTION(env, exports, test_create_arraybuffer_zeroed);
  REGISTER_FUNCTION(env, exports, test_issue_7685);
  REGISTER_FUNCTION(env, exports, test_issue_11949);
  REGISTER_FUNCTION(env, exports, test_napi_get_value_string_utf8_with_buffer);
  REGISTER_FUNCTION(env, exports,
                    test_napi_threadsafe_function_does_not_hang_after_finalize);
  REGISTER_FUNCTION(env, exports,
                    test_napi_threadsafe_function_abort_then_last_release);
  REGISTER_FUNCTION(env, exports,
                    test_napi_threadsafe_function_abort_then_last_release_drop);
  REGISTER_FUNCTION(
      env, exports,
      test_napi_threadsafe_function_abort_then_last_release_finalized);
  REGISTER_FUNCTION(env, exports,
                    test_napi_threadsafe_function_abort_blocked_producers);
  REGISTER_FUNCTION(
      env, exports,
      test_napi_threadsafe_function_abort_blocked_producers_finalized);
  REGISTER_FUNCTION(env, exports, test_napi_threadsafe_function_abort_full_queue);
  REGISTER_FUNCTION(
      env, exports, test_napi_threadsafe_function_abort_full_queue_finalized);
  REGISTER_FUNCTION(env, exports,
                    test_napi_threadsafe_function_microtask_order);
  REGISTER_FUNCTION(env, exports, test_napi_handle_scope_string);
  REGISTER_FUNCTION(env, exports, test_napi_handle_scope_bigint);
  REGISTER_FUNCTION(env, exports, test_napi_delete_property);
  REGISTER_FUNCTION(env, exports, test_napi_escapable_handle_scope);
  REGISTER_FUNCTION(env, exports, test_napi_handle_scope_nesting);
  REGISTER_FUNCTION(env, exports, test_napi_handle_scope_many_args);
  REGISTER_FUNCTION(env, exports, test_napi_ref);
  REGISTER_FUNCTION(env, exports, test_napi_run_script);
  REGISTER_FUNCTION(env, exports, test_napi_throw_with_nullptr);
  REGISTER_FUNCTION(env, exports, test_extended_error_messages);
  REGISTER_FUNCTION(env, exports, bigint_to_i64);
  REGISTER_FUNCTION(env, exports, bigint_to_u64);
  REGISTER_FUNCTION(env, exports, bigint_to_64_null);
  REGISTER_FUNCTION(env, exports, test_is_buffer);
  REGISTER_FUNCTION(env, exports, test_is_typedarray);
  REGISTER_FUNCTION(env, exports, test_is_arraybuffer);
  REGISTER_FUNCTION(env, exports, test_napi_get_default_values);
  REGISTER_FUNCTION(env, exports, test_napi_numeric_string_keys);
  REGISTER_FUNCTION(env, exports, test_deferred_exceptions);
  REGISTER_FUNCTION(env, exports, test_napi_strict_equals);
  REGISTER_FUNCTION(env, exports, test_napi_call_function_recv_null);
  REGISTER_FUNCTION(env, exports, test_napi_create_array_boundary);
  REGISTER_FUNCTION(env, exports, test_napi_dataview_bounds_errors);
  REGISTER_FUNCTION(env, exports, test_napi_typeof_empty_value);
  REGISTER_FUNCTION(env, exports, test_napi_freeze_seal_indexed);
  REGISTER_FUNCTION(env, exports, test_napi_object_coercion);
  REGISTER_FUNCTION(env, exports, test_napi_create_external_buffer_empty);
  REGISTER_FUNCTION(env, exports, test_napi_empty_buffer_info);
  REGISTER_FUNCTION(env, exports, napi_get_typeof);
  REGISTER_FUNCTION(env, exports, test_external_buffer_data_lifetime);
  REGISTER_FUNCTION(env, exports, test_external_arraybuffer_finalizer);
  REGISTER_FUNCTION(env, exports,
                    test_external_arraybuffer_with_pending_exception);
  REGISTER_FUNCTION(env, exports,
                    test_external_buffer_with_pending_exception);
  REGISTER_FUNCTION(env, exports, test_napi_get_named_property_copied_string);
  REGISTER_FUNCTION(env, exports, test_issue_25933);
  REGISTER_FUNCTION(env, exports, test_napi_make_callback_async_context_frame);
  REGISTER_FUNCTION(env, exports, test_napi_create_tsfn_async_context_frame);
}

} // namespace napitests

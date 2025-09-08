#include "standalone_tests.h"

#include <algorithm>
#include <array>
#include <cinttypes>
#include <iostream>
#include <string>

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

  status = napi_wrap(
      env, object, nullptr,
      +[](napi_env env, void *data, void *finalize_hint) {
        puts("finalizer start");
        printf("napi_throw status: %d\n", napi_throw(env, ok(env)));
        puts("finalizer end");
      },
      nullptr, nullptr);

  if (status != napi_ok) {
    printf("napi_wrap failed: %d\n", status);
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

void register_standalone_tests(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, test_issue_7685);
  REGISTER_FUNCTION(env, exports, test_issue_11949);
  REGISTER_FUNCTION(env, exports, test_napi_get_value_string_utf8_with_buffer);
  REGISTER_FUNCTION(env, exports,
                    test_napi_threadsafe_function_does_not_hang_after_finalize);
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
  REGISTER_FUNCTION(env, exports, test_deferred_exceptions);
  REGISTER_FUNCTION(env, exports, test_napi_strict_equals);
  REGISTER_FUNCTION(env, exports, test_napi_call_function_recv_null);
  REGISTER_FUNCTION(env, exports, test_napi_create_array_boundary);
  REGISTER_FUNCTION(env, exports, test_napi_dataview_bounds_errors);
  REGISTER_FUNCTION(env, exports, test_napi_typeof_empty_value);
  REGISTER_FUNCTION(env, exports, test_napi_freeze_seal_indexed);
}

} // namespace napitests

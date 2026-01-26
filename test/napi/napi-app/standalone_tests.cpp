#include "standalone_tests.h"

#include <algorithm>
#include <array>
#include <cinttypes>
#include <cstdlib>
#include <cstring>
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
  REGISTER_FUNCTION(env, exports, test_napi_get_default_values);
  REGISTER_FUNCTION(env, exports, test_napi_numeric_string_keys);
  REGISTER_FUNCTION(env, exports, test_deferred_exceptions);
  REGISTER_FUNCTION(env, exports, test_napi_strict_equals);
  REGISTER_FUNCTION(env, exports, test_napi_call_function_recv_null);
  REGISTER_FUNCTION(env, exports, test_napi_create_array_boundary);
  REGISTER_FUNCTION(env, exports, test_napi_dataview_bounds_errors);
  REGISTER_FUNCTION(env, exports, test_napi_typeof_empty_value);
  REGISTER_FUNCTION(env, exports, test_napi_freeze_seal_indexed);
  REGISTER_FUNCTION(env, exports, test_napi_create_external_buffer_empty);
  REGISTER_FUNCTION(env, exports, test_napi_empty_buffer_info);
  REGISTER_FUNCTION(env, exports, napi_get_typeof);
  REGISTER_FUNCTION(env, exports, test_external_buffer_data_lifetime);
  REGISTER_FUNCTION(env, exports, test_napi_get_named_property_copied_string);
}

} // namespace napitests

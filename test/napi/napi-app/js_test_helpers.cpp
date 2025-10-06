#include "js_test_helpers.h"

#include "utils.h"
#include <map>
#include <string>

namespace napitests {

static bool finalize_called = false;

static void finalize_cb(napi_env env, void *finalize_data,
                        void *finalize_hint) {
  node_api_post_finalizer(
      env,
      +[](napi_env env, void *data, void *hint) {
        napi_handle_scope hs;
        NODE_API_CALL_CUSTOM_RETURN(env, void(),
                                    napi_open_handle_scope(env, &hs));
        NODE_API_CALL_CUSTOM_RETURN(env, void(),
                                    napi_close_handle_scope(env, hs));
        finalize_called = true;
      },
      finalize_data, finalize_hint);
}

static napi_value create_ref_with_finalizer(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value object;
  NODE_API_CALL(env, napi_create_object(env, &object));

  napi_ref ref;
  NODE_API_CALL(env,
                napi_wrap(env, object, nullptr, finalize_cb, nullptr, &ref));

  return ok(env);
}

static napi_value was_finalize_called(const Napi::CallbackInfo &info) {
  napi_value ret;
  NODE_API_CALL(info.Env(),
                napi_get_boolean(info.Env(), finalize_called, &ret));
  return ret;
}

// calls a function (the sole argument) which must throw. catches and returns
// the thrown error
static napi_value call_and_get_exception(const Napi::CallbackInfo &info) {
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
static napi_value throw_error(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  Napi::Value js_code = info[0];
  Napi::Value js_msg = info[1];
  std::string error_kind = info[2].As<Napi::String>().Utf8Value();

  // these are optional
  const char *code = nullptr;
  std::string code_str;
  const char *msg = nullptr;
  std::string msg_str;

  if (js_code.IsString()) {
    code_str = js_code.As<Napi::String>().Utf8Value();
    code = code_str.c_str();
  }
  if (js_msg.IsString()) {
    msg_str = js_msg.As<Napi::String>().Utf8Value();
    msg = msg_str.c_str();
  }

  using ThrowFunction =
      napi_status (*)(napi_env, const char *code, const char *msg);
  std::map<std::string, ThrowFunction> functions{
      {"error", napi_throw_error},
      {"type_error", napi_throw_type_error},
      {"range_error", napi_throw_range_error},
      {"syntax_error", node_api_throw_syntax_error}};

  auto throw_function = functions[error_kind];

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
static napi_value create_and_throw_error(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value js_code = info[0];
  napi_value js_msg = info[1];
  std::string error_kind = info[2].As<Napi::String>();

  if (get_typeof(env, js_code) == napi_null) {
    js_code = nullptr;
  }
  if (get_typeof(env, js_msg) == napi_null) {
    js_msg = nullptr;
  }

  using CreateErrorFunction = napi_status (*)(
      napi_env, napi_value code, napi_value msg, napi_value *result);
  std::map<std::string, CreateErrorFunction> functions{
      {"error", napi_create_error},
      {"type_error", napi_create_type_error},
      {"range_error", napi_create_range_error},
      {"syntax_error", node_api_create_syntax_error}};

  auto create_error_function = functions[error_kind];

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

// perform_get(object, key)
static napi_value perform_get(const Napi::CallbackInfo &info) {
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
  if (status == napi_ok) {
    NODE_API_ASSERT(env, value != nullptr);
    printf("value type = %d\n", get_typeof(env, value));
    return value;
  } else {
    return ok(env);
  }
}

// perform_set(object, key, value)
static napi_value perform_set(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value obj = info[0];
  napi_value key = info[1];
  napi_value value = info[2];
  napi_status status;

  // if key is a string, try napi_set_named_property
  napi_valuetype type = get_typeof(env, key);
  if (type == napi_string) {
    char buf[1024];
    NODE_API_CALL(env,
                  napi_get_value_string_utf8(env, key, buf, 1024, nullptr));
    status = napi_set_named_property(env, obj, buf, value);
    if (status != napi_ok) {
      NODE_API_ASSERT(env, status == napi_pending_exception);
      return ok(env);
    }
  }

  status = napi_set_property(env, obj, key, value);
  if (status != napi_ok) {
    NODE_API_ASSERT(env, status == napi_pending_exception);
  }
  return ok(env);
}

static napi_value make_empty_array(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value js_size = info[0];
  uint32_t size;
  NODE_API_CALL(env, napi_get_value_uint32(env, js_size, &size));
  napi_value array;
  NODE_API_CALL(env, napi_create_array_with_length(env, size, &array));
  return array;
}

// add_tag(object, lower, upper)
static napi_value add_tag(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value object = info[0];

  uint32_t lower, upper;
  NODE_API_CALL(env, napi_get_value_uint32(env, info[1], &lower));
  NODE_API_CALL(env, napi_get_value_uint32(env, info[2], &upper));
  napi_type_tag tag = {.lower = lower, .upper = upper};
  NODE_API_CALL(env, napi_type_tag_object(env, object, &tag));
  return env.Undefined();
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

// check_tag(object, lower, upper): bool
static napi_value check_tag(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value object = info[0];

  uint32_t lower, upper;
  NODE_API_CALL(env, napi_get_value_uint32(env, info[1], &lower));
  NODE_API_CALL(env, napi_get_value_uint32(env, info[2], &upper));

  napi_type_tag tag = {.lower = lower, .upper = upper};
  bool matches;
  NODE_API_CALL(env, napi_check_object_type_tag(env, object, &tag, &matches));
  return Napi::Boolean::New(env, matches);
}

static napi_value create_weird_bigints(const Napi::CallbackInfo &info) {
  // create bigints by passing weird parameters to napi_create_bigint_words
  napi_env env = info.Env();

  std::array<napi_value, 6> bigints;
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
  // zero, another way
  NODE_API_CALL(
      env, napi_create_bigint_words(env, 1, 3, words.data() + 1, &bigints[5]));

  napi_value array;
  NODE_API_CALL(env,
                napi_create_array_with_length(env, bigints.size(), &array));
  for (size_t i = 0; i < bigints.size(); i++) {
    NODE_API_CALL(env, napi_set_element(env, array, (uint32_t)i, bigints[i]));
  }
  return array;
}

static napi_value test_bigint_actual_word_count(const Napi::CallbackInfo &info) {
  // Test that napi_get_value_bigint_words returns the actual word count needed
  // even when the provided buffer is smaller than the actual word count
  napi_env env = info.Env();
  
  if (info.Length() < 1) {
    napi_throw_type_error(env, nullptr, "Expected 1 argument");
    return nullptr;
  }
  
  napi_value bigint_value = info[0];
  
  // First, query the word count with null buffers
  size_t queried_word_count = 0;
  napi_status status = napi_get_value_bigint_words(env, bigint_value, nullptr, &queried_word_count, nullptr);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get word count");
    return nullptr;
  }
  
  // Now test with a buffer that's smaller than needed
  // For a 2-word BigInt, provide only 1 word of buffer
  uint64_t small_buffer[1];
  int sign_bit = 0;
  size_t actual_word_count = 1; // Provide space for only 1 word
  
  status = napi_get_value_bigint_words(env, bigint_value, &sign_bit, &actual_word_count, small_buffer);
  // The function should succeed even with smaller buffer
  // and actual_word_count should be updated to the real count needed
  
  // Create result object
  napi_value result;
  NODE_API_CALL(env, napi_create_object(env, &result));
  
  napi_value queried_val, actual_val, sign_val;
  NODE_API_CALL(env, napi_create_uint32(env, queried_word_count, &queried_val));
  NODE_API_CALL(env, napi_create_uint32(env, actual_word_count, &actual_val));
  NODE_API_CALL(env, napi_create_int32(env, sign_bit, &sign_val));
  
  NODE_API_CALL(env, napi_set_named_property(env, result, "queriedWordCount", queried_val));
  NODE_API_CALL(env, napi_set_named_property(env, result, "actualWordCount", actual_val));
  NODE_API_CALL(env, napi_set_named_property(env, result, "signBit", sign_val));
  
  return result;
}

static napi_value test_reference_unref_underflow(const Napi::CallbackInfo &info) {
  // Test that napi_reference_unref correctly handles refCount == 0
  // It should return an error instead of underflowing
  napi_env env = info.Env();
  
  if (info.Length() < 1) {
    napi_throw_type_error(env, nullptr, "Expected 1 argument");
    return nullptr;
  }
  
  // Create a reference with initial ref count of 1
  napi_ref ref;
  napi_status status = napi_create_reference(env, info[0], 1, &ref);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create reference");
    return nullptr;
  }
  
  // Unref once - should succeed and set refCount to 0
  uint32_t ref_count;
  status = napi_reference_unref(env, ref, &ref_count);
  if (status != napi_ok) {
    napi_delete_reference(env, ref);
    napi_throw_error(env, nullptr, "First unref failed");
    return nullptr;
  }
  
  // Try to unref again when refCount is already 0
  // This should fail with napi_generic_failure
  uint32_t ref_count_after;
  status = napi_reference_unref(env, ref, &ref_count_after);
  
  // Create result object
  napi_value result;
  NODE_API_CALL(env, napi_create_object(env, &result));
  
  napi_value first_unref_count, second_status;
  NODE_API_CALL(env, napi_create_uint32(env, ref_count, &first_unref_count));
  NODE_API_CALL(env, napi_create_uint32(env, status, &second_status));
  
  NODE_API_CALL(env, napi_set_named_property(env, result, "firstUnrefCount", first_unref_count));
  NODE_API_CALL(env, napi_set_named_property(env, result, "secondUnrefStatus", second_status));
  
  // Clean up the reference
  napi_delete_reference(env, ref);
  
  return result;
}

void register_js_test_helpers(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, create_ref_with_finalizer);
  REGISTER_FUNCTION(env, exports, was_finalize_called);
  REGISTER_FUNCTION(env, exports, call_and_get_exception);
  REGISTER_FUNCTION(env, exports, perform_get);
  REGISTER_FUNCTION(env, exports, perform_set);
  REGISTER_FUNCTION(env, exports, throw_error);
  REGISTER_FUNCTION(env, exports, create_and_throw_error);
  REGISTER_FUNCTION(env, exports, make_empty_array);
  REGISTER_FUNCTION(env, exports, add_tag);
  REGISTER_FUNCTION(env, exports, try_add_tag);
  REGISTER_FUNCTION(env, exports, check_tag);
  REGISTER_FUNCTION(env, exports, create_weird_bigints);
  REGISTER_FUNCTION(env, exports, test_bigint_actual_word_count);
  REGISTER_FUNCTION(env, exports, test_reference_unref_underflow);
}

} // namespace napitests

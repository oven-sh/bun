#include "class_test.h"

#include "utils.h"

namespace napitests {

static napi_value constructor(napi_env env, napi_callback_info info) {
  napi_value this_value;
  void *data;
  NODE_API_CALL(
      env, napi_get_cb_info(env, info, nullptr, nullptr, &this_value, &data));

  printf("in constructor, data = \"%s\"\n",
         reinterpret_cast<const char *>(data));

  napi_value new_target;
  NODE_API_CALL(env, napi_get_new_target(env, info, &new_target));
  napi_value new_target_string;
  NODE_API_CALL(env,
                napi_coerce_to_string(env, new_target, &new_target_string));
  char new_target_c_string[1024] = {0};
  NODE_API_CALL(env, napi_get_value_string_utf8(
                         env, new_target_string, new_target_c_string,
                         sizeof new_target_c_string, nullptr));

  // node and bun output different whitespace when stringifying a function,
  // which we don't want the test to fail for
  // so we attempt to delete everything in between {}
  auto *open_brace = reinterpret_cast<char *>(
      memchr(new_target_c_string, '{', sizeof new_target_c_string));
  auto *close_brace = reinterpret_cast<char *>(
      memchr(new_target_c_string, '}', sizeof new_target_c_string));
  if (open_brace && close_brace && open_brace < close_brace) {
    open_brace[1] = '}';
    open_brace[2] = 0;
  }

  printf("new.target = %s\n", new_target_c_string);

  printf("typeof this = %s\n",
         napi_valuetype_to_string(get_typeof(env, this_value)));

  napi_value global;
  NODE_API_CALL(env, napi_get_global(env, &global));
  bool equal;
  NODE_API_CALL(env, napi_strict_equals(env, this_value, global, &equal));
  printf("this == global = %s\n", equal ? "true" : "false");

  // define a property with a normal value
  napi_value property_value = Napi::String::New(env, "meow");
  napi_set_named_property(env, this_value, "foo", property_value);

  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

static napi_value getData_callback(napi_env env, napi_callback_info info) {
  void *data;

  NODE_API_CALL(env,
                napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data));
  const char *str_data = reinterpret_cast<const char *>(data);

  napi_value ret;
  NODE_API_CALL(env,
                napi_create_string_utf8(env, str_data, NAPI_AUTO_LENGTH, &ret));
  return ret;
}

static napi_value getStaticData_callback(napi_env env,
                                         napi_callback_info info) {
  void *data;

  NODE_API_CALL(env,
                napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data));
  const char *str_data = reinterpret_cast<const char *>(data);

  napi_value ret;
  if (data) {
    NODE_API_CALL(
        env, napi_create_string_utf8(env, str_data, NAPI_AUTO_LENGTH, &ret));
  } else {
    // we should hit this case as the data pointer should be null
    NODE_API_CALL(env, napi_get_undefined(env, &ret));
  }
  return ret;
}

static napi_value static_getter_callback(napi_env env,
                                         napi_callback_info info) {
  void *data;

  NODE_API_CALL(env,
                napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data));
  const char *str_data = reinterpret_cast<const char *>(data);

  napi_value ret;
  if (data) {
    NODE_API_CALL(
        env, napi_create_string_utf8(env, str_data, NAPI_AUTO_LENGTH, &ret));
  } else {
    // we should hit this case as the data pointer should be null
    NODE_API_CALL(env, napi_get_undefined(env, &ret));
  }
  return ret;
}

static napi_value get_class_with_constructor(const Napi::CallbackInfo &info) {
  static char constructor_data[] = "constructor data";
  static char method_data[] = "method data";
  static char wrap_data[] = "wrap data";

  napi_env env = info.Env();
  napi_value napi_class;

  const napi_property_descriptor property = {
      .utf8name = "getData",
      .name = nullptr,
      .method = getData_callback,
      .getter = nullptr,
      .setter = nullptr,
      .value = nullptr,
      .attributes = napi_default_method,
      .data = reinterpret_cast<void *>(method_data),
  };

  const napi_property_descriptor static_properties[] = {
      {
          .utf8name = "getStaticData",
          .name = nullptr,
          .method = getStaticData_callback,
          .getter = nullptr,
          .setter = nullptr,
          .value = nullptr,
          .attributes = napi_default_method,
          // the class's data pointer should not be used instead -- it should
          // stay nullptr
          .data = nullptr,
      },
      {
          .utf8name = "getter",
          .name = nullptr,
          .method = nullptr,
          .getter = static_getter_callback,
          .setter = nullptr,
          .value = nullptr,
          .attributes = napi_default,
          // the class's data pointer should not be used instead -- it should
          // stay nullptr
          .data = nullptr,
      },
  };

  NODE_API_CALL(
      env, napi_define_class(env, "NapiClass", NAPI_AUTO_LENGTH, constructor,
                             reinterpret_cast<void *>(constructor_data), 1,
                             &property, &napi_class));
  NODE_API_CALL(env,
                napi_define_properties(env, napi_class, 2, static_properties));
  NODE_API_CALL(env,
                napi_wrap(env, napi_class, reinterpret_cast<void *>(wrap_data),
                          nullptr, nullptr, nullptr));
  return napi_class;
}

static napi_value test_constructor_with_no_prototype(const Napi::CallbackInfo &info) {
  // This test verifies that Reflect.construct with a newTarget that has no prototype
  // property doesn't crash. This was a bug where jsDynamicCast was called on a JSValue
  // of 0 when the prototype property didn't exist.
  
  napi_env env = info.Env();
  
  // Get the NapiClass constructor
  napi_value napi_class = get_class_with_constructor(info);
  
  // Create a newTarget object with no prototype property
  napi_value new_target;
  NODE_API_CALL(env, napi_create_object(env, &new_target));
  
  // Call Reflect.construct(NapiClass, [], newTarget)
  napi_value global;
  NODE_API_CALL(env, napi_get_global(env, &global));
  
  napi_value reflect;
  NODE_API_CALL(env, napi_get_named_property(env, global, "Reflect", &reflect));
  
  napi_value construct_fn;
  NODE_API_CALL(env, napi_get_named_property(env, reflect, "construct", &construct_fn));
  
  napi_value empty_array;
  NODE_API_CALL(env, napi_create_array_with_length(env, 0, &empty_array));
  
  napi_value args[3] = { napi_class, empty_array, new_target };
  napi_value result;
  
  // This should not crash - previously it would crash when trying to access
  // the prototype property of newTarget
  napi_status status = napi_call_function(env, reflect, construct_fn, 3, args, &result);
  
  if (status == napi_ok) {
    return Napi::String::New(env, "success - no crash");
  } else {
    // If there was an error, return it
    const napi_extended_error_info* error_info;
    napi_get_last_error_info(env, &error_info);
    return Napi::String::New(env, error_info->error_message ? error_info->error_message : "error");
  }
}

void register_class_test(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, get_class_with_constructor);
  REGISTER_FUNCTION(env, exports, test_constructor_with_no_prototype);
}

} // namespace napitests

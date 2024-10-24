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

static napi_value get_class_with_constructor(const Napi::CallbackInfo &info) {
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

void register_class_test(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, get_class_with_constructor);
}

} // namespace napitests

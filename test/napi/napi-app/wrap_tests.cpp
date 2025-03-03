#include "wrap_tests.h"

#include "utils.h"
#include <cassert>

namespace napitests {

static napi_ref ref_to_wrapped_object = nullptr;
static bool wrap_finalize_called = false;

static void delete_the_ref(napi_env env, void *_data, void *_hint) {
  printf("delete_the_ref\n");
  // not using NODE_API_ASSERT as this runs in a finalizer where allocating an
  // error might cause a harder-to-debug crash
  assert(ref_to_wrapped_object);
  napi_delete_reference(env, ref_to_wrapped_object);
  ref_to_wrapped_object = nullptr;
  wrap_finalize_called = true;
}

static void finalize_for_create_wrap(napi_env env, void *opaque_data,
                                     void *opaque_hint) {
  int *data = reinterpret_cast<int *>(opaque_data);
  int *hint = reinterpret_cast<int *>(opaque_hint);
  printf("finalize_for_create_wrap, data = %d, hint = %d\n", *data, *hint);
  delete data;
  delete hint;
  if (ref_to_wrapped_object) {
    // don't set wrap_finalize_called, wait for it to be set in delete_the_ref
    node_api_post_finalizer(env, delete_the_ref, nullptr, nullptr);
  } else {
    wrap_finalize_called = true;
  }
}

// create_wrap(js_object: object, ask_for_ref: boolean, strong: boolean): object
static napi_value create_wrap(const Napi::CallbackInfo &info) {
  wrap_finalize_called = false;
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
static napi_value get_wrap_data(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value js_object = info[0];

  void *wrapped_data;
  napi_status status = napi_unwrap(env, js_object, &wrapped_data);
  if (status != napi_ok) {
    napi_value undefined;
    NODE_API_CALL(env, napi_get_undefined(env, &undefined));
    return undefined;
  }

  napi_value js_number;
  NODE_API_CALL(env,
                napi_create_int32(env, *reinterpret_cast<int *>(wrapped_data),
                                  &js_number));
  return js_number;
}

// get_object_from_ref(): object
static napi_value get_object_from_ref(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_value wrapped_object;
  NODE_API_CALL(env, napi_get_reference_value(env, ref_to_wrapped_object,
                                              &wrapped_object));

  if (!wrapped_object) {
    NODE_API_CALL(env, napi_get_undefined(env, &wrapped_object));
  }
  return wrapped_object;
}

// get_wrap_data_from_ref(): number|undefined
static napi_value get_wrap_data_from_ref(const Napi::CallbackInfo &info) {
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
static napi_value remove_wrap(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  napi_value js_object = info[0];

  void *wrap_data;
  NODE_API_CALL(env, napi_remove_wrap(env, js_object, &wrap_data));

  napi_value undefined;
  NODE_API_CALL(env, napi_get_undefined(env, &undefined));
  return undefined;
}

// unref_wrapped_value(): undefined
static napi_value unref_wrapped_value(const Napi::CallbackInfo &info) {
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

static napi_value was_wrap_finalize_called(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  return Napi::Boolean::New(env, wrap_finalize_called);
}

// try_wrap(value: any, num: number): bool
// wraps value in a C++ object corresponding to the number num
// true if success
static napi_value try_wrap(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value value = info[0];
  napi_value js_num = info[1];
  double c_num;
  NODE_API_CALL(env, napi_get_value_double(env, js_num, &c_num));

  napi_status status = napi_wrap(
      env, value, reinterpret_cast<void *>(new double{c_num}),
      [](napi_env env, void *data, void *hint) {
        (void)env;
        (void)hint;
        delete reinterpret_cast<double *>(data);
      },
      nullptr, nullptr);

  napi_value js_result;
  assert(napi_get_boolean(env, status == napi_ok, &js_result) == napi_ok);
  return js_result;
}

// try_unwrap(any): number|undefined
static napi_value try_unwrap(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value value = info[0];

  double *wrapped;
  napi_status status =
      napi_unwrap(env, value, reinterpret_cast<void **>(&wrapped));
  napi_value result;
  if (status == napi_ok) {
    NODE_API_CALL(env, napi_create_double(env, *wrapped, &result));
  } else {
    NODE_API_CALL(env, napi_get_undefined(env, &result));
  }
  return result;
}

static napi_value try_remove_wrap(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value value = info[0];

  double *wrapped;
  napi_status status =
      napi_remove_wrap(env, value, reinterpret_cast<void **>(&wrapped));
  napi_value result;
  if (status == napi_ok) {
    NODE_API_CALL(env, napi_create_double(env, *wrapped, &result));
  } else {
    NODE_API_CALL(env, napi_get_undefined(env, &result));
  }
  return result;
}

void register_wrap_tests(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, create_wrap);
  REGISTER_FUNCTION(env, exports, get_wrap_data);
  REGISTER_FUNCTION(env, exports, get_object_from_ref);
  REGISTER_FUNCTION(env, exports, get_wrap_data_from_ref);
  REGISTER_FUNCTION(env, exports, remove_wrap);
  REGISTER_FUNCTION(env, exports, unref_wrapped_value);
  REGISTER_FUNCTION(env, exports, was_wrap_finalize_called);
  REGISTER_FUNCTION(env, exports, try_wrap);
  REGISTER_FUNCTION(env, exports, try_unwrap);
  REGISTER_FUNCTION(env, exports, try_remove_wrap);
}

} // namespace napitests

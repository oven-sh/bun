// Built twice (NAPI_VERSION=10 and NAPI_VERSION=8) to pin the
// napi_create_reference gate: version >= 10 accepts any value type,
// older versions only accept object/function/symbol.
//
// Values that cannot be held weakly (everything but objects, functions and
// symbols) are released when the count reaches zero: napi_get_reference_value
// then yields NULL and napi_reference_ref leaves the count at 0.
#include <js_native_api.h>
#include <node_api.h>
#include <stdio.h>

static napi_value create_ref(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);

  napi_ref ref = NULL;
  napi_status status = napi_create_reference(env, arg, 1, &ref);

  uint32_t round_trip_ok = 0;
  uint32_t held_at_zero = 0;
  uint32_t count_after_reref = 0;
  if (status == napi_ok) {
    napi_value got = NULL;
    napi_get_reference_value(env, ref, &got);
    bool eq = false;
    napi_strict_equals(env, arg, got, &eq);
    round_trip_ok = eq ? 1 : 0;

    uint32_t rc = 0;
    napi_reference_ref(env, ref, &rc);
    napi_reference_unref(env, ref, &rc);
    napi_reference_unref(env, ref, &rc);

    // The caller still holds the value, so a weakly held one is still here;
    // anything else has been released.
    got = NULL;
    napi_get_reference_value(env, ref, &got);
    held_at_zero = got != NULL ? 1 : 0;

    napi_reference_ref(env, ref, &count_after_reref);
    napi_delete_reference(env, ref);
  }

  napi_value out;
  napi_create_object(env, &out);
  napi_value v;
  napi_create_int32(env, (int32_t)status, &v);
  napi_set_named_property(env, out, "status", v);
  napi_create_int32(env, NAPI_VERSION, &v);
  napi_set_named_property(env, out, "declared", v);
  napi_create_uint32(env, round_trip_ok, &v);
  napi_set_named_property(env, out, "roundTrip", v);
  napi_create_uint32(env, held_at_zero, &v);
  napi_set_named_property(env, out, "heldAtZero", v);
  napi_create_uint32(env, count_after_reref, &v);
  napi_set_named_property(env, out, "reref", v);
  return out;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value fn;
  napi_create_function(env, "create_ref", NAPI_AUTO_LENGTH, create_ref, NULL,
                       &fn);
  napi_set_named_property(env, exports, "create_ref", fn);
  return exports;
}

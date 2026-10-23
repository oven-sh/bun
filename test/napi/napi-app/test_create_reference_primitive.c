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

// Static refs that outlive one test file under `bun test --isolate`.
static napi_ref retained_refs[8];

static napi_ref *retained_slot(napi_env env, napi_callback_info info,
                               size_t arg, napi_value *first) {
  size_t argc = 2;
  napi_value argv[2] = {NULL, NULL};
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (first) {
    *first = argv[0];
  }
  uint32_t slot = 0;
  if (argc > arg && argv[arg]) {
    napi_get_value_uint32(env, argv[arg], &slot);
  }
  return &retained_refs[slot % 8];
}

// retain(value, slot = 0): creates a count-1 ref in the slot (never deleted).
static napi_value retain(napi_env env, napi_callback_info info) {
  napi_value value;
  napi_ref *slot = retained_slot(env, info, 1, &value);
  napi_value out;
  napi_create_int32(env, (int32_t)napi_create_reference(env, value, 1, slot),
                    &out);
  return out;
}

// retained(slot = 0): the value, or undefined once the ref reads empty.
static napi_value retained(napi_env env, napi_callback_info info) {
  napi_ref *slot = retained_slot(env, info, 0, NULL);
  napi_value value = NULL;
  napi_get_reference_value(env, *slot, &value);
  if (!value) {
    napi_get_undefined(env, &value);
  }
  return value;
}

// ref_retained(slot = 0): the count napi_reference_ref reports.
static napi_value ref_retained(napi_env env, napi_callback_info info) {
  napi_ref *slot = retained_slot(env, info, 0, NULL);
  uint32_t count = 0;
  napi_reference_ref(env, *slot, &count);
  napi_value out;
  napi_create_uint32(env, count, &out);
  return out;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value fn;
  napi_create_function(env, "create_ref", NAPI_AUTO_LENGTH, create_ref, NULL,
                       &fn);
  napi_set_named_property(env, exports, "create_ref", fn);
  napi_create_function(env, "retain", NAPI_AUTO_LENGTH, retain, NULL, &fn);
  napi_set_named_property(env, exports, "retain", fn);
  napi_create_function(env, "retained", NAPI_AUTO_LENGTH, retained, NULL, &fn);
  napi_set_named_property(env, exports, "retained", fn);
  napi_create_function(env, "ref_retained", NAPI_AUTO_LENGTH, ref_retained,
                       NULL, &fn);
  napi_set_named_property(env, exports, "ref_retained", fn);
  return exports;
}

#define NAPI_VERSION 10
#include <node_api.h>
#include <stdio.h>

// Verifies that napi_get_last_error_info returns a non-null error_message for
// napi_cannot_run_js. This addon wraps an object with a finalizer that runs
// during env teardown; inside that finalizer napi_throw cannot call into JS
// and returns napi_cannot_run_js (because this addon declares NAPI_VERSION 10).
// The finalizer then calls napi_get_last_error_info and prints the status and
// message so the test can assert on them.

static void teardown_finalizer(napi_env env, void* data, void* hint) {
  (void)data;
  (void)hint;

  napi_value msg;
  napi_value err;
  napi_create_string_utf8(env, "boom", NAPI_AUTO_LENGTH, &msg);
  napi_create_error(env, NULL, msg, &err);

  napi_status throw_status = napi_throw(env, err);

  const napi_extended_error_info* info = NULL;
  napi_get_last_error_info(env, &info);

  printf("napi_throw status=%d error_code=%d error_message=%s\n",
         (int)throw_status,
         info ? (int)info->error_code : -1,
         (info && info->error_message) ? info->error_message : "(null)");
  fflush(stdout);
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value obj;
  napi_create_object(env, &obj);
  napi_wrap(env, obj, NULL, teardown_finalizer, NULL, NULL);
  napi_set_named_property(env, exports, "keep", obj);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

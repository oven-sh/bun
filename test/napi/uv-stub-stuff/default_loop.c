// uv_default_loop() as seen from an N-API addon. On Windows bun links real
// libuv and addons resolve uv_* from bun.exe; the exported uv_default_loop
// must be a loop bun actually runs, or NAN-era addons that call
// uv_queue_work(uv_default_loop(), ...) never get their after-work callback
// (oven-sh/bun#40225, ibm_db).
#include <node_api.h>
#include <stdlib.h>
#include <uv.h>

typedef struct {
  uv_work_t req;
  napi_env env;
  napi_ref cb;
  int ran_work;
} work_data;

static void work_cb(uv_work_t *req) { ((work_data *)req->data)->ran_work = 1; }

static void after_work_cb(uv_work_t *req, int status) {
  work_data *data = (work_data *)req->data;
  napi_env env = data->env;
  napi_handle_scope scope;
  napi_open_handle_scope(env, &scope);
  napi_value cb, global, arg, result;
  napi_get_reference_value(env, data->cb, &cb);
  napi_get_global(env, &global);
  napi_create_int32(env, data->ran_work, &arg);
  napi_call_function(env, global, cb, 1, &arg, &result);
  napi_delete_reference(env, data->cb);
  napi_close_handle_scope(env, scope);
  free(data);
}

// queueWork(cb): uv_queue_work on uv_default_loop(); cb(ran_work) runs from
// the after-work callback, which only fires if the runtime drives the loop.
static napi_value queue_work(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  work_data *data = (work_data *)calloc(1, sizeof(work_data));
  data->env = env;
  napi_create_reference(env, argv[0], 1, &data->cb);
  data->req.data = data;
  uv_queue_work(uv_default_loop(), &data->req, work_cb, after_work_cb);
  return NULL;
}

// defaultLoopIsNapiLoop(): uv_default_loop() == the loop returned by
// napi_get_uv_event_loop, which is the loop the runtime drives.
static napi_value default_loop_is_napi_loop(napi_env env,
                                            napi_callback_info info) {
  uv_loop_t *napi_loop = NULL;
  napi_get_uv_event_loop(env, &napi_loop);
  napi_value result;
  napi_get_boolean(env, uv_default_loop() == napi_loop, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, NULL, 0, queue_work, NULL, &fn);
  napi_set_named_property(env, exports, "queueWork", fn);
  napi_create_function(env, NULL, 0, default_loop_is_napi_loop, NULL, &fn);
  napi_set_named_property(env, exports, "defaultLoopIsNapiLoop", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

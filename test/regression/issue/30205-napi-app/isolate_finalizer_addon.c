// Non-experimental (NAPI_VERSION 8) addon that napi_wrap()s each object it's
// handed. Because nm_version != NAPI_VERSION_EXPERIMENTAL, the finalizer is
// deferred to a NapiFinalizerTask on the event loop rather than run inside GC
// sweep. Under `bun test --isolate`, objects rooted on the old global only
// become collectable once the swap gcUnprotect()s it; their finalizers then
// run while the *next* file is loading, with a NapiEnv whose m_globalObject
// used to point at the now-dead old global. See test/regression/issue/30205.

#include <js_native_api.h>
#include <node_api.h>
#include <stdlib.h>

#define CALL(env, call)                                                        \
  do {                                                                         \
    if ((call) != napi_ok) {                                                   \
      napi_throw_error((env), NULL, "napi call failed: " #call);              \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

static void finalize(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  free(data);
}

// wrap(obj) -> obj  — attaches a deferred finalizer and returns the same
// object so the caller can root it (e.g. on globalThis).
static napi_value wrap(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CALL(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "wrap: expected one argument");
    return NULL;
  }
  int *data = (int *)malloc(sizeof *data);
  *data = 1;
  CALL(env, napi_wrap(env, argv[0], data, finalize, NULL, NULL));
  return argv[0];
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value fn;
  CALL(env, napi_create_function(env, "wrap", NAPI_AUTO_LENGTH, wrap, NULL, &fn));
  CALL(env, napi_set_named_property(env, exports, "wrap", fn));
  return exports;
}

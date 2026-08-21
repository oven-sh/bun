// Built twice (see binding.gyp): as crash_report_addon, whose exports crash on
// request from a method or from a finalizer, and with CRASH_ON_LOAD as
// crash_report_on_load_addon, which crashes inside its own register function.
// The crash is napi_fatal_error, which goes through bun's crash reporter like
// any other panic, so the tests can check which native module the report names.
#include <node_api.h>
#include <stddef.h>

static void fatal(const char *where) {
  napi_fatal_error(where, NAPI_AUTO_LENGTH, "crash_report_addon", NAPI_AUTO_LENGTH);
}

#ifdef CRASH_ON_LOAD

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  fatal("register");
  return exports;
}

#else

static napi_value crash_in_method(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  fatal("method");
  return NULL;
}

static void crashing_finalizer(napi_env env, void *data, void *hint) {
  (void)env;
  (void)data;
  (void)hint;
  fatal("finalizer");
}

// Returns an object whose finalizer crashes. It runs when the object is
// collected or, at the latest, when the environment is torn down at exit.
static napi_value crash_in_finalizer(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value object;
  napi_create_object(env, &object);
  napi_wrap(env, object, NULL, crashing_finalizer, NULL, NULL);
  return object;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_property_descriptor props[] = {
      {"crashInMethod", NULL, crash_in_method, NULL, NULL, NULL, napi_default, NULL},
      {"crashInFinalizer", NULL, crash_in_finalizer, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

#endif

// Exports createLatin1()/createUtf16() which return strings created via
// node_api_create_external_string_{latin1,utf16} with a finalizer that frees
// the backing buffer and increments a counter, plus finalizedCount() to read
// it. Used by test/napi/napi-external-string-env.test.ts to exercise the
// ExternalStringImpl finalizer path through env->doFinalizer() during worker
// teardown.

#include <js_native_api.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#define CALL(env, call)                                                        \
  do {                                                                         \
    if ((call) != napi_ok) {                                                   \
      napi_throw_error((env), NULL, "napi call failed: " #call);              \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

static int g_finalized = 0;

static void finalize_latin1(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  g_finalized++;
  free(data);
}

static void finalize_utf16(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  g_finalized++;
  free(data);
}

static napi_value create_latin1(napi_env env, napi_callback_info info) {
  (void)info;
  // Each call allocates its own backing buffer so the JSString holds the only
  // reference to the ExternalStringImpl; rooting the string on globalThis
  // keeps the impl alive until worker teardown sweeps the global.
  char *buf = (char *)malloc(32);
  memcpy(buf, "external-latin1-string-xxxxxxxx", 32);
  napi_value result;
  bool copied;
  CALL(env, node_api_create_external_string_latin1(env, buf, 31,
                                                    finalize_latin1, NULL,
                                                    &result, &copied));
  return result;
}

static napi_value create_utf16(napi_env env, napi_callback_info info) {
  (void)info;
  static const char16_t src[] = u"external-utf16-string-xxxxxxxxx";
  char16_t *buf = (char16_t *)malloc(sizeof(src));
  memcpy(buf, src, sizeof(src));
  napi_value result;
  bool copied;
  CALL(env, node_api_create_external_string_utf16(env, buf,
                                                   (sizeof(src) / sizeof(char16_t)) - 1,
                                                   finalize_utf16, NULL,
                                                   &result, &copied));
  return result;
}

static napi_value finalized_count(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  CALL(env, napi_create_int32(env, g_finalized, &result));
  return result;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value fn;
  CALL(env, napi_create_function(env, "createLatin1", NAPI_AUTO_LENGTH,
                                  create_latin1, NULL, &fn));
  CALL(env, napi_set_named_property(env, exports, "createLatin1", fn));
  CALL(env, napi_create_function(env, "createUtf16", NAPI_AUTO_LENGTH,
                                  create_utf16, NULL, &fn));
  CALL(env, napi_set_named_property(env, exports, "createUtf16", fn));
  CALL(env, napi_create_function(env, "finalizedCount", NAPI_AUTO_LENGTH,
                                  finalized_count, NULL, &fn));
  CALL(env, napi_set_named_property(env, exports, "finalizedCount", fn));
  return exports;
}

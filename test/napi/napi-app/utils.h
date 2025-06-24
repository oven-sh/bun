#pragma once
#include "napi_with_version.h"
#include <climits>

#ifndef _WIN32
#include <fcntl.h>
#include <stdio.h>

// Node.js makes stdout non-blocking
// This messes up printf when you spam it quickly enough.
class BlockingStdoutScope {
public:
  BlockingStdoutScope() {
    original = fcntl(1, F_GETFL);
    fcntl(1, F_SETFL, original & ~O_NONBLOCK);
    setvbuf(stdout, nullptr, _IOFBF, 8192);
    fflush(stdout);
  }

  ~BlockingStdoutScope() {
    fflush(stdout);
    fcntl(1, F_SETFL, original);
    setvbuf(stdout, nullptr, _IOLBF, 0);
  }

private:
  int original;
};

#endif

// e.g NODE_API_CALL(env, napi_create_int32(env, 5, &my_napi_integer))
#define NODE_API_CALL(env, call) NODE_API_CALL_CUSTOM_RETURN(env, NULL, call)

// Version of NODE_API_CALL for functions not returning napi_value
#define NODE_API_CALL_CUSTOM_RETURN(env, value_to_return_if_threw, call)       \
  NODE_API_ASSERT_CUSTOM_RETURN(env, value_to_return_if_threw,                 \
                                (call) == napi_ok)

// Throw an error in the given napi_env and return if expr is false
#define NODE_API_ASSERT(env, expr)                                             \
  NODE_API_ASSERT_CUSTOM_RETURN(env, NULL, expr)

#ifdef _MSC_VER
#define CURRENT_FUNCTION_NAME __FUNCSIG__
#else
#define CURRENT_FUNCTION_NAME __PRETTY_FUNCTION__
#endif

// Version of NODE_API_ASSERT for functions not returning napi_value
#define NODE_API_ASSERT_CUSTOM_RETURN(ENV, VALUE_TO_RETURN_IF_THREW, EXPR)     \
  do {                                                                         \
    if (!(EXPR)) {                                                             \
      bool is_pending;                                                         \
      napi_is_exception_pending((ENV), &is_pending);                           \
      /* If an exception is already pending, don't rethrow it */               \
      if (!is_pending) {                                                       \
        char buf[4096] = {0};                                                  \
        snprintf(buf, sizeof(buf) - 1, "%s (%s:%d): Assertion failed: %s",     \
                 CURRENT_FUNCTION_NAME, __FILE__, __LINE__, #EXPR);            \
        napi_throw_error((ENV), NULL, buf);                                    \
      }                                                                        \
      return (VALUE_TO_RETURN_IF_THREW);                                       \
    }                                                                          \
  } while (0)

#define REGISTER_FUNCTION(ENV, EXPORTS, FUNCTION)                              \
  EXPORTS.Set(#FUNCTION, Napi::Function::New(ENV, FUNCTION))

static inline napi_value ok(napi_env env) {
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

// For functions that take a garbage collection callback as the first argument
// (functions not called directly by module.js), use this to trigger GC
static inline void run_gc(const Napi::CallbackInfo &info) {
  info[0].As<Napi::Function>().Call(0, nullptr);
}

// calls napi_typeof and asserts it returns napi_ok
static inline napi_valuetype get_typeof(napi_env env, napi_value value) {
  napi_valuetype result;
  // return an invalid napi_valuetype if the call to napi_typeof fails
  NODE_API_CALL_CUSTOM_RETURN(env, static_cast<napi_valuetype>(INT_MAX),
                              napi_typeof(env, value, &result));
  return result;
}

static inline const char *napi_valuetype_to_string(napi_valuetype type) {
  switch (type) {
  case napi_undefined:
    return "undefined";
  case napi_null:
    return "null";
  case napi_boolean:
    return "boolean";
  case napi_number:
    return "number";
  case napi_string:
    return "string";
  case napi_symbol:
    return "symbol";
  case napi_object:
    return "object";
  case napi_function:
    return "function";
  case napi_external:
    return "external";
  case napi_bigint:
    return "bigint";
  default:
    return "unknown";
  }
}

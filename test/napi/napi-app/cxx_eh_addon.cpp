// C++ exceptions thrown and caught inside the addon. node-gyp links Windows
// addons against the static CRT, so the throw machinery is part of the addon
// itself. When `bun build --compile` merges the addon into the exe, that
// machinery asks the OS which image the throw site belongs to and resolves
// the exception's type information relative to that image; the merge has to
// answer with the addon's own base for catch clauses to match (see
// src/standalone_graph/LinkedNodeModule.rs). The fixture compares the output
// of these functions between the addon loaded as a DLL and merged.

#include <node_api.h>
#include <stdexcept>
#include <stdio.h>
#include <string>

#ifdef _MSC_VER
#define NOINLINE __declspec(noinline)
#else
#define NOINLINE __attribute__((noinline))
#endif

static napi_value make_string(napi_env env, const std::string &str) {
  napi_value result;
  if (napi_create_string_utf8(env, str.c_str(), str.size(), &result) != napi_ok) {
    napi_throw_error(env, nullptr, "napi_create_string_utf8 failed");
    return nullptr;
  }
  return result;
}

struct custom_error {
  int code;
};

// Counts destructors run while unwinding through the intermediate frames.
struct guard {
  int *counter;
  explicit guard(int *c) : counter(c) {}
  ~guard() { ++*counter; }
};

static NOINLINE void throw_runtime_error(int *destructors) {
  guard g(destructors);
  throw std::runtime_error("boom");
}

static NOINLINE void throw_through_frame(int *destructors) {
  guard g(destructors);
  throw_runtime_error(destructors);
}

static NOINLINE void throw_custom(int *destructors, int code) {
  guard g(destructors);
  throw custom_error{code};
}

// Throws a standard exception through two frames with destructors and catches
// it by a base class, then throws a user type past a non-matching clause.
// Both depend on the thrown type information resolving against the right
// image base.
static NOINLINE std::string run(void) {
  int destructors = 0;
  std::string out;
  try {
    throw_through_frame(&destructors);
    out += "fell through";
  } catch (const std::exception &e) {
    out += std::string("caught ") + e.what();
  }
  char buffer[64];
  snprintf(buffer, sizeof buffer, ", destructors: %d", destructors);
  out += buffer;
  try {
    throw_custom(&destructors, 42);
    out += ", fell through";
  } catch (const std::logic_error &) {
    out += ", wrong clause";
  } catch (const custom_error &e) {
    snprintf(buffer, sizeof buffer, ", custom %d", e.code);
    out += buffer;
  }
  snprintf(buffer, sizeof buffer, ", destructors: %d", destructors);
  out += buffer;
  return out;
}

static napi_value throw_and_catch(napi_env env, napi_callback_info info) {
  (void)info;
  return make_string(env, "cxx: " + run());
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value fn;
  if (napi_create_function(env, "throw_and_catch", NAPI_AUTO_LENGTH,
                           throw_and_catch, nullptr, &fn) != napi_ok ||
      napi_set_named_property(env, exports, "throw_and_catch", fn) != napi_ok) {
    napi_throw_error(env, nullptr, "failed to register throw_and_catch");
    return nullptr;
  }
  return exports;
}

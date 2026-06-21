// A native addon whose file-scope object throws from its destructor. The
// destructor runs from __cxa_finalize when libc exit() is used (macOS, and
// ASAN builds on other POSIX platforms). It models a real-world addon whose
// teardown fails after the VM has been torn down. Bun should honor the
// process.exit() code rather than reporting a crash from std::terminate.
#include <node_api.h>

struct ThrowsOnDestruct {
  ~ThrowsOnDestruct() noexcept(false) { throw 1; }
};

static ThrowsOnDestruct instance;

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  (void)env;
  return exports;
}

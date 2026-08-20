// Built with compileFixture() by run-crash-handler.test.ts. Stands in for a
// Node-API addon or bun:ffi library that has a bug of its own.
#include <stdint.h>

#ifdef _WIN32
#include <windows.h>
#define EXPORT __declspec(dllexport)
#else
#include <stdlib.h>
#define EXPORT __attribute__((visibility("default")))
#endif

EXPORT void crash_in_native_module(void) {
  *(volatile int*)0 = 1;
}

// A code address inside a library the operating system ships. `Sleep` lives in
// kernel32.dll; `labs` lives in libc (bun itself does not import it, so the
// address cannot resolve to a PLT stub inside the bun executable).
EXPORT uintptr_t address_in_system_library(void) {
#ifdef _WIN32
  return (uintptr_t)&Sleep;
#else
  return (uintptr_t)&labs;
#endif
}

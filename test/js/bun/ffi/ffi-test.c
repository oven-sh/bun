#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#define FFI_EXPORT __declspec(dllexport)
#else
#define FFI_EXPORT __attribute__((visibility("default")))
#endif

static uint8_t buffer_with_deallocator[128];
static int deallocatorCalled;
FFI_EXPORT void deallocator(void *ptr, void *userData) { deallocatorCalled++; }
FFI_EXPORT void *getDeallocatorCallback() {
  deallocatorCalled = 0;
  return &deallocator;
}
FFI_EXPORT void *getDeallocatorBuffer() {
  deallocatorCalled = 0;
  return &buffer_with_deallocator;
}
FFI_EXPORT int getDeallocatorCalledCount() { return deallocatorCalled; }

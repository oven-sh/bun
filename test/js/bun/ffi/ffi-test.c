#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#define FFI_EXPORT __declspec(dllexport)
#else
#define FFI_EXPORT __attribute__((visibility("default")))
#endif

FFI_EXPORT bool returns_true();
FFI_EXPORT bool returns_false();
FFI_EXPORT char returns_42_char();
FFI_EXPORT float returns_42_float();
FFI_EXPORT double returns_42_double();
FFI_EXPORT uint8_t returns_42_uint8_t();
FFI_EXPORT int8_t returns_neg_42_int8_t();
FFI_EXPORT uint16_t returns_42_uint16_t();
FFI_EXPORT uint32_t returns_42_uint32_t();
FFI_EXPORT uint64_t returns_42_uint64_t();
FFI_EXPORT int16_t returns_neg_42_int16_t();
FFI_EXPORT int32_t returns_neg_42_int32_t();
FFI_EXPORT int64_t returns_neg_42_int64_t();

FFI_EXPORT bool cb_identity_true(bool (*cb)());
FFI_EXPORT bool cb_identity_false(bool (*cb)());
FFI_EXPORT char cb_identity_42_char(char (*cb)());
FFI_EXPORT float cb_identity_42_float(float (*cb)());
FFI_EXPORT double cb_identity_42_double(double (*cb)());
FFI_EXPORT uint8_t cb_identity_42_uint8_t(uint8_t (*cb)());
FFI_EXPORT int8_t cb_identity_neg_42_int8_t(int8_t (*cb)());
FFI_EXPORT uint16_t cb_identity_42_uint16_t(uint16_t (*cb)());
FFI_EXPORT uint32_t cb_identity_42_uint32_t(uint32_t (*cb)());
FFI_EXPORT uint64_t cb_identity_42_uint64_t(uint64_t (*cb)());
FFI_EXPORT int16_t cb_identity_neg_42_int16_t(int16_t (*cb)());
FFI_EXPORT int32_t cb_identity_neg_42_int32_t(int32_t (*cb)());
FFI_EXPORT int64_t cb_identity_neg_42_int64_t(int64_t (*cb)());

FFI_EXPORT bool identity_bool_true();
FFI_EXPORT bool identity_bool_false();
FFI_EXPORT char identity_char(char a);
FFI_EXPORT float identity_float(float a);
FFI_EXPORT bool identity_bool(bool ident);
FFI_EXPORT double identity_double(double a);
FFI_EXPORT int8_t identity_int8_t(int8_t a);
FFI_EXPORT int16_t identity_int16_t(int16_t a);
FFI_EXPORT int32_t identity_int32_t(int32_t a);
FFI_EXPORT int64_t identity_int64_t(int64_t a);
FFI_EXPORT uint8_t identity_uint8_t(uint8_t a);
FFI_EXPORT uint16_t identity_uint16_t(uint16_t a);
FFI_EXPORT uint32_t identity_uint32_t(uint32_t a);
FFI_EXPORT uint64_t identity_uint64_t(uint64_t a);
FFI_EXPORT void *identity_ptr(void *ident);

FFI_EXPORT char add_char(char a, char b);
FFI_EXPORT float add_float(float a, float b);
FFI_EXPORT double add_double(double a, double b);
FFI_EXPORT int8_t add_int8_t(int8_t a, int8_t b);
FFI_EXPORT int16_t add_int16_t(int16_t a, int16_t b);
FFI_EXPORT int32_t add_int32_t(int32_t a, int32_t b);
FFI_EXPORT int64_t add_int64_t(int64_t a, int64_t b);
FFI_EXPORT uint8_t add_uint8_t(uint8_t a, uint8_t b);
FFI_EXPORT uint16_t add_uint16_t(uint16_t a, uint16_t b);
FFI_EXPORT uint32_t add_uint32_t(uint32_t a, uint32_t b);
FFI_EXPORT uint64_t add_uint64_t(uint64_t a, uint64_t b);

bool returns_false() { return false; }
bool returns_true() { return true; }
char returns_42_char() { return '*'; }
double returns_42_double() { return (double)42.42; }
float returns_42_float() { return 42.42f; }
int16_t returns_neg_42_int16_t() { return -42; }
int32_t returns_neg_42_int32_t() { return -42; }
int64_t returns_neg_42_int64_t() { return -42; }
int8_t returns_neg_42_int8_t() { return -42; }
uint16_t returns_42_uint16_t() { return 42; }
uint32_t returns_42_uint32_t() { return 42; }
uint64_t returns_42_uint64_t() { return 42; }
uint8_t returns_42_uint8_t() { return (uint8_t)42; }

char identity_char(char a) { return a; }
float identity_float(float a) { return a; }
double identity_double(double a) { return a; }
int8_t identity_int8_t(int8_t a) { return a; }
int16_t identity_int16_t(int16_t a) { return a; }
int32_t identity_int32_t(int32_t a) { return a; }
int64_t identity_int64_t(int64_t a) { return a; }
uint8_t identity_uint8_t(uint8_t a) { return a; }
uint16_t identity_uint16_t(uint16_t a) { return a; }
uint32_t identity_uint32_t(uint32_t a) { return a; }
uint64_t identity_uint64_t(uint64_t a) { return a; }
bool identity_bool(bool ident) { return ident; }
void *identity_ptr(void *ident) { return ident; }

char add_char(char a, char b) { return a + b; }
float add_float(float a, float b) { return a + b; }
double add_double(double a, double b) { return a + b; }
int8_t add_int8_t(int8_t a, int8_t b) { return a + b; }
int16_t add_int16_t(int16_t a, int16_t b) { return a + b; }
int32_t add_int32_t(int32_t a, int32_t b) { return a + b; }
int64_t add_int64_t(int64_t a, int64_t b) { return a + b; }
uint8_t add_uint8_t(uint8_t a, uint8_t b) { return a + b; }
uint16_t add_uint16_t(uint16_t a, uint16_t b) { return a + b; }
uint32_t add_uint32_t(uint32_t a, uint32_t b) { return a + b; }
uint64_t add_uint64_t(uint64_t a, uint64_t b) { return a + b; }

FFI_EXPORT void *ptr_should_point_to_42_as_int32_t();

void *ptr_should_point_to_42_as_int32_t() {
  int32_t *ptr = malloc(sizeof(int32_t));
  *ptr = 42;
  return ptr;
}

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

FFI_EXPORT bool is_null(int32_t *ptr) { return ptr == NULL; }
FFI_EXPORT bool does_pointer_equal_42_as_int32_t(int32_t *ptr);
bool does_pointer_equal_42_as_int32_t(int32_t *ptr) { return *ptr == 42; }

FFI_EXPORT void *return_a_function_ptr_to_function_that_returns_true();
void *return_a_function_ptr_to_function_that_returns_true() {
  return (void *)&returns_true;
}

FFI_EXPORT bool cb_identity_true(bool (*cb)()) { return cb(); }

FFI_EXPORT bool cb_identity_false(bool (*cb)()) { return cb(); }
FFI_EXPORT char cb_identity_42_char(char (*cb)()) { return cb(); }
FFI_EXPORT float cb_identity_42_float(float (*cb)()) { return cb(); }
FFI_EXPORT double cb_identity_42_double(double (*cb)()) { return cb(); }
FFI_EXPORT uint8_t cb_identity_42_uint8_t(uint8_t (*cb)()) { return cb(); }
FFI_EXPORT int8_t cb_identity_neg_42_int8_t(int8_t (*cb)()) { return cb(); }
FFI_EXPORT uint16_t cb_identity_42_uint16_t(uint16_t (*cb)()) { return cb(); }
FFI_EXPORT uint32_t cb_identity_42_uint32_t(uint32_t (*cb)()) { return cb(); }
FFI_EXPORT uint64_t cb_identity_42_uint64_t(uint64_t (*cb)()) { return cb(); }
FFI_EXPORT int16_t cb_identity_neg_42_int16_t(int16_t (*cb)()) { return cb(); }
FFI_EXPORT int32_t cb_identity_neg_42_int32_t(int32_t (*cb)()) { return cb(); }
FFI_EXPORT int64_t cb_identity_neg_42_int64_t(int64_t (*cb)()) { return cb(); }
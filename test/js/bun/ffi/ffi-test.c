#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

bool returns_true();
bool returns_false();
char returns_42_char();
float returns_42_float();
double returns_42_double();
uint8_t returns_42_uint8_t();
int8_t returns_neg_42_int8_t();
uint16_t returns_42_uint16_t();
uint32_t returns_42_uint32_t();
uint64_t returns_42_uint64_t();
int16_t returns_neg_42_int16_t();
int32_t returns_neg_42_int32_t();
int64_t returns_neg_42_int64_t();

bool cb_identity_true(bool (*cb)());
bool cb_identity_false(bool (*cb)());
char cb_identity_42_char(char (*cb)());
float cb_identity_42_float(float (*cb)());
double cb_identity_42_double(double (*cb)());
uint8_t cb_identity_42_uint8_t(uint8_t (*cb)());
int8_t cb_identity_neg_42_int8_t(int8_t (*cb)());
uint16_t cb_identity_42_uint16_t(uint16_t (*cb)());
uint32_t cb_identity_42_uint32_t(uint32_t (*cb)());
uint64_t cb_identity_42_uint64_t(uint64_t (*cb)());
int16_t cb_identity_neg_42_int16_t(int16_t (*cb)());
int32_t cb_identity_neg_42_int32_t(int32_t (*cb)());
int64_t cb_identity_neg_42_int64_t(int64_t (*cb)());

bool identity_bool_true();
bool identity_bool_false();
char identity_char(char a);
float identity_float(float a);
bool identity_bool(bool ident);
double identity_double(double a);
int8_t identity_int8_t(int8_t a);
int16_t identity_int16_t(int16_t a);
int32_t identity_int32_t(int32_t a);
int64_t identity_int64_t(int64_t a);
uint8_t identity_uint8_t(uint8_t a);
uint16_t identity_uint16_t(uint16_t a);
uint32_t identity_uint32_t(uint32_t a);
uint64_t identity_uint64_t(uint64_t a);

char add_char(char a, char b);
float add_float(float a, float b);
double add_double(double a, double b);
int8_t add_int8_t(int8_t a, int8_t b);
int16_t add_int16_t(int16_t a, int16_t b);
int32_t add_int32_t(int32_t a, int32_t b);
int64_t add_int64_t(int64_t a, int64_t b);
uint8_t add_uint8_t(uint8_t a, uint8_t b);
uint16_t add_uint16_t(uint16_t a, uint16_t b);
uint32_t add_uint32_t(uint32_t a, uint32_t b);
uint64_t add_uint64_t(uint64_t a, uint64_t b);

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

void *ptr_should_point_to_42_as_int32_t();
void *ptr_should_point_to_42_as_int32_t() {
  int32_t *ptr = malloc(sizeof(int32_t));
  *ptr = 42;
  return ptr;
}

static uint8_t buffer_with_deallocator[128];
static int deallocatorCalled;
void deallocator(void *ptr, void *userData) { deallocatorCalled++; }
void *getDeallocatorCallback() {
  deallocatorCalled = 0;
  return &deallocator;
}
void *getDeallocatorBuffer() {
  deallocatorCalled = 0;
  return &buffer_with_deallocator;
}
int getDeallocatorCalledCount() { return deallocatorCalled; }

bool is_null(int32_t *ptr) { return ptr == NULL; }
bool does_pointer_equal_42_as_int32_t(int32_t *ptr);
bool does_pointer_equal_42_as_int32_t(int32_t *ptr) { return *ptr == 42; }

void *return_a_function_ptr_to_function_that_returns_true();
void *return_a_function_ptr_to_function_that_returns_true() {
  return (void *)&returns_true;
}

bool cb_identity_true(bool (*cb)()) { return cb(); }

bool cb_identity_false(bool (*cb)()) { return cb(); }
char cb_identity_42_char(char (*cb)()) { return cb(); }
float cb_identity_42_float(float (*cb)()) { return cb(); }
double cb_identity_42_double(double (*cb)()) { return cb(); }
uint8_t cb_identity_42_uint8_t(uint8_t (*cb)()) { return cb(); }
int8_t cb_identity_neg_42_int8_t(int8_t (*cb)()) { return cb(); }
uint16_t cb_identity_42_uint16_t(uint16_t (*cb)()) { return cb(); }
uint32_t cb_identity_42_uint32_t(uint32_t (*cb)()) { return cb(); }
uint64_t cb_identity_42_uint64_t(uint64_t (*cb)()) { return cb(); }
int16_t cb_identity_neg_42_int16_t(int16_t (*cb)()) { return cb(); }
int32_t cb_identity_neg_42_int32_t(int32_t (*cb)()) { return cb(); }
int64_t cb_identity_neg_42_int64_t(int64_t (*cb)()) { return cb(); }
// C11 6.5.4: casts between every pair of scalar types, to void, and what a cast is not (an lvalue).
#include <stdint.h>
#include <stdio.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

// Every arithmetic type from every arithmetic type, for a value both can represent and one that must be reduced.
#define FROM(S) \
  do { \
    volatile S small = (S)42, negative = (S)-3; \
    CHECK((_Bool)small == 1 && (char)small == 42 && (signed char)small == 42 && (unsigned char)small == 42); \
    CHECK((short)small == 42 && (unsigned short)small == 42 && (int)small == 42 && (unsigned)small == 42u); \
    CHECK((long)small == 42L && (unsigned long)small == 42UL && (long long)small == 42LL && (unsigned long long)small == 42ULL); \
    CHECK((float)small == 42.0f && (double)small == 42.0 && (long double)small == 42.0L); \
    if ((S)-1 < (S)0) { \
      CHECK((signed char)negative == -3 && (short)negative == -3 && (int)negative == -3 && (long long)negative == -3); \
      CHECK((float)negative == -3.0f && (double)negative == -3.0); \
    } \
    if ((S)0.5 == 0 && (S)-1 < (S)0) { /* a signed integer type: conversion to unsigned reduces modulo 2^N */ \
      CHECK((unsigned char)negative == (unsigned char)(0 - 3u) && (unsigned short)negative == (unsigned short)(0 - 3u)); \
      CHECK((unsigned)negative == 0 - 3u && (unsigned long long)negative == 0 - 3ull); \
    } \
  } while (0)

enum color { RED = 1, GREEN = 300 };

int main(void) {
  FROM(char); FROM(signed char); FROM(unsigned char); FROM(short); FROM(unsigned short); FROM(int); FROM(unsigned);
  FROM(long); FROM(unsigned long); FROM(long long); FROM(unsigned long long); FROM(float); FROM(double); FROM(long double);
  // Narrowing keeps the low bits; a floating value loses its fraction.
  CHECK((unsigned char)0x1234 == 0x34 && (short)0x12345678 == 0x5678 && (int)0x123456789aLL == 0x3456789a);
  CHECK((int)3.99 == 3 && (int)-3.99 == -3 && (unsigned char)(int)300.7 == 44 && (long long)1e15 == 1000000000000000LL);
  CHECK((float)0.1 != 0.1 && (double)(float)0.5 == 0.5 && (int)(float)16777217 == 16777216);
  // Enumerations, _Bool and characters are integers like any other.
  CHECK((enum color)1 == RED && (int)GREEN == 300 && (unsigned char)GREEN == 44 && (_Bool)GREEN == 1 && (_Bool)0.1 == 1);
  // Pointers: to any object pointer type and back, to an integer wide enough and back, null stays null.
  int object = 7; int *p = &object;
  CHECK((int *)(void *)p == p && (int *)(char *)p == p && (int *)(uintptr_t)p == p && (int *)(intptr_t)p == p);
  CHECK(*(int *)(void *)p == 7 && (void *)0 == (int *)0 && (uintptr_t)(void *)0 == 0 && (char *)0 == 0);
  CHECK(*(unsigned char *)p == (unsigned char)7 || *((unsigned char *)p + sizeof(int) - 1) == 7);
  const int *c = p; CHECK(*(int *)c == 7);
  int (*f)(void) = (int (*)(void))(void (*)(void))main; CHECK(f == main);
  // A cast to void discards; a cast to the same type and a redundant one change nothing.
  (void)object; (void)(object + 1); (void)main;
  CHECK((int)object == 7 && (int)(int)(long)(short)object == 7 && (double)(float)(double)1.5 == 1.5);
  // A cast's operand is converted as if by assignment, after the usual promotions of what is inside it.
  CHECK((unsigned char)(200 + 100) == 44 && (unsigned char)200 + (unsigned char)100 == 300 && (int)(unsigned char)-1 == 255);
  CHECK((long long)(int)0x80000000u == -2147483648LL && (unsigned long long)(int)-1 == 0xffffffffffffffffULL && (unsigned long long)(unsigned)-1 == 0xffffffffULL);
  CHECK(-(unsigned char)1 == -1 && (unsigned)-(unsigned char)1 == 0xffffffffu && ~(unsigned char)0 == -1);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

// Every value of a switch's type can be a case: the largest and the smallest, the ones next to them, and a dense
// run of cases next to a sparse one.
#include <limits.h>
#include <stdio.h>

__attribute__((noinline)) static int on_long(long x) {
  switch (x) {
  case LONG_MAX: return 1;
  case LONG_MAX - 1: return 2;
  case LONG_MIN: return 3;
  case LONG_MIN + 1: return 4;
  case -1: return 5;
  case 0: return 6;
  default: return 0;
  }
}
__attribute__((noinline)) static int on_unsigned_long(unsigned long x) {
  switch (x) {
  case 0: return 1;
  case 1: return 2;
  case ULONG_MAX / 2: return 3;
  case ULONG_MAX / 2 + 1: return 4;
  case ULONG_MAX - 1: return 5;
  case ULONG_MAX: return 6;
  default: return 0;
  }
}
__attribute__((noinline)) static int on_long_long_alone(long long x) {
  switch (x) {
  case LLONG_MAX: return 1;
  default: return 0;
  }
}
__attribute__((noinline)) static int on_int(int x) {
  switch (x) {
  case INT_MAX: return 1;
  case INT_MIN: return 2;
  case INT_MAX - 1: return 3;
  case INT_MIN + 1: return 4;
  case -1: return 5;
  case 0: return 6;
  default: return 0;
  }
}
__attribute__((noinline)) static int on_unsigned(unsigned x) {
  switch (x) {
  case 0x80000000u: return 1;
  case 0xffffffffu: return 2;
  case 0x7fffffffu: return 3;
  case 0: return 4;
  default: return 0;
  }
}
__attribute__((noinline)) static int on_signed_char(signed char x) {
  switch (x) {
  case -128: return 1;
  case 127: return 2;
  case -1: return 3;
  default: return 0;
  }
}
__attribute__((noinline)) static int dense_and_sparse(long x) {
  switch (x) {
  case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7: return (int)x + 10;
  case 0x80000000L: return 1;
  case 0x100000000L: return 2;
  case -0x80000001L: return 3;
  case LONG_MAX: return 4;
  case LONG_MIN: return 5;
  default: return 0;
  }
}

int main(void) {
  const long longs[] = { LONG_MAX, LONG_MAX - 1, LONG_MAX - 2, LONG_MIN, LONG_MIN + 1, LONG_MIN + 2, -1, 0, 1, -2, 0x100000000L, 7, 8, 0x80000000L, -0x80000001L, 0x7fffffffL };
  for (unsigned i = 0; i < sizeof longs / sizeof *longs; i++)
    printf("%ld: %d %d %d %d\n", longs[i], on_long(longs[i]), on_unsigned_long((unsigned long)longs[i]), on_long_long_alone(longs[i]), dense_and_sparse(longs[i]));
  const int ints[] = { INT_MAX, INT_MIN, INT_MAX - 1, INT_MIN + 1, INT_MAX - 2, INT_MIN + 2, -1, 0, 1, 127, -128, 128, -129 };
  for (unsigned i = 0; i < sizeof ints / sizeof *ints; i++)
    printf("%d: %d %d %d\n", ints[i], on_int(ints[i]), on_unsigned((unsigned)ints[i]), on_signed_char((signed char)ints[i]));
  return 0;
}

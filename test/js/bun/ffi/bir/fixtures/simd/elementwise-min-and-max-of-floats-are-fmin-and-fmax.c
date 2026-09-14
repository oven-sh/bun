// Clang's `__builtin_elementwise_min` and `max`, and `__builtin_reduce_min` and `max`, are `fmin` and `fmax` lane by
// lane: where one operand is not a number the result is the other one. (x86's MINPS is another thing: it gives its
// second operand then, and `_mm_min_ps` is that; the IEEE 754-2019 `minimum` is a third, which gives the NaN.) For
// four floats, two doubles and the 8-byte vectors, a NaN in the first operand, in the second and in both. (Which of two
// zeros of different signs is the lesser Clang answers differently at different levels.)
#include <stdio.h>
#include <string.h>

typedef float f4 __attribute__((vector_size(16)));
typedef double d2 __attribute__((vector_size(16)));
typedef float f2 __attribute__((vector_size(8)));

static void show4(const char *what, f4 v) {
  unsigned bits[4];
  memcpy(bits, &v, sizeof bits);
  // (Which NaN comes back where both are one is not pinned.)
  printf("%-22s", what);
  for (int i = 0; i < 4; i++) v[i] != v[i] ? printf(" nan") : printf(" %08x", bits[i]);
  printf("\n");
}
static void show2(const char *what, d2 v) {
  unsigned long long bits[2];
  memcpy(bits, &v, sizeof bits);
  printf("%-22s", what);
  for (int i = 0; i < 2; i++) v[i] != v[i] ? printf(" nan") : printf(" %016llx", bits[i]);
  printf("\n");
}

int main(void) {
  volatile float nan = __builtin_nanf("");
  volatile double dnan = __builtin_nan("");
  f4 a = { nan, 1, 6, -8 }, b = { 2, nan, -6, 8 }, both = { nan, nan, 3, -3 }, plain = { 5, -5, 4, -4 };
  show4("min(a, b)", __builtin_elementwise_min(a, b));
  show4("min(b, a)", __builtin_elementwise_min(b, a));
  show4("max(a, b)", __builtin_elementwise_max(a, b));
  show4("max(b, a)", __builtin_elementwise_max(b, a));
  show4("min(both, plain)", __builtin_elementwise_min(both, plain));
  show4("max(plain, both)", __builtin_elementwise_max(plain, both));
  show4("min(both, both)", __builtin_elementwise_min(both, both));
  d2 x = { dnan, 1 }, y = { 2, dnan };
  show2("min of doubles", __builtin_elementwise_min(x, y));
  show2("max of doubles", __builtin_elementwise_max(y, x));
  f2 p = { nan, 1 }, q = { 2, nan };
  f2 least = __builtin_elementwise_min(p, q), most = __builtin_elementwise_max(q, p);
  printf("%-22s %g %g %g %g\n", "of eight bytes", least[0], least[1], most[0], most[1]);
  f4 one_nan = { 3, nan, -7, 5 }, first_nan = { nan, 3, -7, 5 }, all_nan = { nan, nan, nan, nan };
  printf("%-22s %g %g %g %g\n", "reduce", __builtin_reduce_min(one_nan), __builtin_reduce_max(one_nan), __builtin_reduce_min(first_nan), __builtin_reduce_max(first_nan));
  float every = __builtin_reduce_min(all_nan);
  printf("%-22s %d %g %g\n", "reduce, none a number", every != every, __builtin_reduce_min(x), __builtin_reduce_max(y));
  // Integers are what they were.
  typedef int i4 __attribute__((vector_size(16)));
  i4 m = { 1, -2, 3, -4 }, n = { -1, 2, -3, 4 };
  i4 least_of = __builtin_elementwise_min(m, n);
  printf("%-22s %d %d %d %d %d %d\n", "integers", least_of[0], least_of[1], least_of[2], least_of[3], __builtin_reduce_min(m), __builtin_reduce_max(n));
  return 0;
}

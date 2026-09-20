// `__builtin_elementwise_minimum` and `maximum` (Clang's; GCC has neither) are the minimum and maximum of IEEE 754-2019: a
// NaN when either operand is one, and -0 below +0, which is what AArch64's FMIN and FMAX give. Of vectors of four
// floats, two doubles, two floats (8 bytes), of scalars, and across the lanes of one vector. `__builtin_elementwise_min`
// and `max` are next to them where the two kinds agree: numbers that differ.
#include <stdio.h>
#include <string.h>

typedef float F4 __attribute__((vector_size(16)));
typedef double D2 __attribute__((vector_size(16)));
typedef float F2 __attribute__((vector_size(8)));

typedef unsigned U4 __attribute__((vector_size(16)));
// FMINNM and FMAXNM, the way <arm_neon.h> puts them together: the operand that is a NaN gives way to the other first.
static F4 minimum_number(F4 a, F4 b) {
  U4 an = (U4)(a != a), bn = (U4)(b != b);
  return __builtin_elementwise_minimum((F4)(((U4)b & an) | ((U4)a & ~an)), (F4)(((U4)a & bn) | ((U4)b & ~bn)));
}
static F4 maximum_number(F4 a, F4 b) {
  U4 an = (U4)(a != a), bn = (U4)(b != b);
  return __builtin_elementwise_maximum((F4)(((U4)b & an) | ((U4)a & ~an)), (F4)(((U4)a & bn) | ((U4)b & ~bn)));
}

static unsigned bits32(float x) { unsigned b; memcpy(&b, &x, 4); return b; }
static unsigned long long bits64(double x) { unsigned long long b; memcpy(&b, &x, 8); return b; }
// A NaN is a NaN, whichever; everything else is its bits (which tell -0 from +0).
static void show32(float x) { if (x != x) printf(" nan"); else printf(" %08x", bits32(x)); }
static void show64(double x) { if (x != x) printf(" nan"); else printf(" %016llx", bits64(x)); }

int main(void) {
  volatile float nan = __builtin_nanf(""), inf = __builtin_inff(), zero = 0.0f;
  volatile double dnan = __builtin_nan(""), dinf = __builtin_inf(), dzero = 0.0;
  // Every pair of interesting values, in both orders, in every lane.
  float values[] = { nan, -inf, -2.5f, -zero, zero, 1.5f, inf };
  enum { N = sizeof values / sizeof values[0] };
  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j += 4) {
      F4 a = { values[i], values[i], values[i], values[i] };
      F4 b = { values[j % N], values[(j + 1) % N], values[(j + 2) % N], values[(j + 3) % N] };
      F4 low = __builtin_elementwise_minimum(a, b), high = __builtin_elementwise_maximum(a, b);
      F4 low_swapped = __builtin_elementwise_minimum(b, a), high_swapped = __builtin_elementwise_maximum(b, a);
      printf("f32x4 %d %d:", i, j);
      for (int k = 0; k < 4; k++) { show32(low[k]); show32(high[k]); show32(low_swapped[k]); show32(high_swapped[k]); }
      F4 low_number = minimum_number(a, b), high_number = maximum_number(b, a);
      printf(" |");
      for (int k = 0; k < 4; k++) { show32(low_number[k]); show32(high_number[k]); }
      printf("\n");
    }
  }
  double doubles[] = { dnan, -dinf, -2.5, -dzero, dzero, 1.5, dinf };
  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j += 2) {
      D2 a = { doubles[i], doubles[i] };
      D2 b = { doubles[j % N], doubles[(j + 1) % N] };
      D2 low = __builtin_elementwise_minimum(a, b), high = __builtin_elementwise_maximum(b, a);
      printf("f64x2 %d %d:", i, j);
      for (int k = 0; k < 2; k++) { show64(low[k]); show64(high[k]); }
      printf("\n");
    }
  }
  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j += 2) {
      F2 a = { values[i], values[i] };
      F2 b = { values[j % N], values[(j + 1) % N] };
      F2 low = __builtin_elementwise_minimum(a, b), high = __builtin_elementwise_maximum(a, b);
      printf("f32x2 %d %d:", i, j);
      for (int k = 0; k < 2; k++) { show32(low[k]); show32(high[k]); }
      printf("\n");
    }
  }
  // Two scalars.
  for (int i = 0; i < N; i++) {
    printf("scalars %d:", i);
    for (int j = 0; j < N; j++) {
      volatile float x = values[i], y = values[j];
      volatile double dx = doubles[i], dy = doubles[j];
      show32(__builtin_elementwise_minimum(x, y));
      show32(__builtin_elementwise_maximum(x, y));
      show64(__builtin_elementwise_minimum(dx, dy));
      show64(__builtin_elementwise_maximum(dx, dy));
    }
    printf("\n");
  }
  // Across the lanes of one vector: a NaN anywhere is the answer.
  F4 numbers = { 3.0f, -zero, zero, -7.5f }, with_a_nan = { 3.0f, nan, 1.0f, -7.5f };
  D2 two = { dzero, -dzero }, two_with_a_nan = { 1.0, dnan };
  printf("across:");
  show32(__builtin_reduce_minimum(numbers)); show32(__builtin_reduce_maximum(numbers));
  show32(__builtin_reduce_minimum(with_a_nan)); show32(__builtin_reduce_maximum(with_a_nan));
  show64(__builtin_reduce_minimum(two)); show64(__builtin_reduce_maximum(two));
  show64(__builtin_reduce_minimum(two_with_a_nan)); show64(__builtin_reduce_maximum(two_with_a_nan));
  printf("\n");
  // Where the numbers differ the older pair says the same.
  F4 p = { 1.0f, -2.0f, 3.5f, -inf }, q = { 2.0f, -3.0f, 3.25f, inf };
  F4 older = __builtin_elementwise_min(p, q) - __builtin_elementwise_minimum(p, q) + (__builtin_elementwise_max(p, q) - __builtin_elementwise_maximum(q, p));
  printf("the older pair:");
  for (int k = 0; k < 3; k++) show32(older[k]);
  printf("\n");
  return 0;
}

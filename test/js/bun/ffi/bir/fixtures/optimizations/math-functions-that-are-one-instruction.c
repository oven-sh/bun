// fabs, floor, ceil, trunc and sqrt, and their float forms, give what the C library gives for every kind of argument
// (they are compiled to the instruction), sqrt of a negative number still sets errno, and the functions whose results
// depend on more than the instruction does (fmin and fmax with a NaN, rint and nearbyint with the rounding mode,
// copysign) are still the library's.
#include <errno.h>
#include <fenv.h>
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static unsigned long long bits(double x) { unsigned long long b; memcpy(&b, &x, sizeof b); return b; }
static unsigned bitsf(float x) { unsigned b; memcpy(&b, &x, sizeof b); return b; }

int main(void) {
  volatile double values[] = { 0.0, -0.0, 1.0, -1.0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 0.49999999999999994, 4.0, 2.0, 1e-310, -1e-310, DBL_MIN, DBL_TRUE_MIN, 4503599627370495.5,
    4503599627370496.0, -4503599627370496.5, 9007199254740993.0, 1e300, -1e300, DBL_MAX, INFINITY, -INFINITY, NAN, 123456.789, -123456.789 };
  for (unsigned i = 0; i < sizeof values / sizeof *values; i++) {
    double x = values[i];
    float f = (float)x;
    // (Labelled by its bits: C libraries write a subnormal number two ways with %a.)
    printf("%016llx: %016llx %016llx %016llx %016llx %016llx | %08x %08x %08x %08x %08x\n", bits(x), bits(fabs(x)), bits(floor(x)), bits(ceil(x)), bits(trunc(x)), x < 0 ? 0 : bits(sqrt(x)),
      bitsf(fabsf(f)), bitsf(floorf(f)), bitsf(ceilf(f)), bitsf(truncf(f)), f < 0 ? 0 : bitsf(sqrtf(f)));
  }
  volatile double negative = -1.0, four = 4.0, nan = NAN;
  errno = 0;
  double root = sqrt(four);
  printf("sqrt(4) = %g, errno %d\n", root, errno);
  root = sqrt(negative);
  printf("sqrt(-1) is NaN: %d, errno is EDOM: %d\n", root != root, errno == EDOM);
  errno = 0;
  float rootf = sqrtf((float)negative * 4);
  printf("sqrtf(-4) is NaN: %d, errno is EDOM: %d\n", rootf != rootf, errno == EDOM);
  errno = 0;
  root = sqrt(nan);
  printf("sqrt(NaN) is NaN: %d, errno %d\n", root != root, errno);
  // In the middle of other arithmetic, in a loop.
  double total = 0;
  for (int i = 0; i < 1000; i++) total += sqrt((double)i) * floor(i / 7.0) - fabs(10.0 - i) + ceilf(i / 3.0f) + trunc(-i / 5.0);
  printf("total %.6f\n", total);
  // Still the library's.
  printf("fmin/fmax with NaN: %g %g %g %g\n", fmin(nan, 1.0), fmin(1.0, nan), fmax(nan, 1.0), fmax(1.0, nan));
  printf("copysign: %g %g\n", copysign(3.0, negative), copysign(3.0, -0.0));
  volatile double half = 2.5;
  fesetround(FE_UPWARD);
  printf("upward: rint %g nearbyint %g floor %g ceil %g trunc %g\n", rint(half), nearbyint(half), floor(half), ceil(half), trunc(half));
  fesetround(FE_TONEAREST);
  printf("to nearest: rint %g nearbyint %g\n", rint(half), nearbyint(half));
  return 0;
}

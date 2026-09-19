// C11 7.12 <math.h>: the classification and comparison macros on all three floating types, the constants, and the
// functions whose results are exact.
#include <float.h>
#include <math.h>
#include <stdio.h>

#define CLASSES(x) fpclassify(x) == FP_NAN ? "nan" : fpclassify(x) == FP_INFINITE ? "inf" : fpclassify(x) == FP_ZERO ? "zero" : fpclassify(x) == FP_SUBNORMAL ? "subnormal" : fpclassify(x) == FP_NORMAL ? "normal" : "?"

int main(void) {
  volatile float f_zero = 0.0f; volatile double d_zero = 0.0; volatile long double l_zero = 0.0L;
  float fs[] = {NAN, INFINITY, -INFINITY, 0.0f, -0.0f, FLT_MIN / 2, 1.5f, FLT_MAX};
  for (int i = 0; i < 8; i++) printf("%s %d%d%d%d%d ", CLASSES(fs[i]), isnan(fs[i]) != 0, isinf(fs[i]) != 0, isfinite(fs[i]) != 0, isnormal(fs[i]) != 0, signbit(fs[i]) != 0);
  printf("\n");
  double ds[] = {NAN, HUGE_VAL, 0.0, -0.0, DBL_MIN / 2, -2.5};
  for (int i = 0; i < 6; i++) printf("%s %d%d%d%d%d ", CLASSES(ds[i]), isnan(ds[i]) != 0, isinf(ds[i]) != 0, isfinite(ds[i]) != 0, isnormal(ds[i]) != 0, signbit(ds[i]) != 0);
  printf("\n");
  long double ls[] = {(long double)NAN, HUGE_VALL, -0.0L, LDBL_MIN / 2, 3.0L};
  for (int i = 0; i < 5; i++) printf("%s %d%d%d%d%d ", CLASSES(ls[i]), isnan(ls[i]) != 0, isinf(ls[i]) != 0, isfinite(ls[i]) != 0, isnormal(ls[i]) != 0, signbit(ls[i]) != 0);
  printf("\n");
  // The quiet comparisons never raise and are false (or true, for isunordered) with a NaN.
  double nan = d_zero / d_zero;
  printf("%d %d %d %d %d %d | %d %d %d\n", isgreater(2.0, 1.0), isgreaterequal(1.0, 1.0), isless(1.0f, 2.0), islessequal(2.0L, 1.0), islessgreater(1.0, 2.0), isunordered(1.0, 2.0),
         isgreater(nan, 1.0), islessgreater(nan, nan), isunordered(1.0f, nan));
  printf("%d %d %d\n", sizeof(HUGE_VALF) == sizeof(float), sizeof(HUGE_VAL) == sizeof(double), sizeof(HUGE_VALL) == sizeof(long double));
  printf("%d %d %d\n", sizeof(float_t) >= sizeof(float), sizeof(double_t) >= sizeof(double), FP_NAN != FP_INFINITE && FP_ZERO != FP_NORMAL && FP_SUBNORMAL != FP_NORMAL);
  // Exact results, in each of the three families.
  printf("%g %g %g %g %g %g\n", sqrt(16.0), fabs(-2.5), floor(-2.5), ceil(-2.5), trunc(-2.7), round(2.5));
  printf("%g %g %g %g %g\n", (double)sqrtf(9.0f), (double)fabsf(-1.5f), (double)floorf(1.5f), (double)ceilf(1.5f), (double)roundf(-0.5f));
  printf("%Lg %Lg %Lg %Lg\n", sqrtl(4.0L), fabsl(-3.0L), floorl(2.5L), ceill(2.5L));
  printf("%g %g %g %g %g\n", fmod(7.5, 2.0), remainder(7.5, 2.0), copysign(3.0, -0.0), fmax(1.0, nan), fmin(nan, -1.0));
  printf("%g %g %g %ld %lld %ld\n", ldexp(0.75, 4), scalbn(1.0, -2), fma(2.0, 3.0, 1.0), lround(2.5), llround(-2.5), lrint(3.0));
  int exponent; double whole;
  double mantissa = frexp(48.0, &exponent), fraction = modf(-3.25, &whole);
  printf("%g %d %g %g %d %g\n", mantissa, exponent, fraction, whole, ilogb(1024.0), logb(0.25));
  printf("%g %g %g %g %g\n", pow(2.0, 10.0), exp2(3.0), log2(8.0), cbrt(27.0), hypot(3.0, 4.0));
  printf("%g %g %g %d\n", nextafter(1.0, 2.0) - 1.0 == DBL_EPSILON ? 1.0 : 0.0, fdim(5.0, 3.0), fdim(3.0, 5.0), (int)f_zero + (int)l_zero);
  return 0;
}

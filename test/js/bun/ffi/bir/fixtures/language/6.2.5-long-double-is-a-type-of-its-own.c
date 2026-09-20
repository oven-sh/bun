// C11 6.2.5p10: float, double and long double are three types, also where long double has double's format
// (Windows, Apple's arm64): selection by type, compatibility of pointers and functions, and the library's
// long double functions must all tell them apart, and all of it must still compute.
#include <float.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

#define KIND(x) _Generic((x), float: "float", double: "double", long double: "long double", default: "other")
#define SAME(a, b) _Generic((a *)0, b *: 1, default: 0)
typedef double double_function(void);
typedef long double long_double_function(void);

static long double halve(long double x) { return x / 2; }
static double halve_double(double x) { return x / 2; }
static long double sum(int count, ...) {
  va_list ap;
  va_start(ap, count);
  long double total = 0;
  while (count--) total += va_arg(ap, long double);
  va_end(ap);
  return total;
}
struct holder { char tag; long double value; double other; };

int main(void) {
  long double ld = 1.5L; double d = 1.5; float f = 1.5f;
  printf("%s %s %s %s %s\n", KIND(ld), KIND(1.0L), KIND(d), KIND(1.0), KIND(f));
  printf("%s %s %s %s %s\n", KIND(ld + d), KIND(ld * f), KIND(ld + 1), KIND(d + f), KIND(-ld));
  printf("%s %s %s %s\n", KIND(halve(d)), KIND(halve_double(d)), KIND((long double)d), KIND((double)ld));
  printf("%s %s\n", KIND(fabsl(ld)), KIND(sqrtl(4.0L)));
  printf("%s %s\n", KIND(__builtin_fabsl(-ld)), KIND(__builtin_infl()));
  printf("%d %d %d %d\n", SAME(double, long double), SAME(long double, long double), SAME(double_function, long_double_function), SAME(double *, long double *));
  printf("%d %d\n", _Generic(&ld, long double *: 1, double *: 2, default: 3), _Generic(halve, long double (*)(long double): 1, double (*)(double): 2, default: 3));
  // And it all computes, through calls, variadic calls, the library, structures and conversions.
  struct holder h = {1, 2.25L, 3.5};
  long double array[3] = {1.0L, 2.0L, 3.5L};
  printf("%.2Lf %.2Lf %.2f %.3Lf\n", halve(ld), sum(3, 1.0L, 2.5L, ld), (double)fabsl(-2.5L), h.value + array[2]);
  printf("%.2Lf %.1Lf %d %d\n", sqrtl(2.25L), strtold("12.5", 0), (int)(ld * 10), ld > d / 2);
  printf("%d %d %d\n", sizeof(long double) >= sizeof(double), LDBL_DIG >= DBL_DIG, LDBL_MANT_DIG >= DBL_MANT_DIG);
  ld += f; ld -= 1; ld *= 2; ld /= 4; ld++; --ld;
  printf("%.2Lf %d %d\n", ld, (int)ld, (_Bool)ld);
  return 0;
}

// C11 7.25 <tgmath.h>: each macro calls the function of the type of its argument: float, double or long double for
// the real ones, and integers count as double; the type of the result shows which was called.
#include <stdio.h>
#include <tgmath.h>

#define KIND(x) _Generic((x), float: "f", double: "d", long double: "l", int: "int", long: "long", long long: "llong", default: "?")

int main(void) {
  float f = 2.25f; double d = 2.25; long double l = 2.25L; int i = 4; long long ll = 9;
  printf("%s%s%s%s%s ", KIND(sqrt(f)), KIND(sqrt(d)), KIND(sqrt(l)), KIND(sqrt(i)), KIND(sqrt(ll)));
  printf("%s%s%s ", KIND(fabs(f)), KIND(floor(d)), KIND(ceil(l)));
  printf("%s%s%s%s ", KIND(pow(f, f)), KIND(pow(f, d)), KIND(pow(d, l)), KIND(pow(f, i)));
  printf("%s%s%s%s ", KIND(fmax(f, f)), KIND(fmin(f, 1)), KIND(fmod(l, f)), KIND(copysign(f, -1.0f)));
  printf("%s%s%s ", KIND(fma(f, f, f)), KIND(fma(f, d, f)), KIND(fma(f, f, l)));
  printf("%s%s%s%s%s\n", KIND(ldexp(f, 2)), KIND(frexp(d, &i)), KIND(lround(f)), KIND(llrint(l)), KIND(ilogb(f)));
  printf("%g %g %Lg %g %g\n", (double)sqrt(f), sqrt(d), sqrt(l), sqrt(16), (double)fabs(-f));
  printf("%g %g %Lg %g\n", (double)pow(f, 2.0f), pow(2, 10), fmax(l, 3.0L), (double)trunc(-2.5f));
  printf("%g %g %ld %g\n", (double)round(2.5f), floor(-0.5), lround(-2.5), (double)scalbn(f, 1));
  printf("%d %d %d\n", (int)sizeof(exp(f)) == (int)sizeof(float), (int)sizeof(log(i)) == (int)sizeof(double), (int)sizeof(cbrt(l)) == (int)sizeof(long double));
  return 0;
}

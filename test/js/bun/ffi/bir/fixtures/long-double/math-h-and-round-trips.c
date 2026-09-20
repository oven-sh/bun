/* <math.h>'s type-generic macros and long double functions, text round trips through the C
   library, and the aggregates that hold a long double. */
#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct only { long double value; };
struct with_tag { int tag; long double value; };
union either { long double wide; double narrow; };

static struct only make_only(long double v) { struct only o = { v * 2 }; return o; }
static struct with_tag make_tagged(int tag, long double v) { struct with_tag t = { tag, v + tag }; return t; }
static long double sum_only(struct only a, struct only b) { return a.value + b.value; }
static union either widen(double d) { union either e; e.wide = d; return e; }
typedef struct only (*maker)(long double);

static int round_trips(long double x) {
  char text[64];
  snprintf(text, sizeof text, "%.21Lg", x);
  return strtold(text, NULL) == x;
}

int main(void) {
  long double values[] = { 0.0L, -0.0L, 1.0L, 0.1L, 1e-4940L, LDBL_MIN, LDBL_MAX, -LDBL_EPSILON, 1.0L / 3, 123456789.125L, INFINITY, -INFINITY, __builtin_nanl("") };
  for (int i = 0; i < (int)(sizeof values / sizeof values[0]); i++) {
    long double x = values[i];
    int class = fpclassify(x);
    printf("%Lg: nan %d inf %d finite %d normal %d sign %d class %s\n", x, isnan(x) != 0, isinf(x) != 0, isfinite(x) != 0, isnormal(x) != 0, signbit(x) != 0,
           class == FP_NAN ? "nan" : class == FP_INFINITE ? "infinite" : class == FP_ZERO ? "zero" : class == FP_SUBNORMAL ? "subnormal" : "normal");
  }
  printf("%d %d %d %d %d %d\n", round_trips(0.1L), round_trips(LDBL_MAX), round_trips(LDBL_MIN), round_trips(1e-4945L), round_trips(-2.5e300L), round_trips(1.0L / 3));
  printf("%.18Lf %.18Lf %.18Lf\n", sqrtl(2), cbrtl(27), hypotl(3, 4));
  printf("%.15Lf %.15Lf %.15Lf %.15Lf\n", expl(1), logl(10), sinl(1), atan2l(1, 1) * 4);
  printf("%Lg %Lg %Lg %Lg %Lg\n", floorl(-1.5L), ceill(-1.5L), roundl(2.5L), truncl(-2.7L), fmodl(7.5L, 2));
  printf("%Lg %Lg %ld %lld\n", fmaxl(1, 2), fminl(1, 2), lroundl(2.5L), llrintl(1e15L));
  int exponent; long double fraction = frexpl(1e100L, &exponent);
  printf("%.10Lf %d %Lg %Lg\n", fraction, exponent, ldexpl(fraction, exponent), nextafterl(1, 2) - 1);
  long double integral; long double part = modfl(-3.75L, &integral);
  printf("%Lg %Lg %d %d\n", integral, part, isgreater(2.0L, 1.0L), isunordered(1.0L, __builtin_nanl("")));
  struct only o = make_only(1.25L); maker fp = make_only;
  struct with_tag t = make_tagged(3, 0.5L);
  printf("%Lg %Lg %d %Lg %Lg\n", o.value, fp(10).value, t.tag, t.value, sum_only(o, fp(1)));
  printf("%Lg %zu %zu %zu\n", widen(2.5).wide, sizeof(struct only), sizeof(struct with_tag), _Alignof(union either));
  long double scanned[2]; int n = sscanf("3.25 -1e-10", "%Lf %Lg", &scanned[0], &scanned[1]);
  printf("%d %Lg %Lg\n", n, scanned[0], scanned[1]);
  long double copy; memcpy(&copy, &values[3], sizeof copy); printf("%d\n", copy == values[3]);
  return 0;
}

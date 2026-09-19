// __builtin_huge_val, __builtin_inf and __builtin_nan in their three precisions: the suffix says the type (no suffix is
// double, even though "huge_val" ends in an l), and each is a constant.
#include <math.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define KIND(x) _Generic((x), float: 'f', double: 'd', long double: 'l', default: '?')

static double static_huge = __builtin_huge_val();
static float static_hugef = __builtin_huge_valf();
static long double static_hugel = __builtin_huge_vall();
static double static_negative = -__builtin_inf();
static double static_nan = __builtin_nan("");

static __attribute__((noinline)) double takes_double(double v) { return v; }
static __attribute__((noinline)) int formatted(char *out, double a, double b) { return sprintf(out, "%g %g", a, b); }

int main(void) {
  char text[64];
  CHECK(KIND(__builtin_huge_val()) == 'd' && KIND(__builtin_huge_valf()) == 'f' && KIND(__builtin_huge_vall()) == 'l');
  CHECK(KIND(__builtin_inf()) == 'd' && KIND(__builtin_inff()) == 'f' && KIND(__builtin_infl()) == 'l');
  CHECK(KIND(__builtin_nan("")) == 'd' && KIND(__builtin_nanf("")) == 'f' && KIND(__builtin_nanl("")) == 'l');
  CHECK(sizeof(__builtin_huge_val()) == sizeof(double) && sizeof(__builtin_huge_valf()) == sizeof(float) && sizeof(__builtin_huge_vall()) == sizeof(long double));
  CHECK(sizeof(__builtin_inf()) == sizeof(double) && sizeof(__builtin_nan("")) == sizeof(double) && sizeof(__builtin_nanl("")) == sizeof(long double));
  // Through a variable argument list a double travels as a double.
  CHECK(formatted(text, __builtin_huge_val(), -__builtin_huge_val()) == 8 && strcmp(text, "inf -inf") == 0);
  CHECK(sprintf(text, "%g %g", __builtin_huge_val(), -__builtin_huge_val()) == 8 && strcmp(text, "inf -inf") == 0);
  CHECK(formatted(text, 1.5, -__builtin_inf()) == 8 && strcmp(text, "1.5 -inf") == 0);
  CHECK(sprintf(text, "%g %Lg %g", __builtin_huge_valf(), __builtin_huge_vall(), __builtin_inff()) == 11 && strcmp(text, "inf inf inf") == 0);
  CHECK(sprintf(text, "%Lg", -__builtin_infl()) == 4 && strcmp(text, "-inf") == 0);
  CHECK(takes_double(__builtin_huge_val()) == HUGE_VAL && takes_double(__builtin_huge_valf()) == HUGE_VAL && takes_double(-__builtin_inf()) == -HUGE_VAL);
  CHECK(__builtin_huge_val() == HUGE_VAL && __builtin_huge_valf() == HUGE_VALF && __builtin_huge_vall() == HUGE_VALL && __builtin_inf() == INFINITY);
  CHECK(__builtin_huge_val() > 1e308 && __builtin_huge_valf() > 3e38f && __builtin_huge_vall() > 1e308L && -__builtin_inf() < -1e308);
  CHECK(__builtin_nan("") != __builtin_nan("") && __builtin_nanf("") != __builtin_nanf("") && __builtin_nanl("") != __builtin_nanl(""));
  CHECK(isnan(__builtin_nan("")) && isnan(__builtin_nanf("")) && isnan(__builtin_nanl("")) && isinf(__builtin_huge_vall()) && !signbit(__builtin_nan("")));
  CHECK(static_huge == HUGE_VAL && static_hugef == HUGE_VALF && static_hugel == HUGE_VALL && static_negative == -HUGE_VAL && static_nan != static_nan);
  volatile double d = __builtin_huge_val();
  volatile float f = __builtin_inff();
  volatile long double l = __builtin_infl();
  CHECK(d == f && d == l && d + 1 == d && 1 / d == 0 && d - d != d - d);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

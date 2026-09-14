// A builtin of constants is a constant where GCC and Clang take it for one: as an enumerator, the size of an array,
// the initializer of an object with static storage, the expression of a static assertion. The classification and
// sign builtins of floating constants, `abs` of an integer one, `strlen` of a string literal, and the bit builtins.
#include <stdio.h>

enum {
  NOT_A_NUMBER = __builtin_isnan(__builtin_nan("")),
  A_NUMBER = __builtin_isnan(1.5),
  INFINITE = __builtin_isinf(__builtin_inf()),
  WHICH_INFINITY = __builtin_isinf_sign(-__builtin_inf()),
  FINITE = __builtin_isfinite(1e300),
  NORMAL = __builtin_isnormal(1e-310),
  NORMAL_AS_A_FLOAT = __builtin_isnormal(1e-40f),
  NEGATIVE = __builtin_signbit(-0.0) != 0,
  CLASS = __builtin_fpclassify(10, 20, 30, 40, 50, 1e-310),
  CLASS_OF_ZERO = __builtin_fpclassify(10, 20, 30, 40, 50, -0.0),
  GREATER = __builtin_isgreater(2.0, 1.0),
  UNORDERED = __builtin_isunordered(1.0, __builtin_nan("")),
  LESS_OR_GREATER_OF_A_NAN = __builtin_islessgreater(__builtin_nan(""), 1.0),
  MAGNITUDE = __builtin_abs(-3),
  WIDE_MAGNITUDE = __builtin_llabs(-5000000000LL) == 5000000000LL,
  LENGTH = __builtin_strlen("abc"),
  LENGTH_TO_THE_FIRST_NUL = __builtin_strlen("ab\0cd"),
  LEADING = __builtin_clz(1),
  POPULATION = __builtin_popcountll(0xff00ff00ff00ff00ull),
};
static const double magnitude = __builtin_fabs(-1.5);
static const double with_the_sign_of = __builtin_copysign(2.0, -0.0);
static const float of_a_float = __builtin_fabsf(-2.5f);
static char sized_by_a_length[__builtin_strlen("twelve bytes")];
_Static_assert(__builtin_isinf(__builtin_inf()) && !__builtin_isnan(0.0), "at translation time");
_Static_assert(__builtin_strlen("") == 0 && __builtin_abs(7) == 7, "at translation time");

int main(void) {
  printf("%d %d %d %d %d %d %d %d\n", NOT_A_NUMBER, A_NUMBER, INFINITE, WHICH_INFINITY, FINITE, NORMAL, NORMAL_AS_A_FLOAT, NEGATIVE);
  printf("%d %d %d %d %d\n", CLASS, CLASS_OF_ZERO, GREATER, UNORDERED, LESS_OR_GREATER_OF_A_NAN);
  printf("%d %d %d %d %d %d\n", MAGNITUDE, WIDE_MAGNITUDE, LENGTH, LENGTH_TO_THE_FIRST_NUL, LEADING, POPULATION);
  printf("%g %g %g %d\n", magnitude, with_the_sign_of, (double)of_a_float, (int)sizeof sized_by_a_length);
  // And of what is not a constant they are what they were.
  volatile double x = -1.5, nan = __builtin_nan("");
  volatile int n = -3;
  const char *volatile text = "abc";
  printf("%g %d %d %d %d %d\n", __builtin_fabs(x), __builtin_isnan(nan), __builtin_isgreater(x, nan), __builtin_abs(n), (int)__builtin_strlen(text), __builtin_fpclassify(10, 20, 30, 40, 50, x));
  return 0;
}

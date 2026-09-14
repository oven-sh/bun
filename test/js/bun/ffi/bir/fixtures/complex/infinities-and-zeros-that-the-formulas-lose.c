// C11 G.5.1: where the formulas for the product and the quotient of two complex numbers give a NaN in both parts, an
// operand that was infinite makes the result infinite (or, as a divisor, zero), and what is divided by zero is
// infinite. For `*`, `/`, `*=` and `/=`, float and double, worked out when the program runs (the operands are
// volatile) and in the initializers of objects with static storage.
#include <stdio.h>

#define INF __builtin_inf()
#define NOT_A_NUMBER __builtin_nan("")
#define C(re, im) __builtin_complex((double)(re), (double)(im))
#define CF(re, im) __builtin_complex((float)(re), (float)(im))

// (A NaN is printed without its sign, which nothing here is about.)
static void part(double v) { v != v ? printf(" nan") : printf(" %g", v); }
static void show(const char *what, double _Complex z) {
  printf("%-36s", what);
  part(__real__ z);
  part(__imag__ z);
  printf("\n");
}

static const double _Complex divided_by_zero = C(1, 2) / C(0, 0);
static const double _Complex infinite_times_finite = C(INF, INF) * C(1, 0);
static const double _Complex finite_over_infinite = C(1, 1) / C(INF, INF);
static const double _Complex infinite_over_finite = C(INF, 1) / C(2, 3);
static const double _Complex infinite_times_not_a_number = C(INF, 0) * C(NOT_A_NUMBER, 1);
static const float _Complex of_floats = CF(INF, INF) * CF(1, 0);
static const double _Complex nothing_to_recover = C(NOT_A_NUMBER, 1) * C(2, 3);

int main(void) {
  show("static: divided by zero", divided_by_zero);
  show("static: infinite times finite", infinite_times_finite);
  show("static: finite over infinite", finite_over_infinite);
  show("static: infinite over finite", infinite_over_finite);
  show("static: infinite times a NaN", infinite_times_not_a_number);
  show("static: of floats", of_floats);
  printf("%-36s %d %d\n", "static: nothing to recover", __real__ nothing_to_recover != __real__ nothing_to_recover, __imag__ nothing_to_recover != __imag__ nothing_to_recover);

  volatile double inf = INF, nan = NOT_A_NUMBER, zero = 0, one = 1, two = 2, three = 3, huge = 1e308;
  volatile float inff = (float)INF, onef = 1, zerof = 0, hugef = 3e38f;
  show("(1+2i) / (0+0i)", C(one, two) / C(zero, zero));
  show("(1+2i) / (-0+0i)", C(one, two) / C(-zero, zero));
  show("(inf+inf i) * (1+0i)", C(inf, inf) * C(one, zero));
  show("(1+0i) * (inf+inf i)", C(one, zero) * C(inf, inf));
  show("(inf+inf i) * (inf+inf i)", C(inf, inf) * C(inf, inf));
  show("(inf+0i) * (nan+1i)", C(inf, zero) * C(nan, one));
  show("(1+1i) / (inf+inf i)", C(one, one) / C(inf, inf));
  show("(inf+1i) / (2+3i)", C(inf, one) / C(two, three));
  show("(-inf+inf i) / (2+3i)", C(-inf, inf) / C(two, three));
  show("(1e308+1e308i) * (1e308+1e308i)", C(huge, huge) * C(huge, huge));
  show("(nan+1i) * (2+3i) is two NaNs", C(nan, one) * C(two, three));
  show("1 / (0+0i), a real dividend", one / C(zero, zero));
  show("floats: (inf+inf i) * (1+0i)", CF(inff, inff) * CF(onef, zerof));
  show("floats: (1+1i) / (0+0i)", CF(onef, onef) / CF(zerof, zerof));
  show("floats: (3e38+3e38i) * (3e38+3e38i)", CF(hugef, hugef) * CF(hugef, hugef));
  double _Complex z = C(inf, inf);
  z *= C(one, zero);
  show("*=", z);
  z = C(one, two);
  z /= C(zero, zero);
  show("/=", z);
  float _Complex w = CF(onef, onef);
  w /= CF(inff, inff);
  show("/= of floats", w);
  // And what needs no recovery is what it was, in an expression with calls and conditions around it.
  double _Complex ordinary = (one > zero ? C(one, two) : C(zero, zero)) * C(three, one) / C(one, one) + (C(two, two) * C(two, -two));
  show("ordinary", ordinary);
  return 0;
}

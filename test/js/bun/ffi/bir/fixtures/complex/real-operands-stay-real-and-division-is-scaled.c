// C11 6.3.1.8 and annex G: in `z op r` the real operand stays real, so multiplying and dividing by it works part by
// part (infinities, signed zeros and large values come out as they should); and dividing by a complex number does not
// square anything on the way, so ordinary finite operands do not overflow to NaN.
#include <stdio.h>

static void show(const char *what, double _Complex z) { printf("%s: %g %g\n", what, __real__ z, __imag__ z); }
static void showf(const char *what, float _Complex z) { printf("%s: %g %g\n", what, (double)__real__ z, (double)__imag__ z); }

// The same in static initializers.
static double _Complex s_div_real = (1e200 + 1e200i) / 1e200;
static double _Complex s_div_complex = (1e300 + 1e300i) / (1e300 + 1e300i);
static double _Complex s_div_small = (1e-200 + 3e-200i) / 1e-200;
static double _Complex s_mul_real = (2.0 + 3.0i) * 1e200;
static double _Complex s_real_minus = 1.0 - (2.0 + 3.0i);
static double _Complex s_real_over = 1.0 / (0.0 + 2.0i);
static float _Complex s_float_div = (1e30f + 1e30fi) / (1e30f + 1e30fi);
static double _Complex s_smith_d_larger = (1.0 + 2.0i) / (1e-300 + 1e300i);

int main(void) {
  volatile double big = 1e200, small = 1e-200, zero = 0.0, two = 2.0, infinity = 1e308 * 10, negative_zero = -0.0;
  volatile float fbig = 1e30f, ftwo = 2.0f;
  double _Complex z = 1e200 + 1e200i;
  float _Complex fz = 1e30f + 1e30fi;
  volatile double _Complex w = 1e300 + 1e300i, tiny = 1e-200 + 3e-200i, unit = 1.0 + 1.0i, steep = 1e-300 + 1e300i;
  volatile float _Complex fw = 1e30f + 1e30fi;

  show("z / big", z / big);
  showf("fz / fbig", fz / fbig);
  show("tiny / small", tiny / small);
  show("(inf + 1i) * 2", (infinity + 1.0i) * two);
  show("2 * (inf + 1i)", two * (infinity + 1.0i));
  show("(1 + 1i) / 0", unit / zero);
  show("w / w", w / w);
  showf("fw / fw", fw / fw);
  show("unit / w", unit / w);
  show("w / unit", w / unit);
  show("(1 + 2i) / steep", (1.0 + 2.0i) / steep);
  show("steep / (1 + 2i)", steep / (1.0 + 2.0i));
  show("2 / (0 + 2i)", two / (zero + 2.0i));
  showf("2f / (0 + 2i)", ftwo / (0.0f + 2.0fi));
  show("z + big", z + big);
  show("big + z", big + z);
  show("z - big", z - big);
  show("big - z", big - z);
  show("(0 - 0i) + 0", (zero - zero * 1.0i) + zero);
  show("-0 - (0 + 0i)", negative_zero - (zero + zero * 1.0i));
  show("z * small", z * small);
  show("small * z", small * z);

  double _Complex c = 3.0 + 4.0i;
  c *= two; show("c *= 2", c);
  c /= two; show("c /= 2", c);
  c += two; show("c += 2", c);
  c -= two; show("c -= 2", c);
  c *= unit; show("c *= 1 + 1i", c);
  c /= unit; show("c /= 1 + 1i", c);
  float _Complex fc = 3.0f + 4.0fi;
  fc *= two; showf("fc *= 2.0", fc);
  fc /= ftwo; showf("fc /= 2.0f", fc);
  fc /= unit; showf("fc /= 1 + 1i", fc);
  int n = 3;
  show("c * n", (3.0 + 4.0i) * n);
  show("n / c", n / (3.0 + 4.0i));
  printf("%d %d %d %d\n", z == z, z != big, unit == 1.0, (two + 0.0i) == two);

  show("static (1e200 + 1e200i) / 1e200", s_div_real);
  show("static w / w", s_div_complex);
  show("static tiny / small", s_div_small);
  show("static (2 + 3i) * 1e200", s_mul_real);
  show("static 1 - (2 + 3i)", s_real_minus);
  show("static 1 / 2i", s_real_over);
  showf("static float w / w", s_float_div);
  show("static (1 + 2i) / steep", s_smith_d_larger);
  return 0;
}

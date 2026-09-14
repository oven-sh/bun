// 6.5.16.2: `real op= complex` is `real = real op complex`: computed in the common complex type, and the real part
// stored. For every arithmetic kind of left operand.
#include <stdio.h>

struct fields { int narrow : 5; unsigned wide : 20; };

int main(void) {
  // (Written without <complex.h>, which Microsoft's library has another one of.)
  volatile double _Complex z = __builtin_complex(1.0, 2.0);
  volatile float _Complex w = __builtin_complex(3.0f, -1.0f);
  double d = 5;
  d += z;
  printf("%g\n", d);
  d *= w;
  printf("%g\n", d);
  d /= __builtin_complex(2.0, 0.0);
  printf("%g\n", d);
  d -= z * z;
  printf("%g\n", d);
  int i = 3;
  i += z;
  float f = 2;
  f -= w;
  _Bool b = 0;
  b += z;
  unsigned char byte = 250;
  byte += z * 3;
  long long wide = 1ll << 40;
  wide *= w;
  struct fields fields = { 3, 1000 };
  fields.narrow += z;
  fields.wide *= w;
  printf("%d %g %d %d %lld %d %u\n", i, f, b, byte, wide >> 40, fields.narrow, fields.wide);
  double array[2] = { 1, 2 }, *p = array;
  *p++ += z;
  printf("%g %g %d\n", array[0], array[1], (int)(p - array));
  // The value of the expression is the left operand's new value.
  printf("%g %d\n", (d = 1, d += z), (i = 1, i *= z + z));
  return 0;
}

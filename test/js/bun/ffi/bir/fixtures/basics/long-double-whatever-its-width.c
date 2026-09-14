// long double is the x87 format on x86-64 Linux and macOS, and a double on Windows and on Apple's arm64:
// the same arithmetic gives the same small numbers on all of them.
#include <stdio.h>

static long double scale(long double x, int by) { return x * by + 0.25L; }

int main(void) {
  long double x = 1.5L;
  x += 1;
  long double values[3] = {x, scale(x, 4), -x / 2};
  printf("%d %d %d\n", (int)(x * 2), (int)(values[1] * 4), (int)(values[2] * 100));
  printf("%d\n", sizeof x == sizeof(double) || sizeof x == 16);
  printf("%.2Lf %.2f\n", values[1], (double)values[2]);
  return 0;
}

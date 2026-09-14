// `memcpy`, `memmove` and `memset` are the library's, and compiled in place, only where they are declared as the
// library declares them. A function of the program's own that has one of the names and other parameters is an
// ordinary function, called as it is declared. (GCC and Clang warn, and do the same.)
#include <stdio.h>

static long long memcpy(double d, long long b, long long n) { return (long long)(d * 2) + b + n; }
static long long memset(int d, int b, long long n) { return d * 100 + b * 10 + n; }
static double memmove(double a, double b) { return a - b; }
static int memcmp(int only) { return only + 1; }
static int strlen(int a, int b) { return a * b; }

int main(int argc, char **argv) {
  (void)argv;
  printf("%lld %lld %g %d %d\n", memcpy(1.5, argc, 8), memset(7, argc, 8), memmove(3.5, argc), memcmp(argc), strlen(argc + 2, 5));
  return 0;
}

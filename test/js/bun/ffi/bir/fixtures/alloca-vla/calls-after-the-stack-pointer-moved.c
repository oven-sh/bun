// After a variable length array or alloca has moved the stack pointer, the arguments a later call passes on the
// stack must go where the callee looks for them: more integers than there are registers, mixed variadic arguments,
// and printf with many.
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#if defined _WIN32
#include <malloc.h>
#elif __has_include(<alloca.h>)
#include <alloca.h>
#else
#include <stdlib.h>
#endif

static long long twelve(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j, int k, int l) {
  return a + 2LL * b + 3LL * c + 4LL * d + 5LL * e + 6LL * f + 7LL * g + 8LL * h + 9LL * i + 10LL * j + 11LL * k + 12LL * l;
}
static double mixed(int count, ...) {
  va_list ap;
  va_start(ap, count);
  double total = 0;
  for (int n = 0; n < count; n++) {
    switch (n % 4) {
      case 0: total += va_arg(ap, int); break;
      case 1: total += va_arg(ap, double); break;
      case 2: total += (double)va_arg(ap, long long); break;
      default: total += strlen(va_arg(ap, const char *)); break;
    }
  }
  va_end(ap);
  return total;
}

static long long after_vla(int n) {
  int array[n];
  for (int i = 0; i < n; i++) array[i] = i + 1;
  long long first = twelve(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, array[n - 1]);
  char line[128];
  snprintf(line, sizeof line, "%d %d %d %d %d %d %d %d %d %d %d %d", array[0], 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, array[n - 1]);
  printf("%s\n", line);
  return first + (long long)mixed(12, 1, 0.5, 2LL, "abc", 4, 1.5, 5LL, "de", 7, 2.5, 8LL, "f") + array[0];
}
static long long after_alloca(int n) {
  int *array = alloca(n * sizeof *array);
  for (int i = 0; i < n; i++) array[i] = i + 1;
  long long first = twelve(array[0], 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, array[n - 1]);
  char *more = alloca(64);
  snprintf(more, 64, "%d-%d-%d-%d-%d-%d-%d-%d-%d-%d", 1, 2, 3, 4, 5, 6, 7, 8, 9, array[n - 1]);
  printf("%s %.1f %.1f %.1f %.1f %.1f %.1f %.1f %.1f %.1f %.1f\n", more, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5);
  return first + (long long)mixed(8, 1, 0.5, 2LL, "abc", 4, 1.5, 5LL, "de");
}

int main(void) {
  for (int n = 1; n <= 40; n += 13) {
    long long a = after_vla(n), b = after_alloca(n);
    printf("%lld %lld\n", a, b);
  }
  // In a loop, where each round moves it again, and in nested scopes that release it.
  long long total = 0;
  for (int round = 1; round <= 5; round++) {
    char outer[round * 7];
    memset(outer, round, sizeof outer);
    {
      short inner[round + 3];
      inner[round] = (short)round;
      total += twelve(outer[0], inner[round], 3, 4, 5, 6, 7, 8, 9, 10, 11, (int)sizeof inner);
    }
    total += (long long)mixed(5, round, 0.25, 3LL, "xy", outer[round]);
  }
  printf("%lld\n", total);
  return 0;
}

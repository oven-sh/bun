#include <stdarg.h>
           long long sum_ints(int count, ...) { va_list ap; va_start(ap, count); long long total = 0; for (int i = 0; i < count; i++) total += va_arg(ap, int); va_end(ap); return total; }
           double sum_doubles(int count, ...) { va_list ap; va_start(ap, count); double total = 0; for (int i = 0; i < count; i++) total += va_arg(ap, double); va_end(ap); return total; }
           double sum_mixed(int pairs, ...) { va_list ap; va_start(ap, pairs); double total = 0; for (int i = 0; i < pairs; i++) { total += va_arg(ap, int); total += va_arg(ap, double); } va_end(ap); return total; }
           long long call_ints(void) { return sum_ints(12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12); }
           double call_doubles(void) { return sum_doubles(11, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5); }
           double call_mixed(void) { return sum_mixed(10, 1, 0.25, 2, 0.25, 3, 0.25, 4, 0.25, 5, 0.25, 6, 0.25, 7, 0.25, 8, 0.25, 9, 0.25, 10, 0.25); }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)call_ints());
  printf("%.17g\n", (double)call_doubles());
  printf("%.17g\n", (double)call_mixed());
  return 0;
}

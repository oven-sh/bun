#include <stdarg.h>
         typedef __int128 s128;
         static s128 sum(int n, ...) {
             va_list ap; va_start(ap, n);
             s128 total = 0;
             for (int i = 0; i < n; i++) { total += va_arg(ap, s128); total += va_arg(ap, int); }
             va_end(ap);
             return total;
         }
         unsigned long long run(int part) {
             s128 big = (s128)1 << 100;
             s128 t = sum(5, big, 1, (s128)-7, 2, big, 3, (s128)40, 4, (s128)1, 5);
             return part ? (unsigned long long)(t >> 64) : (unsigned long long)t;
         }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)run(0));
  printf("%lld\n", (long long)run(1));
  return 0;
}

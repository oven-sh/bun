#include <stdarg.h>
           #include <stddef.h>
           static int sum(int n, ...) { va_list ap; va_start(ap, n); int s = 0; for (int i = 0; i < n; i++) s += va_arg(ap, int); va_end(ap); return s; }
           int sum3(void) { return sum(3, 10, 20, 30); }
           int sum_many(void) { return sum(10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10); }
           int sum_none(void) { return sum(0); }
           static double mixed(const char *kinds, ...) {
               va_list ap; va_start(ap, kinds); double total = 0;
               for (; *kinds; kinds++) {
                   switch (*kinds) {
                   case 'i': total += va_arg(ap, int); break;
                   case 'l': total += (double)va_arg(ap, long); break;
                   case 'u': total += va_arg(ap, unsigned long long) >> 32; break;
                   case 'd': total += va_arg(ap, double); break;
                   case 's': total += (double)(va_arg(ap, const char *))[0]; break;
                   case 'p': total += *va_arg(ap, int *); break;
                   }
               }
               va_end(ap);
               return total;
           }
           double mixed_small(void) { int seven = 7; return mixed("idlsp", 1, 2.5, -3L, "A", &seven); }
           double mixed_promotions(void) { char c = 5; short s = -6; float f = 0.25f; unsigned char u = 200; return mixed("iidiu", c, s, f, u, 0xabcdef0100000000ull); }
           double many_doubles(void) { return mixed("dddddddddddd", 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0); }
           double interleaved(void) { return mixed("ididididididididididid", 1, 0.5, 2, 0.5, 3, 0.5, 4, 0.5, 5, 0.5, 6, 0.5, 7, 0.5, 8, 0.5, 9, 0.5, 10, 0.5, 11, 0.5); }
           static double after_floats(double a, float b, int n, ...) { va_list ap; va_start(ap, n); double s = a + b; while (n--) s += va_arg(ap, double); va_end(ap); return s; }
           double named_floats(void) { return after_floats(100.0, 10.0f, 8, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5); }
           static long after_ints(long a, long b, long c, long d, long e, long f, long g, int n, ...) { va_list ap; va_start(ap, n); long s = a + b + c + d + e + f + g; while (n--) s += va_arg(ap, long); va_end(ap); return s; }
           long named_on_stack(void) { return after_ints(1, 2, 3, 4, 5, 6, 7, 3, 100L, 200L, 300L); }
           static int twice(int n, ...) {
               va_list ap, copy; va_start(ap, n); va_copy(copy, ap);
               int a = 0, b = 0;
               for (int i = 0; i < n; i++) a += va_arg(ap, int);
               for (int i = 0; i < n; i++) b += va_arg(copy, int) * 2;
               va_end(copy); va_end(ap);
               return a * 1000 + b;
           }
           int copied(void) { return twice(8, 1, 2, 3, 4, 5, 6, 7, 8); }
           static int vsum(int n, va_list ap) { int s = 0; while (n--) s += va_arg(ap, int); return s; }
           static int forward(int n, ...) { va_list ap; va_start(ap, n); int first = va_arg(ap, int); int rest = vsum(n - 1, ap); va_end(ap); return first * 1000 + rest; }
           int forwarded(void) { return forward(9, 5, 1, 1, 1, 1, 1, 1, 1, 1); }
           int vsnprintf(char *, size_t, const char *, va_list);
           static int format(char *out, size_t n, const char *fmt, ...) { va_list ap; va_start(ap, fmt); int r = vsnprintf(out, n, fmt, ap); va_end(ap); return r; }
           int formatted(char *out) { return format(out, 64, "%d-%s-%.1f-%ld-%c", 42, "str", 2.5, 1234567890123L, 'x'); }
           int through_pointer(void) { int (*f)(int, ...) = sum; int (*table[])(int, ...) = { twice, sum }; return f(2, 40, 2) + table[1](1, 100); }
           int exported_variadic(int n, ...) { va_list ap; va_start(ap, n); int v = va_arg(ap, int); va_end(ap); return v; }
           int calls_exported(void) { return exported_variadic(1, 77); }
           static int c23_start(int n, ...) { va_list ap; va_start(ap); int v = va_arg(ap, int); va_end(ap); return v + n; }
           int c23(void) { return c23_start(1, 41); }
           static int cond_arg(int n, ...) { va_list ap; va_start(ap, n); int v = n > 0 ? va_arg(ap, int) + va_arg(ap, int) : -1; va_end(ap); return v; }
           int in_expression(void) { return cond_arg(1, 30, 12) + cond_arg(0); }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[64] __attribute__((aligned(16)));
int main(void) {
  printf("%d\n", (int)sum3());
  printf("%d\n", (int)sum_many());
  printf("%d\n", (int)sum_none());
  printf("%.17g\n", (double)mixed_small());
  printf("%.17g\n", (double)mixed_promotions());
  printf("%.17g\n", (double)many_doubles());
  printf("%.17g\n", (double)interleaved());
  printf("%.17g\n", (double)named_floats());
  printf("%lld\n", (long long)named_on_stack());
  printf("%d\n", (int)copied());
  printf("%d\n", (int)forwarded());
  for (int i = 0; i < 64; i++) buffer1[i] = 0;
  printf("%d\n", (int)formatted((void *)buffer1));
  bun_test_dump("buffer1", buffer1, 64);
  printf("%d\n", (int)through_pointer());
  printf("%d\n", (int)calls_exported());
  printf("%d\n", (int)c23());
  printf("%d\n", (int)in_expression());
  return 0;
}

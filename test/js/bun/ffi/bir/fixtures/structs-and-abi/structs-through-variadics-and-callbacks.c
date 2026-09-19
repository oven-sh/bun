#include <stdarg.h>
         void qsort(void *base, __SIZE_TYPE__ n, __SIZE_TYPE__ size, int (*cmp)(const void *, const void *));
         struct pair { double a, b; };
         struct ipair { int a; long long b; };
         struct big { long long v[4]; };
         struct small { char c[3]; };
         static double sum_pairs(int count, ...) { va_list ap; va_start(ap, count); double total = 0; for (int i = 0; i < count; i++) { struct pair p = va_arg(ap, struct pair); total += p.a + p.b; } va_end(ap); return total; }
         double pairs(void) {
             struct pair p1 = { 1, 2 }, p2 = { 3, 4 }, p3 = { 5, 6 }, p4 = { 7, 8 }, p5 = { 9, 10 }, p6 = { 11, 12 };
             return sum_pairs(6, p1, p2, p3, p4, p5, p6);
         }
         static double mixed(int count, ...) {
             va_list ap; va_start(ap, count); double total = 0;
             for (int i = 0; i < count; i++) {
                 struct ipair ip = va_arg(ap, struct ipair); total += ip.a + (double)ip.b;
                 total += va_arg(ap, double);
                 struct big b = va_arg(ap, struct big); total += (double)(b.v[0] + b.v[3]);
                 struct small s = va_arg(ap, struct small); total += s.c[2];
                 total += va_arg(ap, int);
             }
             va_end(ap);
             return total;
         }
         double everything(void) {
             struct ipair ip = { 1, 2 }; struct big b = { { 10, 0, 0, 20 } }; struct small s = { { 0, 0, 3 } };
             return mixed(4, ip, 0.5, b, s, 100, ip, 0.5, b, s, 100, ip, 0.5, b, s, 100, ip, 0.5, b, s, 100);
         }
         static double odd_registers(int n, double lead, ...) { va_list ap; va_start(ap, lead); double total = lead; while (n--) { struct pair p = va_arg(ap, struct pair); total += p.a * 10 + p.b; } va_end(ap); return total; }
         double split_case(void) { struct pair p = { 1, 2 }; return odd_registers(4, 0.5, p, p, p, p); }
         struct item { int key; char name[12]; };
         static int by_key(const void *a, const void *b) { struct item x = *(const struct item *)a, y = *(const struct item *)b; return x.key - y.key; }
         static struct item smallest(struct item *items, int n) { qsort(items, (unsigned long long)n, sizeof *items, by_key); return items[0]; }
         int sorted(void) { struct item items[4] = { { 30, "c" }, { 10, "a" }, { 40, "d" }, { 20, "b" } }; struct item first = smallest(items, 4); return first.key + first.name[0] + items[3].key * 1000; }

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)pairs());
  printf("%.17g\n", (double)everything());
  printf("%.17g\n", (double)split_case());
  printf("%d\n", (int)sorted());
  return 0;
}

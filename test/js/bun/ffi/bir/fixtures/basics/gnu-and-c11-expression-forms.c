#include <stddef.h>
         struct P { int x, y; };
         static int sum(const int *v, int n) { int s = 0; while (n--) s += v[n]; return s; }
         static int len2(struct P *p) { return p->x * p->x + p->y * p->y; }
         static const int *table = (const int[]){ 4, 5, 6 };
         static struct P origin = (struct P){ 1, 2 };
         int compound(int k) { int *p = (int[]){ k, k + 1, k + 2 }; p[1] += 10; return sum(p, 3) + len2(&(struct P){ 3, k }) + (struct P){ .y = 7 }.y + table[2] + origin.y + *(int *)&(int){ 9 }; }
         int compound_in_loop(void) { int s = 0; for (int i = 0; i < 3; i++) { struct P *p = &(struct P){ i, 0 }; p->y += 5; s += p->x + p->y; } return s; }
         int stmt_expr(int a) { int r = ({ int t = a * 2; if (t > 10) t = 10; t + 1; }); ({ r++; }); return r + ({ 5; }); }
         #define MAX(a, b) ({ __typeof__(a) _a = (a); __typeof__(b) _b = (b); _a > _b ? _a : _b; })
         int max3(int a, int b, int c) { int calls = 0; int m = MAX(MAX(a, (calls++, b)), c); return m * 10 + calls; }
         int elvis(int a, int b) { return a ?: b; }
         int elvis_once(void) { int n = 0; int v = (++n, n) ?: 100; const char *s = (const char *)0 ?: "x"; return v * 10 + n + s[0]; }
         int ranges(int c) { switch (c) { case 'a' ... 'z': return 1; case 'A' ... 'Z': return 2; case '0' ... '9': return 3; case 1000 ... 100000: return 4; case -5 ... -1: return 5; default: return 0; } }
         #define kind(x) _Generic((x), int: 1, unsigned: 2, long: 3, double: 4, float: 5, char *: 6, const char *: 7, struct P: 8, default: 9)
         int generic(void) { char buf[2]; struct P p; short s = 0; return kind(1) + kind(1u) * 10 + kind(1L) * 100 + kind(1.0) * 1000 + kind(1.0f) * 10000 + kind(buf) * 100000 + kind("s") * 1000000 + kind(p) * 10000000 + kind(s) * 100000000; }
         typedef __typeof__(sizeof 0) my_size; typeof(int *) ip; __typeof__(origin) other_origin;
         int typeofs(void) { int x = 3; typeof(x) y = x + 1; __typeof__(&x) px = &y; typeof(int[4]) arr; return *px + sizeof(my_size) + sizeof arr + sizeof other_origin; }
         int builtins(unsigned v) { return __builtin_expect(v > 3, 0) + __builtin_constant_p(5) * 10 + __builtin_constant_p(v) * 100 + (int)__builtin_offsetof(struct P, y) * 1000 + __builtin_types_compatible_p(int, signed int) * 10000 + __builtin_types_compatible_p(int, long) * 100000; }
         int offsets(void) { struct N { char c; struct { short s; int a[5]; } in; }; return offsetof(struct N, in.a[3]) + offsetof(struct N, in.s) * 100; }
         int bits(unsigned v, unsigned long long w) { return __builtin_popcount(v) + __builtin_clz(v) * 100 + __builtin_ctz(v) * 10000 + __builtin_popcountll(w) * 1000000 + __builtin_clzll(w) * 10000000; }
         int bits2(unsigned long long w) { return __builtin_ctzll(w) + __builtin_ctzl(w) * 100; }
         unsigned swap32(unsigned v) { return __builtin_bswap32(v); }
         unsigned short swap16(unsigned short v) { return __builtin_bswap16(v); }
         unsigned long long swap64(unsigned long long v) { return __builtin_bswap64(v); }
         int unreachable(int x) { if (x > 0) return 1; if (x <= 0) return 2; __builtin_unreachable(); }
         unsigned long long builtin_lib(const char *s) { char buf[8]; __builtin_memset(buf, 0, 8); __builtin_memcpy(buf, s, 3); return __builtin_strlen(buf) + __builtin_abs(-40); }
         double inf(void) { return __builtin_inf() > 1e308 && __builtin_nanf("") != __builtin_nanf("") ? __builtin_huge_val() : 0; }
         __extension__ typedef long long ext_ll;
         int extension(void) { __extension__ int x = 1; return __extension__ (x + 1) + (int)sizeof(__extension__ (ext_ll)0); }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[8] __attribute__((aligned(16)));
int main(void) {
  printf("%d\n", (int)compound(2));
  printf("%d\n", (int)compound_in_loop());
  printf("%d\n", (int)stmt_expr(3));
  printf("%d\n", (int)stmt_expr(30));
  printf("%d\n", (int)max3(3, 9, 5));
  printf("%d\n", (int)elvis(0, 7));
  printf("%d\n", (int)elvis(4, 7));
  printf("%d\n", (int)elvis_once());
  printf("%d\n", (int)ranges(113));
  printf("%d\n", (int)ranges(81));
  printf("%d\n", (int)ranges(55));
  printf("%d\n", (int)ranges(1000));
  printf("%d\n", (int)ranges(100000));
  printf("%d\n", (int)ranges(100001));
  printf("%d\n", (int)ranges(-3));
  printf("%d\n", (int)ranges(0));
  printf("%d\n", (int)generic());
  printf("%d\n", (int)typeofs());
  printf("%d\n", (int)builtins(9));
  printf("%d\n", (int)offsets());
  printf("%d\n", (int)bits(1110016, 1099511627776LL));
  printf("%d\n", (int)bits2(2147483648LL));
  printf("%d\n", (int)swap32(305419896));
  printf("%d\n", (int)swap16(4660));
  printf("%lld\n", (long long)swap64(72623859790382856LL));
  printf("%d\n", (int)unreachable(-1));
  bun_test_fill(buffer1, (const unsigned char[]){97, 98, 99, 100, 101, 102, 0, 0}, 8);
  printf("%lld\n", (long long)builtin_lib((void *)buffer1));
  printf("%s\n", inf() > 1e308 ? "inf" : "finite"); // (the C libraries spell infinity differently)
  printf("%d\n", (int)extension());
  return 0;
}

#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>
#include <math.h>
#include <float.h>
long double g = 1.5L, neg = -2.25L, from_int = 7, from_double = 0.5, folded = 1.0L / 4 + 3;
long double table[3] = { 1.0L, 2.0L, 3.0L };
struct S { int tag; long double value; char tail; };
struct S s = { 1, 10.0L, 'x' };
static long double add(long double a, long double b) { return a + b; }
static long double pick(int which, long double a, long double b) { return which ? a : b; }
static long double sum(int n, ...) { va_list ap; va_start(ap, n); long double t = 0; while (n--) t += va_arg(ap, long double); va_end(ap); return t; }
static long double mixed(int n, ...) { va_list ap; va_start(ap, n); int i = va_arg(ap, int); double d = va_arg(ap, double); long double l = va_arg(ap, long double); long k = va_arg(ap, long); long double m = va_arg(ap, long double); va_end(ap); return i + d + l + k + m; }
static struct S make(long double v) { struct S r = { 2, v * 2, 'y' }; return r; }
static long double field(struct S by_value) { return by_value.value; }
typedef long double (*binary)(long double, long double);
int main(void) {
  printf("%d %d %d\n", (int)sizeof(long double), (int)_Alignof(long double), (int)sizeof(struct S));
  printf("%Lg %Lg %Lg %Lg %Lg\n", g, neg, from_int, from_double, folded);
  long double x = 1.0L, y = 3.0L;
  long double q = x / y;
  printf("%.20Lf\n", q);
  printf("%.20Lf\n", q * 3 - 1);
  printf("%d %d %d %d %d %d\n", x < y, x > y, x <= y, x >= y, x == y, x != y);
  long double nan = 0.0L / (x - 1);
  printf("%d %d %d %d %d %d\n", nan < y, nan > y, nan <= y, nan >= y, nan == nan, nan != nan);
  printf("%d %d %d\n", !x, !(x - 1), nan ? 1 : 0);
  x += 2; x -= 0.5; x *= 4; x /= 5;
  printf("%Lg\n", x);
  int i = 7; i += 0.75L; printf("%d\n", i);
  double d = 1; d /= 3.0L; printf("%.17g\n", d);
  long double a1 = x++, a2 = x, a3 = --x; printf("%Lg %Lg %Lg %Lg\n", a1, a2, a3, -x);
  printf("%Lg %Lg\n", add(g, neg), pick(0, g, neg));
  printf("%Lg %Lg\n", sum(3, 1.0L, 2.5L, table[2]), mixed(5, 1, 2.0, 3.0L, 4L, 5.0L));
  binary fp = add; printf("%Lg\n", fp(table[0], table[1]));
  struct S m = make(21.0L); printf("%d %Lg %c %Lg\n", m.tag, m.value, m.tail, field(s));
  long double *p = &table[1]; p[0] = p[-1] + p[1]; printf("%Lg\n", table[1]);
  printf("%Lg %Lg\n", (long double){ 9 }, (x, y));
  unsigned long long big = 0xffffffffffffffffull; long double lb = big; printf("%.0Lf %llu\n", lb, (unsigned long long)lb);
  unsigned long long half = 0x8000000000000000ull; lb = half; printf("%.0Lf %llu %llu\n", lb, (unsigned long long)lb, (unsigned long long)(lb - 1));
  long long mn = -9223372036854775807LL - 1; lb = mn; printf("%.0Lf %lld\n", lb, (long long)lb);
  printf("%d %u %d %d %d\n", (int)-2.9L, (unsigned)3000000000.5L, (short)-7.5L, (char)65.9L, (_Bool)0.25L);
  float f = 0.1f; lb = f; printf("%.20Lf %g %g\n", lb, (double)(float)0.3L, (double)1.1L);
  enum E { A = 5 } e = A; lb = e; _Bool b = 1; lb += b; printf("%Lg\n", lb);
  __int128 wide = ((__int128)1 << 100) + 12345; lb = wide; printf("%.0Lf\n", lb);
  unsigned __int128 uw = ~(unsigned __int128)0; lb = uw; printf("%Lg\n", lb);
  printf("%Lg %Lg %Lg %Lg\n", LDBL_MAX, LDBL_MIN, LDBL_EPSILON, LDBL_TRUE_MIN);
  printf("%d %d %d %d %d\n", LDBL_MANT_DIG, LDBL_DIG, LDBL_MIN_EXP, LDBL_MAX_EXP, DECIMAL_DIG);
  return 0;
}

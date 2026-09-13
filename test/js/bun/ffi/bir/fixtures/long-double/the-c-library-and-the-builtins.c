int printf(const char *, ...);
int snprintf(char *, unsigned long, const char *, ...);
int sscanf(const char *, const char *, ...);
long double strtold(const char *, char **);
long double sqrtl(long double), fabsl(long double), powl(long double, long double);
long double frexpl(long double, int *), ldexpl(long double, int), floorl(long double), ceill(long double);
long double copysignl(long double, long double);
int strcmp(const char *, const char *);
union U { long double ld; unsigned long long bits[2]; unsigned short half[8]; };
struct Pair { long double a, b; } pairs[2] = { { -1.0L, 2 }, { 0.5, -0.0L } };
static const long double consts[] = { 0x1.8p3L, 1e-4950L, 1.18973149535723176502e+4932L, (long double)3, (long double)0.25, -(long double)7 };
static long double factorial(int n) { return n <= 1 ? 1.0L : n * factorial(n - 1); }
static long double kr(a, b) long double a; int b; { return a * b; }
static long double unproto();
static void note(long double *p) { printf("cleanup %Lg\n", *p); *p = -1; }
static long double with_cleanup(long double v) { long double keep __attribute__((cleanup(note))) = v; return keep + 1; }
static int classify(long double x) {
  return __builtin_isnan(x) * 1 + __builtin_isinf(x) * 2 + __builtin_isfinite(x) * 4 + __builtin_isnormal(x) * 8 + !!__builtin_signbit(x) * 16
       + 100 * __builtin_fpclassify(0, 1, 4, 3, 2, x);
}
int main(void) {
  char buffer[128];
  union U u; u.bits[0] = u.bits[1] = 0; u.ld = 1.0L; printf("%04x %016llx\n", u.half[4], u.bits[0]);
  u.ld = -0.1L; printf("%04x %016llx\n", u.half[4], u.bits[0]);
  printf("%Lg %Lg %Lg %Lg\n", pairs[0].a, pairs[0].b, pairs[1].a, pairs[1].b);
  printf("%Lg %Lg %Lg %Lg %Lg %Lg\n", consts[0], consts[1], consts[2], consts[3], consts[4], consts[5]);
  printf("%.0Lf %Lg %Lg\n", factorial(25), kr(2.5L, 4), unproto(1.5L, 2));
  printf("%Lg\n", with_cleanup(41));
  long double values[4] = { 1, 2, 3, 4 }; int i = 0; values[i++] += 0.5L; values[i++] *= values[0]; printf("%d %Lg %Lg\n", i, values[0], values[1]);
  long double total = 0; for (long double step = 0.25L; step < 2; step += 0.25L) total += step; printf("%Lg\n", total);
  long double count = 3; while (count) { count--; } printf("%Lg %d %d\n", count, count || 0, (count + 1) && 1);
  printf("%Lg %Lg\n", total > 5 ? total : -total, ({ long double t = total * 2; t; }));
  switch ((int)total) { case 7: printf("seven\n"); break; default: printf("other\n"); }
  printf("%Lf %Le %LE %.3Lf %.0Lf %.0Lf %.0Lf %10.2Lf|%-10.2Lf|%+Lg\n", 3.14159265358979323846L, 31415.9265L, 1e-10L, 2.0005L, 0.5L, 1.5L, 2.5L, -1.005L, 1.5L, 2.0L);
  printf("%La %La %La %La\n", 1.0L, 0.1L, -3.5L, 0.0L);
  printf("%Lg %Lg %Lg %Lg %Lg\n", 100000.0L, 1000000.0L, 0.0001L, 0.00001L, 123456789.0L);
  printf("%Lg %Lg %Lg %Lf %LF\n", 1 / 0.0L, -1 / 0.0L, __builtin_nanl(""), -0.0L, 1 / 0.0L);
  snprintf(buffer, sizeof buffer, "%.21Lg", 0.1L); printf("%s\n", buffer);
  char *end; long double parsed = strtold("  -12.5e2xyz", &end); printf("%Lg %s\n", parsed, end);
  parsed = strtold(buffer, 0); printf("%d\n", parsed == 0.1L);
  parsed = strtold("0x1.8p1", 0); printf("%Lg\n", parsed);
  parsed = strtold("1.18973149535723176502e+4932", 0); printf("%d\n", parsed == consts[2]);
  long double scanned = 0; double plain = 0; int n = sscanf("2.75 1.5", "%Lf %lf", &scanned, &plain); printf("%d %Lg %g\n", n, scanned, plain);
  printf("%.18Lf %Lg %Lg\n", sqrtl(2.0L), fabsl(-2.5L), powl(2.0L, 10.0L));
  int e; long double fr = frexpl(48.0L, &e); printf("%Lg %d %Lg %Lg %Lg\n", fr, e, ldexpl(0.75L, 4), floorl(-2.5L), ceill(-2.5L));
  printf("%Lg %Lg %Lg\n", __builtin_fabsl(-3.0L), __builtin_copysignl(2.0L, -0.0L), copysignl(-2.0L, 1.0L));
  printf("%Lg %Lg %d\n", __builtin_infl(), __builtin_huge_vall(), __builtin_nanl("") != __builtin_nanl(""));
  printf("%d %d %d %d %d %d\n", classify(1.0L), classify(-1 / 0.0L), classify(__builtin_nanl("")), classify(0.0L), classify(-1e-4940L), classify(-0.0L));
  printf("%d %d %d\n", __builtin_isgreater(2.0L, 1.0L), __builtin_isunordered(1.0L, __builtin_nanl("")), __builtin_islessequal(1.0L, 1.0L));
  printf("%d %d\n", __builtin_isinf_sign(-__builtin_infl()), (int)sizeof(1.0L + 1));
  return 0;
}
static long double unproto(long double a, int b) { return a + b; }

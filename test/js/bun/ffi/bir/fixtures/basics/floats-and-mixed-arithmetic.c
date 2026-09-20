double mixed(int a, double b) { return a / 2 + b / 2; }
         double avg(int a, int b) { return (a + b) / 2.0; }
         float fmul(float a, float b) { return a * b; }
         double promote(float f) { return f; }
         int to_int(double d) { return (int)d; }
         unsigned to_uint(double d) { return (unsigned)d; }
         long long to_ll(double d) { return (long long)d; }
         double from_uint(unsigned u) { return u; }
         double from_ull(unsigned long long u) { return u; }
         double from_ll(long long v) { return v; }
         float demote(double d) { return (float)d; }
         unsigned char to_uchar(double d) { return (unsigned char)d; }
         double from_char(signed char c) { return c; }
         int compare(double a, double b) { return (a < b) + (a == b) * 2 + (a > b) * 4 + (a != b) * 8; }
         double literals(void) { return 1e-3 + .5 + 2. + 0x1p3 + 1.5f + 1e2f; }
         double neg(double d) { return -d; }
         double incs(void) { double d = 1.5; d++; ++d; d--; float f = 0.25f; f += 1; return d + f; }
         int truthy(double d) { return d ? 1 : 0; }
         int not(double d) { return !d; }
         double compound(int i) { double d = 10; d /= i; i += 2.75; return d + i; }

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)mixed(7, 0x1.8000000000000p+1));
  printf("%.17g\n", (double)avg(3, 4));
  printf("%.9g\n", (double)fmul(0x1.8000000000000p+0f, 0x1.0000000000000p+1f));
  printf("%.17g\n", (double)promote(0x1.0000000000000p-1f));
  printf("%d\n", (int)to_int(-0x1.feb851eb851ecp+1));
  printf("%d\n", (int)to_uint(0x1.65a0bc0000000p+31));
  printf("%lld\n", (long long)to_ll(-0x1.c6bf526340000p+49));
  printf("%.17g\n", (double)from_uint(-1));
  printf("%.17g\n", (double)from_ull(-1LL));
  printf("%.17g\n", (double)from_ll(-1LL));
  printf("%.9g\n", (double)demote(0x1.999999999999ap-4));
  printf("%d\n", (int)to_uchar(0x1.9166666666666p+7));
  printf("%.17g\n", (double)from_char(-5));
  printf("%d\n", (int)compare(0x1.0000000000000p+0, 0x1.0000000000000p+1));
  printf("%d\n", (int)compare(0x1.0000000000000p+1, 0x1.0000000000000p+1));
  printf("%d\n", (int)compare(__builtin_nan(""), 0x1.0000000000000p+1));
  printf("%.17g\n", (double)literals());
  printf("%.17g\n", (double)neg(0x1.4000000000000p+1));
  printf("%.17g\n", (double)incs());
  printf("%d\n", (int)truthy(0x1.0000000000000p-1));
  printf("%d\n", (int)truthy(__builtin_nan("")));
  printf("%d\n", (int)not(0x0.0p+0));
  printf("%.17g\n", (double)compound(4));
  return 0;
}

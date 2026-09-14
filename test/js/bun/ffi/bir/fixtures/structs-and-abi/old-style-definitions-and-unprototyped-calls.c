int later();
         double scale();
         int narrow(c, f, s, p, n) char c; float f; short s; int *p; int n; { return c + (int)(f * 2) + s + *p + n; }
         int call_narrow(void) { int x = 1000; return narrow('a' + 256, 1.5f, (short)70000, &x, 7); }
         int call_later(void) { char c = 5; float f = 2.5f; return later(c, f, 40000LL); }
         int later(int a, double b, long long c) { return a + (int)(b * 10) + (int)(c / 1000); }
         double call_scale(void) { return scale(3, 0.5f); }
         double scale(n, by) double by; int n; { return n * by; }
         int through_pointer(void) { int (*fp)() = later; return fp(1, 2.0, 3000LL); }
         int no_params() { return 9; }
         int call_no_params(void) { return no_params(); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)call_narrow());
  printf("%d\n", (int)call_later());
  printf("%.17g\n", (double)call_scale());
  printf("%d\n", (int)through_pointer());
  printf("%d\n", (int)call_no_params());
  return 0;
}

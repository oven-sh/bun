struct P { long a, b; }; struct D { double a, b; }; struct M { int i; double d; }; struct Big { long v[3]; };
         static long after_seven(int a, int b, int c, int d, int e, int f, int g, struct P p, int h) { return a + b + c + d + e + f + g + p.a * 1000 + p.b * 100000 + h * 10000000; }
         long ints_then_struct(void) { struct P p = { 3, 4 }; return after_seven(1, 1, 1, 1, 1, 1, 1, p, 5); }
         static long one_register_left(int a, int b, int c, int d, int e, struct P p, int h) { return a + b + c + d + e + p.a * 1000 + p.b * 100000 + h * 10000000; }
         long split_is_not_allowed(void) { struct P p = { 3, 4 }; return one_register_left(1, 1, 1, 1, 1, p, 5); }
         static double after_nine(double a, double b, double c, double d, double e, double f, double g, double h, double i, struct D p, double z) { return a + b + c + d + e + f + g + h + i + p.a * 100 + p.b * 1000 + z * 10000; }
         double doubles_then_struct(void) { struct D p = { 1.5, 2.5 }; return after_nine(1, 1, 1, 1, 1, 1, 1, 1, 1, p, 3.0); }
         static double seven_then_pair(double a, double b, double c, double d, double e, double f, double g, struct D p, double z) { return a + b + c + d + e + f + g + p.a * 100 + p.b * 1000 + z * 10000; }
         double one_float_register_left(void) { struct D p = { 1.5, 2.5 }; return seven_then_pair(1, 1, 1, 1, 1, 1, 1, p, 3.0); }
         static double mixed(struct M m, int a, struct D d, struct Big big, struct P p, double x, struct M m2) { return m.i + m.d + a + d.a + d.b + (double)(big.v[0] + big.v[1] + big.v[2]) + (double)(p.a + p.b) + x + m2.i * m2.d; }
         double all_kinds(void) { struct M m = { 1, 0.5 }, m2 = { 4, 0.25 }; struct D d = { 2.0, 3.0 }; struct Big big = { { 10, 20, 30 } }; struct P p = { 100, 200 }; return mixed(m, 7, d, big, p, 0.125, m2); }
         struct Big make_big(long a, long b, long c) { struct Big r = { { a, b, c } }; return r; }
         long big_result(void) { struct Big r = make_big(7, 8, 9); return r.v[0] * 100 + r.v[1] * 10 + r.v[2] + make_big(1, 2, 3).v[1] * 1000; }
         static struct Big shifted(struct Big in, long by) { for (int i = 0; i < 3; i++) in.v[i] += by; return in; }
         long chained(void) { struct Big r = make_big(1, 2, 3); return shifted(shifted(r, 10), 100).v[2] + r.v[2]; }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)ints_then_struct());
  printf("%lld\n", (long long)split_is_not_allowed());
  printf("%.17g\n", (double)doubles_then_struct());
  printf("%.17g\n", (double)one_float_register_left());
  printf("%.17g\n", (double)all_kinds());
  printf("%lld\n", (long long)big_result());
  printf("%lld\n", (long long)chained());
  return 0;
}

struct V { int a; char b; long long c; };
         static struct V g1 = { 1, 2, 3 }, g2 = { 10, 20, 30 };
         int copy(void) { struct V x; x = g1; struct V *p = &x; struct V y; y = *p; *p = g2; return y.a + y.b + (int)y.c + x.a; }
         int cond(int c) { struct V v; v = c ? g1 : g2; return v.a + (c ? g1 : g2).b; }
         int chain(void) { struct V a, b; a = b = g2; return a.a + b.b; }
         int comma(void) { struct V v; v = (g1.a = 5, g1); return v.a; }
         int arr_in_struct(void) { struct W { int n[3]; } w1 = { { 1, 2, 3 } }, w2; w2 = w1; w2.n[1] = 9; return w1.n[1] * 10 + w2.n[1]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)copy());
  printf("%d\n", (int)cond(1));
  printf("%d\n", (int)cond(0));
  printf("%d\n", (int)chain());
  printf("%d\n", (int)comma());
  printf("%d\n", (int)arr_in_struct());
  return 0;
}

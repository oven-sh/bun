static int calls;
         static int bump(int v) { calls++; return v; }
         int and_or(int a, int b) { calls = 0; int r = bump(a) && bump(b); int s = bump(a) || bump(b); return calls * 100 + r * 10 + s; }
         int mixed_operands(int a, int b) { return a * 10 + (a && b) + (b || a) * 100; }
         int held_lhs(int a, int b) { int arr[4] = { 1, 2, 3, 4 }; arr[a] = b && a; return arr[a] + arr[0] * (a || b) * 10; }
         int call_args(int a, int b) { return bump(a) + bump(a && b) * 10 + bump(a ? b : 7) * 100; }
         int guard(const int *p) { return p && *p > 3; }
         int chain(int a, int b, int c) { return a && b || c; }
         int not_chain(int a, int b) { return !(a && !b); }
         int comma(int a) { int x = (a++, a * 2); return x + a; }
         int nested_ternary(int x) { return x < 0 ? -1 : x == 0 ? 0 : x < 10 ? 1 : 2; }
         int select_like(int c, int a, int b) { return c ? a : b; }
         int ternary_mixed(int c) { return (int)((c ? 1 : 2.5) * 2); }
         const char *ternary_ptr(int c) { return c ? "yes" : 0; }
         int ternary_ptr_len(int c) { const char *s = ternary_ptr(c); return s ? s[0] : -1; }
         void ternary_void(int c, int *out) { c ? (void)(*out = 1) : (void)(*out = 2); }
         int run_void(int c) { int v = 0; ternary_void(c, &v); return v; }
         int compound_with_cf(int a, int b) { int arr[3] = { 5, 6, 7 }; arr[1] += a && b; arr[2] *= a ? 2 : 3; return arr[1] * 100 + arr[2]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)and_or(0, 1));
  printf("%d\n", (int)and_or(1, 0));
  printf("%d\n", (int)and_or(1, 1));
  printf("%d\n", (int)mixed_operands(2, 0));
  printf("%d\n", (int)held_lhs(2, 5));
  printf("%d\n", (int)call_args(1, 2));
  printf("%d\n", (int)call_args(0, 2));
  printf("%d\n", (int)guard(0LL));
  printf("%d\n", (int)chain(1, 0, 1));
  printf("%d\n", (int)chain(1, 0, 0));
  printf("%d\n", (int)not_chain(1, 0));
  printf("%d\n", (int)not_chain(1, 1));
  printf("%d\n", (int)comma(3));
  printf("%d\n", (int)nested_ternary(-5));
  printf("%d\n", (int)nested_ternary(0));
  printf("%d\n", (int)nested_ternary(5));
  printf("%d\n", (int)nested_ternary(50));
  printf("%d\n", (int)select_like(5, 10, 20));
  printf("%d\n", (int)select_like(0, 10, 20));
  printf("%d\n", (int)ternary_mixed(0));
  printf("%d\n", (int)ternary_ptr_len(1));
  printf("%d\n", (int)ternary_ptr_len(0));
  printf("%d\n", (int)run_void(0));
  printf("%d\n", (int)compound_with_cf(1, 1));
  printf("%d\n", (int)compound_with_cf(0, 1));
  return 0;
}

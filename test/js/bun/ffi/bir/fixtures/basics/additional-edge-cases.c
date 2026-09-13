static int id(int x) { return x; }
         static int neg(int x) { return -x; }
         int ptr_compound(int n) { int a[8] = { 0, 1, 2, 3, 4, 5, 6, 7 }; int *p = a; p += n; p -= 1; long long big = n; p += big; return *p; }
         int indirect_with_cf(int a, int b) { int (*t[2])(int) = { id, neg }; return t[a && b](a || b) + t[a ? 1 : 0](b ? 5 : 6); }
         struct W { int n[3]; int tag; };
         static struct W w1 = { { 1, 2, 3 }, 10 }, w2 = { { 4, 5, 6 }, 20 };
         int rvalue_array(int c) { return (c ? w1 : w2).n[1] + (c ? w1 : w2).tag; }
         int cond_lhs_store(int c, int v) { int x = 0, y = 0; *(c ? &x : &y) = v; return x * 10 + y; }
         int shift_by_long(int v, long long n) { return v << n; }
         long long shift_long(long long v, unsigned char n) { return v >> n; }
         int do_continue(void) { int i = 0, s = 0; do { i++; if (i & 1) continue; s += i; } while (i < 10); return s; }
         int comma_for(void) { int s = 0; for (int i = 0, j = 10; i < j; i++, j--) s += j - i; return s; }
         int ptr_compare(void) { int a[4]; int *lo = &a[0], *hi = &a[3]; return (lo < hi) + (hi > lo) * 2 + (lo <= lo) * 4 + (hi >= lo) * 8 + (lo == hi) * 16; }
         int ptr_truth(int *p) { int n = 0; if (p) n += 1; if (!p) n += 2; while (p && n < 10) n += 4; return n; }
         double ull_to_double(void) { unsigned long long v = 0x8000000000000000ULL; return v; }
         unsigned long long double_to_ull(double d) { return (unsigned long long)d; }
         int negative_index(void) { int a[5] = { 1, 2, 3, 4, 5 }; int *end = a + 5; return end[-1] * 10 + *(end - 5); }
         int char_index(const char *s, unsigned char i, signed char j) { return s[i] + s[j]; }
         int nested_call_args(int a) { return id(id(a) + id(neg(a && 1))) + id(a ? id(3) : id(4)); }
         static int fill(int *dst, int n) { for (int i = 0; i < n; i++) dst[i] = i * i; return n; }
         int vla_free_sum(void) { int buf[10]; int n = fill(buf, 10), s = 0; while (n--) s += buf[n]; return s; }
         int bool_arith(int a, int b) { return (a < b) + (a == b) * 2 + !a * 4 + !!b * 8 + ((a != 0) & (b != 0)) * 16; }
         int unsigned_wrap(unsigned a) { return a - 1 > a; }
         int int_min(void) { int m = -2147483647 - 1; return m == (int)0x80000000 && -m == m; }
         long long mixed_promote(short s, unsigned u, long long l) { return s * u + l; }
         int switch_ret_in_loop(int n) { for (int i = 0;; i++) { switch (i - n) { case 0: return i * 2; default: continue; } } }
         int local_static_array(int i) { static const int t[] = { 2, 3, 5, 7, 11 }; static const char *n[] = { "x", "yz" }; return t[i] + n[i & 1][0]; }
         int struct_ptr_arith(void) { struct Q { char c; int v; } q[3] = { { 1, 10 }, { 2, 20 }, { 3, 30 } }; struct Q *p = q; p++; return p->v + (p + 1)->c + p[-1].v + (int)((char *)(p + 1) - (char *)p); }

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
  printf("%d\n", (int)ptr_compound(2));
  printf("%d\n", (int)indirect_with_cf(1, 1));
  printf("%d\n", (int)indirect_with_cf(0, 1));
  printf("%d\n", (int)indirect_with_cf(0, 0));
  printf("%d\n", (int)rvalue_array(1));
  printf("%d\n", (int)rvalue_array(0));
  printf("%d\n", (int)cond_lhs_store(1, 7));
  printf("%d\n", (int)cond_lhs_store(0, 7));
  printf("%d\n", (int)shift_by_long(3, 4LL));
  printf("%lld\n", (long long)shift_long(-256LL, 4));
  printf("%d\n", (int)do_continue());
  printf("%d\n", (int)comma_for());
  printf("%d\n", (int)ptr_compare());
  printf("%d\n", (int)ptr_truth(0LL));
  printf("%.17g\n", (double)ull_to_double());
  printf("%lld\n", (long long)double_to_ull(0x1.a055690d9db80p+63));
  printf("%d\n", (int)negative_index());
  printf("%d\n", (int)nested_call_args(2));
  printf("%d\n", (int)vla_free_sum());
  printf("%d\n", (int)bool_arith(0, 3));
  printf("%d\n", (int)unsigned_wrap(0));
  printf("%d\n", (int)int_min());
  printf("%lld\n", (long long)mixed_promote(-1, 2, 1LL));
  printf("%d\n", (int)switch_ret_in_loop(4));
  printf("%d\n", (int)local_static_array(3));
  printf("%d\n", (int)struct_ptr_arith());
  bun_test_fill(buffer1, (const unsigned char[]){97, 98, 0, 0, 0, 0, 0, 0}, 8);
  printf("%d\n", (int)char_index((void *)buffer1, 1, 0));
  return 0;
}

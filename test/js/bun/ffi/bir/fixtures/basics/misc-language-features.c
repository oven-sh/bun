enum Color { RED, GREEN = 10, BLUE };
         enum Color next(enum Color c) { return c == RED ? GREEN : BLUE; }
         static int counter(void) { static int n; return ++n; }
         int three(void) { counter(); counter(); return counter(); }
         int forward(int);
         int use_forward(int x) { return forward(x) + 1; }
         int forward(int x) { return x * 3; }
         int empty_params() { return 4; }
         int call_empty(void) { return empty_params(); }
         int fall_off(int x) { if (x) return 5; return 0; }
         void nothing(void) { return; }
         int dead_code(int x) { return x; x++; goto l; l: return x + 100; }
         int after_break(void) { int s = 0; for (int i = 0; i < 3; i++) { s += 1; continue; s += 100; } while (1) { break; s += 1000; } return s; }
         int block_extern(void) { extern int shared; int local_fn(int); return shared + local_fn(2); }
         int shared = 40;
         int local_fn(int v) { return v; }
         int const_vol(void) { const int a = 3; volatile int b = 4; int *restrict p = (int *)&a; register int r = *p; return r + b; }
         int unary_plus(short s) { return sizeof(+s) + (+s); }
         int inline_fn(int);
         inline int inline_fn(int x) { return x + 1; }
         int deep_expr(int x) { return ((((((((x + 1) * 2) - 3) / 2) % 100) << 1) | 1) ^ 2) & 0xff; }
         int preinc(int x) { int y = ++x + x++; return y * 100 + x; }
         unsigned idx(unsigned char i) { int a[300]; for (int k = 0; k < 300; k++) a[k] = k; return a[i] + i[a]; }
         long long index_64(const int *p, long long i) { return p[i]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)next(0));
  printf("%d\n", (int)next(10));
  printf("%d\n", (int)three());
  printf("%d\n", (int)use_forward(4));
  printf("%d\n", (int)call_empty());
  printf("%d\n", (int)fall_off(0));
  nothing();
  printf("%d\n", (int)dead_code(1));
  printf("%d\n", (int)after_break());
  printf("%d\n", (int)block_extern());
  printf("%d\n", (int)const_vol());
  printf("%d\n", (int)unary_plus(-2));
  printf("%d\n", (int)inline_fn(1));
  printf("%d\n", (int)deep_expr(5));
  printf("%d\n", (int)idx(200));
  return 0;
}

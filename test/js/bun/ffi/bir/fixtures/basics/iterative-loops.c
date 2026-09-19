int sum_to(int n) { int s = 0; for (int i = 1; i <= n; i++) s += i; return s; }
         int fact(int n) { int r = 1; while (n > 1) { r *= n; n--; } return r; }
         int count_down(int n) { int c = 0; do { c++; n -= 3; } while (n > 0); return c; }
         int skip_odds(int n) { int s = 0; for (int i = 0; i < n; i++) { if (i & 1) continue; if (i > 10) break; s += i; } return s; }
         int nested(int n) { int c = 0; for (int i = 0; i < n; i++) for (int j = 0; j < i; j++) c++; return c; }
         int forever(void) { int i = 0; for (;;) { if (++i == 7) return i; } }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sum_to(100));
  printf("%d\n", (int)fact(10));
  printf("%d\n", (int)count_down(10));
  printf("%d\n", (int)count_down(0));
  printf("%d\n", (int)skip_odds(100));
  printf("%d\n", (int)nested(10));
  printf("%d\n", (int)forever());
  return 0;
}

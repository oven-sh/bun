int f(int n) { volatile int total = 0; for (volatile int i = 0; i < n; i++) total += i; return total; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)f(10));
  return 0;
}

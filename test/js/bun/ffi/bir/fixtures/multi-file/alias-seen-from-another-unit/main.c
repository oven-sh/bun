int target(int x) { return x * 2; } int twice(int) __attribute__((alias("target")));

int printf(const char *, ...);
int four(void);
int main(void) {
  printf("%d\n", (int)four());
  return 0;
}

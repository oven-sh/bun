__attribute__((weak)) void hook(void); int a(void) { return hook != 0; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)a());
  return 0;
}

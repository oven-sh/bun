int printf(const char *, ...);
int a(void);
int b(void);
int c(void);
int main(void) {
  printf("%d\n", a());
  printf("%d\n", b());
  printf("%d\n", c());
  printf("%d\n", a());
  return 0;
}

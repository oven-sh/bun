_Atomic int f(_Atomic int x, int *_Atomic p) { return x + *p; } int g(void) { int v = 5; return f(2, &v); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)g());
  return 0;
}

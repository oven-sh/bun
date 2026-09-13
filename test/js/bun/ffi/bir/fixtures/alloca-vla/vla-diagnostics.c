int f(int n) { int tries = 0; { again: tries++; int a[n]; a[0] = tries; if (a[0] < 3) goto again; } return tries; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)f(4));
  return 0;
}

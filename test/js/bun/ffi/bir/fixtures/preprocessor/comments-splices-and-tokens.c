// line comment with a fake */ terminator
/* block
 comment */ int a(void) { return 1 /* inline */ + 2; } // trailing
int b(void) { return 10 \
 + 5; }
int c(void) { return 0x1F + 017 + 0b101 + 'A' + 10u + 10l + 10ull; }
int d(int x) { return x+++1; }
int e(int x, int *p) { return x/ *p; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)a());
  printf("%d\n", (int)b());
  printf("%d\n", (int)c());
  printf("%d\n", (int)d(4));
  return 0;
}

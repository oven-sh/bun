extern _Thread_local int shared; _Thread_local int tentative; static _Thread_local int mine = 1; int a(void) { shared += 10; tentative++; return shared + mine++; }

int printf(const char *, ...);
int b(void);
int main(void) {
  printf("%d\n", (int)a());
  printf("%d\n", (int)a());
  printf("%d\n", (int)b());
  return 0;
}

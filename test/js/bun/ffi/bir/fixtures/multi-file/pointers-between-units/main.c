int printf(const char *, ...);
int read(void);
void advance(void);
int main(void) {
  printf("%d\n", read());
  advance();
  printf("%d\n", read());
  return 0;
}

/* An `inline` definition without `extern` provides no external definition: the other
   unit's does, and each unit may use its own. */
int printf(const char *, ...);
int a(int);
int b(int);
int square(int);
int main(void) {
  printf("%d\n", a(5));
  printf("%d\n", b(5));
  printf("%d\n", square(6));
  return 0;
}

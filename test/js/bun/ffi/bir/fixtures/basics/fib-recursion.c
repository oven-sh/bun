int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)fib(0));
  printf("%d\n", (int)fib(1));
  printf("%d\n", (int)fib(10));
  printf("%d\n", (int)fib(20));
  return 0;
}

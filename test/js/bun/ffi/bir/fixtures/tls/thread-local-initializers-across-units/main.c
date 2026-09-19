_Thread_local int first = 1; int shared = 7;

int printf(const char *, ...);
int sum(void);
int main(void) {
  printf("%d\n", (int)sum());
  return 0;
}

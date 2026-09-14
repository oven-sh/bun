static int calls; void *alloca(unsigned long n) { calls += (int)n; return 0; }
         int f(void) { alloca(5); alloca(6); return calls; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)f());
  return 0;
}

extern void *alloca(__SIZE_TYPE__ size);
         int fill(int n) {
             char *p = alloca(n);
             int *q = __builtin_alloca(n * sizeof(int));
             long long *aligned = __builtin_alloca_with_align(64, 512);
             for (int i = 0; i < n; i++) { p[i] = (char)i; q[i] = i * i; }
             aligned[0] = ((unsigned long long)aligned & 63) == 0;
             return p[n - 1] + q[n - 1] + (int)aligned[0] * 1000 + (((unsigned long long)p & 15) == 0) * 10000;
         }
         int grows(int rounds) {
             int total = 0;
             for (int i = 0; i < rounds; i++) { int *cell = alloca(sizeof(int)); *cell = i; total += *cell; }
             return total;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)fill(10));
  printf("%d\n", (int)grows(100));
  return 0;
}

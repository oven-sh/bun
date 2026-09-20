float swap_float(float *p, float v) { return __atomic_exchange_n(p, v, __ATOMIC_SEQ_CST); }
         double load_double(double *p) { return __atomic_load_n(p, __ATOMIC_ACQUIRE); }
         void store_double(double *p, double v) { __atomic_store_n(p, v, __ATOMIC_RELEASE); }
         int cas_double(double *p, double *expected, double desired) {
             return __atomic_compare_exchange_n(p, expected, desired, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST);
         }
         static int items[4] = {10, 20, 30, 40};
         static int *head = items;
         int advance(void) {
             int *old = __atomic_fetch_add(&head, 2 * sizeof(int), __ATOMIC_SEQ_CST);
             int *now = __atomic_load_n(&head, __ATOMIC_SEQ_CST);
             int *same = items + 2;
             int swapped = __atomic_compare_exchange_n(&head, &same, items + 3, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST);
             return *old + *now * 10 + swapped * 1000 + *head * 10000;
         }
         _Bool lock_free(void) { return __atomic_is_lock_free(8, 0) && __atomic_always_lock_free(1, 0) && !__atomic_is_lock_free(32, 0); }
         unsigned char test_and_set(void *flag) { return __atomic_test_and_set(flag, __ATOMIC_SEQ_CST); }
         void clear(void *flag) { __atomic_clear(flag, __ATOMIC_RELEASE); }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[8] __attribute__((aligned(16)));
static unsigned char buffer2[8] __attribute__((aligned(16)));
static unsigned char buffer3[8] __attribute__((aligned(16)));
static unsigned char buffer4[8] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){0, 0, 192, 63, 0, 0, 0, 0}, 8);
  printf("%.9g\n", (double)swap_float((void *)buffer1, -0x1.0000000000000p+1f));
  bun_test_dump("buffer1", buffer1, 8);
  bun_test_fill(buffer2, (const unsigned char[]){0, 0, 0, 0, 0, 0, 4, 64}, 8);
  printf("%.17g\n", (double)load_double((void *)buffer2));
  store_double((void *)buffer2, -0x0.0p+0);
  bun_test_dump("buffer2", buffer2, 8);
  for (int i = 0; i < 8; i++) buffer3[i] = 0;
  printf("%d\n", (int)cas_double((void *)buffer2, (void *)buffer3, 0x1.2000000000000p+3));
  bun_test_dump("buffer3", buffer3, 8);
  printf("%d\n", (int)cas_double((void *)buffer2, (void *)buffer3, 0x1.2000000000000p+3));
  bun_test_dump("buffer2", buffer2, 8);
  printf("%d\n", (int)advance());
  printf("%d\n", (int)lock_free());
  for (int i = 0; i < 8; i++) buffer4[i] = 0;
  printf("%d\n", (int)test_and_set((void *)buffer4));
  bun_test_dump("buffer4", buffer4, 8);
  printf("%d\n", (int)test_and_set((void *)buffer4));
  clear((void *)buffer4);
  bun_test_dump("buffer4", buffer4, 8);
  return 0;
}

int classes(double x) { return __builtin_isnan(x) + __builtin_isinf(x) * 2 + __builtin_isfinite(x) * 4 + __builtin_isnormal(x) * 8 + __builtin_signbit(x) * 16 + (__builtin_isinf_sign(x) + 1) * 32; }
         int classes_f(float x) { return __builtin_isnan(x) + __builtin_isinf(x) * 2 + __builtin_isfinite(x) * 4 + __builtin_isnormal(x) * 8 + __builtin_signbitf(x) * 16; }
         int classify(double x) { return __builtin_fpclassify(1, 2, 3, 4, 5, x); }
         int compare(double a, double b) { return __builtin_isgreater(a, b) + __builtin_isgreaterequal(a, b) * 2 + __builtin_isless(a, b) * 4 + __builtin_islessequal(a, b) * 8 + __builtin_islessgreater(a, b) * 16 + __builtin_isunordered(a, b) * 32; }
         double magnitude(double x, double y) { return __builtin_fabs(x) + __builtin_copysign(2.0, y); }
         float magnitude_f(float x, float y) { return __builtin_fabsf(x) + __builtin_copysignf(2.0f, y); }
         int bit_tricks(int x, unsigned y) { return __builtin_clrsb(x) * 100 + __builtin_clrsbll((long long)x) + (int)(__builtin_bitreverse32(y) >> 24) * 10000; }
         unsigned long long reversed(unsigned long long x) { return __builtin_bitreverse64(x) + __builtin_bitreverse8(0x01) + __builtin_bitreverse16(0x0001); }
         #if __has_builtin(__builtin_isfinite) && __has_builtin(__builtin_isnan) && __has_builtin(__builtin_fabs) && __has_builtin(__builtin_clrsb)
         int has(void) { return 1; }
         #endif
         typedef unsigned long long u64;
         u64 divide(u64 high, u64 low, u64 by, u64 *remainder) { u64 q; __asm__("divq %[v]" : "=a"(q), "=d"(*remainder) : [v] "r"(by), "a"(low), "d"(high)); return q; }
         u64 multiply(u64 x, u64 y, u64 *high) { u64 low; __asm__("mulq %3" : "=a"(low), "=d"(*high) : "%0"(x), "rm"(y)); return low; }
         _Atomic long counter; _Atomic(int *) slot;
         long atomics(void) { long expected = 5; int value = 0;
             __c11_atomic_init(&counter, 5); __c11_atomic_store(&counter, 5, __ATOMIC_RELEASE);
             int swapped = __c11_atomic_compare_exchange_strong(&counter, &expected, 9, __ATOMIC_SEQ_CST, __ATOMIC_RELAXED);
             long old = __c11_atomic_exchange(&counter, 20, __ATOMIC_ACQ_REL);
             old += __c11_atomic_fetch_or(&counter, 3, __ATOMIC_SEQ_CST);
             __c11_atomic_store(&slot, &value, __ATOMIC_SEQ_CST); __c11_atomic_thread_fence(__ATOMIC_SEQ_CST);
             return old * 100 + __c11_atomic_load(&counter, __ATOMIC_ACQUIRE) + swapped * 10000 + (__c11_atomic_load(&slot, __ATOMIC_RELAXED) == &value) * 100000; }

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
int main(void) {
  printf("%d\n", (int)classes(0x1.8000000000000p+0));
  printf("%d\n", (int)classes(-0x0.0p+0));
  printf("%d\n", (int)classes(__builtin_nan("")));
  printf("%d\n", (int)classes(-__builtin_inf()));
  printf("%d\n", (int)classes(__builtin_inf()));
  printf("%d\n", (int)classes(0x0.0000000000001p-1022));
  printf("%d\n", (int)classes_f(-0x1.16c2000000000p-133f));
  printf("%d\n", (int)classes_f(__builtin_nanf("")));
  printf("%d\n", (int)classify(__builtin_nan("")));
  printf("%d\n", (int)classify(__builtin_inf()));
  printf("%d\n", (int)classify(-0x1.8000000000000p+1));
  printf("%d\n", (int)classify(0x0.012688b70e62bp-1022));
  printf("%d\n", (int)classify(0x0.0p+0));
  printf("%d\n", (int)compare(0x1.0000000000000p+1, 0x1.0000000000000p+0));
  printf("%d\n", (int)compare(0x1.0000000000000p+0, 0x1.0000000000000p+0));
  printf("%d\n", (int)compare(__builtin_nan(""), 0x1.0000000000000p+0));
  printf("%.17g\n", (double)magnitude(-0x1.c000000000000p+1, -0x0.0p+0));
  printf("%.9g\n", (double)magnitude_f(-0x1.c000000000000p+1f, 0x1.0000000000000p+0f));
  printf("%d\n", (int)bit_tricks(-1, 1));
  printf("%d\n", (int)bit_tricks(16777216, 0));
  printf("%lld\n", (long long)reversed(1LL));
  printf("%d\n", (int)has());
  for (int i = 0; i < 8; i++) buffer1[i] = 0;
  printf("%lld\n", (long long)divide(7LL, 5LL, 10LL, (void *)buffer1));
  bun_test_dump("buffer1", buffer1, 8);
  printf("%lld\n", (long long)multiply(-15LL, 1311768467463790320LL, (void *)buffer1));
  bun_test_dump("buffer1", buffer1, 8);
  printf("%lld\n", (long long)atomics());
  return 0;
}

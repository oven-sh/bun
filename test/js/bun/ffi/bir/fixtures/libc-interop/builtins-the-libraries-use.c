#include <stddef.h>
         #include <stdint.h>
         int add_u32(unsigned a, unsigned b) { unsigned r; int o = __builtin_add_overflow(a, b, &r); return o * 2 + (r == a + b); }
         int add_i32(int a, int b) { int r; return __builtin_sadd_overflow(a, b, &r) * 1000 + (r & 0xff); }
         int sub_i64(long long a, long long b) { long long r; int o = __builtin_sub_overflow(a, b, &r); return o * 2 + (r == (long long)((unsigned long long)a - (unsigned long long)b)); }
         int mul_size(size_t a, size_t b) { size_t r; int o = __builtin_mul_overflow(a, b, &r); return o * 2 + (r == a * b); }
         int mul_i64(long long a, long long b) { long long r; return __builtin_smulll_overflow(a, b, &r) * 2 + (r == (long long)((unsigned long long)a * (unsigned long long)b)); }
         int mixed(int a, unsigned long b) { unsigned char r; int o = __builtin_add_overflow(a, b, &r); return o * 1000 + r; }
         int mixed_sign(long long a, unsigned long long b) { long long r; return __builtin_sub_overflow(a, b, &r); }
         int into_wider(unsigned a, unsigned b) { unsigned long long r; return __builtin_mul_overflow(a, b, &r) * 2 + (r == (unsigned long long)a * b); }
         int calls; int next(void) { return ++calls; }
         int once(void) { int r; calls = 0; __builtin_add_overflow(next(), next(), &r); return calls * 10 + r; }
         unsigned rotl32(unsigned x, unsigned n) { return __builtin_rotateleft32(x, n); }
         unsigned long long rotr64(unsigned long long x, unsigned n) { return __builtin_rotateright64(x, n); }
         int rot8(int x, int n) { return __builtin_rotateleft8(x, n) * 1000 + __builtin_rotateright16(x, n); }
         int bits(unsigned x, unsigned long long y) { return __builtin_ffs(x) * 10000 + __builtin_ffsll(y) * 100 + __builtin_parity(x) * 10 + __builtin_parityll(y); }
         static char table[64] __attribute__((aligned(16)));
         long misc(char *p) {
             __builtin_prefetch(p); __builtin_prefetch(p + 64, 0, 3);
             char *q = __builtin_assume_aligned(table, 16);
             __builtin_cpu_init();
             __builtin_assume(p != 0);
             return (q == table) + (__builtin_object_size(p, 0) == (size_t)-1) * 2 + (__builtin_object_size(p, 2) == 0) * 4
                  + __builtin_cpu_supports("avx2") * 8 + __builtin_choose_expr(sizeof(long long) == 8, 16, table) + __builtin_unpredictable(p != 0) * 32;
         }
         size_t library(const char *s) { return __builtin_strlen(s) + (__builtin_strstr(s, "lo") - s) + __builtin_strspn(s, "eh"); }
         #if __has_builtin(__builtin_mul_overflow) && __has_builtin(__builtin_rotateleft32) && __has_builtin(__builtin_frame_address)
         int has(void) { return 1; }
         #endif

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[128] __attribute__((aligned(16)));
static unsigned char buffer2[8] __attribute__((aligned(16)));
int main(void) {
  printf("%d\n", (int)add_u32(-1, 1));
  printf("%d\n", (int)add_u32(7, 8));
  printf("%d\n", (int)add_i32(2147483647, 1));
  printf("%d\n", (int)add_i32(-5, 6));
  printf("%d\n", (int)sub_i64((-9223372036854775807LL - 1), 1LL));
  printf("%d\n", (int)sub_i64(-5LL, -9LL));
  printf("%d\n", (int)mul_size(8589934592LL, 2147483648LL));
  printf("%d\n", (int)mul_size(2147483648LL, 2147483648LL));
  printf("%d\n", (int)mul_size(-1LL, 1LL));
  printf("%d\n", (int)mul_i64((-9223372036854775807LL - 1), -1LL));
  printf("%d\n", (int)mul_i64(-3000000000LL, 3000000000LL));
  printf("%d\n", (int)mul_i64(4611686018427387904LL, 2LL));
  printf("%d\n", (int)mixed(-1, 256LL));
  printf("%d\n", (int)mixed(-1, 0LL));
  printf("%d\n", (int)mixed(1, -1LL));
  printf("%d\n", (int)mixed_sign((-9223372036854775807LL - 1), 1LL));
  printf("%d\n", (int)mixed_sign(5LL, 7LL));
  printf("%d\n", (int)into_wider(-1, -1));
  printf("%d\n", (int)once());
  printf("%d\n", (int)rotl32(-2147483647, 1));
  printf("%d\n", (int)rotl32(305419896, 32));
  printf("%lld\n", (long long)rotr64(1LL, 1));
  printf("%d\n", (int)rot8(129, 1));
  printf("%d\n", (int)bits(8, 1099511627776LL));
  printf("%d\n", (int)bits(0, 0LL));
  for (int i = 0; i < 128; i++) buffer1[i] = 0;
  printf("%lld\n", (long long)misc((void *)buffer1));
  bun_test_fill(buffer2, (const unsigned char[]){104, 101, 108, 108, 111, 0, 0, 0}, 8);
  printf("%lld\n", (long long)library((void *)buffer2));
  printf("%d\n", (int)has());
  return 0;
}

typedef unsigned long long u64; typedef unsigned __int128 u128; typedef __int128 i128;
         u64 mulhi(u64 a, u64 b) { return (u128)a * b >> 64; }
         static __attribute__((noinline)) u128 square(u128 x, int shift) { x *= x; return x >> shift; }
         static __attribute__((noinline)) i128 negate(i128 x) { return -x; }
         u64 chain(u64 a) { u128 s = square((u128)a << 3 | 1, 2); i128 n = negate((i128)s); return (u64)(s >> 60) ^ (u64)(~n >> 64) ^ (u64)n ^ (s > (u128)a) ^ ((n < 0) << 1) ^ ((n == -(i128)s) << 2); }
         u128 id(u128 x) { return x; }
         u64 variadic_like(int pick, u128 a, u64 pad, u128 b) { return pick ? (u64)(a >> 64) + pad : (u64)(b >> 64) + pad; }
         u64 caller(u64 v) { return variadic_like(0, (u128)v, 1, (u128)v << 64 | 5) + variadic_like(1, id((u128)v << 65), 2, 0); }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)chain(81985529216486895LL));
  printf("%lld\n", (long long)caller(81985529216486895LL));
  printf("%lld\n", (long long)mulhi(-1LL, -1LL));
  return 0;
}

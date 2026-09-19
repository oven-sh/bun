typedef unsigned long long u64; typedef unsigned __int128 u128; typedef __int128 i128;
         u128 mul(u64 a, u64 b) { return (u128)a * b; }
         u64 high(u64 a, u64 b) { return (u128)a * b >> 64; }
         long long signed_high(long long a, long long b) { return ((i128)a * b) >> 64; }
         u64 mac(u64 *r, u64 a, u64 w, u64 c) { u128 t = (u128)a * w + *r + c; *r = (u64)t; return (u64)(t >> 64); }
         u64 fe(const u64 f[3], const u64 g[3]) {
             u128 h0 = (u128)f[0] * g[0] + (u128)f[1] * (g[2] * 19) + (u128)f[2] * (g[1] * 19);
             u128 h1 = (u128)f[0] * g[1] + (u128)f[1] * g[0];
             h1 += (u64)(h0 >> 51); h0 &= 0x7ffffffffffff; h1 -= 3; h1 ^= h0 << 70; h1 |= 1; h1++; --h0; h0 *= 5; h0 <<= 3; h0 /= 7; h0 %= 1000003;
             const u128 five = 5; u128 unset; unset = h1; unset = (h0 & 1) ? unset + five : unset - five;
             return (u64)h0 ^ (u64)h1 ^ (u64)(h1 >> 64) ^ (u64)(unset >> 3) ^ (u64)((i128)-2 >> 100) ^ (u64)(((u128)1 << 127) >> 120) ^ (u64)((i128)(long long)f[0] * -3 >> 64);
         }
         int compare(u64 a, u64 b) { u128 x = (u128)a << 64 | b, y = x; y += 1; return (x < y) + (y != x) * 2 + (x == x) * 4 + ((i128)x < 0) * 8; }

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
static unsigned char buffer2[24] __attribute__((aligned(16)));
static unsigned char buffer3[24] __attribute__((aligned(16)));
int main(void) {
  printf("%lld\n", (long long)high(-81985529216486896LL, 1089357896855742840LL));
  printf("%lld\n", (long long)signed_high(-81985529216486896LL, 1089357896855742840LL));
  bun_test_fill(buffer1, (const unsigned char[]){255, 255, 255, 255, 255, 255, 255, 255}, 8);
  printf("%lld\n", (long long)mac((void *)buffer1, -81985529216486896LL, 1089357896855742840LL, -2LL));
  bun_test_dump("buffer1", buffer1, 8);
  bun_test_fill(buffer2, (const unsigned char[]){188, 154, 120, 86, 52, 18, 7, 0, 241, 255, 255, 255, 255, 255, 3, 0, 85, 85, 170, 170, 85, 85, 5, 0}, 24);
  bun_test_fill(buffer3, (const unsigned char[]){15, 15, 15, 15, 15, 15, 6, 0, 51, 51, 34, 34, 17, 17, 2, 0, 254, 202, 239, 190, 173, 222, 4, 0}, 24);
  printf("%lld\n", (long long)fe((void *)buffer2, (void *)buffer3));
  printf("%d\n", (int)compare(-1LL, -1LL));
  printf("%d\n", (int)compare(1LL, 7LL));
  return 0;
}

typedef unsigned int u32; typedef unsigned long long u64;
         u64 rol64(u64 x, int n) { return (x << n) | (x >> (64 - n)); }
         u64 ror64(u64 x, unsigned n) { return (x >> n) | (x << (64 - n)); }
         u32 rol32(u32 x, unsigned n) { return (x << (n & 31)) | (x >> (-n & 31)); }
         u32 ror32(u32 x, unsigned char n) { return (x >> (n & 31)) + (x << ((32 - n) & 31)); }
         u64 xor_form(u64 x, u64 n) { return (x >> (n & 63)) ^ (x << ((0 - n) & 63)); }
         u32 member(const struct { u32 w[2]; } *s, int n) { return (s->w[1] << n) | (s->w[1] >> (32 - n)); }
         u32 builtins(u32 x, u64 y, int n) { return __builtin_rotateleft32(x, n) ^ (u32)__builtin_rotateright64(y, n) ^ _rotl(x, 3) ^ (u32)_rotr64(y, 5) ^ (u32)_lrotl(y, 7); }
         unsigned char narrow(unsigned char x, int n) { return __builtin_rotateleft8(x, n); }
         u32 not_a_rotation(u32 x, u32 y, int n, int m) { return ((x << n) | (y >> (32 - n))) + ((x << n) | (x >> (32 - m))) + ((x << n) | (x >> (31 - n))); }
         int signed_one(int x, int n) { return (x << n) | (x >> (32 - n)); }
         u32 side_effects(u32 *p, int n) { return (*p++ << n) | (*p++ >> (32 - n)); }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)rol64(-9141386507638288913LL, 12));
  printf("%lld\n", (long long)ror64(-9141386507638288913LL, 63));
  printf("%d\n", (int)rol32(-2128394905, 0));
  printf("%d\n", (int)ror32(-2128394905, 0));
  printf("%lld\n", (long long)xor_form(-9141386507638288913LL, 0LL));
  printf("%d\n", (int)rol32(-2128394905, 1));
  printf("%d\n", (int)ror32(-2128394905, 1));
  printf("%lld\n", (long long)xor_form(-9141386507638288913LL, 1LL));
  printf("%d\n", (int)rol32(-2128394905, 31));
  printf("%d\n", (int)ror32(-2128394905, 31));
  printf("%lld\n", (long long)xor_form(-9141386507638288913LL, 31LL));
  printf("%d\n", (int)rol32(-2128394905, 32));
  printf("%d\n", (int)ror32(-2128394905, 32));
  printf("%lld\n", (long long)xor_form(-9141386507638288913LL, 32LL));
  printf("%d\n", (int)rol32(-2128394905, 45));
  printf("%d\n", (int)ror32(-2128394905, 45));
  printf("%lld\n", (long long)xor_form(-9141386507638288913LL, 45LL));
  printf("%d\n", (int)builtins(-2128394905, -9141386507638288913LL, 9));
  printf("%d\n", (int)narrow(129, 1));
  return 0;
}

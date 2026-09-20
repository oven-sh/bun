int clz(unsigned v) { return __builtin_clz(v); }
         int clzl(unsigned long v) { return __builtin_clzl(v); }
         int clzll(unsigned long long v) { return __builtin_clzll(v); }
         int ctz(unsigned v) { return __builtin_ctz(v); }
         int ctzl(unsigned long v) { return __builtin_ctzl(v); }
         int ctzll(unsigned long long v) { return __builtin_ctzll(v); }
         int pop(unsigned v) { return __builtin_popcount(v); }
         int popl(unsigned long v) { return __builtin_popcountl(v); }
         int popll(unsigned long long v) { return __builtin_popcountll(v); }
         unsigned short swap16(unsigned short v) { return __builtin_bswap16(v); }
         unsigned swap32(unsigned v) { return __builtin_bswap32(v); }
         unsigned long long swap64(unsigned long long v) { return __builtin_bswap64(v); }
         int folded(void) { return __builtin_popcount(0xff) + __builtin_ctz(8); }
         void die(int x) { if (x) __builtin_trap(); }
         int never(int x) { if (x) return 1; __builtin_unreachable(); }

int printf(const char *, ...);
int main(void) {
  // `long` has 32 bits on Windows: what depends on its width is printed as if it had 64.
  int narrower = 64 - (int)sizeof(long) * 8;
  printf("%d\n", (int)clz(1));
  printf("%d\n", (int)clz(1048576));
  printf("%d\n", (int)clz(-1));
  printf("%d\n", (int)clzl(1LL) + narrower);
  printf("%d\n", (int)clzll(1099511627776LL));
  printf("%d\n", (int)ctz(80));
  printf("%d\n", (int)ctzl(1UL << (sizeof(long) * 8 - 31)) + narrower);
  printf("%d\n", (int)ctzll((-9223372036854775807LL - 1)));
  printf("%d\n", (int)pop(252641535));
  printf("%d\n", (int)popl(-1LL) + narrower);
  printf("%d\n", (int)popll(-9223372036854775807LL));
  printf("%d\n", (int)swap16(4660));
  printf("%d\n", (int)swap32(305419896));
  printf("%lld\n", (long long)swap64(72623859790382856LL));
  printf("%d\n", (int)folded());
  die(0);
  return 0;
}

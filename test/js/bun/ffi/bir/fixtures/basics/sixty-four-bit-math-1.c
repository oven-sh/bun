long long mul(long long a, long long b) { return a * b; }
         unsigned long long umax(void) { return 0xffffffffffffffffULL; }
         long long big(void) { return 1LL << 62; }
         long long mix(int a, long long b) { return a + b * 2; }
         unsigned long long fnv_offset(void) { return 14695981039346656037ULL; }
         int high(unsigned long long v) { return (int)(v >> 32); }
         long long neg(long long v) { return -v; }
         int sizes(void) { return (sizeof(long) == sizeof(1L)) * 800 + sizeof(long long) * 10 + sizeof(void *) + sizeof(1LL) * 1000 + sizeof(1u) * 10000; } /* long: any width */
         long long literal_types(void) { return sizeof(2147483647) + sizeof(2147483648) * 10 + sizeof(0x7fffffff) * 100 + sizeof(0xffffffff) * 1000 + sizeof(0x100000000) * 10000; }
         int unsigned_literal(void) { return 0xffffffff > 0; }
         long long udiv64(unsigned long long a, unsigned long long b) { return a / b; }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)mul(3000000000LL, 5LL));
  printf("%lld\n", (long long)umax());
  printf("%lld\n", (long long)big());
  printf("%lld\n", (long long)mix(-3, 1099511627776LL));
  printf("%lld\n", (long long)fnv_offset());
  printf("%d\n", (int)high(1311768464867721216LL));
  printf("%lld\n", (long long)neg(5LL));
  printf("%d\n", (int)sizes());
  printf("%lld\n", (long long)literal_types());
  printf("%d\n", (int)unsigned_literal());
  printf("%lld\n", (long long)udiv64(-2LL, 2LL));
  return 0;
}

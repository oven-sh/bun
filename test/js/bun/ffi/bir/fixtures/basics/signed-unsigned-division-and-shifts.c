int sdiv(int a, int b) { return a / b; }
         int srem(int a, int b) { return a % b; }
         unsigned udiv(unsigned a, unsigned b) { return a / b; }
         unsigned urem(unsigned a, unsigned b) { return a % b; }
         int sar(int a, int n) { return a >> n; }
         unsigned shr(unsigned a, int n) { return a >> n; }
         int shl(int a, int n) { return a << n; }
         long long shl64(long long a, int n) { return a << n; }
         unsigned long long shr64(unsigned long long a, long long n) { return a >> n; }
         int cmp_mixed(void) { return (-1 < 1u) * 10 + (-1 < 1); }
         int cmp_unsigned(unsigned a, unsigned b) { return (a < b) + (a <= b) * 2 + (a > b) * 4 + (a >= b) * 8; }
         int cmp_signed(int a, int b) { return (a < b) + (a <= b) * 2 + (a > b) * 4 + (a >= b) * 8; }
         int bitops(int a, int b) { return ((a & b) | (a ^ b)) + ~a; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sdiv(-7, 2));
  printf("%d\n", (int)srem(-7, 2));
  printf("%d\n", (int)srem(7, -2));
  printf("%d\n", (int)udiv(-7, 2));
  printf("%d\n", (int)urem(-7, 5));
  printf("%d\n", (int)sar(-16, 2));
  printf("%d\n", (int)shr(-16, 2));
  printf("%d\n", (int)shl(3, 4));
  printf("%lld\n", (long long)shl64(1LL, 40));
  printf("%lld\n", (long long)shr64(-1LL, 60LL));
  printf("%d\n", (int)cmp_mixed());
  printf("%d\n", (int)cmp_unsigned(-1, 1));
  printf("%d\n", (int)cmp_signed(-1, 1));
  printf("%d\n", (int)bitops(12, 10));
  return 0;
}

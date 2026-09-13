enum Events { IN = 1, ET = 1u << 31, BIG = 1LL << 40, NEG = -5 };
         int f(void) { return (ET > 0) + (sizeof(ET) == 4) * 10 + (sizeof(BIG) == 8) * 100 + (BIG >> 40 == 1) * 1000 + (NEG < 0) * 10000 + (sizeof(IN) == 4) * 100000; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)f());
  return 0;
}

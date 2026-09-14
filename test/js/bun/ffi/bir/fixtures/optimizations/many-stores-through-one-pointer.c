// An array of 50,000 elements with an initializer for each, and 50,000 stores through one pointer in a row: what a
// generated table or an unrolled kernel looks like. They cost their number (the elimination of loads in the backend
// went through every store so far for each one).
#include <stdio.h>

#define TEN(...) __VA_ARGS__ __VA_ARGS__ __VA_ARGS__ __VA_ARGS__ __VA_ARGS__ __VA_ARGS__ __VA_ARGS__ __VA_ARGS__ __VA_ARGS__ __VA_ARGS__
#define HUNDRED(...) TEN(TEN(__VA_ARGS__))
#define THOUSAND(...) TEN(HUNDRED(__VA_ARGS__))
#define FIFTY_THOUSAND(...) TEN(THOUSAND(__VA_ARGS__)) TEN(THOUSAND(__VA_ARGS__)) TEN(THOUSAND(__VA_ARGS__)) TEN(THOUSAND(__VA_ARGS__)) TEN(THOUSAND(__VA_ARGS__))

__attribute__((noinline)) static long long initialized(int seed) {
  // (The elements are not constants, so they are stores.)
  int table[50000] = { FIFTY_THOUSAND(seed ^ 5, ) };
  long long sum = 0;
  for (int i = 0; i < 50000; i += 4999) sum += table[i];
  return sum;
}
__attribute__((noinline)) static long long stored(int *p, int seed) {
  int i = 0;
  FIFTY_THOUSAND(p[i] = seed + i; i++;)
  // Loads among them see the stores before them.
  long long sum = p[0] + p[49999];
  FIFTY_THOUSAND(p[49999 - (i - 50000)] += 1; i++;)
  return sum + p[0] + p[49999] + p[25000];
}
// By constant offsets, 9,000 of them: 1000 to 9999, spelled by pasting digits.
#define ONES(t) p[t##0] = seed + t##0; p[t##1] = seed; p[t##2] = seed; p[t##3] = seed; p[t##4] = seed; p[t##5] = seed; p[t##6] = seed; p[t##7] = seed; p[t##8] = seed; p[t##9] = seed + t##9;
#define TENS(h) ONES(h##0) ONES(h##1) ONES(h##2) ONES(h##3) ONES(h##4) ONES(h##5) ONES(h##6) ONES(h##7) ONES(h##8) ONES(h##9)
#define HUNDREDS(k) TENS(k##0) TENS(k##1) TENS(k##2) TENS(k##3) TENS(k##4) TENS(k##5) TENS(k##6) TENS(k##7) TENS(k##8) TENS(k##9)
__attribute__((noinline)) static long long by_constant_offsets(int *p, int seed) {
  HUNDREDS(1) HUNDREDS(2) HUNDREDS(3) HUNDREDS(4) HUNDREDS(5) HUNDREDS(6) HUNDREDS(7) HUNDREDS(8) HUNDREDS(9)
  return p[1000] + p[9999] + p[5001] + p[999];
}

int main(void) {
  static int storage[50000];
  long long first = initialized(7), second = stored(storage, 3), third = by_constant_offsets(storage, 9);
  printf("%lld %lld %lld\n", first, second, third);
  return 0;
}

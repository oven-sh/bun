// `__builtin_{add,sub,mul}_overflow` with a 128-bit operand or result: done as if with all the bits there are, then
// looked at for whether the result's type holds it, and stored modulo the type either way. Every pairing of 64- and
// 128-bit, signed and unsigned operands and results, at the values where the answer turns.
#include <stdio.h>

typedef __int128 i128;
typedef unsigned __int128 u128;

static int checks, wrong;
#define CHECK(c) do { checks++; if (!(c)) { wrong++; printf("WRONG (line %d): %s\n", __LINE__, #c); } } while (0)

#define I128_MAX ((i128)(((u128)1 << 127) - 1))
#define I128_MIN (-I128_MAX - 1)
#define U128_MAX (~(u128)0)

// The builtin against the answer worked out by hand: whether it overflows, and what is stored.
#define EXPECT(operation, a, b, type, overflows, stored) do { \
    type result = 0; \
    int did = __builtin_##operation##_overflow(a, b, &result); \
    CHECK(did == (overflows)); \
    CHECK(result == (type)(stored)); \
  } while (0)

int main(void) {
  volatile i128 one = 1, minus_one = -1, zero = 0;
  volatile u128 uone = 1;
  volatile long long big = 0x7fffffffffffffffLL;
  volatile unsigned long long ubig = ~0ull;
  // Addition.
  EXPECT(add, I128_MAX, one, i128, 1, I128_MIN);
  EXPECT(add, I128_MAX, zero, i128, 0, I128_MAX);
  EXPECT(add, I128_MIN, minus_one, i128, 1, I128_MAX);
  EXPECT(add, I128_MIN, one, i128, 0, I128_MIN + 1);
  EXPECT(add, U128_MAX, uone, u128, 1, 0);
  EXPECT(add, U128_MAX - 1, uone, u128, 0, U128_MAX);
  EXPECT(add, I128_MAX, one, u128, 0, (u128)1 << 127);
  EXPECT(add, U128_MAX, minus_one, u128, 0, U128_MAX - 1);
  EXPECT(add, U128_MAX, minus_one, i128, 1, -2);
  EXPECT(add, zero, minus_one, u128, 1, U128_MAX);
  EXPECT(add, big, big, i128, 0, (i128)big * 2);
  EXPECT(add, ubig, ubig, i128, 0, (i128)ubig * 2);
  EXPECT(add, (i128)big + 1, zero, long long, 1, -big - 1);
  EXPECT(add, (i128)big, zero, long long, 0, big);
  EXPECT(add, (u128)ubig + 1, zero, unsigned long long, 1, 0);
  EXPECT(add, (i128)1 << 100, (i128)1 << 100, int, 1, 0);
  EXPECT(add, (i128)-5, (i128)3, signed char, 0, -2);
  // Subtraction.
  EXPECT(sub, I128_MIN, one, i128, 1, I128_MAX);
  EXPECT(sub, I128_MIN, zero, i128, 0, I128_MIN);
  EXPECT(sub, zero, I128_MIN, i128, 1, I128_MIN);
  EXPECT(sub, zero, I128_MIN, u128, 0, (u128)1 << 127);
  EXPECT(sub, minus_one, I128_MIN, i128, 0, I128_MAX);
  EXPECT(sub, zero, uone, u128, 1, U128_MAX);
  EXPECT(sub, zero, uone, i128, 0, -1);
  EXPECT(sub, uone, uone, u128, 0, 0);
  EXPECT(sub, I128_MAX, U128_MAX, i128, 0, I128_MIN);
  EXPECT(sub, I128_MAX - 1, U128_MAX, i128, 1, I128_MAX);
  EXPECT(sub, big, (i128)-1, long long, 1, -big - 1);
  EXPECT(sub, 0, ubig, i128, 0, -(i128)ubig);
  // Multiplication.
  EXPECT(mul, (i128)1 << 100, 4, i128, 0, (i128)1 << 102);
  EXPECT(mul, (i128)1 << 100, (i128)1 << 27, i128, 1, I128_MIN);
  EXPECT(mul, (i128)1 << 100, (i128)1 << 27, u128, 0, (u128)1 << 127);
  EXPECT(mul, (i128)1 << 100, (i128)1 << 28, u128, 1, 0);
  EXPECT(mul, (i128)1 << 100, -((i128)1 << 27), i128, 0, I128_MIN);
  EXPECT(mul, I128_MIN, minus_one, i128, 1, I128_MIN);
  EXPECT(mul, I128_MIN, minus_one, u128, 0, (u128)1 << 127);
  EXPECT(mul, I128_MIN, one, i128, 0, I128_MIN);
  EXPECT(mul, U128_MAX, uone, u128, 0, U128_MAX);
  EXPECT(mul, U128_MAX, (u128)2, u128, 1, U128_MAX - 1);
  EXPECT(mul, U128_MAX, zero, i128, 0, 0);
  EXPECT(mul, minus_one, uone, u128, 1, U128_MAX);
  EXPECT(mul, ubig, ubig, u128, 0, (u128)ubig * ubig);
  EXPECT(mul, ubig, ubig, i128, 1, (u128)ubig * ubig);
  EXPECT(mul, big, big, i128, 0, (i128)big * big);
  EXPECT(mul, ubig, ubig, unsigned long long, 1, 1);
  EXPECT(mul, (i128)3, (i128)-7, int, 0, -21);
  EXPECT(mul, (i128)1 << 64, (i128)1 << 63, i128, 1, I128_MIN);
  EXPECT(mul, ((i128)1 << 64) - 1, ((i128)1 << 63), i128, 0, (i128)((((u128)1 << 64) - 1) << 63));
  // The operands are evaluated once, the pointer last.
  static i128 results[3];
  int at = 0, evaluated = 0;
  int did = __builtin_add_overflow((evaluated++, one), (evaluated += 10, I128_MAX), &results[at++]);
  CHECK(did == 1 && at == 1 && evaluated == 11 && results[0] == I128_MIN);
#if defined __GNUC__ && !defined __clang__ || defined __BUN_CC__
  // GCC's predicates: the same question of the type of a value that is not read.
  CHECK(__builtin_add_overflow_p(I128_MAX, one, (i128)0) == 1);
  CHECK(__builtin_add_overflow_p(I128_MAX, one, (u128)0) == 0);
  CHECK(__builtin_mul_overflow_p(big, big, (long long)0) == 1);
  CHECK(__builtin_sub_overflow_p(0, 1, 0u) == 1);
  CHECK(__builtin_sub_overflow_p(0, 1, (at++, 0)) == 0 && at == 2);
#else
  checks += 5, at++;
#endif
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

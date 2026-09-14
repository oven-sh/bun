// The bit-counting builtins of constants are integer constant expressions, as GCC and Clang have them; and a builtin that
// only passes one operand through (__builtin_expect, __builtin_assume_aligned) still evaluates the others.
#include <limits.h>
#include <stdint.h>
#include <stdio.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

enum {
  CLZ_1 = __builtin_clz(1), CLZ_TOP = __builtin_clz(0x80000000u), CLZL = __builtin_clzl(1ul), CLZLL = __builtin_clzll(0x100ull),
  CTZ_8 = __builtin_ctz(8), CTZL = __builtin_ctzl(1ul << 40), CTZLL = __builtin_ctzll(1ull << 63),
  POP = __builtin_popcount(0xf0f0), POPL = __builtin_popcountl(~0ul), POPLL = __builtin_popcountll(~0ull),
  PARITY = __builtin_parity(7), PARITYLL = __builtin_parityll(3ull << 40),
  FFS_0 = __builtin_ffs(0), FFS_8 = __builtin_ffs(8), FFSLL = __builtin_ffsll(1ll << 50),
  CLRSB_0 = __builtin_clrsb(0), CLRSB_M1 = __builtin_clrsb(-1), CLRSBLL = __builtin_clrsbll(1),
  SWAP16 = __builtin_bswap16(0x1234), SWAP32 = (int)(__builtin_bswap32(0x12345678) >> 8),
};
static int s_clz = __builtin_clz(4);
static int s_pop = __builtin_popcountll(~0ull);
static uint64_t s_swap64 = __builtin_bswap64(0x0102030405060708ull);
static uint32_t s_swap32 = __builtin_bswap32(0xaabbccddu);
static char sized[__builtin_ctz(16) + __builtin_popcount(3)];
_Static_assert(__builtin_ctz(8) == 3 && __builtin_clz(1) == 31 && __builtin_popcount(255) == 8, "bit counts of constants");
_Static_assert(__builtin_bswap16(0xff00) == 0x00ff && __builtin_bswap64(1) == 1ull << 56, "byte swaps of constants");

static int calls;
static long side(long v) { calls++; return v; }
static int iside(int v) { calls++; return v; }
static void *pside(void *p) { calls++; return p; }

int main(void) {
  CHECK(CLZ_1 == 31 && CLZ_TOP == 0 && CLZL == (int)sizeof(long) * CHAR_BIT - 1 && CLZLL == 55);
  CHECK(CTZ_8 == 3 && CTZL == 40 && CTZLL == 63);
  CHECK(POP == 8 && POPL == (int)sizeof(long) * CHAR_BIT && POPLL == 64);
  CHECK(PARITY == 1 && PARITYLL == 0 && FFS_0 == 0 && FFS_8 == 4 && FFSLL == 51);
  CHECK(CLRSB_0 == 31 && CLRSB_M1 == 31 && CLRSBLL == 62);
  CHECK(SWAP16 == 0x3412 && SWAP32 == 0x785634);
  CHECK(s_clz == 29 && s_pop == 64 && s_swap64 == 0x0807060504030201ull && s_swap32 == 0xddccbbaau && sizeof sized == 6);
  CHECK(__builtin_constant_p(__builtin_clz(4)) && __builtin_constant_p(__builtin_bswap32(1)));
  switch (0x3412) { case __builtin_bswap16(0x1234): CHECK(1); break; default: CHECK(0); }
  // The run-time forms agree with the folded ones.
  volatile unsigned v = 0xf0f0, one = 1;
  volatile unsigned long long wide = 0x0102030405060708ull;
  CHECK(__builtin_popcount(v) == POP && __builtin_clz(one) == CLZ_1 && __builtin_bswap64(wide) == s_swap64 && __builtin_ctz(v) == 4);
  // The result of __builtin_bswap64 is a uint64_t.
  CHECK(_Generic(__builtin_bswap64(1), uint64_t: 1, default: 0) && _Generic(__builtin_bswap32(1), uint32_t: 1, default: 0) && _Generic(__builtin_bswap16(1), uint16_t: 1, default: 0));

  // Every operand is evaluated, once.
  calls = 0;
  long a = __builtin_expect(side(5), side(1));
  CHECK(a == 5 && calls == 2);
  calls = 0;
  long b = __builtin_expect(side(6), (side(0), 3));
  CHECK(b == 6 && calls == 2);
#if defined __has_builtin
#if __has_builtin(__builtin_expect_with_probability)
  calls = 0;
  long c = __builtin_expect_with_probability(side(7), side(1), 0.5);
  CHECK(c == 7 && calls == 2);
#endif
#endif
  calls = 0;
  static char buffer[32] __attribute__((aligned(16)));
  char *p = __builtin_assume_aligned(pside(buffer), 16, iside(0));
  CHECK(p == buffer && calls == 2);
  calls = 0;
  if (__builtin_expect(iside(1) == 1, 1)) calls += 10;
  CHECK(calls == 11);
  // Constant operands leave a constant: the builtin still works in a static assertion and a case label.
  _Static_assert(__builtin_expect(3, 1) == 3, "the value of __builtin_expect");
  // These do not evaluate their operand.
  calls = 0;
  int constant = __builtin_constant_p(side(1));
  unsigned long size = __builtin_object_size(pside(buffer), 0);
  int chosen = __builtin_choose_expr(1, 10, iside(20));
  CHECK(!constant && size == (unsigned long)-1 && chosen == 10 && calls == 0);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

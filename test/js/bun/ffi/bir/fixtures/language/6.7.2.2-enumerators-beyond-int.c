// C11 6.7.2.2 as GCC and Clang extend it (and C23 6.7.2.2p12 has it): an enumeration whose values do not all fit int takes
// a wider type, and once it is complete every one of its enumerators has that type; before the closing brace each has the
// type its own value needs. An enumeration of ints stays what C11 says: the enumerators are ints.
#include <limits.h>
#include <stdio.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define IS_SIGNED(x) ((__typeof__(x))-1 < 0)
#define KIND(x) _Generic((x), int: 'i', unsigned: 'u', long: 'l', unsigned long: 'L', long long: 'q', unsigned long long: 'Q', \
  unsigned char: 'c', short: 's', default: '?')

enum all_int { AI_A = -1, AI_B = INT_MAX, AI_C = 0 };
enum not_negative { NN_A, NN_B = 5 };
enum beyond_int { BI_A = 1, BI_B = 0xFFFFFFFF };
enum after_int_max { AM_A = INT_MAX, AM_B };
enum negative_and_beyond { NB_A = -1, NB_B = 0x80000000 };
enum after_uint_max { AU_A = UINT_MAX, AU_B };
enum beyond_uint { BU_A = 0x100000000, BU_B = 1 };
enum every_bit { EB_A = 0xFFFFFFFFFFFFFFFFULL };
enum most_negative { MN_A = LLONG_MIN, MN_B = 1 };
enum events { EV_IN = 1, EV_ET = 1u << 31, EV_BIG = 1LL << 40, EV_NEG = -5 };
// Inside the braces an enumerator still has the type its own value gave it.
enum inside { IN_A = 0, IN_SIZE_BEFORE = sizeof(IN_A), IN_BIG = 0x100000000, IN_SIZE_AFTER = sizeof(IN_A), IN_BIG_SIZE = sizeof(IN_BIG) };
enum fixed_small : unsigned char { FS_A = 1, FS_B = 255 };
enum fixed_wide : long long { FW_A = 1 };
enum forward;
enum forward { FD_A = 1, FD_B = -2 };

static long variadic_sum(int n, ...) {
  __builtin_va_list ap;
  __builtin_va_start(ap, n);
  long total = 0;
  while (n--) total += __builtin_va_arg(ap, long);
  __builtin_va_end(ap);
  return total;
}

int main(void) {
  CHECK(sizeof(AI_A) == 4 && sizeof(AI_B) == 4 && IS_SIGNED(AI_A) && KIND(AI_B) == 'i' && sizeof(enum all_int) == 4 && IS_SIGNED(enum all_int));
  CHECK(sizeof(NN_B) == 4 && IS_SIGNED(NN_B) && KIND(NN_A) == 'i' && sizeof(enum not_negative) == 4 && !IS_SIGNED(enum not_negative));
  CHECK(sizeof(BI_A) == 4 && sizeof(BI_B) == 4 && !IS_SIGNED(BI_A) && !IS_SIGNED(BI_B) && KIND(BI_A) == 'u' && sizeof(enum beyond_int) == 4);
  CHECK(BI_A - 2 > 0 && BI_B + 1 == 0 && -BI_A > 0);
  CHECK(sizeof(AM_A) == 4 && !IS_SIGNED(AM_A) && AM_B == 0x80000000u && KIND(AM_B) == 'u' && AM_B > 0);
  CHECK(sizeof(NB_A) == 8 && sizeof(NB_B) == 8 && IS_SIGNED(NB_A) && IS_SIGNED(NB_B) && KIND(NB_A) == 'l' && sizeof(enum negative_and_beyond) == 8);
  CHECK(NB_A < NB_B && NB_B == 2147483648L && NB_A >> 40 == -1);
  CHECK(sizeof(AU_A) == 8 && sizeof(AU_B) == 8 && AU_B == 4294967296 && !IS_SIGNED(AU_A) && KIND(AU_A) == 'L');
  CHECK(sizeof(BU_A) == 8 && sizeof(BU_B) == 8 && !IS_SIGNED(BU_B) && KIND(BU_B) == 'L' && BU_B - 2 > 0);
  CHECK(sizeof(EB_A) == 8 && !IS_SIGNED(EB_A) && EB_A > 0 && EB_A > 5 && EB_A >> 1 == 0x7FFFFFFFFFFFFFFF && EB_A / 2 == 0x7FFFFFFFFFFFFFFF && KIND(EB_A) == 'L');
  CHECK(sizeof(MN_A) == 8 && IS_SIGNED(MN_B) && MN_A < 0 && MN_B - 2 < 0 && KIND(MN_B) == 'l');
  CHECK(sizeof(EV_IN) == 8 && sizeof(EV_ET) == 8 && sizeof(EV_BIG) == 8 && sizeof(EV_NEG) == 8 && sizeof(enum events) == 8 && IS_SIGNED(EV_IN) && IS_SIGNED(EV_ET));
  CHECK(EV_ET > 0 && EV_ET == 2147483648 && EV_BIG >> 40 == 1 && EV_NEG < 0 && EV_NEG < EV_ET && KIND(EV_IN) == 'l');
  CHECK(variadic_sum(3, EV_IN, EV_NEG, EV_BIG) == (1L << 40) - 4);
  CHECK(IN_SIZE_BEFORE == 4 && IN_SIZE_AFTER == 4 && IN_BIG_SIZE == 8 && sizeof(IN_A) == 8 && sizeof(IN_SIZE_BEFORE) == 8);
  CHECK(sizeof(FS_A) == 1 && sizeof(enum fixed_small) == 1 && KIND(FS_B) == 'c' && FS_B == 255 && sizeof(FS_A + 0) == 4);
  CHECK(sizeof(FW_A) == 8 && KIND(FW_A) == 'q' && sizeof(enum fixed_wide) == 8);
  CHECK(sizeof(FD_A) == 4 && KIND(FD_B) == 'i' && FD_B == -2 && sizeof(enum forward) == 4 && IS_SIGNED(enum forward));
  // An object of the enumeration holds every enumerator.
  enum negative_and_beyond object = NB_B;
  enum every_bit bits = EB_A;
  __typeof__(EB_A) same = EB_A;
  CHECK(object == 0x80000000L && (object = NB_A) < 0 && bits == ULONG_MAX && same + 1 == 0 && sizeof same == 8);
  // The constants are usable wherever an integer constant expression is.
  static const long table[] = { [NB_B >> 31] = EV_BIG };
  _Static_assert(EB_A == ULONG_MAX && AM_B > 0 && NB_A < NB_B && sizeof(BU_B) == 8, "enumerators in constant expressions");
  switch (object) { case NB_A: CHECK(table[1] == 1L << 40 && sizeof table == 16); break; default: CHECK(0); }
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

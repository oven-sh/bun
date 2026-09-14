// A rotation asked for by name: Clang's `__builtin_rotateleft8/16/32/64` and `rotateright`, and Microsoft's `_rotl`, `_rotr`,
// `_lrotl`, `_lrotr`, `_rotl64`, `_rotr64` (which this compiler knows without a header). Each against the rotation written
// out in C, for counts on both sides of the width. (GCC has none of them and Clang has the second family only through
// <x86intrin.h>; what is checked is that they are rotations, which needs no other compiler's word.)
#include <stdio.h>

static int checks, wrong;
#define CHECK(c) do { checks++; if (!(c)) { wrong++; printf("WRONG (line %d): %s\n", __LINE__, #c); } } while (0)

static unsigned long long rotated_left(unsigned long long x, unsigned n, unsigned width) {
  unsigned long long mask = width == 64 ? ~0ull : (1ull << width) - 1;
  n %= width;
  x &= mask;
  return n == 0 ? x : ((x << n) | (x >> (width - n))) & mask;
}
static unsigned long long rotated_right(unsigned long long x, unsigned n, unsigned width) { return rotated_left(x, width - n % width, width); }

int main(void) {
  volatile unsigned char x8 = 0x81;
  volatile unsigned short x16 = 0x8001;
  volatile unsigned x32 = 0x81234567u;
  volatile unsigned long long x64 = 0x8123456789abcdefull;
  static const int counts[] = { 0, 1, 7, 8, 9, 15, 16, 31, 32, 33, 63, 64, 65, 100 };
  for (unsigned i = 0; i < sizeof counts / sizeof counts[0]; i++) {
    volatile int n = counts[i];
#if defined __has_builtin
#if __has_builtin(__builtin_rotateleft32)
    CHECK(__builtin_rotateleft8(x8, n) == rotated_left(x8, n, 8) && __builtin_rotateright8(x8, n) == rotated_right(x8, n, 8));
    CHECK(__builtin_rotateleft16(x16, n) == rotated_left(x16, n, 16) && __builtin_rotateright16(x16, n) == rotated_right(x16, n, 16));
    CHECK(__builtin_rotateleft32(x32, n) == rotated_left(x32, n, 32) && __builtin_rotateright32(x32, n) == rotated_right(x32, n, 32));
    CHECK(__builtin_rotateleft64(x64, n) == rotated_left(x64, n, 64) && __builtin_rotateright64(x64, n) == rotated_right(x64, n, 64));
#endif
#endif
#if defined __BUN_CC__ || defined _MSC_VER
    CHECK(_rotl(x32, n) == rotated_left(x32, n, 32) && _rotr(x32, n) == rotated_right(x32, n, 32));
    CHECK(_rotl64(x64, n) == rotated_left(x64, n, 64) && _rotr64(x64, n) == rotated_right(x64, n, 64));
    CHECK(_lrotl(x32, n) == rotated_left(x32, n, 8 * sizeof(long)) && _lrotr(x32, n) == rotated_right(x32, n, 8 * sizeof(long))); /* long: any width */
#endif
  }
#ifdef __BUN_CC__
  printf("%d checks\n", checks); // (How many another compiler makes depends on which of the names it has.)
#endif
  printf("%d wrong\n", wrong);
  return wrong != 0;
}

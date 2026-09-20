// The ways a rotation is written in C, which the compiler makes a rotate instruction of where that is what they are.
// `(x << n) | (x >> (W - n))` is one for the counts it is defined for, joined by `|`, `+` or `^` alike: no bit is in both
// halves. `(x << (n & (W-1))) | (x >> (-n & (W-1)))` is defined for a count of nothing too, where both halves are `x`:
// `|` makes `x` of them, `^` makes 0 and `+` makes `x + x`, so only the first is a rotation. Every form, width, direction
// and way of writing the second count, at the counts where they differ.
#include <stdio.h>

typedef unsigned int u32;
typedef unsigned long long u64;

#define M32(n) ((n) & 31)
#define M64(n) ((n) & 63)
// (name, type, the two shifts, how they are joined, the first count, the second count)
#define FORM(name, type, first, second, join, a, b) \
  __attribute__((noinline)) static type name(type x, unsigned n) { return (x first (a)) join (x second (b)); }
// Masked counts: defined for every n.
FORM(left32_or_negated, u32, <<, >>, |, M32(n), M32(-n))
FORM(left32_xor_negated, u32, <<, >>, ^, M32(n), M32(-n))
FORM(left32_add_negated, u32, <<, >>, +, M32(n), M32(-n))
FORM(right32_or_negated, u32, >>, <<, |, M32(n), M32(-n))
FORM(right32_xor_negated, u32, >>, <<, ^, M32(n), M32(-n))
FORM(right32_add_negated, u32, >>, <<, +, M32(n), M32(-n))
FORM(left32_or_from_zero, u32, <<, >>, |, M32(n), M32(0 - n))
FORM(left32_xor_from_zero, u32, <<, >>, ^, M32(n), M32(0 - n))
FORM(left32_add_from_zero, u32, <<, >>, +, M32(n), M32(0 - n))
FORM(left32_or_from_width, u32, <<, >>, |, M32(n), M32(32 - n))
FORM(left32_xor_from_width, u32, <<, >>, ^, M32(n), M32(32 - n))
FORM(left32_add_from_width, u32, <<, >>, +, M32(n), M32(32 - n))
FORM(right32_add_from_width, u32, >>, <<, +, M32(n), M32(32 - n))
FORM(left64_or_negated, u64, <<, >>, |, M64(n), M64(-n))
FORM(left64_xor_negated, u64, <<, >>, ^, M64(n), M64(-n))
FORM(left64_add_negated, u64, <<, >>, +, M64(n), M64(-n))
FORM(right64_or_from_zero, u64, >>, <<, |, M64(n), M64(0 - n))
FORM(right64_xor_from_zero, u64, >>, <<, ^, M64(n), M64(0 - n))
FORM(right64_add_from_zero, u64, >>, <<, +, M64(n), M64(0 - n))
FORM(left64_xor_from_width, u64, <<, >>, ^, M64(n), M64(64 - n))
FORM(right64_add_from_width, u64, >>, <<, +, M64(n), M64(64 - n))
// Counts that are not masked: defined from 1 to W - 1.
FORM(left32_or_plain, u32, <<, >>, |, n, 32 - n)
FORM(left32_xor_plain, u32, <<, >>, ^, n, 32 - n)
FORM(left32_add_plain, u32, <<, >>, +, n, 32 - n)
FORM(right32_xor_plain, u32, >>, <<, ^, n, 32 - n)
FORM(left64_or_plain, u64, <<, >>, |, n, 64 - n)
FORM(left64_add_plain, u64, <<, >>, +, n, 64 - n)
FORM(right64_xor_plain, u64, >>, <<, ^, n, 64 - n)

// Counts of other types, and what is rotated other than a parameter.
__attribute__((noinline)) static u32 count_is_a_byte(u32 x, unsigned char n) { return (x >> (n & 31)) | (x << ((32 - n) & 31)); }
__attribute__((noinline)) static u64 count_is_64_bits(u64 x, u64 n) { return (x >> (n & 63)) | (x << ((0 - n) & 63)); }
__attribute__((noinline)) static u32 count_is_signed(u32 x, int n) { return (x << (n & 31)) | (x >> (-n & 31)); }
__attribute__((noinline)) static u32 of_a_member(const struct { u32 w[2]; } *s, int n) { return (s->w[1] << n) | (s->w[1] >> (32 - n)); }
__attribute__((noinline)) static u32 through_a_pointer(const u32 *p, unsigned n) { return (*p << (n & 31)) ^ (*p >> (-n & 31)); }
__attribute__((noinline)) static u32 of_a_volatile(volatile u32 *p, unsigned n) { return (*p << (n & 31)) | (*p >> (-n & 31)); }
// By constants.
__attribute__((noinline)) static u32 by_five_or(u32 x) { return (x << 5) | (x >> 27); }
__attribute__((noinline)) static u32 by_five_add(u32 x) { return (x << 5) + (x >> 27); }
__attribute__((noinline)) static u32 by_five_xor(u32 x) { return (x >> 27) ^ (x << 5); }
__attribute__((noinline)) static u64 by_forty(u64 x) { return (x << 40) + (x >> 24); }
// What looks like one and is not: two different values, counts that do not add up, a signed value, 16 bits, two reads
// that each have an effect.
__attribute__((noinline)) static u32 not_a_rotation(u32 x, u32 y, int n, int m) { return ((x << n) | (y >> (32 - n))) + ((x << n) | (x >> (32 - m))) + ((x << n) | (x >> (31 - n))) + ((x << 5) ^ (x >> 26)); }
__attribute__((noinline)) static int of_a_signed_value(int x, int n) { return (int)(((unsigned)x << n) | (unsigned)(x >> (32 - n))); }
__attribute__((noinline)) static unsigned short of_16_bits(unsigned short x, int n) { return (unsigned short)((x << n) | (x >> (16 - n))); }
__attribute__((noinline)) static u32 with_side_effects(u32 **p, int n) { u32 first = *(*p)++; return (first << n) | (*(*p)++ >> (32 - n)); }

int main(void) {
  const u32 x = 0x81234567u;
  const u64 y = 0x8123456789abcdefull;
  static const unsigned counts[] = { 0, 1, 13, 31, 32, 33, 45, 63, 64, 77, 128 };
  for (unsigned i = 0; i < sizeof counts / sizeof counts[0]; i++) {
    unsigned n = counts[i];
    printf("%u: %08x %08x %08x | %08x %08x %08x | %08x %08x %08x | %08x %08x %08x %08x\n", n, left32_or_negated(x, n), left32_xor_negated(x, n), left32_add_negated(x, n),
           right32_or_negated(x, n), right32_xor_negated(x, n), right32_add_negated(x, n), left32_or_from_zero(x, n), left32_xor_from_zero(x, n), left32_add_from_zero(x, n),
           left32_or_from_width(x, n), left32_xor_from_width(x, n), left32_add_from_width(x, n), right32_add_from_width(x, n));
    printf("%u: %016llx %016llx %016llx | %016llx %016llx %016llx | %016llx %016llx\n", n, left64_or_negated(y, n), left64_xor_negated(y, n), left64_add_negated(y, n),
           right64_or_from_zero(y, n), right64_xor_from_zero(y, n), right64_add_from_zero(y, n), left64_xor_from_width(y, n), right64_add_from_width(y, n));
    printf("%u: %08x %016llx %08x %08x %08x\n", n, count_is_a_byte(x, (unsigned char)n), count_is_64_bits(y, n), count_is_signed(x, (int)n), count_is_signed(x, -(int)n), through_a_pointer(&x, n));
  }
  for (unsigned n = 1; n < 32; n += 5)
    printf("%u: %08x %08x %08x %08x\n", n, left32_or_plain(x, n), left32_xor_plain(x, n), left32_add_plain(x, n), right32_xor_plain(x, n));
  for (unsigned n = 1; n < 64; n += 9)
    printf("%u: %016llx %016llx %016llx\n", n, left64_or_plain(y, n), left64_add_plain(y, n), right64_xor_plain(y, n));
  struct { u32 w[2]; } s = { { 1, x } };
  volatile u32 v = x;
  printf("%08x %08x %08x\n", of_a_member((const void *)&s, 7), of_a_volatile(&v, 0), of_a_volatile(&v, 9));
  printf("%08x %08x %08x %016llx\n", by_five_or(x), by_five_add(x), by_five_xor(x), by_forty(y));
  u32 two[2] = { x, 0x0f0f0f0fu }, *cursor = two;
  u32 both_read = with_side_effects(&cursor, 8);
  printf("%08x %d %04x %08x %d\n", not_a_rotation(x, 0x00ff00ffu, 3, 4), of_a_signed_value(-2128394905, 4), of_16_bits(0x8001, 3), both_read, (int)(cursor - two));
  return 0;
}

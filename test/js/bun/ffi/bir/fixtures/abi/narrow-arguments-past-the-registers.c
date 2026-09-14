// Arguments narrower than an int that no register is left for. Most conventions give each a slot of eight bytes;
// Apple's arm64 packs them at their own size and alignment (a char takes a byte, a short two at a multiple of two), so
// that is what a function compiled here and one the system's compiler made have to agree on, with the C library's and
// through a pointer. Eight long arguments use up the integer registers; then every mix of char, short, int, long,
// _Bool and float; named ones ahead of an ellipsis; results that are narrow; and the values are ones whose high bits
// would show if a neighbour's bytes were read with them.
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
#define EIGHT long r1, long r2, long r3, long r4, long r5, long r6, long r7, long r8
#define THE_EIGHT 1, 2, 3, 4, 5, 6, 7, 8

NOINLINE static long mixed(EIGHT, char c1, char c2, short s1, int i1, char c3, long l1, short s2, float f1, char c4) {
  return r1 + r8 + c1 * 3L + c2 * 5L + s1 * 7L + i1 * 11L + c3 * 13L + l1 * 17L + s2 * 19L + (long)(f1 * 23) + c4 * 29L;
}
NOINLINE static long all_bytes(EIGHT, signed char a, unsigned char b, signed char c, unsigned char d, signed char e, unsigned char f, signed char g, unsigned char h, signed char i) {
  return r2 + a + b * 2L + c * 3L + d * 4L + e * 5L + f * 6L + g * 7L + h * 8L + i * 9L;
}
NOINLINE static long all_shorts(EIGHT, short a, unsigned short b, short c, unsigned short d, short e) { return r3 + a + b * 2L + c * 3L + d * 4L + e * 5L; }
NOINLINE static long with_bools(EIGHT, _Bool a, char b, _Bool c, short d, _Bool e, int f) { return r4 + a + b * 2L + c * 4L + d * 8L + e * 16L + f * 32L; }
NOINLINE static long bytes_then_wide(EIGHT, char a, long b, char c, double d, char e, long long f) { return r5 + a + b * 3 + c * 5L + (long)(d * 7) + e * 11L + f * 13; }
NOINLINE static long one_left(long r1, long r2, long r3, long r4, long r5, long r6, long r7, char in_the_last_register, char first_on_the_stack, short second) {
  return r7 + in_the_last_register * 3L + first_on_the_stack * 5L + second * 7L;
}
NOINLINE static long floats_use_theirs_up(double d1, double d2, double d3, double d4, double d5, double d6, double d7, double d8, float f1, char c1, float f2, short s1) {
  return (long)(d1 + d8 + f1 * 3 + f2 * 5) + c1 * 7L + s1 * 11L;
}
NOINLINE static long named_then_anonymous(EIGHT, char a, short b, char c, ...) {
  va_list list;
  va_start(list, c);
  long total = r6 + a + b * 3L + c * 5L;
  total += va_arg(list, int) * 7L;
  total += va_arg(list, long) * 11;
  total += (long)(va_arg(list, double) * 13);
  total += va_arg(list, int) * 17L;
  va_end(list);
  return total;
}
NOINLINE static signed char returns_a_byte(EIGHT, signed char a, signed char b) { return (signed char)(r8 + a - b); }
NOINLINE static unsigned short returns_a_short(EIGHT, unsigned short a, unsigned char b) { return (unsigned short)(r8 + a * b); }
static int by_their_bytes(const void *a, const void *b) { return *(const signed char *)a - *(const signed char *)b; }

int main(void) {
  printf("%ld\n", mixed(THE_EIGHT, -1, 100, -300, 70000, 'x', 1L << 40, 20000, 1.5f, -128));
  printf("%ld\n", all_bytes(THE_EIGHT, -1, 255, -128, 128, 127, 1, -2, 254, -3));
  printf("%ld\n", all_shorts(THE_EIGHT, -1, 65535, -32768, 32768, 32767));
  printf("%ld\n", with_bools(THE_EIGHT, 1, -5, 0, -7, 1, -9));
  printf("%ld\n", bytes_then_wide(THE_EIGHT, -1, 1L << 33, 2, 2.5, -3, -(1LL << 35)));
  printf("%ld\n", one_left(1, 2, 3, 4, 5, 6, 7, -8, -9, -10));
  printf("%ld\n", floats_use_theirs_up(1, 2, 3, 4, 5, 6, 7, 8, 0.5f, -4, 1.5f, -300));
  printf("%ld\n", named_then_anonymous(THE_EIGHT, -1, -2, -3, -4, 1L << 34, 2.5, 'c'));
  printf("%d %d\n", returns_a_byte(THE_EIGHT, 100, -30), returns_a_short(THE_EIGHT, 300, 250));
  // Through a pointer, and one that the C library calls.
  long (*pointer)(EIGHT, char, char, short, int, char, long, short, float, char) = mixed;
  volatile int which = 0;
  if (which) pointer = 0;
  printf("%ld\n", pointer(THE_EIGHT, 1, -2, 3, -4, 5, -6, 7, -8.5f, 9));
  signed char bytes[5] = { 3, -1, 2, -128, 127 };
  qsort(bytes, 5, 1, by_their_bytes);
  printf("%d %d %d %d %d\n", bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  return 0;
}

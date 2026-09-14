// C11 6.4.4.2p3 and 6.3.1.4p2: a floating constant, and an integer converted to a floating type, is rounded once, to its
// own type; going through double first rounds a float twice and can land on the wrong neighbour.
#include <float.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

static uint32_t bits(float f) { uint32_t u; memcpy(&u, &f, 4); return u; }
static uint64_t bits64(double d) { uint64_t u; memcpy(&u, &d, 8); return u; }

static float s_decimal = 1.00000005960464477625798673798840354720596224069595336914062500001f;
static float s_hex = 0x1.000001000000001p0f;
static float s_from_int = (float)0x1000001000000001LL;
static float s_from_unsigned = (float)0xFFFFFF8000000001ULL;
static float s_from_negative = (float)-0x1000001000000001LL;
static float s_from_128 = (float)(((unsigned __int128)1 << 100) + ((unsigned __int128)1 << 76) + 1);
static double s_double = 1.00000000000000011102230246251565404236316680908203125000000001;

int main(void) {
  // 1 + 2^-24 + a little: double rounds the little away, and then the tie goes to even (down).
  CHECK(bits(1.00000005960464477625798673798840354720596224069595336914062500001f) == 0x3f800001 && bits(s_decimal) == 0x3f800001);
  CHECK(bits(0x1.000001000000001p0f) == 0x3f800001 && bits(s_hex) == 0x3f800001 && bits(0x1.000001p0f) == 0x3f800000 && bits(0x1.000003p0f) == 0x3f800002);
  CHECK(bits(16777217.0000000001f) == 0x4b800001 && bits(16777217.0f) == 0x4b800000 && bits(16777219.0f) == 0x4b800002);
  // Just below the halfway point to infinity, and just above the smallest subnormal's half.
  CHECK(bits(3.4028235677973366e38f) == 0x7f7fffff && 3.4028235677973366e38f == FLT_MAX);
  CHECK(bits(7.0064923216240854e-46f) == 0x00000001 && bits(7.0064923216240853e-46f) == 0 && bits(1e-46f) == 0);
  CHECK(bits(-1.00000005960464477625798673798840354720596224069595336914062500001f) == 0xbf800001);
  // Integers.
  volatile long long big = 0x1000001000000001LL;
  volatile unsigned long long high = 0xFFFFFF8000000001ULL;
  CHECK(bits((float)0x1000001000000001LL) == 0x5d800001 && bits(s_from_int) == 0x5d800001 && bits((float)big) == 0x5d800001);
  CHECK(bits((float)0xFFFFFF8000000001ULL) == 0x5f800000 && bits(s_from_unsigned) == 0x5f800000 && bits((float)high) == 0x5f800000);
  CHECK(bits((float)-0x1000001000000001LL) == 0xdd800001 && bits(s_from_negative) == 0xdd800001 && bits((float)-big) == 0xdd800001);
  CHECK(bits((float)0x1000001000000000LL) == 0x5d800000 && bits((float)0x1000003000000000LL) == 0x5d800002 && bits((float)16777217) == 0x4b800000);
  CHECK(bits(s_from_128) == 0x71800001);
  float assigned = 0x1000001000000001LL;
  float array[2] = { 0x1000001000000001LL, 16777217.0000000001f };
  CHECK(bits(assigned) == 0x5d800001 && bits(array[0]) == 0x5d800001 && bits(array[1]) == 0x4b800001);
  // Doubles were always rounded once.
  CHECK(bits64(1.00000000000000011102230246251565404236316680908203125000000001) == 0x3ff0000000000001 && bits64(s_double) == 0x3ff0000000000001);
  CHECK(bits64((double)0x20000000000001LL) == 0x4340000000000000 && bits64((double)0x20000000000003LL) == 0x4340000000000002 && bits64((double)0xFFFFFFFFFFFFFC01ULL) == 0x43f0000000000000);
  // A float constant is exactly a float: widening it changes nothing.
  CHECK((double)0.1f != 0.1 && (double)0.1f == 0x1.99999ap-4 && 0.1f == (float)0.1 && sizeof 0.1f == 4 && sizeof 0.1 == 8);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

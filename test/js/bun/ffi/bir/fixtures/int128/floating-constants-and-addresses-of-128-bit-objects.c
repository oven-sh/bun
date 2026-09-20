// Conversions between floating constants and the 128-bit integer types give the same value as a constant, in a static
// initializer and at run time; and the address of a 128-bit object is an address constant like any other.
#include <float.h>
#include <stddef.h>
#include <stdio.h>

typedef __int128 i128;
typedef unsigned __int128 u128;

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define U(high, low) (((u128)(high) << 64) | (u128)(low))

// Floating constants to 128 bits, in static initializers.
static u128 s_1e19 = (u128)1e19;
static u128 s_2_64 = (u128)1.8446744073709552e19;
static u128 s_1e20 = (u128)1e20;
static u128 s_1e30 = (u128)1e30;
static u128 s_3e38f = (u128)3e38f;
static i128 s_i1e30 = (i128)1e30;
static i128 s_neg = (i128)-1e30;
static i128 s_9_3e18 = (i128)9.3e18;
static u128 s_ld_max64 = (u128)18446744073709551615.0L;
static u128 s_ld_2_63 = (u128)9223372036854775808.0L;
static u128 s_half = (u128)0.5;
static u128 s_minus_half = (u128)-0.5;
static i128 s_small = (i128)-3.75;
static _Bool s_bool = (_Bool)(u128)1e30;

// 128 bits to floating, in static initializers: rounded once, from all the bits.
static double s_d_all_ones = (double)~(u128)0;
static double s_d_2_100 = (double)((u128)1 << 100);
static double s_d_neg_2_100 = (double)-((i128)1 << 100);
static double s_d_min = (double)((i128)1 << 127);
static double s_d_tie = (double)(((u128)1 << 100) + ((u128)1 << 47) + 1);
static float s_f_all_ones = (float)~(u128)0;
static float s_f_2_100 = (float)((u128)1 << 100);
static float s_f_tie = (float)(((u128)1 << 100) + ((u128)1 << 76) + 1);
static long double s_ld_2_100 = (long double)((u128)1 << 100);

// Addresses.
struct holder { char c; i128 wide; int after; i128 array[3]; };
static i128 object = 5;
static i128 *pointer = &object;
static struct holder held = { 'h', 7, 9, { 1, 2, 3 } };
static i128 *member = &held.wide;
static i128 *element = &held.array[1];
static i128 *decayed = held.array;
static int *after = &held.after;
static i128 wide_array[4] = { 10, 20, 30, 40 };
static i128 *into_array = wide_array + 2;
static size_t offset_of_wide = offsetof(struct holder, wide);
static size_t offset_after = offsetof(struct holder, after);
static size_t offset_of_element = offsetof(struct holder, array[2]);
static size_t size_of_object = sizeof object;
static _Bool same = &object == &object;
static double _Complex complex_object = 1.0;
static double _Complex *complex_pointer = &complex_object;
static long double long_double_object = 2.0L;
static long double *long_double_pointer = &long_double_object;

int main(void) {
  volatile double d19 = 1e19, d2_64 = 1.8446744073709552e19, d20 = 1e20, d30 = 1e30, dneg = -1e30, d93 = 9.3e18;
  volatile float f38 = 3e38f;
  CHECK(s_1e19 == U(0, 0x8ac7230489e80000) && (u128)1e19 == s_1e19 && (u128)d19 == s_1e19);
  CHECK(s_2_64 == U(1, 0) && (u128)1.8446744073709552e19 == s_2_64 && (u128)d2_64 == s_2_64);
  CHECK(s_1e20 == U(5, 0x6bc75e2d63100000) && (u128)1e20 == s_1e20 && (u128)d20 == s_1e20);
  CHECK(s_1e30 == U(0xc9f2c9cd0, 0x4675000000000000) && (u128)1e30 == s_1e30 && (u128)d30 == s_1e30);
  CHECK(s_3e38f == (u128)f38 && (u128)3e38f == s_3e38f && s_3e38f >> 100 == 0xe1b1e60);
  CHECK(s_i1e30 == (i128)s_1e30 && (i128)1e30 == s_i1e30 && (i128)d30 == s_i1e30);
  CHECK(s_neg == -s_i1e30 && (i128)-1e30 == s_neg && (i128)dneg == s_neg && s_neg < 0);
  CHECK(s_9_3e18 == 9300000000000000000 && (i128)9.3e18 == s_9_3e18 && (i128)d93 == s_9_3e18 && s_9_3e18 >> 64 == 0);
  // (Where long double has double's format the constant is 2^64 before it is converted.)
  CHECK(s_ld_max64 == (LDBL_MANT_DIG >= 64 ? U(0, 0xffffffffffffffff) : U(1, 0)) && (u128)18446744073709551615.0L == s_ld_max64);
  CHECK(s_ld_2_63 == U(0, 0x8000000000000000) && (u128)9223372036854775808.0L == s_ld_2_63);
  CHECK(s_half == 0 && s_minus_half == 0 && s_small == -3 && s_bool == 1 && (u128)0.5 == 0 && (i128)-3.75 == -3);
  CHECK((unsigned long long)1.8e19 == 18000000000000000000ull && (long long)-9.2e18 == -9200000000000000000ll);
  // An array size and a case label are integer constant expressions.
  char sized[(u128)2.5 + (i128)1.5];
  switch ((int)sizeof sized) { case (int)(i128)3.9: CHECK(sizeof sized == 3); break; default: CHECK(0); }

  volatile u128 v_ones = ~(u128)0, v_2_100 = (u128)1 << 100, v_tie = ((u128)1 << 100) + ((u128)1 << 47) + 1, v_ftie = ((u128)1 << 100) + ((u128)1 << 76) + 1;
  volatile i128 v_neg = -((i128)1 << 100), v_min = (i128)1 << 127;
  CHECK(s_d_all_ones == 0x1p128 && s_d_all_ones == (double)v_ones && (double)~(u128)0 == 0x1p128);
  CHECK(s_d_2_100 == 0x1p100 && s_d_2_100 == (double)v_2_100 && s_d_neg_2_100 == -0x1p100 && s_d_neg_2_100 == (double)v_neg);
  CHECK(s_d_min == -0x1p127 && s_d_min == (double)v_min);
  CHECK(s_d_tie == 0x1.0000000000001p100 && s_d_tie == (double)v_tie);
  CHECK(s_f_all_ones == (float)v_ones && s_f_2_100 == 0x1p100f && s_f_2_100 == (float)v_2_100);
  CHECK(s_f_tie == 0x1.000002p100f && s_f_tie == (float)v_ftie);
  CHECK(s_ld_2_100 == 0x1p100L && s_ld_2_100 == (long double)v_2_100);

  CHECK(pointer == &object && *pointer == 5 && member == &held.wide && *member == 7 && *after == 9);
  CHECK(element == &held.array[1] && *element == 2 && decayed == held.array && decayed[2] == 3 && into_array == &wide_array[2] && *into_array == 30);
  CHECK(offset_of_wide == 16 && offset_after == 32 && offset_of_element == 48 + 32 && size_of_object == 16 && same);
  CHECK(_Alignof(i128) == 16 && sizeof(struct holder) == 96 && (char *)member - (char *)&held == 16);
  CHECK(complex_pointer == &complex_object && long_double_pointer == &long_double_object && __real__ *complex_pointer == 1.0 && *long_double_pointer == 2.0L);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

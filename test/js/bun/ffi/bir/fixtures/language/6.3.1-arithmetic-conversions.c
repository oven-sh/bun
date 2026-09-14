// C11 6.3.1: integer promotions, the usual arithmetic conversions, _Bool, and conversions between the integer
// and floating types in both directions.
#include <limits.h>
#include <stdint.h>
#include <stdio.h>

#define KIND(x) _Generic((x), _Bool: "bool", char: "char", signed char: "schar", unsigned char: "uchar", short: "short", \
  unsigned short: "ushort", int: "int", unsigned: "uint", long: "long", unsigned long: "ulong", long long: "llong", \
  unsigned long long: "ullong", float: "float", double: "double", long double: "ldouble", default: "other")

struct fields { unsigned narrow : 3; unsigned full : 32; int negative : 4; _Bool flag : 1; };

int main(void) {
  // Integer promotions: everything of lower rank than int becomes int (or unsigned int where int cannot hold it).
  _Bool b = 1; char c = 1; signed char sc = 1; unsigned char uc = 1; short s = 1; unsigned short us = 1;
  printf("%s %s %s %s %s %s\n", KIND(+b), KIND(+c), KIND(+sc), KIND(+uc), KIND(+s), KIND(+us));
  printf("%s %s %s %s\n", KIND(uc + uc), KIND(~uc), KIND(-s), KIND(uc << 1));
  struct fields f = {7, 1, -3, 1};
  printf("%s %s %s %s\n", KIND(+f.narrow), KIND(+f.full), KIND(+f.negative), KIND(+f.flag));
  printf("%d %d\n", (unsigned char)200 + (unsigned char)100, -(unsigned char)1 < 0);
  // The usual arithmetic conversions, for every pair of ranks.
  int i = 1; unsigned u = 1; long l = 1; unsigned long ul = 1; long long ll = 1; unsigned long long ull = 1;
  float fl = 1; double d = 1; long double ld = 1;
  printf("%s %s %s %s %s\n", KIND(i + u), KIND(i + l), KIND(u + ll), KIND(ll + ull), KIND(i + ull));
  printf("%s %s %s %s %s %s\n", KIND(i + fl), KIND(fl + d), KIND(d + ld), KIND(ull + fl), KIND(c + d), KIND(fl + fl));
  // unsigned int with long: long if it can hold every unsigned int, else unsigned long.
  printf("%d\n", KIND(u + l)[0] == (sizeof(long) > sizeof(int) ? 'l' : 'u'));
  // The consequences: a negative int compared with an unsigned is converted first.
  printf("%d %d %d %d\n", -1 < 0u, -1 < 0, -1L < 0u == (sizeof(long) > sizeof(int)), (unsigned char)255 == 255);
  printf("%d %d\n", (short)-1 < (unsigned short)1, -1 == UINT_MAX);
  // _Bool: anything that compares unequal to zero becomes 1.
  printf("%d %d %d %d %d %d\n", (_Bool)0, (_Bool)256, (_Bool)0.5, (_Bool)-0.0, (_Bool)"text", (_Bool)(void *)0);
  b = 2; b += 5; b = b * 0.25;
  printf("%d\n", b);
  // To an unsigned type: modulo one more than its maximum. To a signed type that cannot hold the value: as GCC and
  // Clang define it, the same bits.
  printf("%d %u %u %d\n", (unsigned)-1 == UINT_MAX, (unsigned)(unsigned char)0x1ff, (unsigned)(unsigned short)-2, (unsigned long long)-1LL == ULLONG_MAX);
  printf("%d %d %d\n", (signed char)0x180, (short)0x18000, (int)0x180000000LL);
  printf("%d %d\n", (signed char)255, (int)4294967295u);
  // Real floating to integer: toward zero. Integer to floating: exact when it fits, else rounded to nearest.
  printf("%d %d %d %d %lld\n", (int)2.9, (int)-2.9, (int)0.999, (int)(unsigned)3.99f, (long long)-1e18);
  printf("%.1f %.1f %.1f %.1f\n", (float)16777217, (double)16777217, (float)0xffffff80u, (double)9007199254740993LL);
  printf("%.1f %.1f\n", (double)ULLONG_MAX, (float)LLONG_MIN);
  // Between floating types: exact when widening, rounded when narrowing.
  printf("%d %d %.10f %.10f\n", (double)0.1f == 0.1f, (float)0.1 == 0.1, (double)(float)0.1, (double)(float)1e-50);
  float narrowed = 1e300 > 1 ? 3.14159265358979 : 0;
  printf("%.7f\n", narrowed);
  return 0;
}

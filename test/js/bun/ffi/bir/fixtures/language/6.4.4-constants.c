// C11 6.4.4: every form of integer, floating, enumeration and character constant, and the type each has.
#include <limits.h>
#include <stdio.h>
#include <uchar.h>
#include <wchar.h>

#define KIND(x) _Generic((x), int: "int", unsigned: "uint", long: "long", unsigned long: "ulong", long long: "llong", \
  unsigned long long: "ullong", float: "float", double: "double", long double: "ldouble", char: "char", default: "other")
// The type of a constant that does not fit int depends on how wide long is; what is printed is whether it is the
// first type of the standard's list that can hold the value.
#define FIRST_THAT_FITS(constant, ...) first_that_fits(KIND(constant), (const char *[]){__VA_ARGS__, 0}, (unsigned long long)(constant))
static int first_that_fits(const char *kind, const char *const *candidates, unsigned long long value) {
  for (; *candidates; candidates++) {
    const char *k = *candidates;
    unsigned long long max = k[0] == 'i' ? INT_MAX : k[0] == 'u' && k[1] == 'i' ? UINT_MAX : k[0] == 'l' && k[1] == 'o' ? LONG_MAX
                           : k[0] == 'u' && k[2] == 'o' ? ULONG_MAX : k[0] == 'l' ? LLONG_MAX : ULLONG_MAX;
    if (value <= max) return k[0] == kind[0] && k[1] == kind[1] && k[2] == kind[2];
  }
  return 0;
}

enum { ENUMERATOR = 7 };

int main(void) {
  // Decimal, octal and hexadecimal (and, as C23 and GNU C have them, binary) integers.
  printf("%d %d %d %d %d %d\n", 42, 052, 0x2a, 0X2A, 0b101010, 0);
  printf("%s %s %s %s %s %s\n", KIND(1), KIND(1u), KIND(1l), KIND(1ul), KIND(1ll), KIND(1ull));
  printf("%s %s %s %s %s %s\n", KIND(1U), KIND(1L), KIND(1LU), KIND(1uLL), KIND(1llu), KIND(1LLU));
  // Without a suffix: decimal takes int, long, long long; octal and hexadecimal may also take the unsigned ones.
  printf("%d %d %d\n", FIRST_THAT_FITS(2147483647, "int", "long", "llong"), FIRST_THAT_FITS(2147483648, "int", "long", "llong"),
         FIRST_THAT_FITS(9223372036854775807, "int", "long", "llong"));
  printf("%d %d %d %d\n", FIRST_THAT_FITS(0x7fffffff, "int", "uint", "long", "ulong", "llong", "ullong"),
         FIRST_THAT_FITS(0xffffffff, "int", "uint", "long", "ulong", "llong", "ullong"),
         FIRST_THAT_FITS(0x100000000, "int", "uint", "long", "ulong", "llong", "ullong"),
         FIRST_THAT_FITS(0xffffffffffffffff, "int", "uint", "long", "ulong", "llong", "ullong"));
  printf("%d %d %d\n", FIRST_THAT_FITS(4294967295u, "uint", "ulong", "ullong"), FIRST_THAT_FITS(4294967296u, "uint", "ulong", "ullong"),
         FIRST_THAT_FITS(037777777777, "int", "uint", "long", "ulong", "llong", "ullong"));
  printf("%llu %lld\n", 18446744073709551615ull, 9223372036854775807ll);
  // Floating constants: a fraction or an exponent or both; decimal or hexadecimal; float, double and long double.
  printf("%g %g %g %g %g %g\n", 1., .5, 1.5, 1e3, 1.5e-3, 1E+2);
  printf("%g %g %g %g\n", 0x1p4, 0x1.8p1, 0x.1p4, 0XAP-1);
  printf("%s %s %s %s %s\n", KIND(1.0), KIND(1.0f), KIND(1.0F), KIND(1.0l), KIND(1.0L));
  printf("%s %s %d\n", KIND(1e1f), KIND(0x1p0L), 0.1f != 0.1);
  printf("%.17g %.17g %.9g\n", 0.1, 1.7976931348623157e308, (double)3.40282347e38f);
  printf("%.17g %.17g\n", 4.9406564584124654e-324, 2.2250738585072014e-308);
  // An enumeration constant is an int.
  printf("%s %d\n", KIND(ENUMERATOR), ENUMERATOR);
  // Character constants are ints (the value of a char converted); the prefixed ones have the type of their prefix.
  printf("%s %d %d %d %d\n", KIND('a'), 'a', '\n', '\0', (int)sizeof 'a' == (int)sizeof(int));
  printf("%d %d\n", '\377' == (char)'\377', '\x7f');
  printf("%d %d %d\n", _Generic(L'a', wchar_t: 1, default: 0), _Generic(u'a', char16_t: 1, default: 0), _Generic(U'a', char32_t: 1, default: 0));
  printf("%d %d %d %d\n", L'a' == 'a', (int)u'€', (int)(U'\U0001F600' == 0x1F600), L'\x41');
  // A multi-character constant is implementation-defined, and GCC's definition is everybody's.
  printf("%d %d\n", 'ab', 'abcd' == (('a' << 24) | ('b' << 16) | ('c' << 8) | 'd'));
  return 0;
}

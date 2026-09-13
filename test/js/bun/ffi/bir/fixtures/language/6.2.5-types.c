// C11 6.2.5 and 6.2.6: the kinds of types there are, what is true of each on every platform, and how values are
// represented. (What differs between platforms is printed as a relation, not a number.)
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define KIND(x) _Generic((x), _Bool: "bool", char: "char", signed char: "schar", unsigned char: "uchar", short: "short", \
  unsigned short: "ushort", int: "int", unsigned: "uint", long: "long", unsigned long: "ulong", long long: "llong", \
  unsigned long long: "ullong", float: "float", double: "double", long double: "ldouble", default: "other")

enum color { RED, GREEN };
struct incomplete;
union number { int i; float f; unsigned char bytes[4]; };

int main(void) {
  // Sizes and ranges: the orderings the standard guarantees.
  printf("%d %d %d %d\n", sizeof(char) == 1, sizeof(short) <= sizeof(int), sizeof(int) <= sizeof(long), sizeof(long) <= sizeof(long long));
  printf("%d %d %d %d\n", CHAR_BIT >= 8, SHRT_MAX >= 32767, INT_MAX >= 32767, LLONG_MAX >= 9223372036854775807LL);
  printf("%d %d %d\n", sizeof(float) <= sizeof(double), sizeof(double) <= sizeof(long double), sizeof(_Bool) >= 1);
  // char is a type of its own, with the range of signed char or of unsigned char.
  printf("%s %s %s %d\n", KIND((char)0), KIND((signed char)0), KIND((unsigned char)0), (CHAR_MIN == 0) == (CHAR_MAX == UCHAR_MAX));
  // Each signed type has an unsigned counterpart of the same size and alignment; unsigned arithmetic wraps.
  printf("%d %d %d\n", sizeof(int) == sizeof(unsigned), _Alignof(long) == _Alignof(unsigned long), UINT_MAX + 1u == 0);
  unsigned char wraps = 0; wraps--;
  printf("%d %d\n", wraps, 0u - 1u == UINT_MAX);
  // The value bits of a non-negative signed value are those of the unsigned one; negative numbers are two's complement.
  int minus_one = -1; unsigned all_ones;
  memcpy(&all_ones, &minus_one, sizeof all_ones);
  printf("%d %d\n", all_ones == UINT_MAX, (unsigned char)-1 == UCHAR_MAX);
  // An enumerated type is compatible with some integer type; its constants are ints.
  printf("%s %d\n", KIND(RED), sizeof(enum color) <= sizeof(long long));
  // Derived types: arrays, structures, unions, functions, pointers; and the incomplete ones.
  int array[3]; struct incomplete *to_incomplete = 0; void *to_void = array; int (*to_function)(void) = main;
  extern int unknown_size[];
  printf("%d %d %d %d\n", (int)(sizeof array / sizeof array[0]), to_incomplete == 0, to_void == (void *)array, to_function == main);
  printf("%d\n", unknown_size[1]);
  // A pointer to void has the representation and alignment of a pointer to a character type; pointers to
  // structures all look alike, as do pointers to unions.
  printf("%d %d %d\n", sizeof(void *) == sizeof(char *), sizeof(struct incomplete *) == sizeof(union number *), _Alignof(void *) == _Alignof(char *));
  // The bytes of an object can be read as unsigned chars, and copied back.
  union number n = {.f = 1.0f};
  float back;
  memcpy(&back, n.bytes, sizeof back);
  printf("%d %08x %d\n", back == 1.0f, (unsigned)n.i, n.bytes[0] | n.bytes[1] | n.bytes[2]);
  // The three real floating types, the complex ones, and qualified versions are all distinct types.
  printf("%s %s %s\n", KIND(1.0f), KIND(1.0), KIND(1.0L));
  const volatile int qualified = 3;
  printf("%s %d\n", KIND(qualified), sizeof(const int) == sizeof(int));
  return 0;
}
int unknown_size[2] = {10, 20};

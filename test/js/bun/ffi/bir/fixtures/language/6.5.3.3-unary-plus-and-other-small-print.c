// Small print that is easy to get wrong: the result of unary + is a promoted value (never the object itself, so not an
// lvalue and not a bit-field any more); __func__ is an array of const char; a function type without a parameter list
// goes only with parameter lists that the default promotions leave alone; addresses converted to integers and moved are
// still address constants; and max_align_t has the size and alignment GCC and Clang give it.
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

struct bits { int a : 3; unsigned b : 5; long long c : 40; unsigned d : 32; };

// Addresses through integers, in static initializers.
static int array[8] = { 0, 1, 2, 3, 4, 5, 6, 7 };
int main(void);
static int object = 42;
static long moved = (long)&array + 4 * sizeof(int);
static uintptr_t moved_back = (uintptr_t)&array[6] - 2 * sizeof(int);
static uintptr_t from_the_left = sizeof(int) + (uintptr_t)array;
static _Bool is_there = &object;
static _Bool function_is_there = main;
static int *through_char = (int *)((char *)&array + 8);
static const char *inside_a_literal = "hello" + 2;
static const char *element_of_a_literal = &"hello"[1];

static int takes_int(int v) { return v + 1; }
static int takes_char(char c) { return c; }
static int takes_float(float f) { return (int)f; }
static int takes_double_and_pointer(double d, char *p) { return (int)d + (p != 0); }
static int takes_variable(int n, ...) { return n; }

static int name_checks(void) {
  // A pointer to it is a pointer to an array of const char.
  return _Generic(&__func__, const char (*)[12]: 1, char (*)[12]: 2, default: 0) * 10 + (sizeof __func__ == 12) + (strcmp(__func__, "name_checks") == 0) * 100;
}

int main(void) {
  struct bits s = { -3, 17, 1LL << 35, 0xffffffffu };
  int x = 1;
  short h = 2;
  CHECK(sizeof(+s.a) == sizeof(int) && sizeof(+s.b) == sizeof(int) && sizeof(+s.c) == sizeof(long long) && sizeof(+s.d) == sizeof(unsigned));
  CHECK(_Alignof(__typeof__(+s.a)) == _Alignof(int) && sizeof(1 ? s.a : 2) == sizeof(int));
  CHECK(+s.a == -3 && +s.b == 17 && +s.c == 1LL << 35 && +s.d == 0xffffffffu && +s.b - 18 < 0 && +s.d - 0 > 0);
  CHECK(_Generic(+s.a, int: 1, default: 0) && _Generic(+s.b, int: 1, default: 0) && _Generic(+s.d, unsigned: 1, default: 0) && _Generic(+h, int: 1, default: 0));
  CHECK(_Generic(+x, int: 1, default: 0) && +x == 1 && -+-+x == 1 && sizeof(+h) == sizeof(int) && +(char)5 == 5);

  CHECK(name_checks() == 111);
  CHECK(_Generic(__func__, const char *: 1, char *: 2, default: 0) == 1 && strcmp(__func__, "main") == 0 && strcmp(__FUNCTION__, "main") == 0);

  // C11 6.7.6.3p15.
  CHECK(_Generic(takes_int, int (*)(): 1, default: 0) == 1 && _Generic(takes_double_and_pointer, int (*)(): 1, default: 0) == 1);
  CHECK(_Generic(takes_char, int (*)(): 1, default: 0) == 0 && _Generic(takes_float, int (*)(): 1, default: 0) == 0 && _Generic(takes_variable, int (*)(): 1, default: 0) == 0);
  int (*unprototyped)() = takes_int;
  CHECK(unprototyped(4) == 5 && __builtin_types_compatible_p(int (*)(), int (*)(int)) && !__builtin_types_compatible_p(int (*)(), int (*)(char)) && !__builtin_types_compatible_p(int (*)(), int (*)(int, ...)));

  CHECK(moved == (long)&array[4] && *(int *)moved == 4 && moved_back == (uintptr_t)&array[4] && from_the_left == (uintptr_t)&array[1]);
  CHECK(is_there == 1 && function_is_there == 1 && *through_char == 2 && strcmp(inside_a_literal, "llo") == 0 && *element_of_a_literal == 'e');

  CHECK(sizeof(max_align_t) == 32 && _Alignof(max_align_t) == 16 && _Alignof(max_align_t) >= _Alignof(long double) && _Alignof(max_align_t) >= _Alignof(long long));
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

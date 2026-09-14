// C11 6.6: integer constant expressions, arithmetic constant expressions and address constants, in every place
// the language asks for one.
#include <limits.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

struct record { char tag; int values[4]; struct { short a, b; } inner; };
enum { ONE = 1, FROM_SIZEOF = sizeof(int), FROM_CAST = (int)3.9, FROM_CHAR = 'a' - 'A', FROM_CONDITIONAL = 1 ? 10 : 20,
       FROM_OFFSETOF = offsetof(struct record, inner), FROM_ALIGNOF = _Alignof(double), FROM_SHIFT = 1 << 10,
       FROM_LOGIC = (3 > 2) && !0 || 0, FROM_UNEVALUATED = 0 && (1 / 1), FROM_ENUM = ONE + FROM_SHIFT, NEGATIVE = -5 % 3,
       FROM_GENERIC = _Generic(1L, long: 7, default: 8), FROM_NESTED_SIZEOF = sizeof(char[sizeof(short) + 1]) }; /* long: any width */

// Integer constant expressions: array sizes, bit-field widths, enumerators, case labels, _Static_assert, alignas.
static int sized[FROM_SHIFT / 256 + 1];
struct bits { unsigned narrow : FROM_SIZEOF - 1; unsigned wide : CHAR_BIT * 2; };
_Static_assert(FROM_CAST == 3 && FROM_UNEVALUATED == 0 && sizeof(sized) == 5 * sizeof(int), "evaluated when translated");
static _Alignas(1 << 5) char aligned;

// Arithmetic constant expressions initialize objects of static storage duration.
static double real = 1.0 / 3 + 2 * 0.5, from_int = 7 / 2, mixed = (float)0.1 + 1;
static float narrowed = 1e-3, negated = -(2.5f * 2);
static long long wide = 1LL << 40 | 0xff, from_unsigned = UINT_MAX + 1LL, from_double = (long long)1e15;
static unsigned wraps = 0u - 1, all = ~0u >> 28;
static int logical = (1.5 > 1) + (2 == 2.0) * 2, from_bool = (_Bool)0.25 + (_Bool)0;
static unsigned char truncated = (unsigned char)0x1ff + 1;

// Address constants: of objects of static storage duration and of functions, plus or minus a constant;
// the null pointer; an integer cast to a pointer.
static int objects[8];
static struct record one_record;
static int function(int x) { return x + 1; }
static int *to_object = &objects[3], *to_array = objects, *to_end = objects + 8, *to_middle = &objects[8] - 4;
static int *to_member = &one_record.values[2];
static short *to_inner = &one_record.inner.b;
static char *into_bytes = (char *)&one_record + offsetof(struct record, values);
static int (*to_function)(int) = function, (*to_function_too)(int) = &function;
static void *null = 0, *also_null = (void *)0, *from_integer = (void *)(uintptr_t)0x1000;
static const char *to_string = "literal" + 3, *to_compound = (const char[]){"compound"};
static ptrdiff_t difference = (char *)&objects[5] - (char *)&objects[1] == 4 * sizeof(int);
static uintptr_t address_as_integer = (uintptr_t)&objects[0];
static _Bool address_is_true = &objects[0] != 0;
static struct { int *p; int n; int (*f)(int); } table[] = {{&objects[1], sizeof objects / sizeof *objects, function}, {objects + 2, 2, 0}};

static int switch_on(int x) {
  switch (x) {
    case FROM_SHIFT: return 1;
    case 'a' + 1: return 2;
    case (int)sizeof(long long) * 100: return 3;
    case -FROM_SIZEOF: return 4;
    case INT_MAX: return 5;
    case 1 ? 0x7fff : 0: return 6;
    default: return 0;
  }
}

int main(void) {
  printf("%d %d %d %d %d %d\n", FROM_CAST, FROM_CHAR, FROM_CONDITIONAL, FROM_SHIFT, FROM_LOGIC, FROM_UNEVALUATED);
  printf("%d %d %d %d %d\n", FROM_ENUM, NEGATIVE, FROM_GENERIC, FROM_NESTED_SIZEOF, FROM_OFFSETOF == (int)offsetof(struct record, inner));
  printf("%d %d %d\n", (int)(sizeof sized / sizeof sized[0]), (int)sizeof(struct bits) >= 3, (int)((uintptr_t)&aligned % 32));
  printf("%.6f %.1f %.6f %.4f %.1f\n", real, from_int, mixed, (double)narrowed, (double)negated);
  printf("%lld %lld %lld %u %u %d %d %d\n", wide, from_unsigned, from_double, wraps, all, logical, from_bool, truncated);
  printf("%d %d %d %d %d\n", to_object == &objects[3], to_array == objects, (int)(to_end - to_array), to_middle == &objects[4], to_member == one_record.values + 2);
  printf("%d %d %d %d\n", to_inner == &one_record.inner.b, into_bytes == (char *)one_record.values, to_function(1), to_function_too == function);
  printf("%d %d %d %s %s\n", null == 0, also_null == 0, from_integer == (void *)0x1000, to_string, to_compound);
  printf("%d %d %d\n", (int)difference, address_as_integer == (uintptr_t)objects, address_is_true);
  printf("%d %d %d %d\n", table[0].p == objects + 1, table[0].n, table[0].f(41), table[1].p == &objects[2]);
  printf("%d %d %d %d %d %d %d\n", switch_on(1024), switch_on('b'), switch_on(800), switch_on(-(int)sizeof(int)), switch_on(INT_MAX), switch_on(32767), switch_on(9));
  // In a block, an initializer for a static object obeys the same rules; one for an automatic object need not be constant.
  static int *static_in_block = &objects[7];
  int n = 3, runtime = n * FROM_SHIFT;
  printf("%d %d\n", (int)(static_in_block - objects), runtime);
  return 0;
}

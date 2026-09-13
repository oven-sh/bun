// C11 6.5.1.1: _Generic picks by the type of an expression it does not evaluate.
#include <stdio.h>

#define NAME(x) _Generic((x), int: "int", long: "long", char: "char", char *: "char *", const char *: "const char *", \
  int *: "int *", double: "double", float: "float", void *: "void *", int (*)(void): "function", default: "something else")
#define ABS(x) _Generic((x), int: abs_int, double: abs_double, long long: abs_wide)(x)

static int abs_int(int x) { return x < 0 ? -x : x; }
static double abs_double(double x) { return x < 0 ? -x : x; }
static long long abs_wide(long long x) { return x < 0 ? -x : x; }
static int function(void) { return 1; }
struct tagged { int a; };
enum color { RED };

int main(void) {
  int i = 0; const int ci = 1; char c = 'c'; char array[4] = "abc"; const char *text = "t"; int evaluated = 0;
  // The controlling expression undergoes lvalue conversion: qualifiers drop, arrays and functions become pointers.
  printf("%s | %s | %s | %s | %s\n", NAME(i), NAME(ci), NAME(c), NAME(array), NAME(text));
  printf("%s | %s | %s | %s | %s\n", NAME("literal"), NAME(function), NAME(&i), NAME((void *)0), NAME(1.0f));
  printf("%s | %s | %s | %s\n", NAME('a'), NAME(1L), NAME(c + c), NAME((short)1));
  // It is not evaluated, and only the chosen association is.
  printf("%s %d\n", NAME(evaluated++), evaluated);
  printf("%d %g %lld\n", ABS(-3), ABS(-2.5), ABS(-9000000000LL));
  // default may come anywhere; the result can be an lvalue, a constant expression, or of any type.
  int first = 1, second = 2;
  _Generic(i, default: second, int: first) = 10;
  printf("%d %d\n", first, second);
  enum { CHOSEN = _Generic(1u, unsigned: 5, default: 6) };
  static int sized[_Generic(0.0, double: 3, default: 4)];
  printf("%d %d\n", CHOSEN, (int)(sizeof sized / sizeof sized[0]));
  // Structure, enumeration, pointer-to-qualified and array types are all distinguishable.
  struct tagged t = {1};
  printf("%d %d %d %d\n", _Generic(t, struct tagged: 1, default: 0), _Generic(RED, int: 1, default: 0), _Generic(&ci, const int *: 1, int *: 2), _Generic(&array, char (*)[4]: 1, default: 0));
  // Nested selections.
  printf("%s\n", _Generic(i, int: _Generic(c, char: "int then char", default: "?"), default: "?"));
  return 0;
}

// C11 6.5.3.4: sizeof and _Alignof on every kind of type and expression; what is and is not evaluated.
#include <stddef.h>
#include <stdio.h>

struct flexible { int count; short values[]; };
struct padded { char c; long long wide; char d; };
union either { char c[5]; int i; };
enum color { RED, GREEN };
typedef int vector[4];

static int calls;
static int side_effect(void) { return ++calls; }

int main(void) {
  // Results have type size_t, and are constants unless a variable length array is involved.
  printf("%d %d\n", _Generic(sizeof 0, size_t: 1, default: 0), _Generic(_Alignof(int), size_t: 1, default: 0));
  enum { CONSTANT = sizeof(int[3]) / sizeof(int) };
  static char sized_by_sizeof[sizeof(double) * 2];
  printf("%d %d\n", CONSTANT, (int)sizeof sized_by_sizeof == 2 * (int)sizeof(double));
  // Types: basic, derived, qualified, typedefs; expressions: with and without parentheses.
  int i = 0; int array[7]; int matrix[2][3]; int *pointer = array; struct padded s; vector v;
  printf("%d %d %d %d\n", sizeof(char) == 1, sizeof i == sizeof(int), sizeof(i) == sizeof i, sizeof i + 1 == sizeof(int) + 1);
  printf("%d %d %d %d\n", (int)(sizeof array / sizeof *array), (int)(sizeof matrix / sizeof matrix[0]), (int)(sizeof matrix[0] / sizeof matrix[0][0]), sizeof pointer == sizeof(void *));
  printf("%d %d %d\n", sizeof v == 4 * sizeof(int), sizeof(const volatile int) == sizeof(int), sizeof(enum color) == sizeof(RED) || sizeof(enum color) <= sizeof(int));
  // A structure: members, padding inside and at the end; a flexible array member adds nothing; a union is its biggest.
  printf("%d %d %d\n", sizeof s >= 2 + sizeof(long long), sizeof s % _Alignof(struct padded) == 0, (int)offsetof(struct padded, d) > (int)offsetof(struct padded, wide));
  printf("%d %d %d\n", sizeof(struct flexible) == offsetof(struct flexible, values), sizeof(union either) >= 5, sizeof(union either) % sizeof(int) == 0);
  // The operand is not evaluated: no side effects, no arrays decaying, no functions called, no null dereferenced.
  int *null = 0;
  printf("%d %d %d %d\n", (int)(sizeof(i++) == sizeof(int)), i, (int)(sizeof side_effect() == sizeof(int)), calls);
  printf("%d %d %d\n", sizeof *null == sizeof(int), sizeof null[5] == sizeof(int), sizeof "four" == 5);
  printf("%d %d %d\n", sizeof 'a' == sizeof(int), sizeof(char)+0 == 1, sizeof (char){0} == 1);
  // The integer promotions show in the size of an expression, not of an object.
  char c = 0; short sh = 0;
  printf("%d %d %d %d\n", sizeof c == 1, sizeof +c == sizeof(int), sizeof(c + c) == sizeof(int), sizeof(sh << 1) == sizeof(int));
  // A variable length array: the operand is evaluated and the result is not a constant.
  int n = 3;
  int vla[n][n + 1];
  printf("%d %d %d\n", (int)(sizeof vla / sizeof(int)), (int)(sizeof vla[0] / sizeof(int)), (int)(sizeof(int[n * 2]) / sizeof(int)));
  int evaluated = 0;
  size_t from_vla = sizeof(int[evaluated++ + 2]);
  size_t not_evaluated = sizeof(*(int (*)[evaluated++ + 2])0) ;
  printf("%d %d %d\n", (int)(from_vla / sizeof(int)), (int)(not_evaluated / sizeof(int)), evaluated >= 1);
  // _Alignof takes a type; an array has its element's, and nothing is evaluated.
  printf("%d %d %d\n", _Alignof(int[n]) == _Alignof(int), _Alignof(struct padded) == _Alignof(long long), _Alignof(char) == 1);
  return 0;
}

// C11 6.7.8 and 6.7.10: typedef names (a synonym, not a new type), in every scope, of every kind of type including
// variably modified ones; and _Static_assert wherever a declaration may stand.
#include <stdio.h>

typedef int length, *length_pointer, triple[3], (*unary)(int);
typedef struct point { int x, y; } point, *point_pointer;
typedef enum { OFF, ON } toggle;
typedef const char *const text;
typedef unsigned long long wide;
typedef length distance;                   // a typedef of a typedef
typedef triple matrix[2];                  // int [2][3]
typedef int function_type(int);
_Static_assert(sizeof(matrix) == 6 * sizeof(int), "at file scope");
_Static_assert(1, "a second one in a row");

static length negate(length x) { return -x; }
static function_type declared_by_typedef;
static int declared_by_typedef(int x) { return x * 3; }

struct holds_assertion { int a; _Static_assert(sizeof(int) >= 2, "among the members"); int b; };

int main(void) {
  _Static_assert(sizeof(wide) == 8, "in a block");
  length a = 5; distance b = a; length_pointer p = &b; triple t = {1, 2, 3}; unary u = negate; toggle on = ON; text words = "words";
  point origin = {1, 2}; point_pointer pp = &origin; matrix m = {{1, 2, 3}, {4, 5, 6}};
  printf("%d %d %d %d %d %s %d %d\n", a + *p, t[2], u(4), (int)on, pp->y, words, m[1][2], declared_by_typedef(2));
  // The synonym and the type are the same type; qualifiers apply to the whole of what the name stands for.
  printf("%d %d %d\n", _Generic(a, int: 1, default: 0), _Generic(p, int *: 1, default: 0), _Generic(&t, int (*)[3]: 1, default: 0));
  const length_pointer fixed = &a;         // a const pointer to int, not a pointer to const int
  *fixed = 50;
  const triple constants = {7, 8, 9};      // an array of const int
  printf("%d %d %d\n", a, constants[1], _Generic(&constants[0], const int *: 1, default: 0));
  // A typedef name shares the name space of ordinary identifiers, so it can be hidden, and can itself be a member name.
  {
    int length = 3;                        // hides the typedef in this block
    struct { int length; } s = {4};
    printf("%d %d\n", length, s.length);
  }
  {
    typedef char length;                   // redefined in an inner scope
    length tiny = 'x';
    printf("%d\n", (int)sizeof tiny);
  }
  length back_again = 9;
  printf("%d\n", (int)sizeof back_again == (int)sizeof(int));
  // A typedef of a variably modified type fixes its size when the typedef is reached.
  int n = 3;
  typedef int row[n];
  typedef row *row_pointer;
  n = 10;
  row r;
  row_pointer rp = &r;
  for (int i = 0; i < 3; i++) (*rp)[i] = i * i;
  printf("%d %d %d\n", (int)(sizeof(row) / sizeof(int)), (int)(sizeof r / sizeof r[0]), r[2]);
  for (int k = 1; k <= 2; k++) {
    typedef char block[k * 4];             // a different size each time round
    printf("%d ", (int)sizeof(block));
  }
  printf("\n");
  struct holds_assertion h = {1, 2};
  printf("%d\n", h.a + h.b);
  return 0;
}

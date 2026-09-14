// 6.5.3.4p2: the operand of `sizeof` is evaluated only where its type is a variable length array type, and the operand
// of `_Alignof` never. 6.9.1p10: the bounds in the parameters of a function are evaluated when it is entered, the
// outermost one too, which decides nothing (the parameter is a pointer).
#include <stddef.h>
#include <stdio.h>

static int calls;
static int three(void) { calls++; return 3; }

static void bound_with_an_effect(int n, int a[n++]) { (void)a; printf("the parameter after its bound: %d\n", n); }
static void bound_that_is_a_call(int a[three()]) { (void)a; printf("calls on entry: %d\n", calls); }
static void two_bounds(int n, int m, int a[n++][m++]) { printf("both: %d %d, a row of %d\n", n, m, (int)(sizeof a[0] / sizeof a[0][0])); }
static void only_declared(int n, int a[n++]);

int main(void) {
  int row[5] = { 1, 2, 3, 4, 5 };
  bound_with_an_effect(2, row);
  calls = 0;
  bound_that_is_a_call(row);
  int grid[4][4] = { { 0 } };
  two_bounds(2, 4, grid);
  (void)only_declared;

  calls = 0;
  size_t size = sizeof(int (*)[three()]);
  printf("a pointer to an array of as many: %d calls, %d bytes\n", calls, (int)size);
  calls = 0;
  size = sizeof(*(int (*)[three()])0);
  printf("what it points to: %d calls, %d bytes\n", calls, (int)size);
  calls = 0;
  size = sizeof(int[three()]);
  printf("the array itself: %d calls, %d bytes\n", calls, (int)size);
  calls = 0;
  size = _Alignof(int[three()]);
  printf("its alignment: %d calls, %d\n", calls, (int)size);
  calls = 0;
  size = sizeof((int (*)[three()])0);
  printf("a cast to the pointer: %d calls, %d bytes\n", calls, (int)size);
  calls = 0;
  void *cast = (int (*)[three()])0;
  printf("the cast evaluated: %d calls, %d\n", calls, cast == 0);
  calls = 0;
  size = sizeof(three());
  printf("a call as the operand: %d calls, %d bytes\n", calls, (int)size);

  return 0;
}
static void only_declared(int n, int a[n++]) { (void)n, (void)a; }

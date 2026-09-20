// C11 7.2 <assert.h>: assert is an expression of type void that evaluates its argument once, or not at all under
// NDEBUG; the header may be included again and again with NDEBUG changing; static_assert is _Static_assert.
#include <stdio.h>

static int evaluated;
static int counted(int value) { evaluated++; return value; }

#include <assert.h>
static void with_assertions(void) {
  assert(counted(1));
  assert(counted(2) == 2 && "a string in the condition is the usual way to say why");
  (void)sizeof(assert(1), 0);        // a void expression, usable as the left operand of a comma
  1 ? assert(1) : assert(1);
}

#define NDEBUG
#include <assert.h>
static void without_assertions(void) {
  assert(counted(0));                 // not evaluated at all
  assert(this is not even C);
  1 ? assert(0) : assert(0);
}

#undef NDEBUG
#include <assert.h>
static void with_assertions_again(void) { assert(counted(3)); }

static_assert(sizeof(char) == 1, "static_assert is a macro for _Static_assert");

int main(void) {
  with_assertions();
  printf("%d\n", evaluated);
  without_assertions();
  printf("%d\n", evaluated);
  with_assertions_again();
  printf("%d\n", evaluated);
  static_assert(1, "in a block too");
  return 0;
}

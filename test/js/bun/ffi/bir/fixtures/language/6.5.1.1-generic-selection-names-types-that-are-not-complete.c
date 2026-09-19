// 6.5.1.1: GCC and Clang let a generic selection name an incomplete type (a structure that is only declared, `void`,
// an array of no stated length): nothing has such a type, so it matches nothing, and the selection goes on to the
// others. (A function type and a variably modified one GCC takes and Clang refuses; they are refused here.)
#include <stdio.h>

struct only_declared;
union also_only_declared;

#define WHICH(x) _Generic((x), struct only_declared: "a structure nobody has", void: "void", int[]: "an array", union also_only_declared: "a union", \
                          struct only_declared *: "a pointer to the structure", int *: "a pointer to int", int: "int", default: "something else")

int main(void) {
  struct only_declared *p = 0;
  int array[3] = { 0 };
  printf("%s, %s, %s, %s\n", WHICH(1), WHICH(p), WHICH(array), WHICH(1.5));
  return 0;
}

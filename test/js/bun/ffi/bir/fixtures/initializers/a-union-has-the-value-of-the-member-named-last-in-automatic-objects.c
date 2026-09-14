// The same for objects with automatic storage and for compound literals, where the initializers need not be constants:
// all of the union is given a value, and the bytes the member named last does not reach are zero.
#include <stdio.h>

union U { int a[3]; int b; char c; };
struct N { union U u; int t; };

static void show(const char *name, const void *object, size_t size) {
  const unsigned char *bytes = object;
  printf("%-24s", name);
  for (size_t i = 0; i < size; i++) printf(" %02x", bytes[i]);
  printf("\n");
}
#define SHOW(object) show(#object, &object, sizeof object)

int main(void) {
  volatile int one = 1, five = 5;
  union U another_member = { .a = { 1, 2, 3 }, .b = 5 };
  union U not_constant = { .a = { one, 2, 3 }, .b = five };
  union U the_same_one_twice = { .a[0] = one, .a[2] = 3 };
  struct N nested = { .u.a = { 1, 2, 3 }, .u.b = 9, .t = 4 };
  union U *literal = &(union U){ .a = { 1, 2, 3 }, .c = 1 };
  union U many[2] = { [0].a = { 1, 2, 3 }, [0].b = five, [1] = { .a = { 1, 2, 3 } }, [1].c = 6 };
  SHOW(another_member);
  SHOW(not_constant);
  SHOW(the_same_one_twice);
  SHOW(nested);
  show("literal", literal, sizeof *literal);
  SHOW(many);
  return 0;
}

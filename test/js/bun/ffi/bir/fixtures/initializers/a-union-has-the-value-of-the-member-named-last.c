// 6.7.9p17-19: a union is initialized through one member. A later designator for another member of the same union
// overrides all of what the earlier one gave, not only the bytes it writes itself; a later designator for the same
// member adds to it. Objects with static storage, whose other bytes are zero.
#include <stdio.h>
#include <string.h>

union U { int a[3]; int b; char c; };
struct N { union U u; int t; };
union P { int *p; long n; };
union W { struct { int x, y; } first; struct { int x, y, z; } second; };
struct anonymous { int before; union { int y; float f; int several[2]; }; int after; };

static int x;
static union U another_member = { .a = { 1, 2, 3 }, .b = 5 };
static union U a_smaller_one = { .a = { 1, 2, 3 }, .c = 7 };
static union U the_same_one_twice = { .a[0] = 1, .a[2] = 3 };
static union U back_again = { .a = { 1, 2, 3 }, .b = 5, .a[1] = 9 };
static union U after_the_first = { 1, 2, .b = 5 };
static struct N nested = { .u.a = { 1, 2, 3 }, .u.b = 9, .t = 4 };
static struct N nested_the_same = { .u.a[0] = 1, .t = 4, .u.a[2] = 3 };
static union P no_relocation_left = { .p = &x, .n = 1 };
static union P a_relocation_in_the_end = { .n = 1, .p = &x };
static union W a_larger_second = { .first = { 1, 2 }, .second.z = 3 };
static union W a_smaller_second = { .second = { 1, 2, 3 }, .first.y = 4 };
static struct anonymous without_a_name = { .before = 1, .several = { 2, 3 }, .y = 4, .after = 5 };
static struct anonymous without_a_name_as_float = { .y = 1, .f = 2.0f };
static union U many[3] = { [0].a = { 1, 2, 3 }, [0].b = 5, [2] = { .a = { 1, 2, 3 } }, [2].c = 6, [1].a[1] = 8, [1].a[2] = 9 };

static void show(const char *name, const void *object, size_t size) {
  const unsigned char *bytes = object;
  printf("%-28s", name);
  for (size_t i = 0; i < size; i++) printf(" %02x", bytes[i]);
  printf("\n");
}
#define SHOW(object) show(#object, &object, sizeof object)

int main(void) {
  SHOW(another_member);
  SHOW(a_smaller_one);
  SHOW(the_same_one_twice);
  SHOW(back_again);
  SHOW(after_the_first);
  SHOW(nested);
  SHOW(nested_the_same);
  printf("%-28s %ld\n", "no_relocation_left", no_relocation_left.n);
  printf("%-28s %d\n", "a_relocation_in_the_end", a_relocation_in_the_end.p == &x);
  SHOW(a_larger_second);
  SHOW(a_smaller_second);
  SHOW(without_a_name);
  SHOW(without_a_name_as_float);
  SHOW(many);
  return 0;
}

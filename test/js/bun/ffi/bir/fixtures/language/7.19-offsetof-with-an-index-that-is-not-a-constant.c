// `offsetof(T, member[i])` with an index that is not a constant is what sizes an allocation that ends in a flexible
// array (`offsetof(struct S, tail[n])`). GCC and Clang take it; the result is then not a constant expression.
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>

struct inner { double d[3]; int after; };
struct S { int count; struct inner in[2]; long long wide; char tail[]; };
static int calls;
static int counted(int value) { calls++; return value; }

int main(void) {
  volatile int one = 1, two = 2;
  int n = 5;
  printf("%d %d\n", (int)offsetof(struct S, in[1].d[2]), (int)offsetof(struct S, tail[5]));
  printf("%d %d\n", (int)offsetof(struct S, in[one].d[two]), (int)offsetof(struct S, tail[n + 3]));
  printf("%d %d\n", (int)offsetof(struct S, in[one].after), (int)offsetof(struct S, in[1].d[two]));
  int with_a_call = (int)offsetof(struct S, tail[counted(7)]);
  printf("%d %d\n", with_a_call, calls);
  int not_evaluated = (int)sizeof(offsetof(struct S, tail[counted(7)]));
  printf("%d %d\n", not_evaluated, calls);
  struct S *s = malloc(offsetof(struct S, tail[n]));
  s->count = n;
  for (int i = 0; i < n; i++) s->tail[i] = (char)('a' + i);
  printf("%d %.5s\n", s->count, s->tail);
  free(s);
  enum { CONSTANT = offsetof(struct S, in[1].d[1]) };
  static char sized[offsetof(struct S, tail[3])];
  printf("%d %d\n", CONSTANT, (int)sizeof sized);
  return 0;
}

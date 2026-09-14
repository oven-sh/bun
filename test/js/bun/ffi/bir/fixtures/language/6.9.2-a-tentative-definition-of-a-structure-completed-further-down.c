// 6.9.2p2-3: a tentative definition with external linkage may have an incomplete type where it stands, as long as
// the type is complete by the end of the file.
#include <stdio.h>

struct S a_tentative;
union U another;
struct S *pointer = &a_tentative;
struct S again;
extern struct S only_declared;

struct S { int a, b; };
union U { char bytes[12]; double d; };
struct S again;
struct S only_declared = { 3, 4 };

int main(void) {
  a_tentative.b = 5;
  another.bytes[11] = 1;
  printf("%d %d %d %d\n", pointer->b, pointer == &a_tentative, a_tentative.a, (int)sizeof a_tentative);
  printf("%d %d %d %d\n", (int)sizeof another, again.a, only_declared.a, only_declared.b);
  return 0;
}

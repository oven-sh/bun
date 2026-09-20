// What C23 added that this compiler takes without being asked: keywords that were macros of a header, binary
// constants, empty initializers, labels at the end of a block, unnamed parameters, typeof.
#include <stdio.h>

static thread_local int per_thread = 10;
static alignas(16) char aligned[4];
static_assert(alignof(int) == _Alignof(int), "alignof without <stdalign.h>");
static_assert(sizeof(int) >= 2);                                 // no message
struct point { int x, y; };

static int unnamed(int, int second) { return second; }

int main(void) {
  typeof(per_thread) a = 0b1010;
  const int fixed = 3;
  typeof_unqual(fixed) b = 4;
  b++;
  struct point origin = {};
  int zeros[3] = {};
  if (a == 10) goto end;
  a = -1;
  {
    a = -2;
  inner:
  }
  goto inner;
end:
  printf("%d %d %d %d %d %d %d\n", a, b, origin.x + origin.y, zeros[2], unnamed(1, 2), per_thread, (int)((unsigned long long)aligned % 16));
}

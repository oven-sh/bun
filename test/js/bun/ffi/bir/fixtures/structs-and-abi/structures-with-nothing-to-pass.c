// Structures in which there is nothing to pass: no member at all (GNU C), only unnamed bit-fields, only a structure
// of those. They are passed, returned, assigned and taken from an ellipsis like any other, and what is next to them
// arrives where it should.
#include <stdarg.h>
#include <stdio.h>

struct nothing {};
struct only_padding { int : 8; };
struct more_padding { long long : 40; int : 0; };
struct of_nothing { struct nothing inside; } __attribute__((aligned(8)));
struct nearly { struct only_padding padding; char one; };

#define NOINLINE __attribute__((noinline))
static NOINLINE struct nothing returns_nothing(int x) { struct nothing n; (void)x; return n; }
static NOINLINE struct only_padding returns_only_padding(int x) { struct only_padding u; (void)x; return u; }
static NOINLINE struct more_padding returns_more_padding(int x) { struct more_padding u; (void)x; return u; }
static NOINLINE struct of_nothing returns_of_nothing(int x) { struct of_nothing u; (void)x; return u; }
static NOINLINE struct nearly returns_nearly(int x) { struct nearly u; u.one = (char)x; return u; }
static NOINLINE int takes_them(int a, struct nothing n, int b, struct only_padding p, int c, struct more_padding m, int d, struct nearly nearly, int e) {
  (void)n, (void)p, (void)m;
  return a * 10000 + b * 1000 + c * 100 + d * 10 + e + nearly.one * 100000;
}
static NOINLINE int through_an_ellipsis(int count, ...) {
  va_list list;
  va_start(list, count);
  int first = va_arg(list, int);
  struct only_padding p = va_arg(list, struct only_padding);
  int second = va_arg(list, int);
  struct nearly nearly = va_arg(list, struct nearly);
  int third = va_arg(list, int);
  va_end(list);
  (void)p;
  return first * 100 + second * 10 + third + nearly.one * 1000;
}

int main(void) {
  struct nothing n = returns_nothing(1), n2;
  struct only_padding p = returns_only_padding(2), p2;
  struct more_padding m = returns_more_padding(3), m2;
  struct of_nothing o = returns_of_nothing(4), o2;
  struct nearly nearly = returns_nearly(7), nearly2;
  n2 = n, p2 = p, m2 = m, o2 = o, nearly2 = nearly;
  (void)o2;
  printf("%d\n", takes_them(1, n2, 2, p2, 3, m2, 4, nearly2, 5));
  printf("%d\n", through_an_ellipsis(5, 1, p, 2, nearly, 3));
  return 0;
}

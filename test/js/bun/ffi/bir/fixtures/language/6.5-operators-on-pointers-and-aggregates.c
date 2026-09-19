// C11 6.5.2, 6.5.3.2, 6.5.6, 6.5.8, 6.5.9, 6.5.15, 6.5.16 for operands that are not arithmetic: pointers, arrays,
// structures, unions and functions; and the order of evaluation where the standard fixes it.
#include <stddef.h>
#include <stdio.h>
#include <string.h>

struct point { int x, y; };
struct shape { struct point origin; struct point corners[2]; const char *name; };
union scalar { int i; unsigned char bytes[sizeof(int)]; };

static struct point add(struct point a, struct point b) { return (struct point){a.x + b.x, a.y + b.y}; }
static struct point *self(struct point *p) { return p; }
static int order[8], ordered;
static int note(int value) { order[ordered++] = value; return value; }
static int (*choose(int which))(int) { return which ? note : 0; }

int main(void) {
  // Subscripting is pointer arithmetic, on arrays of any depth, from either side.
  int a[5] = {10, 11, 12, 13, 14}, m[2][3] = {{1, 2, 3}, {4, 5, 6}};
  int *p = a + 1, *end = a + 5;
  printf("%d %d %d %d %d\n", a[2], *(a + 2), 2[a], p[-1], (&a[4])[-2]);
  printf("%d %d %d %d\n", m[1][2], *(*(m + 1) + 2), (*m)[1], *m[1]);
  // Pointer arithmetic: + - += -= ++ -- and the difference of two pointers, scaled by the element size.
  p += 2; p--; ++p;
  printf("%d %d %d %d\n", *p, (int)(end - p), (int)(p - end), (int)((char *)end - (char *)a) == 5 * (int)sizeof(int));
  ptrdiff_t difference = &m[1][0] - &m[0][0];
  printf("%d %d %d\n", (int)difference, *(p + 1), *(1 + p));
  int (*rows)[3] = m;
  rows++;
  printf("%d %d\n", (*rows)[0], (int)((char *)rows - (char *)m) == 3 * (int)sizeof(int));
  // One past the end may be computed and compared, not read.
  printf("%d %d %d %d\n", end > a, end == &a[5], p < end, p >= a);
  // Equality: same object, null, and pointers to void; relational within one array or one structure.
  void *v = a; struct shape s = {{1, 2}, {{3, 4}, {5, 6}}, "box"};
  printf("%d %d %d %d %d\n", v == a, (void *)&s == (void *)&s.origin, &s.origin.x < &s.origin.y, (char *)&s.corners < (char *)&s.name, &s.corners[0] < &s.corners[1]);
  // Members: . and ->, nested, through a function's result, of a union.
  struct shape *ps = &s;
  printf("%d %d %d %d %c\n", s.origin.y, ps->corners[1].x, (*ps).corners->y, self(&ps->origin)->x, ps->name[1]);
  printf("%d %d\n", add(s.origin, s.corners[0]).x, add(add(s.origin, s.origin), s.corners[1]).y);
  union scalar u = {.i = 0x01020304};
  printf("%d\n", u.bytes[0] + u.bytes[1] + u.bytes[2] + u.bytes[3]);
  // & and * are inverses; &*p and &a[i] do not evaluate the access.
  int *null = 0;
  printf("%d %d %d\n", &*null == 0, &null[3] == (int *)0 + 3, *&a[3]);
  // Assignment and the conditional operator on structures, unions and pointers.
  struct point copy = s.origin, other;
  other = copy = s.corners[1];
  copy.x = 99;
  printf("%d %d %d\n", other.x, s.corners[1].x, (copy.x > 0 ? copy : other).x);
  const char *chosen = copy.y ? "yes" : 0;
  void *mixed = copy.y ? (void *)a : (void *)&s;
  const int *qualified = copy.y ? a : (const int *)0;
  printf("%s %d %d\n", chosen, mixed == a, *qualified);
  struct shape moved;
  moved = s;
  moved.corners[0].x = 30;
  printf("%d %d %d\n", s.corners[0].x, moved.corners[0].x, memcmp(&moved.origin, &s.origin, sizeof s.origin));
  // A function call: the designator can be any expression of function-pointer type; arguments are converted as
  // if by assignment to the parameters.
  printf("%d %d\n", choose(1)(5), (choose(1) ? choose(1) : note)(6));
  ordered = 0;
  // Where the order IS specified: && || ?: and the comma operator evaluate left to right, with a sequence point;
  // the function designator and arguments before the call; a full expression before the next.
  int r = (note(1), note(2)) + 0;
  r += note(0) && note(100);
  r += note(3) || note(100);
  r += note(0) ? note(100) : note(4);
  printf("%d:", r);
  for (int i = 0; i < ordered; i++) printf(" %d", order[i]);
  printf("\n");
  int i = 0;
  i = i + 1; i += i; a[i] = i;
  printf("%d %d %d\n", i, a[2], a[3]);
  return 0;
}

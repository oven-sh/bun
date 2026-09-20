// C11 6.5.2.5: compound literals: unnamed objects, at file scope and in blocks, modifiable, addressable.
#include <stdio.h>
#include <string.h>

struct point { int x, y; };
struct line { struct point from, to; };

// At file scope: static storage duration, constant initializers.
static int *file_scope = (int[]){1, 2, 3};
static struct point *origin = &(struct point){.y = 7};
static const char *const names[] = {(const char[]){"first"}, (const char[]){'s', 'e', 'c', 0}};

static int sum(const int *values, int count) { int total = 0; while (count--) total += *values++; return total; }
static int length(struct line l) { return (l.to.x - l.from.x) + (l.to.y - l.from.y); }
static struct point *keep(struct point *p) { return p; }

int main(void) {
  printf("%d %d %s %s\n", file_scope[2], origin->y, names[0], names[1]);
  file_scope[0] = 10;
  printf("%d\n", sum(file_scope, 3));
  // In a block: automatic, initialized each time the expression is evaluated, with any initializer an object takes.
  printf("%d %d\n", sum((int[]){1, 2, 3, 4}, 4), sum((const int[5]){[4] = 9}, 5));
  printf("%d\n", length((struct line){{1, 2}, .to = {4, 6}}));
  int n = 3;
  struct point *p = &(struct point){n, n * 2};
  p->x += 1;
  printf("%d %d %d\n", p->x, p->y, (int)sizeof(int[]){1, 2, 3, 4, 5} / (int)sizeof(int));
  // It is an lvalue: it can be assigned to, and its members too.
  (struct point){1, 2}.x = 5;
  struct point copy = (struct point){.x = 8};
  copy = (struct point){copy.y, copy.x};
  printf("%d %d\n", copy.x, copy.y);
  // One object per evaluation of the expression: in a loop, the same one each time round, fresh in value.
  int fresh = 1;
  for (int i = 0; i < 3; i++) {
    struct point *each = keep(&(struct point){i, 0});
    fresh &= each->x == i && each->y == 0;
    each->y += 5;
  }
  printf("%d\n", fresh);
  // Scalars and unions too, and a literal of a const-qualified type.
  int *scalar = &(int){41};
  ++*scalar;
  union number { int i; float f; } *u = &(union number){.f = 1.0f};
  printf("%d %d %d\n", *scalar, u->i == 0x3f800000, (const int){5});
  char *text = (char[]){"writable"};
  text[0] = 'W';
  printf("%s %d\n", text, (int)strlen((char[16]){"padded"}));
  return 0;
}

// A small local structure nobody takes the address of lives in registers. Copying it into an
// object that is in memory (its address is taken) goes element by element, whichever way the
// copy is written: an initializer, a member of a bigger initializer, a compound literal, an
// assignment.
#include <stdio.h>

struct P { int x, y; };
struct Q { short a; char b; double d; float f; };
struct W { struct P p; int k; struct Q q; };

static __attribute__((noinline)) void show_p(const struct P *p) { printf("%d %d\n", p->x, p->y); }
static __attribute__((noinline)) void show_q(const struct Q *q) { printf("%d %d %g %g\n", q->a, q->b, q->d, q->f); }
static __attribute__((noinline)) void show_w(const struct W *w) { printf("%d %d %d | ", w->p.x, w->p.y, w->k); show_q(&w->q); }

static __attribute__((noinline)) int opaque(int v) { return v; }

int main(void) {
  struct P src = { opaque(3), opaque(4) };
  struct Q mixed = { -2, 'c', 2.5, 1.5f };

  struct P whole = src;
  show_p(&whole);
  struct Q whole_mixed = mixed;
  show_q(&whole_mixed);

  struct W first_member = { src };
  show_w(&first_member);
  struct W designated = { .q = mixed, .p = src };
  show_w(&designated);
  struct W both = { src, 9, mixed };
  show_w(&both);

  show_p(&(struct P){ src.y, src.x });
  show_w(&(struct W){ src, 1 });
  show_w(&(struct W){ .q = mixed });

  struct P array[3] = { src, [2] = src };
  show_p(&array[0]);
  show_p(&array[1]);
  show_p(&array[2]);

  struct W assigned;
  assigned.p = src;
  assigned.k = 7;
  assigned.q = mixed;
  show_w(&assigned);

  // The other direction: out of memory into registers, and registers to registers.
  struct P back = array[2];
  struct P again = back;
  printf("%d %d %d %d\n", back.x, back.y, again.x + src.x, again.y + src.y);

  // The source changes afterwards; the copies do not.
  src.x = 100;
  mixed.d = 100;
  show_p(&whole);
  show_w(&both);
  printf("%d %g\n", src.x, mixed.d);
  return 0;
}

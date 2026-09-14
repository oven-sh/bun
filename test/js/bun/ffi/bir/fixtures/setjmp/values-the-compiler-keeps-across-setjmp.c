// What a function holds across a call of setjmp that is not a variable of the program's: the addresses of structures
// it was passed by value, of over-aligned locals, of a thread-local object. After longjmp they are what they were,
// however much the path that led to the longjmp needed registers and room on the stack for. With six and with eight
// structures, the second return in a loop, longjmp from two functions down and from a comparison function of qsort,
// and what C11 7.13.2.1 says of locals: a volatile one changed after setjmp has its last value, and one that was not
// changed has the value it had.
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>

struct S { long a[3]; };
struct aligned { _Alignas(32) long a[4]; };
static jmp_buf jb;
#define NOINLINE __attribute__((noinline))
NOINLINE static long sink(struct S *p) { return p->a[0] + p->a[1] * 3 + p->a[2] * 5; }
NOINLINE static long sink_aligned(struct aligned *p) { return p->a[0] + p->a[1] * 3 + p->a[2] * 5; }
NOINLINE static void fill(struct aligned *p, long v) { p->a[0] = v; p->a[1] = v + 1; p->a[2] = v + 2; p->a[3] = 0; }
NOINLINE static long opaque(long x) { return x * 7 + 1; }
NOINLINE static void thrower(long x) { if (x) longjmp(jb, 1); }
NOINLINE static void two_down(long x) { thrower(opaque(x)); }
#define MUCH(k) (opaque(k) * 3 + opaque(k + 1) * 5 + opaque(k + 2) * 7 + opaque(k + 3) * 11 + opaque(k + 4) * 13 + opaque(k + 5) * 17 + opaque(k + 6) * 19 + opaque(k + 7) * 23 + opaque(k + 8) * 29 + opaque(k + 9) * 31 + opaque(k + 10) * 37 + opaque(k + 11) * 41)

NOINLINE static long six(struct S a, struct S b, struct S c, struct S d, struct S e, struct S g, long k) {
  if (setjmp(jb)) return sink(&a) + sink(&b) * 2 + sink(&c) * 3 + sink(&d) * 4 + sink(&e) * 5 + sink(&g) * 6;
  thrower(MUCH(k));
  return 0;
}
NOINLINE static long eight(struct S a, struct S b, struct S c, struct S d, struct S e, struct S g, struct S h, struct S i, long k) {
  if (setjmp(jb)) return sink(&a) + sink(&b) * 2 + sink(&c) * 3 + sink(&d) * 4 + sink(&e) * 5 + sink(&g) * 6 + sink(&h) * 7 + sink(&i) * 8;
  two_down(MUCH(k));
  return 0;
}
NOINLINE static long over_aligned_locals(long k) {
  struct aligned a, b, c, d, e, g, h, i;
  fill(&a, 100), fill(&b, 200), fill(&c, 300), fill(&d, 400), fill(&e, 500), fill(&g, 600), fill(&h, 700), fill(&i, 800);
  if (setjmp(jb))
    return sink_aligned(&a) + sink_aligned(&b) * 2 + sink_aligned(&c) * 3 + sink_aligned(&d) * 4 + sink_aligned(&e) * 5 + sink_aligned(&g) * 6 + sink_aligned(&h) * 7 + sink_aligned(&i) * 8;
  thrower(MUCH(k));
  return 0;
}
static _Thread_local long for_this_thread[4] = { 1, 2, 3, 4 };
NOINLINE static long a_thread_local(struct S a, struct S b, struct S c, struct S d, struct S e, long k) {
  long before = for_this_thread[1];
  if (setjmp(jb)) return before * 1000000 + for_this_thread[2] * 100000 + sink(&a) + sink(&b) + sink(&c) + sink(&d) + sink(&e);
  for_this_thread[2] = 9;
  thrower(MUCH(k));
  return 0;
}
// The second return in a loop: each time round, one more.
NOINLINE static long in_a_loop(struct S a, struct S b, struct S c, struct S d, struct S e, struct S g) {
  volatile long times = 0;
  long total = 0;
  for (;;) {
    switch (setjmp(jb)) {
    case 0:
      thrower(MUCH(times));
      return -1;
    default:
      times++;
      total += sink(&a) + sink(&b) + sink(&c) + sink(&d) + sink(&e) + sink(&g);
      if (times == 3) return total * 10 + times;
    }
  }
}
// A structure as the result: the address it goes to is kept across too.
struct wide { long a[6]; };
NOINLINE static struct wide returns_a_structure(struct S a, struct S b, struct S c, struct S d, struct S e, long k) {
  struct wide result = { { 0 } };
  if (setjmp(jb)) {
    result.a[0] = sink(&a), result.a[1] = sink(&b), result.a[2] = sink(&c), result.a[3] = sink(&d), result.a[4] = sink(&e), result.a[5] = k;
    return result;
  }
  thrower(MUCH(k));
  return result;
}
static int leaves_by_longjmp(const void *x, const void *y) { (void)x, (void)y; longjmp(jb, 7); }
NOINLINE static long out_of_qsort(struct S a, struct S b, struct S c, struct S d, struct S e, struct S g) {
  int numbers[4] = { 4, 3, 2, 1 };
  int how = setjmp(jb);
  if (how) return how * 100000 + sink(&a) + sink(&b) + sink(&c) + sink(&d) + sink(&e) + sink(&g);
  qsort(numbers, 4, sizeof numbers[0], leaves_by_longjmp);
  return 0;
}
// 7.13.2.1: a local that is volatile has its last value after longjmp; one that was not changed is what it was.
NOINLINE static long what_locals_are(long k) {
  volatile long changed = 1;
  long untouched = k * 2;
  long also = 5;
  if (setjmp(jb)) return changed * 100 + untouched * 10 + also;
  changed = 7;
  thrower(MUCH(k));
  return 0;
}

int main(void) {
  struct S v[8];
  for (int i = 0; i < 8; i++)
    for (int j = 0; j < 3; j++) v[i].a[j] = (i + 1) * 100 + j;
  printf("%ld\n", six(v[0], v[1], v[2], v[3], v[4], v[5], 3));
  printf("%ld\n", eight(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], 3));
  printf("%ld\n", over_aligned_locals(3));
  printf("%ld\n", a_thread_local(v[0], v[1], v[2], v[3], v[4], 3));
  printf("%ld\n", in_a_loop(v[0], v[1], v[2], v[3], v[4], v[5]));
  struct wide w = returns_a_structure(v[0], v[1], v[2], v[3], v[4], 3);
  printf("%ld %ld %ld %ld %ld %ld\n", w.a[0], w.a[1], w.a[2], w.a[3], w.a[4], w.a[5]);
  printf("%ld\n", out_of_qsort(v[0], v[1], v[2], v[3], v[4], v[5]));
  printf("%ld\n", what_locals_are(4));
  return 0;
}

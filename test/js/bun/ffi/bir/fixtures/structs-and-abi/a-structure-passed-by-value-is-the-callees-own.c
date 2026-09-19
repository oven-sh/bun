// A structure passed by value is the callee's own copy, made anew for each call: what the callee does to it the caller
// does not see, two calls in one expression do not see each other's, and a call in a loop next to an `alloca` leaves
// the alloca'd memory what it was. For structures small enough for registers, of a few dozen bytes, and of several
// kilobytes (which some conventions pass as the address of a copy, made for the time of the call).
#include <setjmp.h>
#include <stdio.h>
#include <string.h>
#if defined _WIN32
#include <malloc.h>
#else
#include <alloca.h>
#endif

struct small { int a, b; };
struct medium { long long a[5]; };
struct large { char bytes[300]; };
struct huge { int words[4096]; };

#define NOINLINE __attribute__((noinline))
NOINLINE static int changes_small(struct small s) { s.a += 100; s.b = -s.b; return s.a + s.b; }
NOINLINE static long long changes_medium(struct medium m) { for (int i = 0; i < 5; i++) m.a[i] *= 2; return m.a[0] + m.a[4]; }
NOINLINE static int changes_large(struct large l) { memset(l.bytes, 9, sizeof l.bytes); return l.bytes[0] + l.bytes[299]; }
NOINLINE static long long changes_huge(struct huge h, int at) { long long before = h.words[at]; for (int i = 0; i < 4096; i++) h.words[i] = -1; return before; }
NOINLINE static long long two_of_them(struct huge first, struct large between, struct huge second) { first.words[0]++; second.words[0]--; return first.words[0] * 1000LL + second.words[0] + between.bytes[7]; }
NOINLINE static struct huge gives_one_back(struct huge h) { h.words[1] = 77; return h; }
static jmp_buf out;
NOINLINE static void leaves_by_longjmp(struct huge h) { h.words[0] = 5; longjmp(out, h.words[0]); }

int main(void) {
  struct small s = { 1, 2 };
  struct medium m = { { 1, 2, 3, 4, 5 } };
  static struct large l;
  static struct huge h, other;
  memset(l.bytes, 3, sizeof l.bytes);
  for (int i = 0; i < 4096; i++) h.words[i] = i, other.words[i] = 2 * i;
  printf("%d %d %d\n", changes_small(s), s.a, s.b);
  printf("%lld %lld %lld\n", changes_medium(m), m.a[0], m.a[4]);
  printf("%d %d %d\n", changes_large(l), l.bytes[0], l.bytes[299]);
  printf("%lld %d %d\n", changes_huge(h, 4000), h.words[4000], h.words[0]);
  // Two in one expression, and two in one call.
  long long sum = changes_huge(h, 10) + changes_huge(other, 10);
  printf("%lld %lld %d %d\n", sum, two_of_them(h, l, other), h.words[0], other.words[0]);
  // One that is returned, passed on at once.
  printf("%lld %d\n", changes_huge(gives_one_back(h), 1), h.words[1]);
  // In a loop, next to memory from alloca that has to outlive the call.
  long long total = 0;
  char *kept[8];
  for (int i = 0; i < 8; i++) {
    kept[i] = alloca(32);
    memset(kept[i], i + 1, 32);
    total += changes_huge(h, i) + changes_large(l);
  }
  int intact = 1;
  for (int i = 0; i < 8; i++) intact &= kept[i][0] == i + 1 && kept[i][31] == i + 1;
  printf("%lld %d\n", total, intact);
  // Left by longjmp: the stack is the caller's again, and the next call works.
  volatile int rounds = 0;
  int how = setjmp(out);
  if (how == 0 || rounds < 3) {
    rounds++;
    leaves_by_longjmp(h);
  }
  printf("%d %d %d %lld\n", how, rounds, h.words[0], changes_huge(h, 123));
  return 0;
}

// `const` and `volatile` go with `_Atomic` like with any type: a const atomic object is read and not written, a
// pointer to one can be had from a pointer to one that is not const, and the atomic version of a type is another type
// than the type: `_Generic` tells them apart. (Assigning to the const one, and a pointer to `int` from the address of
// an `_Atomic int`, are errors: diagnostics/cases.json.)
#include <stdatomic.h>
#include <stdio.h>

static const _Atomic int fixed = 41;
static volatile _Atomic int seen_by_others = 1;
static _Atomic int plain_atomic = 2;
static int plain = 3;

#define KIND(x) _Generic(&(x), const _Atomic int *: "const atomic", volatile _Atomic int *: "volatile atomic", _Atomic int *: "atomic", int *: "plain", default: "other")

static int reads(const _Atomic int *p) { return atomic_load(p) + *p; }

int main(void) {
  const _Atomic int *to_const = &plain_atomic;
  _Atomic int *to_atomic = &plain_atomic;
  atomic_fetch_add(to_atomic, 5);
  seen_by_others += 2;
  atomic_store(&seen_by_others, seen_by_others * 10);
  printf("%d %d %d %d\n", reads(&fixed), reads(to_const), seen_by_others, plain);
  printf("%s, %s, %s, %s\n", KIND(fixed), KIND(seen_by_others), KIND(plain_atomic), KIND(plain));
  printf("%d %d\n", (int)sizeof fixed, (int)_Alignof(const _Atomic long long));
  return 0;
}

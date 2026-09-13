// C11 6.7.3 and 6.7.2.4: const, volatile, restrict and _Atomic (as a qualifier and as _Atomic(T)): where each may be
// written, what it attaches to, and what a program may rely on.
#include <stdio.h>
#include <string.h>

#define QUALIFIED(x) _Generic(&(x), const volatile int *: "const volatile", const int *: "const", volatile int *: "volatile", int *: "none", default: "other")

static const int table[3] = {1, 2, 3};            // the elements are const, not the array
typedef int vector[3];
static const vector from_typedef = {4, 5, 6};     // the same, through a typedef
static int *const fixed_pointer = (int[]){7};     // a const pointer to modifiable ints
static const int *movable_pointer = table;        // a modifiable pointer to const ints
static const int *const neither = table;
static volatile int hardware = 5;
static const volatile int read_only_hardware = 6;

// restrict: within the block, the object is reached only through this pointer, so the copy may go either way.
static void copy(int n, int *restrict to, const int *restrict from) { for (int i = 0; i < n; i++) to[i] = from[i]; }
static void scale(int n, int out[restrict static 3], const int in[restrict const 3]) { for (int i = 0; i < n; i++) out[i] = in[i] * 2; }

struct holder { const int fixed; int loose; volatile int watched; int *restrict owner; };

int main(void) {
  // Qualifiers may be repeated, come before or after the type, and apply to the pointer written before them.
  const int a = 1; int const b = 2; const const int c = 3; const volatile int d = 4; volatile int e = 5; int plain = 6;
  printf("%s %s %s %s %s %s\n", QUALIFIED(a), QUALIFIED(b), QUALIFIED(c), QUALIFIED(d), QUALIFIED(e), QUALIFIED(plain));
  printf("%s %s %s\n", QUALIFIED(table[0]), QUALIFIED(from_typedef[1]), QUALIFIED(*movable_pointer));
  *fixed_pointer = 70;
  movable_pointer++;
  printf("%d %d %d %d\n", *fixed_pointer, *movable_pointer, *neither, a + b + c + d);
  // A value has no qualifiers: they drop when an lvalue is read, and a cast to a qualified type is a cast to the type.
  printf("%d %d\n", _Generic(a, int: 1, default: 0), _Generic((const int)plain, int: 1, default: 0));
  // A pointer to T converts to a pointer to qualified T; the other way needs a cast, which is fine if the object
  // was never const.
  const int *view = &plain;
  *(int *)view = 60;
  printf("%d %d\n", plain, *view);
  // Every access to a volatile object happens, in order; the value may change between two reads as far as the
  // compiler knows.
  int reads = hardware + hardware;
  hardware = 1; hardware = 2; hardware++;
  printf("%d %d %d\n", reads, hardware, read_only_hardware);
  // In a structure: a const member makes the whole structure unassignable, not its other members.
  struct holder h = {1, 2, 3, &plain};
  h.loose = 20; h.watched++; *h.owner = 61;
  printf("%d %d %d %d\n", h.fixed, h.loose, h.watched, plain);
  int from[3] = {1, 2, 3}, to[3], doubled[3];
  copy(3, to, from);
  scale(3, doubled, to);
  printf("%d %d\n", to[2], doubled[2]);
  // _Atomic as a qualifier and as a type specifier name the same type; reading gives a plain value.
  _Atomic int counter = 5; _Atomic(int) other = 6; _Atomic(int *) pointer = &plain; int *_Atomic also_pointer = &plain;
  counter++; counter += other; other = counter;
  printf("%d %d %d %d %d\n", counter, other, *pointer, *also_pointer, _Generic(counter + 0, int: 1, default: 0));
  printf("%d %d\n", _Generic(&counter, _Atomic int *: 1, default: 0), _Generic(&other, _Atomic(int) *: 1, default: 0));
  const _Atomic long long wide = 1LL << 40;
  printf("%lld\n", wide);
  return 0;
}

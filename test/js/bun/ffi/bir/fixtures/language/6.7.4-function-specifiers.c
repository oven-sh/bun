// C11 6.7.4: inline and _Noreturn.
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdnoreturn.h>

static inline int twice(int x) { return 2 * x; }                 // internal linkage: an ordinary function that may be inlined
inline int thrice(int x) { return 3 * x; }                       // an inline definition...
extern inline int thrice(int x);                                  // ...made the external definition by this declaration
inline int declared_later(int x);
int declared_later(int x) { return x + 100; }                    // inline on a declaration only: an ordinary external definition
static inline int recursive(int n) { return n <= 1 ? 1 : n * recursive(n - 1); }
static inline int with_static(void) { static int calls; return ++calls; }   // allowed in a static inline function

static jmp_buf back;
static _Noreturn void leave(int code) { longjmp(back, code); }
static noreturn void stop(void);                                 // the <stdnoreturn.h> spelling
_Noreturn static inline void both_specifiers(void) { exit(0); }
static int chooses(int x) {
  if (x > 0) return x;
  leave(7);                                                      // no return needed after a call that cannot come back
}

int main(void) {
  int (*pointer)(int) = twice;                                   // an inline function has an address like any other
  printf("%d %d %d %d %d\n", twice(4), thrice(4), declared_later(4), pointer(5), recursive(5));
  with_static();
  printf("%d\n", with_static());
  int code = setjmp(back);
  if (code == 0) printf("%d\n", chooses(3) + chooses(-1));
  else printf("came back with %d\n", code);
  if (code == 7) stop();
  both_specifiers();
}
static void stop(void) { printf("stopping\n"); exit(0); }

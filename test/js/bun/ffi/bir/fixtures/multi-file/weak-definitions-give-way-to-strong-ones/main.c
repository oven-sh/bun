// A weak definition is a default: a definition in another translation unit that is not weak takes its place, for every
// caller, this unit's own included. Without one, the weak definition is what there is.
#include <stdio.h>

__attribute__((weak)) int overridden_function(void) { return 1; }
__attribute__((weak)) int overridden_object = 10;
__attribute__((weak)) int kept_function(void) { return 3; }
__attribute__((weak)) int kept_object = 30;
// Weak in both units: the first one met stays (this file is linked first).
__attribute__((weak)) int weak_in_both(void) { return 5; }
__attribute__((weak)) int weak_object_in_both = 50;
// By pragma, and with the attribute on an earlier declaration.
#pragma weak by_pragma
int by_pragma(void) { return 7; }
int declared_weak_first(void) __attribute__((weak));
int declared_weak_first(void) { return 9; }
// A weak tentative definition against an initialized one.
__attribute__((weak)) int tentative;

// The addresses in a table follow the definition that stands.
static int (*const table[])(void) = { overridden_function, kept_function, by_pragma };
static int *const objects[] = { &overridden_object, &kept_object };

int other_unit_sees(void);
int strong_calls_weak(void);

int main(void) {
  printf("%d %d %d %d\n", overridden_function(), overridden_object, kept_function(), kept_object);
  printf("%d %d %d %d %d\n", weak_in_both(), weak_object_in_both, by_pragma(), declared_weak_first(), tentative);
  printf("%d %d %d %d %d\n", table[0](), table[1](), table[2](), *objects[0], *objects[1]);
  printf("%d %d\n", other_unit_sees(), strong_calls_weak());
  overridden_object++;
  printf("%d %d\n", other_unit_sees(), table[0] == overridden_function);
  return 0;
}

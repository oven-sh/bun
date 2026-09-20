// A symbol declared weak and defined nowhere has a null address, which is what programs test it for; so whether its
// address is null is not a constant, and is looked at when the program runs. One that is defined (weakly too) is
// there. (As an initializer of an object with static storage the test is an error: diagnostics/cases.json.)
#include <stdio.h>

extern int nowhere __attribute__((weak));
extern int nowhere_function(void) __attribute__((weak));
#pragma weak by_pragma
extern int by_pragma;
int defined_weakly __attribute__((weak)) = 5;
__attribute__((weak)) int defined_weakly_function(void) { return 6; }
extern int defined_later __attribute__((weak));
static int an_ordinary_one;
static const _Bool ordinary_is_there = &an_ordinary_one != 0;
_Static_assert(&an_ordinary_one != 0, "the address of an ordinary object is not null");

int main(void) {
  printf("%d %d %d\n", &nowhere != 0, nowhere_function != 0, &by_pragma != 0);
  printf("%d %d %d\n", &nowhere ? 1 : 2, nowhere_function ? 1 : 2, !nowhere_function);
  printf("%d %d %d\n", (_Bool)&nowhere, &nowhere && 1, &nowhere == 0 || nowhere_function == 0);
  if (&nowhere) printf("%d\n", nowhere);
  if (nowhere_function) printf("%d\n", nowhere_function());
  printf("%d %d %d\n", &defined_weakly != 0, defined_weakly_function != 0, defined_weakly + defined_weakly_function());
  printf("%d %d\n", &defined_later != 0, ordinary_is_there);
  return 0;
}

int defined_later = 1;

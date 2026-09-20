/* A function nothing defines, mentioned only by code that is never emitted, is not required
   when the program is loaded (tinycc's tcctest.c relies on it, as it may with gcc). */
#include <stdio.h>
extern int never_defined(void);
static int defined_here(void) { return 7; }
static inline void refer_to_undefined(void) { never_defined(); }
int main(void) {
  int i = 0 ? never_defined() : defined_here();
  if (0) printf("%d\n", never_defined());
  while (1) { printf("%d\n", i); break; printf("%d\n", never_defined()); }
  return 0;
}

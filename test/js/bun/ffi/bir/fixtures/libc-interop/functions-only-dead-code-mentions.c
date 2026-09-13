/* A function nothing defines, mentioned only by code that is never emitted, is not required
   when the program is loaded (tinycc's tcctest.c relies on it, as it may with gcc). */
#include <stdio.h>
extern int undefined_function(void);
static int defined_function(void) { return 7; }
static inline void refer_to_undefined(void) { undefined_function(); }
int main(void) {
  int i = 0 ? undefined_function() : defined_function();
  if (0) printf("%d\n", undefined_function());
  while (1) { printf("%d\n", i); break; printf("%d\n", undefined_function()); }
  return 0;
}

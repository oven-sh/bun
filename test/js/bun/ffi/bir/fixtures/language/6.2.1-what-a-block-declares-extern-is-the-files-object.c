// 6.2.2p4 and 6.2.1p4: an object or function declared `extern` inside a block is the one the file defines, before
// or after, and the same one as another block's; the name is in scope in the block only. (That it is not in scope
// after the block is an error to use: diagnostics/cases.json.)
#include <stdio.h>

int defined_before = 1;
static int bumps(void) {
  extern int defined_before, defined_after;
  extern int also_bumps(void);
  defined_before++, defined_after++;
  return also_bumps();
}
static int reads(void) {
  extern int defined_after;
  int (*function)(void);
  {
    extern int also_bumps(void);
    function = also_bumps;
  }
  return defined_after * 100 + function();
}
int defined_after = 10;
int also_bumps(void) { return ++defined_before; }
// A name of the file's own is hidden by a local and seen again through a block's `extern`.
int hidden = 5;
static int sees_through(void) {
  int hidden = 6;
  {
    extern int hidden;
    return hidden;
  }
}

int main(void) {
  int first = bumps();
  int second = reads();
  printf("%d %d %d %d %d\n", first, second, defined_before, defined_after, sees_through());
  return 0;
}

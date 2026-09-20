// C11 7.22.4.7: quick_exit runs what at_quick_exit registered, most recent first, and nothing atexit registered; it
// does not flush streams either, so what should be seen is flushed by hand.
#include <stdio.h>
#include <stdlib.h>

static void on_exit_only(void) { puts("an atexit handler ran"); fflush(stdout); }
static void first_registered(void) { puts("first registered, runs last"); fflush(stdout); }
static void second_registered(void) { puts("second registered, runs first"); fflush(stdout); }

int main(void) {
  atexit(on_exit_only);
  at_quick_exit(first_registered);
  at_quick_exit(second_registered);
  puts("main");
  fflush(stdout);
  quick_exit(3);
}

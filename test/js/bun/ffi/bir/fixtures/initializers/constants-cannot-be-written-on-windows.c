// On Windows: a store through a string literal is an access violation, which ends the program with a status that
// is not 0, after what it printed before and without what comes after.
#include <stdio.h>

static const int constant = 5;
static const char *const names[] = {"alpha", "beta"};

int main(int argc, char **argv) {
  printf("%d %s\n", constant, names[1]);
  fflush(stdout);
  // (Through a volatile pointer, so that the store is not reasoned away.)
  char *volatile literal = (char *)"a string literal";
  int *volatile not_const_any_more = (int *)&constant;
  if (argc > 5) *not_const_any_more = 6; else literal[0] = 'A';
  printf("WRONG: the store went through: %s %d %s\n", literal, constant, argv[0]);
  fflush(stdout);
  return 0;
}

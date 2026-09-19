// A store through a string literal, or through a cast that takes const away from a constant, faults, as it does in
// any program whose constants the loader protects. (The handler turns the fault into output that can be compared.)
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static const int constant = 5;
static const char *const names[] = {"alpha", "beta"};
static volatile int which;

static void faulted(int number) {
  (void)number;
  static const char said[] = "faulted\n";
  write(1, said, sizeof said - 1);
  _exit(which);
}

int main(int argc, char **argv) {
  signal(SIGSEGV, faulted);
  signal(SIGBUS, faulted);
  printf("%d %s\n", constant, names[1]);
  fflush(stdout);
  // (Through volatile pointers, so that the stores are not reasoned away.)
  char *volatile literal = (char *)"a string literal";
  int *volatile not_const_any_more = (int *)&constant;
  which = argc > 5 ? 1 : 0;
  if (which) *not_const_any_more = 6; else literal[0] = 'A';
  printf("WRONG: the store went through: %s %d %s\n", literal, constant, argv[0]);
  return 1;
}

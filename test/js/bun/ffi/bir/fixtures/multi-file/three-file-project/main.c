#include "shared.h"
int printf(const char *, ...);
int run_parity(unsigned n);
int run_table(int a, int b);
int run_globals(void);
const char *run_names(int i);
const char *own_string(void);
const char *own_string_too(void);

int main(void) {
  printf("%d\n", run_parity(7));
  printf("%d\n", run_parity(10));
  printf("%d\n", run_table(9, 4));
  /* bump twice: counter 10 -> 14, parity's private_total 7 -> 9, scratch 0 -> 2 (+5). */
  printf("%d\n", run_globals());
  printf("%d\n", is_odd(3));
  printf("%d\n", mul(6, 7));
  printf("%s\n", run_names(2));
  printf("%s\n", own_string_too());
  printf("%s\n", own_string());
  return 0;
}

// The C library returns small structures by value: div_t and ldiv_t, everywhere.
#include <stdio.h>
#include <stdlib.h>

int divide(int n, int d) {
  div_t r = div(n, d);
  return r.quot * 100 + r.rem;
}
long divide_long(long n, long d) {
  ldiv_t r = ldiv(n, d);
  return r.quot * 1000 + r.rem + ldiv(7, 2).rem;
}
static div_t (*through_a_pointer)(int, int) = div;

int main(void) {
  printf("%d\n", divide(47, 5));
  printf("%d\n", divide(-47, 5));
  printf("%lld\n", (long long)divide_long(-47, 5));
  printf("%lld\n", (long long)divide_long(2000000, -7));
  div_t r = through_a_pointer(1000, 33);
  printf("%d %d %d\n", r.quot, r.rem, (int)sizeof(ldiv_t) == 2 * (int)sizeof(long));
  return 0;
}

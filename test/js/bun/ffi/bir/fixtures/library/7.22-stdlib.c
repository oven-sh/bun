// C11 7.22 <stdlib.h>: conversions, the division functions (structures by value), sorting and searching with a
// comparison function written in C, allocation with its alignment promise, and exit handlers.
#include <limits.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct entry { const char *name; int rank; double weight; };
static int calls_to_compare;
static int by_rank(const void *a, const void *b) {
  calls_to_compare++;
  const struct entry *x = a, *y = b;
  return (x->rank > y->rank) - (x->rank < y->rank);
}
static int by_name(const void *a, const void *b) { return strcmp(((const struct entry *)a)->name, ((const struct entry *)b)->name); }
static int descending(const void *a, const void *b) { return *(const int *)b - *(const int *)a; }

static void last(void) { printf("last registered, first run\n"); }
static void first(void) { printf("first registered, last run\n"); fflush(stdout); }

int main(void) {
  atexit(first);
  atexit(last);
  // Numeric conversions: bases, prefixes, where parsing stops, saturation.
  char *end;
  printf("%d %ld %lld %lu %llu\n", atoi("  -42abc"), atol("123456789"), atoll("-9000000000"), strtoul("4294967295", 0, 10), strtoull("18446744073709551615", 0, 10));
  long hex = strtol("0x7fQ", &end, 0); /* long: any width */
  printf("%ld %c %ld %ld %ld\n", hex, *end, strtol("0777", 0, 0), strtol("-zz", 0, 36), strtol("101", 0, 2));
  printf("%d %d\n", strtol("99999999999999999999", 0, 10) == LONG_MAX, strtoll("-99999999999999999999", 0, 10) == LLONG_MIN);
  double parsed = strtod("  -1.5e2xyz", &end);
  printf("%.1f %s %.3f %.2f %g\n", parsed, end, atof("3.14159"), (double)strtof("2.25", 0), (double)strtold("0x1p-2", 0));
  printf("%d\n", strtod("nothing", &end) == 0 && strcmp(end, "nothing") == 0);
  // abs and div: structures returned by value, quotient toward zero.
  div_t d = div(-7, 2); ldiv_t l = ldiv(7L, -2L); lldiv_t ll = lldiv(-9000000000LL, 7);
  printf("%d %d %ld %ld %lld %lld | %d %ld %lld\n", d.quot, d.rem, l.quot, l.rem, ll.quot, ll.rem, abs(-3), labs(-4L), llabs(-5000000000LL));
  // qsort and bsearch call back into compiled C.
  struct entry table[] = {{"delta", 4, 0.4}, {"alpha", 1, 0.1}, {"echo", 5, 0.5}, {"charlie", 3, 0.3}, {"bravo", 2, 0.2}};
  qsort(table, 5, sizeof table[0], by_rank);
  printf("%s %s %s %s %s %d\n", table[0].name, table[1].name, table[2].name, table[3].name, table[4].name, calls_to_compare > 0);
  struct entry key = {0, 3, 0};
  struct entry *found = bsearch(&key, table, 5, sizeof table[0], by_rank);
  key.rank = 9;
  printf("%s %.1f %d\n", found ? found->name : "?", found ? found->weight : 0, bsearch(&key, table, 5, sizeof table[0], by_rank) == 0);
  qsort(table, 5, sizeof table[0], by_name);
  key.name = "echo";
  found = bsearch(&key, table, 5, sizeof table[0], by_name);
  printf("%d %d\n", found ? found->rank : -1, (int)(found - table));
  int numbers[] = {3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5};
  qsort(numbers, sizeof numbers / sizeof numbers[0], sizeof numbers[0], descending);
  for (size_t i = 0; i < sizeof numbers / sizeof numbers[0]; i++) printf("%d", numbers[i]);
  qsort(numbers, 0, sizeof numbers[0], descending);       // nothing to sort is fine
  printf("\n");
  // Allocation: aligned for any type, zeroed by calloc, preserved by realloc.
  long double *block = malloc(3 * sizeof *block);
  int *zeroed = calloc(100, sizeof *zeroed);
  int all_zero = 1;
  for (int i = 0; i < 100; i++) all_zero &= zeroed[i] == 0;
  for (int i = 0; i < 100; i++) zeroed[i] = i;
  zeroed = realloc(zeroed, 1000 * sizeof *zeroed);
  printf("%d %d %d %d\n", (uintptr_t)block % _Alignof(max_align_t) == 0, all_zero, zeroed[99], (uintptr_t)zeroed % _Alignof(max_align_t) == 0);
  free(block); free(zeroed); free(0);
  // rand is a sequence that srand restarts; the environment can be asked.
  srand(7); int a = rand(), b = rand(); srand(7);
  printf("%d %d %d\n", rand() == a && rand() == b, a >= 0 && a <= RAND_MAX, RAND_MAX >= 32767);
  printf("%d %d\n", getenv("SURELY_NOBODY_SETS_THIS_VARIABLE_42") == 0, EXIT_SUCCESS == 0 && EXIT_FAILURE != 0);
  printf("%d\n", MB_CUR_MAX >= 1);
  exit(EXIT_SUCCESS);                 // runs the handlers, last registered first
}

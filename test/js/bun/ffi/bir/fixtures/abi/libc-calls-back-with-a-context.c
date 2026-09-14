// The C library calling functions compiled here, with arguments of its own choosing: the binary tree of <search.h>
// (a comparison function, and a visitor that gets a pointer, an enumeration by value and an int), bsearch and
// qsort with keys of several types, and pthread_once.
#include <pthread.h>
#include <search.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int compare_strings(const void *a, const void *b) { return strcmp(a, b); }
static int visited, deepest, leaves, order_is_sorted = 1;
static const char *previous;
static void visit(const void *node, VISIT which, int depth) {
  const char *word = *(const char *const *)node;
  if (which == postorder || which == leaf) {       // in order
    visited++;
    if (previous && strcmp(previous, word) >= 0) order_is_sorted = 0;
    previous = word;
  }
  if (which == leaf) leaves++;
  if (depth > deepest) deepest = depth;
}

static int compare_doubles(const void *a, const void *b) { double x = *(const double *)a, y = *(const double *)b; return (x > y) - (x < y); }
struct wide { long long key; char payload[24]; };
static int compare_wide(const void *a, const void *b) { long long x = ((const struct wide *)a)->key, y = ((const struct wide *)b)->key; return (x > y) - (x < y); }

static pthread_once_t once = PTHREAD_ONCE_INIT;
static int initialized;
static void initialize(void) { initialized++; }

int main(void) {
  void *root = 0;
  static char apple_again[] = "apple";             // equal to one that is already there, and another object
  const char *words[] = {"pear", "apple", "fig", "cherry", "banana", "grape", apple_again, "date"};
  int inserted = 0;
  for (int i = 0; i < 8; i++) {
    const char **found = tsearch(words[i], &root, compare_strings);
    inserted += *found == words[i];
  }
  twalk(root, visit);
  const char **hit = tfind("fig", &root, compare_strings);
  printf("%d %d %d %d %d %s %d\n", inserted, visited, order_is_sorted, leaves > 0, deepest > 0, hit ? *hit : "?", tfind("kiwi", &root, compare_strings) == 0);
  tdelete("fig", &root, compare_strings);
  printf("%d\n", tfind("fig", &root, compare_strings) == 0);

  double reals[] = {3.5, -1.25, 9.0, 0.0, 2.75};
  qsort(reals, 5, sizeof reals[0], compare_doubles);
  double key = 2.75, *at = bsearch(&key, reals, 5, sizeof reals[0], compare_doubles);
  printf("%.2f %.2f %.2f %d\n", reals[0], reals[2], reals[4], at ? (int)(at - reals) : -1);
  struct wide records[6];
  for (int i = 0; i < 6; i++) { records[i].key = (5 - i) * 10000000000LL; snprintf(records[i].payload, sizeof records[i].payload, "record %d", i); }
  qsort(records, 6, sizeof records[0], compare_wide);
  struct wide wanted = {30000000000LL, ""}, *record = bsearch(&wanted, records, 6, sizeof records[0], compare_wide);
  printf("%s %s %s\n", records[0].payload, records[5].payload, record ? record->payload : "?");

  pthread_once(&once, initialize);
  pthread_once(&once, initialize);
  printf("%d\n", initialized);
  return 0;
}

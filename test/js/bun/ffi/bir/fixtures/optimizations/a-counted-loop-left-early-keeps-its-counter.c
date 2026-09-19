// A loop that counts through a few constants over a local array is exactly what an optimizer likes to take apart. However
// it is compiled, the counter has the value of the iteration the loop was left from: by goto, break or return, forwards
// or backwards, from one loop or two.
#include <stdio.h>

static __attribute__((noinline)) int find(int key) {
  int a[4] = {10, 20, 30, 40};
  int i;
  for (i = 0; i < 4; i++)
    if (a[i] == key) goto found;
  return -1;
found:
  return i;
}

static __attribute__((noinline)) int find_declared_in_the_loop(int key) {
  int a[4] = {10, 20, 30, 40};
  int where = -1;
  for (int i = 0; i < 4; i++)
    if (a[i] == key) { where = i; goto found; }
found:
  return where;
}

static __attribute__((noinline)) int find_by_break(int key) {
  int a[5] = {1, 2, 3, 4, 5};
  int i;
  for (i = 0; i < 5; i++)
    if (a[i] == key) break;
  return i;
}

static __attribute__((noinline)) int find_by_return(int key) {
  int a[4] = {10, 20, 30, 40};
  for (int i = 0; i < 4; i++)
    if (a[i] == key) return i;
  return -1;
}

static __attribute__((noinline)) int find_in_a_grid(int key) {
  int g[3][3] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
  int i, j;
  for (i = 0; i < 3; i++)
    for (j = 0; j < 3; j++)
      if (g[i][j] == key) goto found;
  return -1;
found:
  return i * 10 + j;
}

static __attribute__((noinline)) int backwards(int key) {
  int a[4] = {10, 20, 30, 40};
  int i = -1, tries = 0;
retry:
  if (i >= 0) return i * 100 + tries;
  tries++;
  for (i = 0; i < 4; i++)
    if (a[i] == key) goto retry;
  return -tries;
}

static __attribute__((noinline)) int by_twos_and_downwards(int key) {
  int a[8] = {0, 1, 2, 3, 4, 5, 6, 7};
  int i, j;
  for (i = 0; i < 8; i += 2)
    if (a[i] == key) goto even;
  for (j = 7; j >= 0; j--)
    if (a[j] == key) goto odd;
  return -1;
even:
  return i;
odd:
  return 100 + j;
}

static __attribute__((noinline)) int from_a_statement_expression(int key) {
  int a[4] = {10, 20, 30, 40};
  int i;
  for (i = 0; i < 4; i++) {
    int hit = ({ if (a[i] == key) goto found; 0; });
    (void)hit;
  }
  return -1;
found:
  return i;
}

static __attribute__((noinline)) int sum_after_the_jump(int key) {
  int a[4] = {10, 20, 30, 40};
  int total = 0;
  int i;
  for (i = 0; i < 4; i++) {
    total += a[i];
    if (a[i] == key) goto out;
  }
  i = 99;
out:
  return total * 100 + i;
}

int main(void) {
  printf("%d %d %d %d %d\n", find(10), find(20), find(30), find(40), find(50));
  printf("%d %d %d\n", find_declared_in_the_loop(10), find_declared_in_the_loop(40), find_declared_in_the_loop(5));
  printf("%d %d %d\n", find_by_break(1), find_by_break(4), find_by_break(9));
  printf("%d %d %d\n", find_by_return(20), find_by_return(40), find_by_return(0));
  printf("%d %d %d %d\n", find_in_a_grid(1), find_in_a_grid(6), find_in_a_grid(9), find_in_a_grid(10));
  printf("%d %d %d\n", backwards(10), backwards(40), backwards(7));
  printf("%d %d %d %d\n", by_twos_and_downwards(0), by_twos_and_downwards(6), by_twos_and_downwards(7), by_twos_and_downwards(1));
  printf("%d %d\n", from_a_statement_expression(30), from_a_statement_expression(31));
  printf("%d %d %d\n", sum_after_the_jump(10), sum_after_the_jump(30), sum_after_the_jump(0));
  return 0;
}

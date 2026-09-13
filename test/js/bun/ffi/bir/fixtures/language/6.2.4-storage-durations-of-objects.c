// C11 6.2.4: static, thread, automatic and allocated storage; when each object's life starts and ends.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int initialized_before_startup = 40 + 2;
static int zero_initialized[4];
static _Thread_local int per_thread = 5;

static int *address_of_automatic(int depth, int **outermost) {
  int local = depth;                 // a new instance for every (recursive) entry into the block
  if (depth == 0) *outermost = &local;
  if (depth < 3) {
    int *inner = address_of_automatic(depth + 1, outermost);
    return inner != &local && *outermost != inner ? &local : 0;
  }
  return &local;
}

static int static_in_block(void) {
  static int kept = 10;              // initialized once, keeps its value
  int fresh = 10;                    // initialized every time
  kept++; fresh++;
  return kept * 100 + fresh;
}

struct holder { int values[3]; };
static struct holder make(void) { struct holder h = {{1, 2, 3}}; return h; }

int main(void) {
  printf("%d %d %d\n", initialized_before_startup, zero_initialized[3], per_thread);
  int *outermost = 0;
  printf("%d\n", address_of_automatic(0, &outermost) != 0);
  static_in_block();
  printf("%d\n", static_in_block());
  // A jump back above a declaration makes a new object (with a VLA, of another size); its old value is gone,
  // but an object without an initializer keeps its address' lifetime for the whole block.
  int rounds = 0, sum = 0;
again:;
  int initialized_each_time = 1;
  initialized_each_time += rounds;
  sum += initialized_each_time;
  if (++rounds < 3) goto again;
  printf("%d\n", sum);
  for (int n = 1; n <= 3; n++) {
    int vla[n];                      // lifetime: from the declaration to the end of the block, each iteration
    memset(vla, n, sizeof vla);
    sum += (int)sizeof vla;
  }
  printf("%d\n", sum);
  // A compound literal in a block is an automatic object of that block; at file scope it is static.
  int *literal = (int[]){1, 2, 3};
  literal[1] = 20;
  printf("%d\n", literal[0] + literal[1] + literal[2]);
  // The array inside a structure a function returned has temporary lifetime: it can be read in the same expression.
  printf("%d\n", make().values[2]);
  // Allocated storage lasts until it is freed.
  int *allocated = malloc(3 * sizeof *allocated);
  allocated[2] = 9;
  allocated = realloc(allocated, 6 * sizeof *allocated);
  printf("%d\n", allocated[2]);
  free(allocated);
  char *cleared = calloc(4, 1);
  printf("%d\n", cleared[3]);
  free(cleared);
  return 0;
}

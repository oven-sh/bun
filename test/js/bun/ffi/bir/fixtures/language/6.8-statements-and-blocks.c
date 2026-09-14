// C11 6.8: labeled, compound, expression, selection, iteration and jump statements, in their corner cases.
#include <stdio.h>

static int classify(int x) {
  switch (x) {
    case 0: return 0;
    case 1: case 2: return 12;                  // several labels on one statement
    case 3: x += 10;                            // falls through
    case 4: x += 100; break;
    default: x = -1; break;                     // default need not be last
    case 5: x = 5;
  }
  return x;
}

// Duff's device: case labels inside a loop inside the switch.
static int duff(const int *from, int count) {
  int total = 0, rounds = (count + 3) / 4;
  switch (count % 4) {
    case 0: do { total += *from++;
    case 3:      total += *from++;
    case 2:      total += *from++;
    case 1:      total += *from++;
            } while (--rounds > 0);
  }
  return total;
}

static int jump_into_block(int skip) {
  int result = 0;
  if (skip) goto inside;                        // into a block, past a declaration without an initializer
  {
    int local;
    local = 1;
    result += local;
  inside:
    local = 10;
    result += local;
  }
  return result;
}

static int switch_on_types(void) {
  int r = 0;
  switch ((unsigned char)300) { case 44: r += 1; }          // the controlling expression is promoted
  switch (5LL << 32) { case 5LL << 32: r += 2; break; case 5: r += 100; }
  switch ('a') { case 97: r += 4; }
  switch (r) { }                                            // an empty body
  switch (r) default: r += 8;                               // a body that is not a block
  switch (1) { int never_initialized; case 1: never_initialized = 16; r += never_initialized; }   // a declaration before the first label
  return r;
}

int main(void) {
  printf("%d %d %d %d %d %d %d\n", classify(0), classify(2), classify(3), classify(4), classify(5), classify(6), classify(-7));
  int numbers[10] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
  printf("%d %d %d %d\n", duff(numbers, 10), duff(numbers, 4), duff(numbers, 7), duff(numbers, 1));
  printf("%d %d %d\n", jump_into_block(0), jump_into_block(1), switch_on_types());
  // Expression and null statements; a label needs a statement after it, which may be the null one.
  int i = 0, total = 0;
  i++; (void)i; ;
  // The three loops; every clause of `for` is optional; a declaration in the first clause is scoped to the loop.
  while (i < 3) i++;
  do total += i; while (--i > 0);
  for (int j = 0, k = 10; j < k; j++, k--) total += k - j;
  for (;;) { if (++i > 3) break; }
  for (i = 0; i < 100; i++) { if (i % 2) continue; if (i > 6) break; total += i; }
  for (struct { int a, b; } pair = {0, 5}; pair.a < pair.b; pair.a++) total++;
  printf("%d %d\n", i, total);
  // break and continue bind to the innermost loop or switch; continue inside a switch inside a loop continues the loop.
  int log = 0;
  for (int outer = 0; outer < 3; outer++) {
    for (int inner = 0; inner < 3; inner++) {
      if (inner == 1) continue;
      if (outer == 1) break;
      log = log * 10 + outer * 3 + inner + 1;
    }
    switch (outer) { case 0: continue; case 2: break; }
    log = log * 10 + 9;
  }
  printf("%d\n", log);
  // goto: forward, backward, out of nested blocks; a loop built from it.
  int countdown = 3, steps = 0;
retry:
  steps++;
  if (--countdown > 0) goto retry;
  for (int a = 0; a < 5; a++) for (int b = 0; b < 5; b++) if (a * b == 6) { steps += a * 10 + b; goto out; }
out:
  printf("%d\n", steps);
  // if/else: else goes with the nearest if; the controlling expression is any scalar.
  double real = 0.5; int *null = 0; const char *text = "x";
  if (real) if (null) total = 1; else total = 2;
  if (text && !null && real) total += 10;
  if (0) total = -1; else if (0.0) total = -2; else total += 100;
  printf("%d\n", total);
  // return: converts as if by assignment; from a void function, without a value.
  return (char)256;
}

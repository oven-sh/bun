// An attribute may follow a label in either spelling: as a statement of its own (fallthrough), or in front of the
// declaration or statement the label is on.
#include <stdio.h>

static int classify(int x) {
  int r = 0;
  switch (x) {
    case 1: [[fallthrough]];
    case 2: __attribute__((fallthrough));
    case 3: [[gnu::fallthrough]];
    case 4: r += 10; [[fallthrough]];
    default:
      r += 1;
      break;
    case 6: [[]];
    case 7:
      r = 7;
  }
  return r;
}

static int labelled(int x) {
  if (x == 0) goto declaration;
  if (x == 1) goto statement;
  goto end;
declaration: [[maybe_unused]] int v = 5;
  return v;
statement: [[]];
  return 9;
end: [[]];
  return -1;
}

int main(void) {
  printf("%d %d %d %d %d %d %d\n", classify(1), classify(3), classify(4), classify(5), classify(6), classify(7), classify(100));
  printf("%d %d %d\n", labelled(0), labelled(1), labelled(2));
  return 0;
}

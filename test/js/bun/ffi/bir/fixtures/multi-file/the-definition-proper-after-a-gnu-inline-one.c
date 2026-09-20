// `extern inline __attribute__((gnu_inline))` defines a copy to inline and nothing else, so the definition proper may
// follow in the same file: that is how a C library compiles its own `atof` next to its header's inline one. Calls made
// before it and after it are calls of the function the program has.
#include <stdio.h>

__attribute__((gnu_inline)) extern inline int scaled(int x) { return x * 5; }
static int before(void) { return scaled(1); }
int scaled(int x) { return x * 5; }
static int after(void) { return scaled(2); }
int (*by_address)(int) = scaled;

__attribute__((gnu_inline, always_inline)) extern inline int twice(int x) { return x * 2; }
int twice(int x) { return x + x; }

int main(void) {
  printf("%d %d %d %d\n", before(), after(), by_address(3), twice(4));
  return 0;
}

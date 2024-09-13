// Ensure we can include builtin headers.
#include <stdalign.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdnoreturn.h>
#include <string.h>

int main() {
  // Check fprint stdout and stderr.
  fprintf(stdout, "Hello, World!\n");
  fprintf(stderr, "Hello, World!\n");

  // Verify printf doesn't crash.
  printf("Hello, World!\n");

  // Verify tgmath.h works.
  double x = 1.0;
  double y = 2.0;
  double w = pow(x, y);
  printf("pow(1.0, 2.0) = %f\n", w);

  // Verify stdint.h works.
  uint8_t a = 1;
  uint16_t b = 2;
  uint32_t c = 3;
  uint64_t d = 4;
  printf("uint8_t 1 = %hhu, uint16_t 2 = %hu, uint32_t 3 = %u, uint64_t 4 = "
         "%llu\n",
         a, b, c, d);

  // Verify stddef.h works.
  size_t e = 5;
  ptrdiff_t f = 6;
  printf("size_t 5 = %zu, ptrdiff_t 6 = %td\n", e, f);

  // Verify stdbool.h works.
  bool g = true;
  bool h = false;
  printf("bool true = %d, bool false = %d\n", (int)g, (int)h);

  return 42;
}
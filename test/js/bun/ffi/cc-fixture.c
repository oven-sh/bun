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
#include <tgmath.h>

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
  printf("uint8_t = %hhu, uint16_t = %hu, uint32_t = %u, uint64_t = %llu\n", a,
         b, c, d);

  // Verify stddef.h works.
  size_t e = 5;
  ptrdiff_t f = 6;
  printf("size_t = %zu, ptrdiff_t = %td\n", e, f);

  // Verify stdbool.h works.
  bool g = true;
  bool h = false;
  printf("bool = %i, bool = %i\n", (int)g, (int)h);

  return 42;
}
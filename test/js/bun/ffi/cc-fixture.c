// Ensure we can include builtin headers.
#include <stdalign.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdnoreturn.h>

int main() {
  // Check fprint stdout and stderr.
  fprintf(stdout, "Hello, World!\n");
  fprintf(stderr, "Hello, World!\n");

  // Verify printf doesn't crash.
  printf("Hello, World!\n");
  printf("Hi!, 123 == %d\n", 123);

  // Verify stdbool.h works.
  bool g = true;
  bool h = false;
  printf("bool true = %d, bool false = %d\n", (int)g, (int)h);

  return 42;
}
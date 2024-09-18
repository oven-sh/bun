// Ensure we can include builtin headers.
#include <stdalign.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdnoreturn.h>
#if __has_include(<stdio.h>)
#include <stdio.h>
#endif

int main() {

#if __has_include(<stdio.h>)
  // Check fprint stdout and stderr.
  fprintf(stdout, "Hello, World!\n");
  fprintf(stderr, "Hello, World!\n");

  // Verify printf doesn't crash.
  printf("Hello, World!\n");
  printf("Hi!, 123 == %d\n", 123);
#endif

  // Verify stdbool.h works.
  bool g = true;
  bool h = false;
#if __has_include(<stdio.h>)
  printf("bool true = %d, bool false = %d\n", (int)g, (int)h);
#endif

#ifdef HAS_MY_DEFINE
#if (__has_include(<stdio.h>))
  printf("HAS_MY_DEFINE is defined as %s\n", HAS_MY_DEFINE);
#endif
#endif

  return 42;
}
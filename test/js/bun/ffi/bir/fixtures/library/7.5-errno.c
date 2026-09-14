// C11 7.5 <errno.h>: errno is a modifiable lvalue of type int, one per thread, that library functions set.
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int *where(void) { return &errno; }

int main(void) {
  errno = 0;
  printf("%d %d\n", errno, _Generic(errno, int: 1, default: 0));
  errno = EDOM; errno++; errno -= 1;
  printf("%d %d %d\n", errno == EDOM, *where() == EDOM, where() == &errno);
  // The three values every implementation has are distinct and positive.
  printf("%d %d\n", EDOM > 0 && ERANGE > 0 && EILSEQ > 0, EDOM != ERANGE && ERANGE != EILSEQ && EDOM != EILSEQ);
#if EDOM > 0 && ERANGE > 0
  printf("usable in #if\n");
#endif
  // A library function sets it and leaves it alone on success.
  errno = 0;
  long big = strtol("999999999999999999999999", 0, 10);
  printf("%d %d\n", errno == ERANGE, big == LONG_MAX);
  errno = 0;
  long fine = strtol("42", 0, 10);
  printf("%d %ld %d\n", errno, fine, strerror(ERANGE) != 0 && strlen(strerror(ERANGE)) > 0);
  return 0;
}

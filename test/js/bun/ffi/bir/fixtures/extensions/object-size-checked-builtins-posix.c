// The checked forms of what POSIX adds to <string.h>: `__builtin___stpcpy_chk` and `__builtin___stpncpy_chk`, with sizes
// that are not known and sizes that are enough. (Microsoft's C library has neither function.)
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define UNKNOWN ((size_t)-1)

int main(void) {
  char buffer[64], other[64];
  volatile size_t sixty_four = 64; // (so that "enough" has to be found out when the program runs)
  memset(buffer, '#', sizeof buffer);
  memset(other, '#', sizeof other);

  CHECK(__builtin___stpcpy_chk(buffer, "end", UNKNOWN) == buffer + 3 && strcmp(buffer, "end") == 0);
  CHECK(__builtin___stpcpy_chk(buffer + 3, " of it", 61) == buffer + 9 && strcmp(buffer, "end of it") == 0);
  CHECK(__builtin___stpcpy_chk(other, "xy", sixty_four) == other + 2 && strcmp(other, "xy") == 0);
  // stpncpy fills up with zeros and points at the first of them, or past the end when there is none.
  CHECK(__builtin___stpncpy_chk(buffer, "abc", 6, UNKNOWN) == buffer + 3 && memcmp(buffer, "abc\0\0\0 i", 8) == 0);
  CHECK(__builtin___stpncpy_chk(buffer, "0123456789", 4, 64) == buffer + 4 && memcmp(buffer, "0123\0\0 i", 8) == 0);
  CHECK(__builtin___stpncpy_chk(other, "short", 8, sixty_four) == other + 5 && memcmp(other, "short\0\0\0", 8) == 0 && other[8] == '#');
#if defined __has_builtin
#if __has_builtin(__builtin___stpcpy_chk) && __has_builtin(__builtin___stpncpy_chk)
  CHECK(1);
#else
  CHECK(!"the builtins are announced");
#endif
#else
  CHECK(1);
#endif
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

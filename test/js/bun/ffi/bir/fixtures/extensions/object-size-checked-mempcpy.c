// `__builtin___mempcpy_chk`: mempcpy is memcpy that points past what it copied, and the GNU C library's alone.
#define _GNU_SOURCE
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define UNKNOWN ((size_t)-1)

int main(void) {
  char buffer[64];
  volatile size_t sixty_four = 64; // (so that "enough" has to be found out when the program runs)
  CHECK(__builtin___mempcpy_chk(buffer, "one", 3, UNKNOWN) == buffer + 3);
  CHECK(__builtin___mempcpy_chk(buffer + 3, ", two", 5, 61) == buffer + 8);
  CHECK(__builtin___mempcpy_chk(buffer + 8, ", three", 8, sixty_four) == buffer + 16 && strcmp(buffer, "one, two, three") == 0);
  CHECK(__builtin_mempcpy(buffer, "ONE", 3) == buffer + 3 && strcmp(buffer, "ONE, two, three") == 0);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

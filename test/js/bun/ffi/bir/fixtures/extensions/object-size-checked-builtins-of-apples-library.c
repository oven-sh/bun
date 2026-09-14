// `__builtin___strlcpy_chk`, `__builtin___strlcat_chk` and `__builtin___memccpy_chk`, which Clang has and GCC has not, for the
// functions Apple's headers check: BSD's bounded copies (the GNU C library has those only since 2.38, and no checking
// memccpy at all), so this runs where Apple's library is. (strlcpy and strlcat say how long the result would have been.)
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define UNKNOWN ((size_t)-1)

int main(void) {
  char buffer[16], other[16] = { '#', '#', '#', '#', '#', '#', '#', '#' };
  volatile size_t sixteen = 16; // (so that "enough" has to be found out when the program runs)
  CHECK(__builtin___strlcpy_chk(buffer, "copied", sizeof buffer, UNKNOWN) == 6 && strcmp(buffer, "copied") == 0);
  CHECK(__builtin___strlcpy_chk(buffer, "much too long to fit in there", sizeof buffer, 16) == 29 && strcmp(buffer, "much too long t") == 0);
  CHECK(__builtin___strlcpy_chk(buffer, "cut", 3, sixteen) == 3 && strcmp(buffer, "cu") == 0);
  CHECK(__builtin___strlcat_chk(buffer, "t and", sizeof buffer, UNKNOWN) == 7 && strcmp(buffer, "cut and") == 0);
  CHECK(__builtin___strlcat_chk(buffer, " pasted on", sizeof buffer, 16) == 17 && strcmp(buffer, "cut and pasted ") == 0);
  CHECK(__builtin___strlcat_chk(buffer, "!", sizeof buffer, sixteen) == 16 && strcmp(buffer, "cut and pasted ") == 0);
  // memccpy stops after the byte it was told to stop at, and says where; or copies all and says nothing.
  CHECK(__builtin___memccpy_chk(buffer, "key=value", '=', 9, UNKNOWN) == buffer + 4 && memcmp(buffer, "key=and", 7) == 0);
  CHECK(__builtin___memccpy_chk(buffer, "no such byte", '=', 12, 16) == NULL && memcmp(buffer, "no such byte", 12) == 0);
  CHECK(__builtin___memccpy_chk(other, "a,b", ',', 3, sixteen) == other + 2 && memcmp(other, "a,###", 5) == 0);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

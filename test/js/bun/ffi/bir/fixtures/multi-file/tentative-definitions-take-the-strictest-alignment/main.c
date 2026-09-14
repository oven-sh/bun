// An object that several files define tentatively is one object with the largest size and the strictest alignment any
// of them gives it, as a linker makes of a common symbol: a file may count on the alignment it declared. (The
// reference compilers need -fcommon to link this.)
#include <stdint.h>
#include <stdio.h>

char before_the_first;
char in_the_second_file[64];
char between;
_Alignas(32) char in_this_file[32];
char after;
char in_the_third_file[8];

int the_second_file_sees(void);
int the_third_file_sees(void);

int main(void) {
  printf("%d %d %d\n", (int)((uintptr_t)in_the_second_file % 64), (int)((uintptr_t)in_this_file % 32), (int)((uintptr_t)in_the_third_file % 128));
  printf("%d %d\n", the_second_file_sees(), the_third_file_sees());
  before_the_first = between = after = 0;
  return 0;
}

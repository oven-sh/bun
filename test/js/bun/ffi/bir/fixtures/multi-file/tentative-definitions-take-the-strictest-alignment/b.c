#include <stdint.h>
_Alignas(64) char in_the_second_file[64];
char in_this_file[32];
_Alignas(16) char in_the_third_file[8];
int the_second_file_sees(void) {
  return (int)((uintptr_t)in_the_second_file % 64 + (uintptr_t)in_this_file % 32 + (uintptr_t)in_the_third_file % 128);
}

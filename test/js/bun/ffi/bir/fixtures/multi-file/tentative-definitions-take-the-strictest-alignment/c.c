#include <stdint.h>
char in_the_second_file[64];
// (Larger here, stricter there.)
_Alignas(128) char in_the_third_file[256];
int the_third_file_sees(void) { in_the_third_file[255] = 1; return (int)((uintptr_t)in_the_second_file % 64 + (uintptr_t)in_the_third_file % 128); }

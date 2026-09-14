// C11 7.22.3.1: aligned_alloc. (Microsoft's library has none: its free could not release such a block.)
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
  for (size_t alignment = 16; alignment <= 4096; alignment *= 4) {
    unsigned char *block = aligned_alloc(alignment, alignment * 2);
    int usable = block != 0;
    if (block) { memset(block, 0xab, alignment * 2); usable = block[alignment * 2 - 1] == 0xab; }
    printf("%d %d %d\n", (int)alignment, block != 0 && (uintptr_t)block % alignment == 0, usable);
    free(block);
  }
  return 0;
}

#include <string.h>
#include "src/utils/huffman_utils.h"
// Returns the size (0: refused). out[i] = bits | value << 16.
int hf_build(int root_bits, const int* lens, int n, uint32_t* out, int cap) {
  HuffmanTables t;
  int size, i;
  if (!VP8LHuffmanTablesAllocate(cap, &t)) return -1;
  size = VP8LBuildHuffmanTable(&t, root_bits, lens, n);
  for (i = 0; i < size; ++i) out[i] = t.curr_segment->curr_table[i].bits | (uint32_t)t.curr_segment->curr_table[i].value << 16;
  VP8LHuffmanTablesDeallocate(&t);
  return size;
}

/* Locals whose alignment is more than the stack's, and more than their own size. */
#include <stdint.h>
#include <stdio.h>

static int misaligned(const void *p, uintptr_t by) { return (uintptr_t)p % by != 0; }

static int wide(void) {
  __attribute__((aligned(128))) char a[3] = { 1, 2, 3 };
  _Alignas(4096) int page = 7;
  _Alignas(64) double d = 1.5;
  return misaligned(a, 128) + misaligned(&page, 4096) + misaligned(&d, 64) + a[2] + page + (int)d;
}

static int smaller_than_their_alignment(void) {
  _Alignas(16) char c = 'c';
  char between = 1;
  _Alignas(16) int v[3] = { 1, 2, 3 };
  _Alignas(32) short s = 4;
  return misaligned(&c, 16) + misaligned(v, 16) + misaligned(&s, 32) + (c == 'c') + between + v[0] + v[1] + v[2] + s;
}

static int in_a_loop(int n) {
  int bad = 0;
  for (int i = 0; i < n; i++) {
    _Alignas(256) char block[i % 3 + 1];
    block[0] = (char)i;
    bad += misaligned(block, 256) + (block[0] != (char)i);
  }
  return bad;
}

int main(void) {
  printf("%d\n", wide());
  printf("%d\n", smaller_than_their_alignment());
  printf("%d\n", in_a_loop(10));
  return 0;
}

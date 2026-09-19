// A structure passed by value in memory is copied byte for byte: one that ends exactly where a mapping ends is
// passed without touching the page after it. Every size here is one the ABI passes in memory (over 16 bytes, or an
// odd size among many arguments), placed against an inaccessible page and passed to a function with code of its own,
// to one that is inlined, through a pointer to a function, and as the last of several arguments.
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>

#define SIZES(X) X(17) X(20) X(23) X(24) X(31) X(33) X(63) X(64) X(65) X(68) X(71) X(72) X(79) X(200) X(204) X(4095) X(4097) X(65536)

#define DECLARE(n)                                                                                                   \
  struct bytes_##n { unsigned char bytes[n]; };                                                                     \
  __attribute__((noinline)) static int ends_##n(struct bytes_##n s) { return s.bytes[0] + 256 * s.bytes[n - 1]; }   \
  static inline int inlined_ends_##n(struct bytes_##n s) { s.bytes[0] ^= 0; return s.bytes[0] + 256 * s.bytes[n - 1]; } \
  __attribute__((noinline)) static int after_six_##n(long a, long b, long c, long d, long e, long f, struct bytes_##n s) { return (int)(a + b + c + d + e + f) + s.bytes[0] + 256 * s.bytes[n - 1]; } \
  static int (*volatile pointer_to_ends_##n)(struct bytes_##n) = ends_##n;
SIZES(DECLARE)

// Small ones that go in memory because the registers are taken.
struct five { unsigned char bytes[5]; };
struct twelve { int words[3]; };
__attribute__((noinline)) static int small_in_memory(long a, long b, long c, long d, long e, long f, struct five five, struct twelve twelve) {
  return (int)(a + b + c + d + e + f) + five.bytes[0] + 256 * five.bytes[4] + twelve.words[0] + twelve.words[2];
}

int main(void) {
  const size_t readable = 1 << 17, guard = 1 << 16;
  unsigned char *mapping = mmap(0, readable + guard, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (mapping == MAP_FAILED || mprotect(mapping + readable, guard, PROT_NONE)) {
    puts("cannot set up the mapping");
    return 1;
  }
  unsigned char *end = mapping + readable;
#define USE(n)                                                                       \
  {                                                                                  \
    struct bytes_##n *object = (struct bytes_##n *)(end - n);                        \
    memset(object, 0x5a, n);                                                         \
    object->bytes[0] = 1;                                                            \
    object->bytes[n - 1] = 2;                                                        \
    printf("%d bytes: %d %d %d %d\n", n, ends_##n(*object), inlined_ends_##n(*object), pointer_to_ends_##n(*object), after_six_##n(1, 2, 3, 4, 5, 6, *object)); \
  }
  SIZES(USE)
  struct five *five = (struct five *)(end - sizeof(struct five));
  memset(five, 7, sizeof *five);
  struct twelve twelve = { { 10, 20, 30 } };
  printf("small ones: %d\n", small_in_memory(1, 2, 3, 4, 5, 6, *five, twelve));
  struct twelve *last = (struct twelve *)(end - sizeof(struct twelve));
  *last = twelve;
  printf("small ones: %d\n", small_in_memory(1, 2, 3, 4, 5, 6, *five, *last));
  return 0;
}

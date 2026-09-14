// A helper with a large local buffer, called on a rare path of a deeply recursive function, does not become part of
// that function's frame: the recursion would carry the buffer at every level and run out of stack. (A helper marked
// always_inline is the author's decision and is inlined whatever it holds, so that one is recursed around only a
// little.)
#include <stdio.h>
#include <string.h>

#define HELPER(name, size, attributes)                                        \
  attributes static int name(int n) {                                         \
    char buffer[size];                                                        \
    memset(buffer, n, sizeof buffer);                                         \
    return buffer[n & (size - 1)];                                            \
  }
HELPER(leaf_2048, 2048, )
HELPER(leaf_4096, 4096, )
HELPER(leaf_16384, 16384, )
HELPER(leaf_megabyte, 1048576, )
HELPER(leaf_inline_keyword, 16384, inline)
HELPER(leaf_forced, 4096, inline __attribute__((always_inline)))
HELPER(leaf_kept_out, 16384, __attribute__((noinline)))
static int through_another(int n) { return leaf_16384(n) + 1; }

#define RECURSION(name, helper)                                               \
  __attribute__((noinline)) static int name(int n) {                          \
    if (!n) return 0;                                                         \
    int extra = n % 1000 == 0 ? helper(n) : 0;                                \
    return extra + name(n - 1) + 1;                                           \
  }
RECURSION(around_2048, leaf_2048)
RECURSION(around_4096, leaf_4096)
RECURSION(around_16384, leaf_16384)
RECURSION(around_megabyte, leaf_megabyte)
RECURSION(around_inline_keyword, leaf_inline_keyword)
RECURSION(around_forced, leaf_forced)
RECURSION(around_kept_out, leaf_kept_out)
RECURSION(around_another, through_another)

// Two functions that call each other, the buffer in a third.
static int pong(int n);
__attribute__((noinline)) static int ping(int n) { return n ? pong(n - 1) + 1 : 0; }
static int pong(int n) { return n ? (n % 1000 == 1 ? leaf_16384(n) : 0) + ping(n - 1) + 1 : 0; }

// A helper whose buffer is a variable-length array is never inlined.
static int leaf_variable(int n) { char buffer[n % 7000 + 1]; memset(buffer, n, sizeof buffer); return buffer[0]; }
RECURSION(around_variable, leaf_variable)

int main(void) {
  printf("%d\n", around_2048(20000));
  printf("%d\n", around_4096(20000));
  printf("%d\n", around_16384(20000));
  printf("%d\n", around_megabyte(20000));
  printf("%d\n", around_inline_keyword(20000));
  printf("%d\n", around_forced(200));
  printf("%d\n", around_kept_out(20000));
  printf("%d\n", around_another(20000));
  printf("%d\n", ping(20000));
  printf("%d\n", around_variable(20000));
  return 0;
}

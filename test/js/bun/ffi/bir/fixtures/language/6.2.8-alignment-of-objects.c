// C11 6.2.8: every complete object type has an alignment; stricter ones can be asked for; addresses honour them.
#include <stdalign.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

struct mixed { char c; double d; short s; };
struct over { alignas(32) char bytes[3]; };
static alignas(64) char file_scope[5];
static alignas(double) char as_double[3];
static alignas(16) alignas(8) int strictest_wins;
static alignas(0) int zero_has_no_effect;

#define ALIGNED(object, to) ((uintptr_t)&(object) % (to) == 0)

int main(void) {
  // Alignments are powers of two, those of the character types are the weakest, max_align_t the strongest fundamental.
  size_t all[] = {alignof(char), alignof(short), alignof(int), alignof(long), alignof(long long), alignof(float), alignof(double), /* long: any width */
                  alignof(long double), alignof(void *), alignof(max_align_t), alignof(struct mixed), alignof(struct over)};
  int powers = 1, ordered = 1;
  for (size_t i = 0; i < sizeof all / sizeof all[0]; i++) powers &= all[i] != 0 && (all[i] & (all[i] - 1)) == 0;
  ordered &= alignof(char) == 1 && alignof(char) == alignof(signed char) && alignof(char) == alignof(unsigned char);
  ordered &= alignof(max_align_t) >= alignof(long long) && alignof(max_align_t) >= alignof(double) && alignof(max_align_t) >= alignof(void *);
  printf("%d %d\n", powers, ordered);
  // A structure is as aligned as its strictest member, and its size is a multiple of that.
  printf("%d %d %d\n", alignof(struct mixed) == alignof(double), sizeof(struct mixed) % alignof(struct mixed) == 0, (int)offsetof(struct mixed, d) % (int)alignof(double) == 0);
  printf("%d %d\n", (int)alignof(struct over), (int)sizeof(struct over));
  // An array has the alignment of its elements; a qualified type that of the unqualified one.
  printf("%d %d\n", alignof(int[7]) == alignof(int), alignof(const volatile double) == alignof(double));
  // Objects are where their alignment says, whatever their storage duration.
  alignas(128) char local[3];
  alignas(16) int local_int = 5;
  static alignas(32) short in_block_static;
  struct over member;
  printf("%d %d %d %d %d %d\n", ALIGNED(file_scope, 64), ALIGNED(as_double, alignof(double)), ALIGNED(strictest_wins, 16), ALIGNED(local, 128),
         ALIGNED(local_int, 16), ALIGNED(in_block_static, 32));
  printf("%d %d %d\n", ALIGNED(member, 32), ALIGNED(zero_has_no_effect, alignof(int)), local_int);
  // alignas with a type means the alignment of that type.
  alignas(long long) char buffer[sizeof(long long)];
  *(long long *)buffer = 1234567890123LL;
  printf("%lld\n", *(long long *)buffer);
  return 0;
}

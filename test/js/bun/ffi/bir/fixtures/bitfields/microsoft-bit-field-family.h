// The body of the two Microsoft bit-field fixtures: a family of structures whose layout is printed as found at
// run time (each member is set to all ones in a zeroed object, and the bits that came on are located). The file
// that includes this one defines MS: `__attribute__((ms_struct))` where the layout is asked for, nothing on Windows.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static void where(const char *name, const void *object, size_t size) {
  const unsigned char *bytes = object;
  long first = -1, count = 0;
  for (size_t bit = 0; bit < size * 8; bit++) {
    if (bytes[bit / 8] >> (bit % 8) & 1) {
      if (first < 0) first = (long)bit;
      count++;
    }
  }
  printf("  %s: %ld bits at %ld\n", name, count, first);
}
#define STRUCT(T) printf(#T ": %zu bytes, aligned to %zu\n", sizeof(T), _Alignof(T))
#define MEMBER(T, member)       \
  do {                          \
    T v;                        \
    memset(&v, 0, sizeof v);    \
    v.member = -1;              \
    where(#member, &v, sizeof v); \
  } while (0)

enum small { ZERO, ONE, TWO, THREE };

// Neighbours share a storage unit when their types have one size, whatever the types are.
struct MS same_type { int a : 3; int b : 4; int c : 25; int d : 1; };
struct MS same_size { unsigned char a : 1; _Bool b : 1; signed char c : 6; char d : 1; };
struct MS signed_and_unsigned { int a : 10; unsigned b : 10; enum small c : 10; int32_t d : 3; };
// A type of another size starts a unit, aligned for it.
struct MS sizes_change { signed char a : 3; int b : 4; char c : 2; short d : 5; short e : 11; long long f : 1; };
struct MS narrow_then_wide { signed char a : 1; long long b : 1; signed char c : 1; };
struct MS does_not_fit { int a : 30; int b : 4; int c : 28; int d : 4; };
struct MS whole_units { char a : 8; short b : 16; int c : 32; long long d : 64; };
struct MS after_members { char c; int a : 3; char d; short b : 3; int e; long long f : 5; };
struct MS then_members { int a : 3; char c; int b : 3; short d; };
// A zero-width bit-field ends the unit of the bit-field before it, and is nothing anywhere else.
struct MS zero_width { int a : 3; int : 0; int b : 3; };
struct MS zero_width_of_another_type { int a : 3; char : 0; int b : 3; short c : 1; long long : 0; short d : 1; };
struct MS zero_width_after_a_member { char c; int : 0; char d; long long : 0; char e; };
struct MS zero_width_first { int : 0; char c; };
struct MS zero_width_twice { char a : 1; int : 0; long long : 0; char b : 1; };
struct MS zero_width_last { char a : 1; long long : 0; };
struct MS unnamed_bits { int a : 3; int : 7; int b : 3; char : 3; char c : 2; };
// Unions: each bit-field is a whole unit at the start, and adds nothing to the alignment.
union MS only_bits { int a : 3; char b : 2; };
union MS wide_bits { char c; long long a : 3; };
union MS bits_and_members { short s; int a : 17; char b : 2; };
union MS zero_width_in_a_union { char a : 3; int : 0; };
// #pragma pack limits the alignment of a unit, not its size.
#pragma pack(push, 1)
struct MS packed_to_1 { char c; int a : 3; int b : 4; short d : 3; long long e : 40; signed char f : 1; };
struct MS packed_to_1_with_zero_width { char c; int a : 3; int : 0; char d; };
#pragma pack(pop)
#pragma pack(push, 2)
struct MS packed_to_2 { char c; int a : 3; long long b : 4; char d : 3; int e; };
#pragma pack(pop)
#pragma pack(push, 4)
struct MS packed_to_4 { char c; long long a : 3; char d; long long b : 60; long long e : 5; };
#pragma pack(pop)
#pragma pack(push, 8)
struct MS packed_to_8 { char c; long long a : 3; short b : 3; };
#pragma pack(pop)
// An alignment written on a bit-field is that of its unit.
struct MS aligned_bits { char c; char a : 3 __attribute__((aligned(4))); char b : 3; };
struct MS aligned_whole { char a : 3; int b : 3; } __attribute__((aligned(16)));
// Inside other things.
struct MS outer { char c; struct same_size inner; struct sizes_change more; short s : 3; };
struct MS array_of { struct narrow_then_wide three[3]; char last : 1; };
struct MS anonymous { int a : 3; struct MS { int b : 3; char c : 3; }; union MS { int d : 5; short e; }; int f : 3; };
// The System V layout, asked for by name: what these structures are without MS, and on Windows what MinGW's GCC
// gives for the attribute. (Clang does not know it.)
struct __attribute__((gcc_struct)) the_other_layout { char a : 3; int b : 4; char c : 2; short d : 5; long long e : 1; };

#ifdef MS_PRAGMA
#pragma ms_struct on
struct by_pragma { char a : 3; int b : 4; char c : 2; };
#pragma ms_struct off
struct after_the_pragma { char a : 3; int b : 4; char c : 2; };
#endif

static void layouts(void) {
  STRUCT(struct same_type); MEMBER(struct same_type, a); MEMBER(struct same_type, b); MEMBER(struct same_type, c); MEMBER(struct same_type, d);
  STRUCT(struct same_size); MEMBER(struct same_size, a); MEMBER(struct same_size, b); MEMBER(struct same_size, c); MEMBER(struct same_size, d);
  STRUCT(struct signed_and_unsigned); MEMBER(struct signed_and_unsigned, a); MEMBER(struct signed_and_unsigned, b); MEMBER(struct signed_and_unsigned, c); MEMBER(struct signed_and_unsigned, d);
  STRUCT(struct sizes_change); MEMBER(struct sizes_change, a); MEMBER(struct sizes_change, b); MEMBER(struct sizes_change, c); MEMBER(struct sizes_change, d); MEMBER(struct sizes_change, e); MEMBER(struct sizes_change, f);
  STRUCT(struct narrow_then_wide); MEMBER(struct narrow_then_wide, a); MEMBER(struct narrow_then_wide, b); MEMBER(struct narrow_then_wide, c);
  STRUCT(struct does_not_fit); MEMBER(struct does_not_fit, a); MEMBER(struct does_not_fit, b); MEMBER(struct does_not_fit, c); MEMBER(struct does_not_fit, d);
  STRUCT(struct whole_units); MEMBER(struct whole_units, a); MEMBER(struct whole_units, b); MEMBER(struct whole_units, c); MEMBER(struct whole_units, d);
  STRUCT(struct after_members); MEMBER(struct after_members, c); MEMBER(struct after_members, a); MEMBER(struct after_members, d); MEMBER(struct after_members, b); MEMBER(struct after_members, e); MEMBER(struct after_members, f);
  STRUCT(struct then_members); MEMBER(struct then_members, a); MEMBER(struct then_members, c); MEMBER(struct then_members, b); MEMBER(struct then_members, d);
  STRUCT(struct zero_width); MEMBER(struct zero_width, a); MEMBER(struct zero_width, b);
  STRUCT(struct zero_width_of_another_type); MEMBER(struct zero_width_of_another_type, a); MEMBER(struct zero_width_of_another_type, b); MEMBER(struct zero_width_of_another_type, c); MEMBER(struct zero_width_of_another_type, d);
  STRUCT(struct zero_width_after_a_member); MEMBER(struct zero_width_after_a_member, c); MEMBER(struct zero_width_after_a_member, d); MEMBER(struct zero_width_after_a_member, e);
  STRUCT(struct zero_width_first); MEMBER(struct zero_width_first, c);
  STRUCT(struct zero_width_twice); MEMBER(struct zero_width_twice, a); MEMBER(struct zero_width_twice, b);
  STRUCT(struct zero_width_last); MEMBER(struct zero_width_last, a);
  STRUCT(struct unnamed_bits); MEMBER(struct unnamed_bits, a); MEMBER(struct unnamed_bits, b); MEMBER(struct unnamed_bits, c);
  STRUCT(union only_bits); MEMBER(union only_bits, a); MEMBER(union only_bits, b);
  STRUCT(union wide_bits); MEMBER(union wide_bits, c); MEMBER(union wide_bits, a);
  STRUCT(union bits_and_members); MEMBER(union bits_and_members, s); MEMBER(union bits_and_members, a); MEMBER(union bits_and_members, b);
  STRUCT(union zero_width_in_a_union); MEMBER(union zero_width_in_a_union, a);
  STRUCT(struct packed_to_1); MEMBER(struct packed_to_1, c); MEMBER(struct packed_to_1, a); MEMBER(struct packed_to_1, b); MEMBER(struct packed_to_1, d); MEMBER(struct packed_to_1, e); MEMBER(struct packed_to_1, f);
  STRUCT(struct packed_to_1_with_zero_width); MEMBER(struct packed_to_1_with_zero_width, c); MEMBER(struct packed_to_1_with_zero_width, a); MEMBER(struct packed_to_1_with_zero_width, d);
  STRUCT(struct packed_to_2); MEMBER(struct packed_to_2, c); MEMBER(struct packed_to_2, a); MEMBER(struct packed_to_2, b); MEMBER(struct packed_to_2, d); MEMBER(struct packed_to_2, e);
  STRUCT(struct packed_to_4); MEMBER(struct packed_to_4, c); MEMBER(struct packed_to_4, a); MEMBER(struct packed_to_4, d); MEMBER(struct packed_to_4, b); MEMBER(struct packed_to_4, e);
  STRUCT(struct packed_to_8); MEMBER(struct packed_to_8, c); MEMBER(struct packed_to_8, a); MEMBER(struct packed_to_8, b);
  STRUCT(struct aligned_bits); MEMBER(struct aligned_bits, c); MEMBER(struct aligned_bits, a); MEMBER(struct aligned_bits, b);
  STRUCT(struct aligned_whole); MEMBER(struct aligned_whole, a); MEMBER(struct aligned_whole, b);
  STRUCT(struct outer); MEMBER(struct outer, c); MEMBER(struct outer, inner.c); MEMBER(struct outer, more.f); MEMBER(struct outer, s);
  STRUCT(struct array_of); MEMBER(struct array_of, three[2].c); MEMBER(struct array_of, last);
  STRUCT(struct anonymous); MEMBER(struct anonymous, a); MEMBER(struct anonymous, b); MEMBER(struct anonymous, c); MEMBER(struct anonymous, d); MEMBER(struct anonymous, e); MEMBER(struct anonymous, f);
  STRUCT(struct the_other_layout); MEMBER(struct the_other_layout, a); MEMBER(struct the_other_layout, b); MEMBER(struct the_other_layout, c); MEMBER(struct the_other_layout, d); MEMBER(struct the_other_layout, e);
#ifdef MS_PRAGMA
  STRUCT(struct by_pragma); MEMBER(struct by_pragma, a); MEMBER(struct by_pragma, b); MEMBER(struct by_pragma, c);
  STRUCT(struct after_the_pragma); MEMBER(struct after_the_pragma, a); MEMBER(struct after_the_pragma, b); MEMBER(struct after_the_pragma, c);
#endif
}

// The values: a plain `int` bit-field is signed, and everything wraps to its width.
__attribute__((noinline)) static void store(struct signed_and_unsigned *p, int x) {
  p->a = x, p->b = (unsigned)x, p->c = (enum small)(x & 3), p->d = x;
}
__attribute__((noinline)) static long long sum(const struct sizes_change *p) { return p->a + p->b * 10 + p->c * 100 + p->d * 1000 + p->e * 10000LL + p->f * 100000000LL; }
static struct sizes_change initialized = {-4, 7, 1, -16, 1023, -1};
static struct zero_width_of_another_type also_initialized = {.b = -3, .d = -1, .a = 2};

static void values(void) {
  struct signed_and_unsigned v;
  memset(&v, 0, sizeof v);
  store(&v, 1023);
  printf("1023: %d %u %d\n", v.a, v.b, v.d);
  store(&v, -513);
  printf("-513: %d %u %d\n", v.a, v.b, v.d);
  store(&v, 511);
  v.a++, v.b += 600, v.d -= 8;
  printf("511 and then: %d %u %d\n", v.a, v.b, v.d);
  printf("sum: %lld\n", sum(&initialized));
  initialized.e = -1, initialized.b += 3, initialized.f = 0;
  printf("sum: %lld\n", sum(&initialized));
  printf("initialized: %d %d %d %d\n", also_initialized.a, also_initialized.b, also_initialized.c, also_initialized.d);
  struct packed_to_1 p = {'x', -1, 5, -2, -549755813888LL, -1}, q = p;
  q.e += 1, q.a = 2, q.f = 0;
  printf("packed: %c %d %d %d %lld %d then %d %lld %d\n", p.c, p.a, p.b, p.d, p.e, p.f, q.a, q.e, q.f);
  struct anonymous n = {.a = 3, .b = -4, .c = 2, .e = -2, .f = -1};
  printf("anonymous: %d %d %d %d %d\n", n.a, n.b, n.c, n.e, n.f);
  union bits_and_members u = {.s = -1};
  u.a = 0x12345;
  printf("union: %d %d %d\n", u.a, u.b, u.s);
  struct array_of many = {{{1, -1, 0}, {0, 0, -1}, {-1, 0, 0}}, -1};
  printf("array: %d %d %d %d %d\n", many.three[0].a, many.three[0].b, many.three[1].c, many.three[2].a, many.last);
}

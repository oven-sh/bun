// The corners of structure layout where GCC and Clang agree with each other and the System V rules are easy to get
// wrong: a zero-width bit-field at the end, `aligned` on a bit-field, `#pragma pack` together with `packed` and with an
// alignment written on a member, and `packed` on an enumeration.
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define SIZE_ALIGN(t, size, align) (sizeof(t) == (size) && _Alignof(t) == (align))
// Where a bit-field is: the first byte that changes when all its bits are set.
#define FIRST_BYTE(type, field) first_byte(&(type){ .field = -1 }, sizeof(type))
static int first_byte(const void *object, size_t size) {
  const unsigned char *bytes = object;
  for (size_t i = 0; i < size; i++) if (bytes[i]) return (int)i;
  return -1;
}

// 1. A zero-width bit-field ends the unit it is in, at the end of the structure too.
struct zw_end_long { char f0; short f1; long long : 0; };
struct zw_end_bool { _Bool f0; long long : 0; };
struct zw_end_int { signed char f0 : 8; int : 0; };
struct zw_middle { char f0; int : 0; char f1; };
struct zw_after_member { int f0; char f1; short : 0; };
union zw_union { char f0; long long : 0; };
struct zw_only { int : 0; };

// 2. `aligned` on a bit-field says where it starts, which may be less than its type asks for.
struct al_lower { unsigned short f0; long long f1 : 2 __attribute__((aligned(4))); signed char f2 : 4; };
struct al_one { unsigned short f0; unsigned long long f1 : 12 __attribute__((aligned(1))); };
struct al_raise { char f0; int f1 : 12 __attribute__((aligned(8))); char f2; };
struct al_same { char f0; int f1 : 5 __attribute__((aligned(4))); int f2 : 5; };

// 3. While `#pragma pack` is in force it, not `packed`, says how a bit-field's type aligns the structure.
#pragma pack(push, 2)
struct __attribute__((packed)) pp_2 { signed char f0 : 3; unsigned long f1 : 21; };
struct pp_2_plain { signed char f0 : 3; unsigned long f1 : 21; };
struct __attribute__((packed)) pp_2_member { char c; long l; };
#pragma pack(pop)
#pragma pack(push, 1)
struct __attribute__((packed)) pp_1 { char c; int f : 9; };
#pragma pack(pop)
#pragma pack(push, 4)
struct __attribute__((packed)) pp_4 { char f0 : 2; long long f1 : 40; };
#pragma pack(pop)
struct __attribute__((packed)) only_packed { signed char f0 : 3; unsigned long f1 : 21; };

// 4. `#pragma pack` holds an alignment written on a member to its limit; it does not cancel it.
#pragma pack(push, 16)
struct pk16_alignas { char c; _Alignas(64) void *p; };
#pragma pack(pop)
#pragma pack(push, 4)
struct __attribute__((packed)) pk4_packed { char c; _Bool b __attribute__((aligned(16))); char e; };
struct pk4_member { char c; double d __attribute__((aligned(8))); };
struct pk4_array { char c; short a[3] __attribute__((aligned(16))); };
struct pk4_below { char c; short s __attribute__((aligned(2))); };
#pragma pack(pop)
#pragma pack(push, 1)
struct pk1_member { char c; int i __attribute__((aligned(8))); };
#pragma pack(pop)
struct no_pack { char c; _Alignas(64) void *p; };

// 5. A packed enumeration takes the narrowest type that holds its enumerators.
enum __attribute__((packed)) small { SMALL_A = 1 };
enum __attribute__((packed)) medium { MEDIUM_A = 300 };
enum __attribute__((packed)) signed_small { SS_A = -1, SS_B = 127 };
enum __attribute__((packed)) signed_medium { SM_A = -1, SM_B = 128 };
enum __attribute__((packed)) wide { WIDE_A = 70000 };
enum __attribute__((packed)) very_wide { VW_A = 0x100000000 };
enum after_brace { AFTER_A = 5 } __attribute__((packed));
enum plain { PLAIN_A = 1 };
struct holds_packed { enum small a; enum medium b; enum small c[3]; };

int main(void) {
  CHECK(SIZE_ALIGN(struct zw_end_long, 8, 2) && SIZE_ALIGN(struct zw_end_bool, 8, 1) && SIZE_ALIGN(struct zw_end_int, 4, 1));
  CHECK(SIZE_ALIGN(struct zw_middle, 5, 1) && offsetof(struct zw_middle, f1) == 4 && SIZE_ALIGN(struct zw_after_member, 8, 4));
  CHECK(SIZE_ALIGN(union zw_union, 1, 1) && SIZE_ALIGN(struct zw_only, 0, 1));

  CHECK(SIZE_ALIGN(struct al_lower, 8, 8) && FIRST_BYTE(struct al_lower, f1) == 4 && FIRST_BYTE(struct al_lower, f2) == 4);
  CHECK(SIZE_ALIGN(struct al_one, 8, 8) && FIRST_BYTE(struct al_one, f1) == 2);
  CHECK(SIZE_ALIGN(struct al_raise, 16, 8) && FIRST_BYTE(struct al_raise, f1) == 8 && offsetof(struct al_raise, f2) == 10);
  CHECK(SIZE_ALIGN(struct al_same, 8, 4) && FIRST_BYTE(struct al_same, f1) == 4 && FIRST_BYTE(struct al_same, f2) == 4);

  CHECK(SIZE_ALIGN(struct pp_2, 4, 2) && FIRST_BYTE(struct pp_2, f1) == 0 && SIZE_ALIGN(struct pp_2_plain, 4, 2));
  CHECK(SIZE_ALIGN(struct pp_2_member, 9, 1) && offsetof(struct pp_2_member, l) == 1);
  CHECK(SIZE_ALIGN(struct pp_1, 3, 1) && SIZE_ALIGN(struct pp_4, 8, 4) && FIRST_BYTE(struct pp_4, f1) == 0);
  CHECK(SIZE_ALIGN(struct only_packed, 3, 1));

  CHECK(SIZE_ALIGN(struct pk16_alignas, 32, 16) && offsetof(struct pk16_alignas, p) == 16);
  CHECK(SIZE_ALIGN(struct pk4_packed, 8, 4) && offsetof(struct pk4_packed, b) == 4 && offsetof(struct pk4_packed, e) == 5);
  CHECK(SIZE_ALIGN(struct pk4_member, 12, 4) && offsetof(struct pk4_member, d) == 4);
  CHECK(SIZE_ALIGN(struct pk4_array, 12, 4) && offsetof(struct pk4_array, a) == 4 && SIZE_ALIGN(struct pk4_below, 4, 2) && offsetof(struct pk4_below, s) == 2);
  CHECK(SIZE_ALIGN(struct pk1_member, 5, 1) && offsetof(struct pk1_member, i) == 1);
  CHECK(SIZE_ALIGN(struct no_pack, 128, 64) && offsetof(struct no_pack, p) == 64);

  CHECK(sizeof(enum small) == 1 && (enum small)-1 > 0 && sizeof(enum medium) == 2 && (enum medium)-1 > 0);
  CHECK(sizeof(enum signed_small) == 1 && (enum signed_small)-1 < 0 && sizeof(enum signed_medium) == 2 && (enum signed_medium)-1 < 0);
  CHECK(sizeof(enum wide) == 4 && sizeof(enum very_wide) == 8 && sizeof(enum after_brace) == 1 && sizeof(enum plain) == 4);
  CHECK(sizeof(SMALL_A) == 4 && sizeof(MEDIUM_A) == 4 && sizeof(VW_A) == 8 && SS_A == -1);
  CHECK(SIZE_ALIGN(struct holds_packed, 8, 2) && offsetof(struct holds_packed, b) == 2 && offsetof(struct holds_packed, c) == 4);
  enum medium object = MEDIUM_A;
  enum signed_small negative = SS_A;
  CHECK(object == 300 && negative == -1 && negative < 0 && (object = (enum medium)70000) == 4464);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

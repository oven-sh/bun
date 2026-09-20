// Microsoft C: every enumeration is an int and so is every enumerator, whatever value was written for it; the value is
// reduced to 32 bits. (Clang's Microsoft mode is the reference: every check below is also a static assertion there.)
int printf(const char *, ...);

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#ifdef VERIFY_AS_STATIC_ASSERTIONS
#define CHECK(c) _Static_assert(c, #c)
#else
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)
#endif

#define IS_SIGNED(x) ((__typeof__(x))-1 < 0)
#define IS_INT(x) _Generic((x), int: 1, default: 0)

enum beyond_int { BI_A = 1, BI_B = 0xFFFFFFFF };
enum after_int_max { AM_A = 0x7FFFFFFF, AM_B };
enum negative_and_beyond { NB_A = -1, NB_B = 0x80000000 };
enum beyond_uint { BU_A = 0x100000001, BU_B = 1 };
enum every_bit { EB_A = 0xFFFFFFFFFFFFFFFFULL };
enum events { EV_IN = 1, EV_ET = 1u << 31, EV_BIG = 1LL << 40, EV_NEG = -5 };
enum fixed_small : unsigned char { FS_A = 1, FS_B = 255 };
enum __attribute__((packed)) packed_small { PS_A = 1 };

int main(void) {
  CHECK(sizeof(BI_A) == 4 && sizeof(BI_B) == 4 && IS_INT(BI_A) && IS_INT(BI_B) && sizeof(enum beyond_int) == 4 && IS_SIGNED(enum beyond_int));
  CHECK(BI_B == -1 && BI_B < 0 && BI_A - 2 < 0);
  CHECK(IS_INT(AM_A) && IS_INT(AM_B) && AM_B < 0 && AM_B == -2147483647 - 1);
  CHECK(sizeof(NB_A) == 4 && sizeof(NB_B) == 4 && IS_INT(NB_B) && NB_B < NB_A && sizeof(enum negative_and_beyond) == 4);
  CHECK(sizeof(BU_A) == 4 && IS_INT(BU_A) && BU_A == 1 && BU_A == BU_B);
  CHECK(sizeof(EB_A) == 4 && IS_INT(EB_A) && EB_A == -1 && sizeof(enum every_bit) == 4);
  CHECK(sizeof(EV_IN) == 4 && sizeof(EV_ET) == 4 && sizeof(EV_BIG) == 4 && sizeof(EV_NEG) == 4 && sizeof(enum events) == 4);
  CHECK(EV_ET < 0 && EV_BIG == 0 && EV_NEG == -5 && IS_INT(EV_ET) && IS_INT(EV_BIG));
  CHECK(sizeof(enum packed_small) == 4 && sizeof(PS_A) == 4 && IS_SIGNED(enum packed_small));
  CHECK(sizeof(FS_A) == 1 && sizeof(enum fixed_small) == 1 && FS_B == 255 && !IS_SIGNED(enum fixed_small));
#ifndef VERIFY_AS_STATIC_ASSERTIONS
  printf("%d checks, %d wrong\n", checks, wrong);
#endif
  return wrong != 0;
}

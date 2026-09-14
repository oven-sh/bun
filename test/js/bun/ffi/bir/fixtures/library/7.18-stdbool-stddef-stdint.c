// C11 7.18 <stdbool.h>, 7.19 <stddef.h>, 7.20 <stdint.h>: the macros and types the compiler's own headers define.
#include <limits.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

#if true && !false && __bool_true_false_are_defined
static const char *in_the_preprocessor = "true and false work in #if";
#endif

struct record { char tag; double value; char text[5]; struct { short a, b; } inner; };
static int checks, wrong;
#define CHECK(c) do { checks++; if (!(c)) { wrong++; printf("WRONG: %s\n", #c); } } while (0)
#define IS(x, T) _Generic((x), T: 1, default: 0)
#define SIGNED(T) ((T)-1 < 0)
#define EXACT(bits) \
  CHECK(sizeof(int##bits##_t) * CHAR_BIT == bits && SIGNED(int##bits##_t) && !SIGNED(uint##bits##_t) && sizeof(uint##bits##_t) * CHAR_BIT == bits); \
  CHECK(INT##bits##_MAX == (int##bits##_t)(UINT##bits##_MAX >> 1) && INT##bits##_MIN == -INT##bits##_MAX - 1 && (uint##bits##_t)-1 == UINT##bits##_MAX); \
  CHECK(sizeof(int_least##bits##_t) * CHAR_BIT >= bits && sizeof(int_fast##bits##_t) * CHAR_BIT >= bits && SIGNED(int_least##bits##_t) && !SIGNED(uint_fast##bits##_t)); \
  CHECK(INT_LEAST##bits##_MAX >= INT##bits##_MAX && INT_FAST##bits##_MIN <= INT##bits##_MIN && UINT_LEAST##bits##_MAX >= UINT##bits##_MAX && UINT_FAST##bits##_MAX >= UINT##bits##_MAX); \
  CHECK(IS(INT##bits##_C(1), int_least##bits##_t) || sizeof(INT##bits##_C(1)) >= sizeof(int_least##bits##_t)); \
  CHECK(UINT##bits##_C(1) > 0 && (UINT##bits##_C(0) - 1 > 0 || bits < 32))

int main(void) {
  printf("%s\n", in_the_preprocessor);
  bool yes = true, no = false, from_number = 42, from_pointer = &yes;
  CHECK(sizeof(bool) == sizeof(_Bool) && IS(yes, _Bool) && yes == 1 && no == 0 && from_number == 1 && from_pointer == 1);
  CHECK(IS(true, int) || IS(true, _Bool));     // (int in C11, the type itself from C23 on)
  yes++; CHECK(yes == 1);
  // <stddef.h>
  int array[4];
  CHECK(IS(sizeof 0, size_t) && !SIGNED(size_t) && IS(&array[3] - &array[0], ptrdiff_t) && SIGNED(ptrdiff_t));
  CHECK(sizeof(size_t) == sizeof(void *) && sizeof(ptrdiff_t) == sizeof(void *) && NULL == 0 && !NULL);
  CHECK(_Alignof(max_align_t) >= _Alignof(long double) && _Alignof(max_align_t) >= _Alignof(long long) && _Alignof(max_align_t) >= _Alignof(void *));
  CHECK(IS(L'x', wchar_t) && sizeof(wchar_t) >= 2);
  CHECK(offsetof(struct record, tag) == 0 && offsetof(struct record, value) == _Alignof(double) && offsetof(struct record, text[2]) == offsetof(struct record, text) + 2);
  CHECK(offsetof(struct record, inner.b) == offsetof(struct record, inner) + sizeof(short) && IS(offsetof(struct record, inner), size_t));
  enum { CONSTANT = offsetof(struct record, inner) };
  static char sized[offsetof(struct record, text) + 1];
  CHECK(CONSTANT > 0 && sizeof sized > 1);
  // <stdint.h>
  EXACT(8); EXACT(16); EXACT(32); EXACT(64);
  CHECK(sizeof(intptr_t) == sizeof(void *) && SIGNED(intptr_t) && !SIGNED(uintptr_t) && (void *)(uintptr_t)(void *)array == (void *)array);
  CHECK(INTPTR_MAX == (intptr_t)(UINTPTR_MAX >> 1) && INTPTR_MIN == -INTPTR_MAX - 1 && PTRDIFF_MAX == INTPTR_MAX && SIZE_MAX == UINTPTR_MAX);
  CHECK(sizeof(intmax_t) >= sizeof(long long) && INTMAX_MAX >= LLONG_MAX && UINTMAX_MAX >= ULLONG_MAX && INTMAX_MIN <= LLONG_MIN);
  CHECK(IS(INTMAX_C(1), intmax_t) && IS(UINTMAX_C(1), uintmax_t) && INTMAX_C(9223372036854775807) == INTMAX_MAX);
  CHECK(WCHAR_MAX > WCHAR_MIN && WCHAR_MAX >= 65535 && SIG_ATOMIC_MAX > SIG_ATOMIC_MIN && WINT_MAX > WINT_MIN);
#if INT32_MAX == 2147483647 && UINT64_MAX == 18446744073709551615u && INT64_MIN < 0 && SIZE_MAX >= 65535
  CHECK(1);
#else
  CHECK(!"the limits work in #if");
#endif
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

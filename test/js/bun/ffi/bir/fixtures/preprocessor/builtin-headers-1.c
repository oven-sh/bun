#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include <limits.h>
#include <float.h>
#include <stdalign.h>
#include <stdnoreturn.h>
#include <iso646.h>
#include <stdarg.h>

         struct S { char c; int64_t v; };
         int sizes(void) { return sizeof(int8_t) + sizeof(int16_t) * 10 + sizeof(uint32_t) * 100 + sizeof(int64_t) * 1000 + sizeof(uintptr_t) * 10000 + sizeof(intmax_t) * 100000 + sizeof(size_t) * 1000000 + (sizeof(wchar_t) == sizeof(L'x')) * 40000000; }
         int limits(void) { return (INT_MAX == 2147483647) + (INT_MIN == -2147483647 - 1) + (UINT_MAX == 4294967295u) + (LONG_MAX == (sizeof(long) == 8 ? 9223372036854775807LL : 2147483647LL)) + (CHAR_BIT == 8) + (SCHAR_MIN == -128) + (UCHAR_MAX == 255) + (SHRT_MAX == 32767) + (LLONG_MIN < 0) + (ULLONG_MAX == 18446744073709551615ULL) + (CHAR_MIN < 0); }
         int stdint_limits(void) { return (INT8_MIN == -128) + (UINT16_MAX == 65535) + (INT32_MAX == 2147483647) + (INT64_MIN == -9223372036854775807LL - 1) + (UINT64_MAX == 18446744073709551615ull) + (SIZE_MAX == UINT64_MAX) + (INTPTR_MIN < 0) + (UINT64_C(1) << 40 == 1099511627776) + (sizeof(INT64_C(1)) == 8) + (PTRDIFF_MAX == INT64_MAX); }
         int misc(void) { bool t = true; return offsetof(struct S, v) + (NULL == 0) + t + (not false) + alignof(double) * 100 + (FLT_DIG == 6) + (DBL_MANT_DIG == 53) + (DBL_MAX > 1e300) + (FLT_EPSILON < 1e-6f) + (1 and 1) + (5 bitand 4); }
         noreturn void die(void);
         alignas(32) static char buffer[3];
         int aligned(void) { return (int)((uintptr_t)buffer % 32); }
         int takes_va_list(const char *fmt, va_list ap);

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sizes());
  printf("%d\n", (int)limits());
  printf("%d\n", (int)stdint_limits());
  printf("%d\n", (int)misc());
  printf("%d\n", (int)aligned());
  return 0;
}

// __has_include, __has_builtin, __has_attribute and the others; and the predefined macros that describe the
// target, checked against what the compiler actually does.
#include <limits.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>

static int wrong;
#define CHECK(c) do { if (!(c)) { wrong++; printf("WRONG (line %d): %s\n", __LINE__, #c); } } while (0)

#if !defined __has_include || !defined __has_builtin || !defined __has_attribute
#error the __has_ queries are macros that are defined
#endif
#if !__has_include(<stdio.h>) || !__has_include("has-queries-and-predefined-macros.c") || __has_include(<no/such/header.h>) || __has_include("no-such-file.h")
#error __has_include
#endif
#if defined __has_include_next
#if __has_include_next(<no/such/header.h>)
#error __has_include_next
#endif
#endif
#if !__has_builtin(__builtin_expect) || !__has_builtin(__builtin_memcpy) || !__has_builtin(__builtin_bswap32) || __has_builtin(__builtin_no_such_thing_at_all)
#error __has_builtin
#endif
#if !__has_attribute(aligned) || !__has_attribute(packed) || !__has_attribute(__unused__) || __has_attribute(no_such_attribute_at_all)
#error __has_attribute
#endif
#if defined __has_feature && defined __has_extension
#if __has_feature(no_such_feature_at_all) || __has_extension(no_such_extension_at_all)
#error __has_feature and __has_extension say no to what nobody has
#endif
#endif
#if defined __has_c_attribute
#if __has_c_attribute(no_such::attribute)
#error __has_c_attribute
#endif
#endif

int main(void) {
  // The sizes and limits the preprocessor announces are the ones the types have.
  CHECK(__CHAR_BIT__ == CHAR_BIT && __SCHAR_MAX__ == SCHAR_MAX && __SHRT_MAX__ == SHRT_MAX && __INT_MAX__ == INT_MAX && __LONG_MAX__ == LONG_MAX && __LONG_LONG_MAX__ == LLONG_MAX);
  CHECK(__SIZEOF_SHORT__ == sizeof(short) && __SIZEOF_INT__ == sizeof(int) && __SIZEOF_LONG__ == sizeof(long) && __SIZEOF_LONG_LONG__ == sizeof(long long) && __SIZEOF_POINTER__ == sizeof(void *));
  CHECK(__SIZEOF_FLOAT__ == sizeof(float) && __SIZEOF_DOUBLE__ == sizeof(double) && __SIZEOF_LONG_DOUBLE__ == sizeof(long double) && __SIZEOF_SIZE_T__ == sizeof(size_t) && __SIZEOF_PTRDIFF_T__ == sizeof(ptrdiff_t));
  CHECK(__SIZEOF_WCHAR_T__ == sizeof(wchar_t) && __SIZEOF_WINT_T__ == sizeof(wint_t));
#ifdef __SIZEOF_INT128__
  CHECK(__SIZEOF_INT128__ == sizeof(__int128));
#endif
  // The types behind the library's typedefs.
  CHECK(_Generic((size_t)0, __SIZE_TYPE__: 1, default: 0) && _Generic((ptrdiff_t)0, __PTRDIFF_TYPE__: 1, default: 0) && _Generic((wchar_t)0, __WCHAR_TYPE__: 1, default: 0));
  CHECK(_Generic((intptr_t)0, __INTPTR_TYPE__: 1, default: 0) && _Generic((uintptr_t)0, __UINTPTR_TYPE__: 1, default: 0) && _Generic((intmax_t)0, __INTMAX_TYPE__: 1, default: 0) && _Generic((uintmax_t)0, __UINTMAX_TYPE__: 1, default: 0));
  CHECK(_Generic((int8_t)0, __INT8_TYPE__: 1, default: 0) && _Generic((uint16_t)0, __UINT16_TYPE__: 1, default: 0) && _Generic((int32_t)0, __INT32_TYPE__: 1, default: 0) && _Generic((uint64_t)0, __UINT64_TYPE__: 1, default: 0));
  CHECK(_Generic(u'x', __CHAR16_TYPE__: 1, default: 0) && _Generic(U'x', __CHAR32_TYPE__: 1, default: 0));
  CHECK(__SIZE_MAX__ == SIZE_MAX && __PTRDIFF_MAX__ == PTRDIFF_MAX && __INTMAX_MAX__ == INTMAX_MAX && __UINTMAX_MAX__ == UINTMAX_MAX && __INTPTR_MAX__ == INTPTR_MAX && __WCHAR_MAX__ == WCHAR_MAX);
  // Byte order, and the architecture.
  unsigned probe = 1;
  CHECK((__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__) == (*(unsigned char *)&probe == 1) && __ORDER_LITTLE_ENDIAN__ != __ORDER_BIG_ENDIAN__);
#if defined __x86_64__
  CHECK(sizeof(void *) == 8);
#elif defined __aarch64__
  CHECK(sizeof(void *) == 8);
#else
  CHECK(!"one of the architectures is announced");
#endif
#ifdef __CHAR_UNSIGNED__
  CHECK((char)-1 > 0);
#else
  CHECK((char)-1 < 0);
#endif
#if defined __LP64__
  CHECK(sizeof(long) == 8);
#elif defined _WIN64
  CHECK(sizeof(long) == 4 && sizeof(void *) == 8);
#endif
  // The counters and the file names.
  int first = __COUNTER__, second = __COUNTER__;
  CHECK(second == first + 1 && __INCLUDE_LEVEL__ == 0 && sizeof(__BASE_FILE__) > 1 && sizeof(__TIMESTAMP__) > 1);
  CHECK(__STDC__ == 1 && __STDC_HOSTED__ == 1 && __STDC_VERSION__ >= 201112L);
  printf("%d wrong\n", wrong);
  return wrong != 0;
}

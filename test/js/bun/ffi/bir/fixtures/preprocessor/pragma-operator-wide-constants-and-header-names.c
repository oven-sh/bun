// _Pragma takes its string after macro replacement; wide character constants have values in #if; and a comment may stand
// between #include and the header name.
#include /* a comment first */ <stdio.h>
#include/**/<string.h>
#include /* one */ /* two */ <limits.h>
#include <stddef.h> /* and one after */

// 6.10.9: what follows _Pragma is ordinary text, so a macro may supply the string.
#define PACK_1 "pack(1)"
#define PACK_POP "pack()"
#define STRINGIZED(x) #x
#define PRAGMA(x) _Pragma(STRINGIZED(x))
_Pragma(PACK_1)
struct packed_by_macro { char c; int i; };
_Pragma(PACK_POP)
struct not_packed { char c; int i; };
PRAGMA(pack(2))
struct packed_to_two { char c; int i; };
PRAGMA(pack())
#define DECLARE(name) _Pragma("pack(1)") struct name { char c; long l; }; _Pragma("pack()")
DECLARE(declared_in_a_macro)
_Pragma(L"pack(1)")
struct wide_string { char c; short s; };
_Pragma("pack()")

// 6.10.1p4: character constants, wide ones too, are what they are in an expression.
#if L'a' == 97 && u'a' == 97 && U'a' == 97 && L'\0' == 0
#define WIDE_VALUES 1
#else
#define WIDE_VALUES 0
#endif
#if u'\xffff' > 0 && U'\xffffffff' > 0 && u'\xffff' == 65535 && U'\xffffffff' == 4294967295
#define UNSIGNED_16_AND_32 1
#else
#define UNSIGNED_16_AND_32 0
#endif
// wchar_t is signed where it is an int and unsigned where it has 16 bits.
#if L'\0' - 1 < 0
#define WCHAR_SIGNED_IN_IF 1
#else
#define WCHAR_SIGNED_IN_IF 0
#endif
#if '\377' < 0
#define CHAR_SIGNED_IN_IF 1
#else
#define CHAR_SIGNED_IN_IF 0
#endif
#if L'\x7fffffff' > 0 || L'\xffff' > 0
#define WIDE_MAX_POSITIVE 1
#else
#define WIDE_MAX_POSITIVE 0
#endif

int main(void) {
  printf("%d %d %d %d %d\n", (int)sizeof(struct packed_by_macro), (int)sizeof(struct not_packed), (int)sizeof(struct packed_to_two),
         (int)sizeof(struct declared_in_a_macro), (int)sizeof(struct wide_string));
  printf("%d %d %d %d\n", WIDE_VALUES, UNSIGNED_16_AND_32, WIDE_MAX_POSITIVE, (int)strlen("from string.h"));
  printf("%d %d\n", WCHAR_SIGNED_IN_IF == ((wchar_t)-1 < 0), CHAR_SIGNED_IN_IF == (CHAR_MIN < 0));
  return 0;
}

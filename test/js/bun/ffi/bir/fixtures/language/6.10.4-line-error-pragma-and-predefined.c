// C11 6.10.4 to 6.10.9: #line, #error (only where it is skipped), #pragma and _Pragma, the null directive, and the
// predefined macro names.
#include <stdio.h>
#include <string.h>

#pragma STDC FP_CONTRACT OFF
#pragma STDC FENV_ACCESS OFF
#pragma STDC CX_LIMITED_RANGE ON
#pragma unknown_to_everybody at all
#
# /* a null directive with a comment */

#define PRAGMA(x) _Pragma(#x)
PRAGMA(STDC FP_CONTRACT ON)
_Pragma("once")
#define PACKED_BEGIN _Pragma("pack(push, 1)")
#define PACKED_END _Pragma("pack(pop)")
PACKED_BEGIN
struct packed { char c; int i; };
PACKED_END
struct natural { char c; int i; };

static const char *tail(const char *path) {
  const char *slash = strrchr(path, '/'), *backslash = strrchr(path, '\\');
  const char *last = slash > backslash ? slash : backslash;
  return last ? last + 1 : path;
}

#if 0
#error this is in a skipped group
#endif

int main(void) {
  printf("%d %d\n", (int)sizeof(struct packed), (int)sizeof(struct natural));
  // __LINE__ and __FILE__, and what #line does to them (with a number, with a name, through a macro).
  printf("%d %s\n", __LINE__, tail(__FILE__));
#line 100
  printf("%d %s\n", __LINE__, tail(__FILE__));
#line 200 "renamed.c"
  printf("%d %s\n", __LINE__, __FILE__);
#define LINE_NUMBER 300
#define FILE_NAME "from-macros.c"
#line LINE_NUMBER FILE_NAME
  printf("%d %s\n", __LINE__, __FILE__);
  printf("%d\n", __LINE__
                 + __LINE__);
  // The date and time of translation have fixed shapes: "Mmm dd yyyy" and "hh:mm:ss".
  const char *date = __DATE__, *time = __TIME__;
  printf("%d %d %d %d\n", (int)strlen(date), date[3] == ' ' && date[6] == ' ', (int)strlen(time), time[2] == ':' && time[5] == ':');
  printf("%d\n", strstr("JanFebMarAprMayJunJulAugSepOctNovDec", (char[4]){date[0], date[1], date[2], 0}) != 0);
  // The conformance macros.
  printf("%d %d\n", __STDC_HOSTED__, __STDC_VERSION__ >= 201112L);
#if defined __STDC_IEC_559__ && __STDC_IEC_559__ != 1
  printf("WRONG: a conditional feature macro is 1 or not defined\n");
#endif
#if defined __STDC_NO_THREADS__ && __STDC_NO_THREADS__ != 1
  printf("WRONG: a conditional feature macro is 1 or not defined\n");
#endif
#if defined __STDC_UTF_16__ && defined __STDC_UTF_32__
  printf("%d %d\n", __STDC_UTF_16__, __STDC_UTF_32__);
#endif
  // None of the predefined names can be #undef'd or redefined away from under the library; __func__ is not a macro.
#ifdef __func__
  printf("WRONG: __func__ is a macro\n");
#endif
  // __COUNTER__ (an extension everybody has) counts its own expansions.
  int first = __COUNTER__, second = __COUNTER__;
  printf("%d\n", second - first);
  return 0;
}

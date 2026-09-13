// C11 6.4.1 and 6.4.2: every keyword in use, and what an identifier may be made of.
#include <stdio.h>

// auto break case char const continue default do double else enum extern float for goto if inline int long
// register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while
// _Alignas _Alignof _Atomic _Bool _Complex _Generic _Noreturn _Static_assert _Thread_local
typedef unsigned long long wide;
enum state { IDLE, BUSY };
union either { float f; unsigned u; };
struct record { signed char tag; short count; const volatile double *measure; };
extern int declared_elsewhere;
static inline int clamp(register int value, int low, int high) { return value < low ? low : value > high ? high : value; }
static _Noreturn void never_called(void);
static _Thread_local int per_thread;
static _Atomic int counted;
static _Alignas(16) char aligned[4];
_Static_assert(_Alignof(aligned) >= 1 && sizeof(_Bool) >= 1, "the keywords work in constant expressions");
static void copy(int n, int *restrict to, const int *restrict from) { while (n-- > 0) *to++ = *from++; }

// Identifiers: letters, digits and the underscore, case distinguished, as long as one likes;
// universal character names and (as an extension everybody has) a dollar sign.
static int _leading, __double, a1b2, CamelCase, camelcase, UPPER_CASE;
static int a_very_long_identifier_whose_every_character_is_significant_because_this_compiler_has_no_limit_1 = 1;
static int a_very_long_identifier_whose_every_character_is_significant_because_this_compiler_has_no_limit_2 = 2;
static int café = 3, π = 4;
static int with$dollar = 5;

int main(void) {
  auto int automatic = 0;
  struct record r = {-1, 2, 0};
  union either e = {.u = 0x3f800000};
  wide total = 0;
  for (int i = 0; i < 10; i++) {
    if (i == 2) continue;
    else if (i == 7) break;
    switch (i % 3) {
      case 0: total += 1; break;
      default: total += 10;
    }
  }
  do { automatic++; } while (automatic < 3);
  goto done;
done:
  printf("%llu %d %d %d %g\n", total, automatic, clamp(15, 0, 9), r.tag + r.count, (double)e.f);
  int from[3] = {1, 2, 3}, to[3];
  copy(3, to, from);
  printf("%d %d %d %d\n", to[2], (int)sizeof(enum state) > 0, _Generic(1.0f, float: 1, default: 0), per_thread + counted + declared_elsewhere);
  double _Complex z = 1.0;
  printf("%d\n", sizeof z == 2 * sizeof(double));
  _leading = 1; __double = 2; a1b2 = 3; CamelCase = 4; camelcase = 5; UPPER_CASE = 6;
  printf("%d %d %d\n", _leading + __double + a1b2, CamelCase * 10 + camelcase, UPPER_CASE);
  printf("%d %d\n", a_very_long_identifier_whose_every_character_is_significant_because_this_compiler_has_no_limit_1,
         a_very_long_identifier_whose_every_character_is_significant_because_this_compiler_has_no_limit_2);
  printf("%d %d %d\n", café, π, with$dollar);
  // __func__ is a predefined identifier: the name of the enclosing function.
  printf("%s %d\n", __func__, (int)sizeof __func__);
  if (automatic < 0) never_called();
  return 0;
}
int declared_elsewhere = 0;
static void never_called(void) { for (;;) {} }

// C11 6.10.1: #if, #ifdef, #ifndef, #elif, #else, #endif: what the controlling expression may contain and how it
// is evaluated.
#include <limits.h>
#include <stdio.h>

#define DEFINED_EMPTY
#define DEFINED_ZERO 0
#define DEFINED_ONE 1
#define FUNCTION_LIKE(x) ((x) + 1)
#define NAMES_ITSELF NAMES_ITSELF

static int lines;
#define TAKEN(text) printf("%d: %s\n", ++lines, text)

int main(void) {
  // defined X, defined(X), and ! of each; a macro that is defined to nothing or to 0 is still defined.
#if defined DEFINED_EMPTY && defined(DEFINED_ZERO) && !defined UNDEFINED && !defined(UNDEFINED) && defined FUNCTION_LIKE
  TAKEN("defined in every spelling");
#endif
#ifdef DEFINED_ZERO
  TAKEN("#ifdef of a macro whose value is 0");
#endif
#ifndef UNDEFINED
  TAKEN("#ifndef");
#else
  TAKEN("WRONG");
#endif
  // Identifiers that are not macros (and keywords too) are 0; true and false are not special.
#if UNDEFINED == 0 && int == 0 && sizeof == 0 && true == 0 && NAMES_ITSELF == 0
  TAKEN("unknown identifiers are 0");
#endif
  // Arithmetic is in intmax_t and uintmax_t: every operator of constant expressions but casts and sizeof.
#if (1 + 2 * 3 - 4 / 2 % 3 == 5) && (1 << 4 == 16) && (256 >> 4 == 16) && ((6 & 3) == 2) && ((6 | 3) == 7) && ((6 ^ 3) == 5) && (~0 == -1)
  TAKEN("arithmetic and bitwise operators");
#endif
#if (1 < 2) && (2 > 1) && (1 <= 1) && (1 >= 1) && (1 != 2) && !(1 == 2) && (1 ? 1 : 0) && (0 ? 0 : 1) && (0 || 1) && !(1 && 0) && -1 < 0 && +1 > 0
  TAKEN("relational, logical and conditional operators");
#endif
#if 0x7fffffffffffffff + 0 > 0 && 0xffffffffffffffff > 0 && -1 < 0u == 0 && 18446744073709551615u == -1 && -9223372036854775807 - 1 < 0
  TAKEN("64-bit signed and unsigned arithmetic");
#endif
#if 'a' == 97 && '\n' == 10 && '\0' == 0 && 'A' < 'a' && '\x41' == 'A' && '\101' == 'A'
  TAKEN("character constants");
#endif
#if FUNCTION_LIKE(2) == 3 && DEFINED_ONE + DEFINED_ONE == 2 && FUNCTION_LIKE(DEFINED_ZERO)
  TAKEN("macros are expanded first");
#endif
#if CHAR_BIT == 8 && INT_MAX >= 32767 && UINT_MAX == 0xffffffff
  TAKEN("the limits are usable here");
#endif
  // Only the first true group of a chain is taken, and the expressions of skipped groups are not evaluated.
#if 0
  TAKEN("WRONG");
#elif 0
  TAKEN("WRONG");
#elif 1
  TAKEN("the first true #elif");
#elif 1 / 0
  TAKEN("WRONG");
#else
  TAKEN("WRONG");
#endif
#if 1
  TAKEN("a true #if skips every #elif without looking at it");
#elif this is not even ( an expression
#endif
  // Nesting; a skipped group may contain anything that lexes, and its directives are not obeyed.
#if 1
#if 0
#error not reached
#include <no/such/header.h>
#define DEFINED_ONE 2
#else
#ifdef DEFINED_ONE
#if DEFINED_ONE == 1
  TAKEN("three levels deep, and a #define in a skipped group did nothing");
#endif
#endif
#endif
#endif
  // Division by zero and the like are fine where they are not evaluated.
#if 0 && (1 / 0)
#elif 1 || (1 % 0)
  TAKEN("short circuit");
#endif
  return 0;
}

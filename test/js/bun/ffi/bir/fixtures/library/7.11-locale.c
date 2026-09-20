// C11 7.11 <locale.h>: the "C" locale, and the structure localeconv returns a pointer to.
#include <limits.h>
#include <locale.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  const char *now = setlocale(LC_ALL, 0);
  printf("%s\n", now);
  printf("%d %d\n", setlocale(LC_ALL, "C") != 0, setlocale(LC_NUMERIC, "no such locale anywhere") == 0);
  struct lconv *conventions = localeconv();
  printf("%s|%s|%s|%d\n", conventions->decimal_point, conventions->thousands_sep, conventions->currency_symbol, conventions->frac_digits == CHAR_MAX);
  struct lconv copy = *conventions;
  printf("%d\n", strcmp(copy.decimal_point, ".") == 0);
  int categories[] = {LC_ALL, LC_COLLATE, LC_CTYPE, LC_MONETARY, LC_NUMERIC, LC_TIME};
  int distinct = 1;
  for (int i = 0; i < 6; i++) for (int j = 0; j < i; j++) distinct &= categories[i] != categories[j];
  printf("%d %.2f\n", distinct, 1234.5);
  return 0;
}

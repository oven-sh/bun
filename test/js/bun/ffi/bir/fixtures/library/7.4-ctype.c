// C11 7.4 <ctype.h>: the classification and mapping functions over every value of unsigned char and EOF in the
// "C" locale, as macros (if the library has them so) and as functions.
#include <ctype.h>
#include <stdio.h>

int main(void) {
  int counts[12] = {0};
  int (*functions[12])(int) = {isalnum, isalpha, isblank, iscntrl, isdigit, isgraph, islower, isprint, ispunct, isspace, isupper, isxdigit};
  int agree = 1;
  for (int c = 0; c < 128; c++) {
    int through_macros[12] = {isalnum(c), isalpha(c), isblank(c), iscntrl(c), isdigit(c), isgraph(c), islower(c), isprint(c), ispunct(c), isspace(c), isupper(c), isxdigit(c)};
    for (int k = 0; k < 12; k++) {
      counts[k] += through_macros[k] != 0;
      agree &= (through_macros[k] != 0) == (functions[k](c) != 0);      // the function behind the macro says the same
      agree &= (through_macros[k] != 0) == ((functions[k])(c) != 0);
    }
  }
  for (int k = 0; k < 12; k++) printf("%d ", counts[k]);
  printf("%d\n", agree);
  // EOF is no character of any class; the argument is evaluated once even by a macro.
  int c = 'a', before = c;
  printf("%d %d %d\n", isalpha(EOF) != 0, isspace(EOF) != 0, isalpha(c++) != 0 && c == before + 1);
  printf("%c%c%c%c %d %d\n", toupper('a'), tolower('A'), toupper('1'), tolower('z'), toupper(EOF) == EOF, (toupper)('q'));
  const char *text = "Hello, World 42!";
  int letters = 0, digits = 0, spaces = 0, others = 0;
  for (const char *p = text; *p; p++) {
    unsigned char u = (unsigned char)*p;
    if (isalpha(u)) letters++; else if (isdigit(u)) digits++; else if (isspace(u)) spaces++; else others++;
  }
  printf("%d %d %d %d\n", letters, digits, spaces, others);
  return 0;
}

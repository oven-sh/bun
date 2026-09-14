// C11 7.9 <iso646.h>: eleven macros that spell operators.
#include <iso646.h>
#include <stdio.h>

int main(void) {
  int a = 6, b = 3, c = 0;
  printf("%d %d %d %d %d %d\n", a and b, c or b, not c, a bitand b, a bitor b, a xor b);
  printf("%d %d\n", compl a, a not_eq b);
  c or_eq 8; c and_eq 12; c xor_eq 5;
  printf("%d\n", c);
#if defined and and defined or and defined not and defined xor and defined compl and defined bitand and defined bitor and defined and_eq and defined or_eq and defined xor_eq and defined not_eq
  printf("all macros\n");
#endif
#define STRING(x) #x
#define SPELLED(x) STRING(x)
  printf("%s %s %s\n", SPELLED(and), SPELLED(not_eq), SPELLED(compl));
  return 0;
}

// An inline function's static object and a selectany object are the program's, not each unit's; a unit that only
// declares an inline function calls the definition another unit made for itself.
#include "shared.h"
int printf(const char *, ...);
int from_other(void);
int from_third(int);
const char *name_in_other(void);
int main(void) {
  *counter() += 1;
  one_value += 1;
  printf("%d %d %d\n", *counter(), from_other(), one_value);
  printf("%d %d\n", from_third(21), name_in_other() == one_name);
  return 0;
}

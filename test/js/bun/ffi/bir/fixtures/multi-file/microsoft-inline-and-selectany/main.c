// An inline function's static object and a selectany object are the program's, not each unit's; a unit that only
// declares an inline function calls the definition another unit made for itself.
#include "shared.h"
int printf(const char *, ...);
int from_other(void);
int from_third(int);
const char *name_in_other(void);
int *value_in_other(void);
int main(void) {
  *counter() += 1;
  one_value += 1;
  printf("%d %d %d\n", *counter(), from_other(), one_value);
  // (Which "shared" each file's copy of the pointer held is nobody's business: equal strings need not be one object.)
  printf("%d %d %c\n", from_third(21), value_in_other() == &one_value, name_in_other()[1] == one_name[1] ? 'h' : '?');
  return 0;
}

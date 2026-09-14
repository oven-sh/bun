// Whether an object can be written is the business of the unit that defines it: this one only promises not to
// write `counter` itself, and sees the other unit's writes; `limit` is constant in both.
#include <stdio.h>

extern const int counter;          // defined, without const, in the other unit
extern const int limit;
extern const char *const labels[];
int bump(void);

int main(void) {
  int before = counter;
  int after = bump();
  printf("%d %d %d %d %s %s\n", before, after, counter, limit, labels[0], labels[1]);
  return 0;
}

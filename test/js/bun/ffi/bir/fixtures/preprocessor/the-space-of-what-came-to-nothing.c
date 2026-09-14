// 6.10.3.2p2: `#` makes one space of the white space between the tokens of its argument. A macro with nothing in
// it, an empty argument and a `__VA_OPT__` without arguments leave no token, and the white space that was in front of
// them is still white space between their neighbours: `a EMPTY;` is spelled "a ;" as GCC and Clang spell it.
#include <stdio.h>

#define EMPTY
#define NOTHING()
#define STR(x) #x
#define XSTR(x) STR(x)
#define DEFINES(n, ...) S n __VA_OPT__(= { __VA_ARGS__ })
#define BETWEEN(x) a x b
#define THEN(x) a x;
#define AFTER(x) x;

int main(void) {
  puts(XSTR(DEFINES(foo);));
  puts(XSTR(DEFINES(foo, 1);));
  puts(XSTR(a EMPTY;));
  puts(XSTR(a EMPTY ;));
  puts(XSTR(a EMPTY b));
  puts(XSTR(a EMPTY EMPTY b));
  puts(XSTR(aEMPTY;));
  puts(XSTR(EMPTY a));
  puts(XSTR(a EMPTY));
  puts(XSTR(a NOTHING();));
  puts(XSTR(BETWEEN()));
  puts(XSTR(BETWEEN(EMPTY)));
  puts(XSTR(THEN()));
  puts(XSTR(AFTER()));
  puts(XSTR(f EMPTY (1)));
  puts(XSTR(-EMPTY-));
  puts(XSTR(- EMPTY-));
  return 0;
}

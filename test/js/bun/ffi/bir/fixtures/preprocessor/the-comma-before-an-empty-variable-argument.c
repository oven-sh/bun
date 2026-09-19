// GNU's `, ## __VA_ARGS__`: the comma goes when the invocation has no variable argument at all, and stays when it has
// one that is empty (`F(a,)`), as in GCC and Clang. With nothing but `...` to take, `F()` has none.
#include <stdio.h>

#define TEXT_OF(...) #__VA_ARGS__
#define TEXT(...) TEXT_OF(__VA_ARGS__)
#define AFTER(format, ...) format , ## __VA_ARGS__
#define NAMED(format, rest...) format , ## rest
#define ONLY(...) first , ## __VA_ARGS__
#define TWO(a, b, ...) a b , ## __VA_ARGS__
#define EMPTY

int main(void) {
  puts(TEXT(AFTER("a")));
  puts(TEXT(AFTER("a",)));
  puts(TEXT(AFTER("a", )));
  puts(TEXT(AFTER("a", 1)));
  puts(TEXT(AFTER("a", 1, 2)));
  puts(TEXT(AFTER("a", EMPTY)));
  puts(TEXT(NAMED("a")));
  puts(TEXT(NAMED("a",)));
  puts(TEXT(NAMED("a", 1)));
  puts(TEXT(ONLY()));
  puts(TEXT(ONLY( )));
  puts(TEXT(ONLY(1)));
  puts(TEXT(ONLY(EMPTY)));
  puts(TEXT(TWO(x, y)));
  puts(TEXT(TWO(x, y,)));
  puts(TEXT(TWO(x, y, z)));
  printf(AFTER("%d %d\n", 1, 2));
  printf(AFTER("none\n"));
  return 0;
}

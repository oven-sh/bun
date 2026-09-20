// __VA_OPT__ (C23): what each use turns into, stringified after expansion. (Without the spaces: compilers
// differ on whether a __VA_OPT__ that turned into nothing leaves one behind in a string.)
#include <stdio.h>
#define STR(...) #__VA_ARGS__
#define SHOW(...) show(STR(__VA_ARGS__))
static void show(const char *text) {
  for (; *text; text++)
    if (*text != ' ') putchar(*text);
  putchar('\n');
}

#define F(a, ...) f(a __VA_OPT__(,) __VA_ARGS__)
#define G(...) __VA_OPT__(x ## __VA_ARGS__ ## y)|
#define E
#define H(...) [__VA_OPT__(yes)]
#define S(...) #__VA_OPT__(a  __VA_ARGS__ b)
#define P(x, ...) x ## __VA_OPT__(_tail) __VA_OPT__() end
#define Q(x, ...) __VA_OPT__(pre_) ## x
#define LOG(fmt, ...) printf(fmt __VA_OPT__(, __VA_ARGS__))

int main(void) {
  SHOW(F(1) F(1, 2) F(1, 2, 3) F(1,));
  SHOW(G() G(1) G(a b));
  SHOW(H() H(E) H(E E) H(0));
  puts(S());
  puts(S(1, 2));
  SHOW(P(a) P(a, 1));
  SHOW(Q(a) Q(a, 1));
  LOG("a\n");
  LOG("b %d\n", (1, 2));
  return 0;
}

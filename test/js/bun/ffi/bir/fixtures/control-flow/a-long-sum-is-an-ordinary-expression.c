// A chain of operators is not nesting, however long it is: `a + b + c` is `(a + b) + c`, ten thousand terms are a tree
// ten thousand deep, and everything that walks one goes down it by a loop. The same for `,`, for `&&` and `||`, and
// for `p ? a : q ? b : ...`, which goes on in its last operand. (The chains are made by macros so that this file
// stays small; the compiler sees every term.)
#include <stdio.h>

// `m()` written ten, a hundred, a thousand, ten thousand times.
#define R10(m) m() m() m() m() m() m() m() m() m() m()
#define R100(m) R10(m) R10(m) R10(m) R10(m) R10(m) R10(m) R10(m) R10(m) R10(m) R10(m)
#define R1000(m) R100(m) R100(m) R100(m) R100(m) R100(m) R100(m) R100(m) R100(m) R100(m) R100(m)
#define R5000(m) R1000(m) R1000(m) R1000(m) R1000(m) R1000(m)
#define R10000(m) R5000(m) R5000(m)

#define PLUS() + v
static int sum(int v) { return v R10000(PLUS); }

#define TIMES() * 3u + w
static unsigned polynomial(unsigned w) { return w R1000(TIMES); }

#define OR() | bit(n++)
static unsigned bit(int n) { return 1u << (n % 32); }
static unsigned flags(void) { int n = 0; return 0u R10000(OR); }

#define PLUS_HALF() + 0.5
static double halves(void) { return 1.0 R10000(PLUS_HALF); }

#define PLUS_WIDE() + wide
static long long wide_sum(long long wide) { __int128 total = (__int128)1 R1000(PLUS_WIDE); return (long long)(total >> 1); }

#define AND() && ++calls < limit
static int calls;
static int all_of(int limit) { calls = 0; return 1 R10000(AND); }

#define OR_ELSE() || ++calls == stop
static int any_of(int stop) { calls = 0; return 0 R10000(OR_ELSE); }

#define STEP() count += 1,
static int steps(void) { int count = 0; return (R10000(STEP) count); }

// (`__COUNTER__` counts on at every use: the conditions are the even numbers and the values the odd ones.)
#define CASE() key == __COUNTER__ ? __COUNTER__ :
static int choose(int key) { return R5000(CASE) -1; }

#define ELSE_NOTHING() key == -2 - __COUNTER__ ? (void)0 :
static void choose_nothing(int key) { R1000(ELSE_NOTHING) (void)puts("none of a thousand"); }

// A static initializer is a constant expression of the same shape.
#define PLUS_ONE() + 1
static const int constant = 0 R10000(PLUS_ONE);
enum { ENUMERATOR = 0 R10000(PLUS_ONE) };
#define SEVEN() 7 == 10000 + __COUNTER__ ? 1 :
static const int chosen = R5000(SEVEN) 2;

int main(void) {
  int result;
  printf("%d\n", sum(3));
  printf("%u\n", polynomial(5));
  printf("%x\n", flags());
  printf("%g\n", halves());
  printf("%lld\n", wide_sum(1000000000000LL));
  result = all_of(20000);
  printf("%d %d\n", result, calls);
  result = all_of(77);
  printf("%d %d\n", result, calls);
  result = any_of(9999);
  printf("%d %d\n", result, calls);
  result = any_of(20000);
  printf("%d %d\n", result, calls);
  printf("%d\n", steps());
  printf("%d %d %d %d\n", choose(0), choose(4242), choose(9998), choose(9999));
  choose_nothing(5);
  printf("%d %d %d\n", constant, (int)ENUMERATOR, chosen);
  return 0;
}

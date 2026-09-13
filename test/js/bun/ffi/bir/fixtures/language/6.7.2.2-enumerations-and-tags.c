// C11 6.7.2.2 and 6.7.2.3: enumerations, and how tags are declared, completed and hidden.
#include <limits.h>
#include <stdio.h>

enum plain { ZERO, ONE, TWO };
enum valued { TEN = 10, ELEVEN, FIVE = 5, SIX, SIX_AGAIN = SIX, NEGATIVE = -3, NEXT, FROM_EXPRESSION = TEN * 2 + ONE, TRAILING_COMMA, };
enum limits { SMALL = INT_MIN, LARGE = INT_MAX };
typedef enum { ANONYMOUS_A, ANONYMOUS_B } anonymous;

struct later;                                // an incomplete type until it is defined
struct later *make(void);
struct pair_of_later { struct later *a, *b; };   // pointers to it are complete
struct later { int value; };                 // completed; everything above now sees the members
struct later *make(void) { static struct later one = {42}; return &one; }

union forward;
static int size_of_forward(void);
union forward { char bytes[6]; short aligned; };
static int size_of_forward(void) { return (int)sizeof(union forward); }

int main(void) {
  printf("%d %d %d\n", ZERO, ONE, TWO);
  printf("%d %d %d %d %d %d %d %d\n", TEN, ELEVEN, FIVE, SIX, SIX_AGAIN, NEGATIVE, NEXT, FROM_EXPRESSION);
  printf("%d %d %d %d\n", TRAILING_COMMA, SMALL == INT_MIN, LARGE == INT_MAX, ANONYMOUS_B);
  // Enumerators are ints; an object of the type holds any of them, and any other value of its underlying type.
  enum valued v = ELEVEN;
  anonymous a = ANONYMOUS_B;
  v = (enum valued)7;
  printf("%d %d %d %d\n", (int)v, (int)a + 1, sizeof(TEN) == sizeof(int), sizeof(enum plain) <= sizeof(int));
  switch (v + FIVE) { case 12: printf("arithmetic on it is integer arithmetic\n"); break; default: printf("?\n"); }
  int index[TWO + 1] = {[ZERO] = 5, [TWO] = 7};
  printf("%d %d\n", index[TWO], (int)(sizeof index / sizeof index[0]));
  // Tags: completed later in the same scope; a declaration `struct tag;` in an inner scope starts a new type.
  struct pair_of_later p = {make(), make()};
  printf("%d %d %d\n", p.a->value, p.a == p.b, size_of_forward() >= 6);
  {
    struct later;                            // hides the outer one
    struct later { char different[3]; } inner;
    enum plain { ZERO_AGAIN = 100 };         // a new enumeration with the same tag, in this scope only
    printf("%d %d\n", (int)sizeof inner, ZERO_AGAIN);
  }
  printf("%d\n", (int)sizeof(struct later) == (int)sizeof(int));
  // A tag declared inside a declaration is visible from then on, even when it appears in a parameter or a cast.
  int n = sizeof(struct in_a_cast { char c[5]; });
  struct in_a_cast again;
  printf("%d %d\n", n, (int)sizeof again);
  return 0;
}

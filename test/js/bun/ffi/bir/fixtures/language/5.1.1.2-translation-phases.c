// C11 5.1.1.2: the phases of translation, each seen through something only it could have done.
#include <stdio.h>
#include <string.h>

#define STR(x) #x
#define XSTR(x) STR(x)
#define CAT(a, b) a##b

// Phase 2 comes before phase 3: a backslash-newline joins lines before comments and tokens are found.
#define SPLICED 4\
2
// this comment continues \
   onto this line, so nothing here is code: int hidden = 1;
static int spl\
iced_name = 7;

// Phase 3: a comment is one space; a string literal is not searched for comments; tokens are maximal.
static const char *not_a_comment = "/* still text */ // also text";
static int a_plus = 1, plus_b = 2;

int main(void) {
  printf("phase 2: %d %d\n", SPLICED, spliced_name);
  int a = 10 /* one space */ + /* another */ 5;
  int x = 3, y = 2;
  int maximal = x+++y;     // x++ + y
  int divided = 12 //* a comment in C99 and later, a division by a comment before */ 4
      / 4;
  printf("phase 3: %d %d %d %d %s\n", a, maximal, x, divided, not_a_comment);
  // Phase 4: directives run and macros expand before anything is a keyword.
#define int_value 5
  printf("phase 4: %d %s %s %d\n", int_value, XSTR(CAT(a_, plus)), STR(CAT(a_, plus)), CAT(a_, plus) + CAT(plus_, b));
  // Phase 5 then 6: escape sequences become characters, and only then are adjacent literals joined:
  // "\x12" "3" is the two characters 0x12 and '3', not the one character 0x123.
  const char joined[] = "\x12" "3";
  const char one[] = "a" /* between */ "b"
                     "c";
  printf("phase 5 and 6: %d %d %d %s %d\n", (int)sizeof joined, joined[0], joined[1], one, (int)strlen("\0hidden" "x"));
  // A trigraph is not replaced (as GNU C and C23 have it): these are nine ordinary characters.
  printf("trigraphs: %s %d\n", "?""?=", (int)sizeof("??=") - 1);
  return 0;
}

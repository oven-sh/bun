// A backslash-newline can come anywhere: inside the two characters that begin or end a comment, in a string, in a
// number, in a name. It joins the lines before anything else looks at them, and still counts as a line.
#include <stdio.h>
/\
/ a line comment begun across a splice \
  and continued
/\
* a block comment *\
/ int hidden;
int main(void) {
  const char *s = "a\
b\"c" /* ** / */ "d";
  int x = 0x1p\
+3 + 1e\
+1;
  long id\
ent = 5;
  printf("%s %d %ld %d\n", s, x, ident, __LINE__);
  return 0;
}

/* #line (and the `# 33 "file"` markers other preprocessors write) number the line after the
   directive, whatever is or is not on it. */
#include <stdio.h>
int main(void) {
#line 100
  int a = __LINE__;
#line 200 "elsewhere.c"


  int b = __LINE__; const char *file = __FILE__;
#define NUMBER 300
#line NUMBER
  /* a comment
     over two lines */ int c = __LINE__;
# 400 "marker.c"
  int d = __LINE__; const char *marked = __FILE__;
#line \
 500
  int e = __LINE__;
  printf("%d %d %s %d %d %s %d\n", a, b, file, c, d, marked, e);
  return 0;
}

// `__builtin_object_size(p, 1)` is the room left in the closest object that holds `*p`. The last member of a
// structure stands for whatever was allocated after it, but only as far as the structure is itself at the end of
// what holds it: a last member of a member that is not last ends where that member ends.
#include <stdio.h>
#include <string.h>

struct N { char x[4]; struct { char y[6]; char z[3]; } in; char last[2]; };
struct deep { char a[2]; struct { char b[2]; struct { char c[2]; char d[5]; } innermost; } middle; };
struct holder { struct deep first; struct deep second; };
union either { struct N n; char bytes[32]; };
static struct N gn;
static struct deep gd;
static struct holder gh;
static union either gu;
static struct N several[2];

#define SIZES(p) printf("%-28s %d %d %d %d\n", #p, (int)__builtin_object_size(p, 0), (int)__builtin_object_size(p, 1), (int)__builtin_object_size(p, 2), (int)__builtin_object_size(p, 3))

int main(void) {
  SIZES(gn.in.z);
  SIZES(gn.in.y);
  SIZES(gn.last);
  SIZES(gn.x);
  SIZES(&gn.in.z[1]);
  // Last at every level: it runs to the end of the whole.
  SIZES(gd.middle.innermost.d);
  SIZES(gd.middle.innermost.c);
  // The same structure as a member that is not last, and as one that is.
  SIZES(gh.first.middle.innermost.d);
  SIZES(gh.second.middle.innermost.d);
  SIZES(gu.n.in.z);
  SIZES(several[0].in.z);
  SIZES(several[1].last);
  char source[8] = "abcdefg";
  __builtin___memcpy_chk(gn.in.z, source, 3, __builtin_object_size(gn.in.z, 1));
  printf("%.3s\n", gn.in.z);
  return 0;
}

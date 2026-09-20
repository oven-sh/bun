// C11 6.5.16.2 with 6.3.1.1p2: `field op= value` computes `field op value`, and there a bit-field whose values all fit
// an int is an int, whatever type it was declared with; only then is the result converted back and stored.
#include <stdio.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

struct fields {
  unsigned b : 3;
  unsigned c : 31;
  unsigned long long w : 20;
  unsigned full : 32;
  unsigned long long wide : 40;
  long long narrow_signed : 31;
  _Bool flag : 1;
  unsigned short s9 : 9;
  unsigned char c7 : 7;
  int plain : 5;
};

int main(void) {
  struct fields s = {0};
  volatile int minus_one = -1, minus_two = -2, minus_three = -3;
  s.b = 7; s.b /= -1;
  CHECK(s.b == 1);
  s.b = 7; s.b /= minus_one;
  CHECK(s.b == 1);
  s.b = 7; s.b %= -2;
  CHECK(s.b == 1);
  s.b = 7; s.b %= minus_two;
  CHECK(s.b == 1);
  s.c = 100; s.c /= -3;
  CHECK(s.c == 2147483615);
  s.c = 100; s.c /= minus_three;
  CHECK(s.c == 2147483615);
  s.w = 1000; s.w /= -3;
  CHECK(s.w == 1048243);
  s.w = 1000; s.w /= minus_three;
  CHECK(s.w == 1048243);
  // A field as wide as unsigned, or wider than int, keeps its unsigned type.
  s.full = 100; s.full /= -3;
  CHECK(s.full == 0);
  s.wide = 1000; s.wide /= -3;
  CHECK(s.wide == 0);
  s.narrow_signed = -100; s.narrow_signed /= 3;
  CHECK(s.narrow_signed == -33);
  // The operators whose result does not depend on the sign of the operation agree either way.
  s.b = 5; s.b += -2; s.c = 9; s.c *= -1; s.w = 16; s.w -= -4;
  CHECK(s.b == 3 && s.c == 2147483639 && s.w == 20);
  s.b = 6; s.b >>= 1; s.c = 1; s.c <<= 30; s.w = 0xfffff; s.w >>= 4;
  CHECK(s.b == 3 && s.c == 1073741824 && s.w == 0xffff);
  s.b = 5; s.b &= -2; s.b |= 1; s.b ^= -1;
  CHECK(s.b == 2);
  s.flag = 0; s.flag += 5; s.s9 = 300; s.s9 /= -7; s.c7 = 100; s.c7 %= -7; s.plain = -9; s.plain /= 2;
  CHECK(s.flag == 1 && s.s9 == 470 && s.c7 == 2 && s.plain == -4);
  // The value of the assignment is the stored field's.
  s.b = 7;
  CHECK((s.b /= -1) == 1 && (s.c = 100, s.c /= -3) == 2147483615);
  // Through a pointer, in a volatile structure, and as a statement inside an expression.
  volatile struct fields v = {0};
  struct fields *p = &s;
  p->b = 7; p->b /= -1; v.b = 7; v.b /= -1; v.w = 1000; v.w /= -3;
  CHECK(p->b == 1 && v.b == 1 && v.w == 1048243);
  // ++ and -- wrap in the field's own width.
  s.b = 7; s.b++; s.c = 0; s.c--; s.w = 0; --s.w;
  CHECK(s.b == 0 && s.c == 2147483647 && s.w == 0xfffff);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

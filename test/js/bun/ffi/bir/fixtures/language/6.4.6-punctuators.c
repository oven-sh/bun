// C11 6.4.6 and 6.4.9: every punctuator, the digraphs that stand for six of them, and both kinds of comment.
%:include <stdio.h>
%:define GLUE(a, b) a %:%: b
%:define TEXT(x) %:x

struct point <% int x, y; %>;

int main(void) <%
  int a<:3:> = <%1, 2, 3%>;                 // <: :> <% %> are [ ] { }
  struct point p = <% .x = 4, .y = 5 %>, *q = &p;
  int i = 0, r, value_2 = 3;
  r = a[0] + a<:1:> - (a[2] * 2) / 1 % 7;    // [ ] ( ) + - * / %
  i++; ++i; i--; --i;                       // ++ --
  r += i; r -= 1; r *= 2; r /= 1; r %= 100; r <<= 1; r >>= 1; r &= 0xff; r ^= 1; r |= 2;   // the assignments
  printf("%d %d %d\n", r, p.x + q->y, GLUE(value_, 2));          // . -> and the ## digraph
  printf("%d %d %d %d %d %d\n", 1 < 2, 2 > 1, 1 <= 1, 1 >= 2, 1 == 1, 1 != 1);
  printf("%d %d %d %d %d %d\n", 6 & 3, 6 | 3, 6 ^ 3, ~6, 1 << 4, 256 >> 4);
  printf("%d %d %d %d\n", 1 && 0, 1 || 0, !1, 1 ? 2 : 3);
  printf("%d %s\n", (1, 2), TEXT(a<:0:> %> <%));              // , and the # digraph: spelled as written
  int *pointer = &a<:1:>;
  printf("%d %d\n", *pointer, (int)sizeof(int<:2:>) / (int)sizeof(int));
  /* a comment /* does not nest */
  printf("%d\n", 7 /* within a line */ + 1); // to the end of the line
  printf("%s\n", "a digraph in a string stays: <: %> %:");
  return i;   /* ; ends a statement; ... is in a prototype: int printf(const char *, ...); */
%>

// C11 6.10.3: macro replacement: argument substitution, # and ##, rescanning, and the examples of the standard
// itself (6.10.3.5), whose expected results are given there.
#include <stdio.h>

#define SHOW(...) show(STR(__VA_ARGS__))
#define STR(...) #__VA_ARGS__
// Spacing in a stringified result is only fixed between tokens that had some: compare without it.
static void show(const char *text) {
  for (; *text; text++)
    if (*text != ' ') putchar(*text);
  putchar('\n');
}

// 6.10.3.5 EXAMPLE 3 cannot be an argument of another macro (`h` opens a parenthesis it does not close), so it is
// compiled: functions f, t and m exist, and each line must compute what the standard's expansion of it computes.
static int f(int v) { return v + 1; }
static int t(int v) { return v * 10; }
static int m(int a, int b) { return a * 100 + b; }
static int z[1] = {4};
#define x 3
#define f(a) f(x * (a))
#undef x
#define x 2
#define g f
#define z z[0]
#define h g(~
#define m(a) a(w)
#define w 0,1
#define t(a) a
static void example_3(void) {
  int y = 1, first = f(y+1) + f(f(z)) % t(t(g)(0) + t)(1);
  int second = g(x+(3,4)-w) | h 5) & m
      (f)^m(m);
  // f(2 * (y+1)) + f(2 * (f(2 * (z[0])))) % f(2 * (0)) + t(1) is 5 + 19 % 1 + 10; and
  // f(2 * (2+(3,4)-0,1)) | f(2 * (~ 5)) & f(2 * (0,1))^m(0,1) is 3 | -11 & 3 ^ 1.
  printf("%d %d\n", first, second);
}
#undef x
#undef f
#undef g
#undef z
#undef h
#undef m
#undef w
#undef t
#define x 2
#define p() int
#define q(x) x
#define r(x,y) x ## y
#define str(x) # x
// EXAMPLE 4
#define xstr(s) str(s)
#define debug(s, t) printf("x" # s "= %d, x" # t "= %s", x ## s, x ## t)
#define INCFILE(n) vers ## n
#define glue(a, b) a ## b
#define xglue(a, b) glue(a, b)
#define HIGHLOW "hello"
#define LOW LOW ", world"
// EXAMPLE 5
#define t5(x,y,z) x ## y ## z
// EXAMPLE 7
#define debug7(...) fprintf(standard_error, __VA_ARGS__) /* the standard has stderr, which is a macro in some libraries */
#define showlist(...) puts(#__VA_ARGS__)
#define report(test, ...) ((test)?puts(#test): printf(__VA_ARGS__))

// An object-like macro that looks function-like, and a function-like one used without its parentheses.
#define OBJECT (1 + 1)
#define FUNCTION() 5
#define EMPTY
#define IDENTITY(v) v
#define FIRST(a, ...) a
#define REST(a, ...) __VA_ARGS__
#define COUNT(...) COUNT_(__VA_ARGS__, 5, 4, 3, 2, 1, 0)
#define COUNT_(a, b, c, d, e, n, ...) n
#define PASTE3(a, b, c) a ## b ## c
#define HASH_ALONE #
#define DEFER(m) m EMPTY
#define EXPAND(...) __VA_ARGS__
#define RECURSE(n) n DEFER(RECURSE_INDIRECT)()(n)
#define RECURSE_INDIRECT() RECURSE

int main(void) {
  example_3();
  SHOW(p() i[q()] = { q(1), r(2,3), r(4,), r(,5), r(,) };);
  SHOW(char c[2][6] = { str(hello), str() };);
  SHOW(xstr(INCFILE(2).h) glue(HIGH, LOW); xglue(HIGH, LOW));
  SHOW(debug(1, 2););
  SHOW(fputs(str(strncmp("abc\0d", "abc", '\4') == 0) str(: @\n), s););
  SHOW(int j[] = { t5(1,2,3), t5(,4,5), t5(6,,7), t5(8,9,), t5(10,,), t5(,11,), t5(,,12), t5(,,) };);
  SHOW(debug7("Flag") debug7("X = %d\n", x) showlist(The first, second, and third items.) report(x>y, "x is %d but y is %d", x, y));
  // A function-like macro name not followed by ( is left alone; an argument may be empty or contain commas in parentheses.
  SHOW(FUNCTION FUNCTION() FUNCTION EMPTY () OBJECT(2));
  SHOW(IDENTITY() | IDENTITY((a, b)) | IDENTITY(IDENTITY)(c) | FIRST(1, 2, 3) | REST(1, 2, 3) | REST(1));
  printf("%d %d %d %d\n", COUNT(a), COUNT(a, b, c), COUNT(a, b, c, d, e), PASTE3(1, 2, 3) + PASTE3(, 4, ) + PASTE3(, , 5));
  // ## makes one token of two, including ones that then name a macro or spell an operator.
  SHOW(glue(+, +) glue(<, <=) glue(., 5) glue(1e, 3) glue(L, "s") glue(x, 1) glue(OBJ, ECT) glue(-, >));
  // An argument is fully expanded before substitution unless it sits next to # or ##.
  SHOW(str(OBJECT) xstr(OBJECT) glue(OBJ, ECT) glue(OBJECT, 2) xglue(v, FUNCTION()));
  // A macro is not expanded inside its own expansion, however it is reached, but can be again afterwards.
  SHOW(z LOW EXPAND(RECURSE(1)) EXPAND(EXPAND(RECURSE(2))));
  // Redefinition with the same replacement is allowed; #undef of something undefined is too.
#define SAME(a) (a + 1)
#define SAME(a) (a   +   1)
#undef NEVER_DEFINED
#undef SAME
#define SAME 9
  printf("%d\n", SAME);
  return 0;
}

// The rules of macro expansion and of #if, seen through what the expansions spell: each line prints the
// tokens a piece of text turns into (stringified after expansion), or which branch of a conditional was taken.
#include <stdio.h>
#define STR(...) #__VA_ARGS__
#define SHOW(...) puts(STR(__VA_ARGS__))

int main(void) {
  // Self-reference and mutual recursion stop (C11 6.10.3.4p2).
#define foo foo + bar
#define bar foo
  SHOW(foo bar);
#define f(a) a*g
#define g(a) f(a)
  SHOW(f(2)(9));
  // A function-like macro name without '(' is not an invocation.
#define F(x) [x]
  SHOW(F F (1) F
       (2));
  // Arguments are fully expanded before substitution, except next to # and ##.
#define A 1
#define S(x) #x
#define X(x) S(x)
  SHOW(S(A) X(A));
#define C(x, y) x ## y
  SHOW(C(A, A) C(A, 2));
  // Stringification: spacing collapses, strings and chars are escaped.
  puts(S(  a   +  "b\n"  '\''  ));
  // Placemarkers.
#define C3(a, b, c) a ## b ## c
  SHOW(C3(1,,3) C3(,,3) C3(,,) |);
  // Variadics, including GNU comma swallowing and named variadics.
#define P(f, ...) p(f, ## __VA_ARGS__)
  SHOW(P(a) P(a, b, c));
#define Q(f, args...) p(f , ## args)
  SHOW(Q(a) Q(a, b));
#define V(...) <__VA_ARGS__>
  SHOW(V() V(1) V(1, (2, 3)));
  // Arguments that span lines and contain parentheses and commas.
#define F2(a, b) a|b
  SHOW(F2((1,
           2),
          h(3, 4)));
  // Deferred expansion needs another scan.
#define E()
#define D(x) x E()
#define A0() 1
#define SCAN(...) __VA_ARGS__
  SHOW(D(A0) () SCAN(D(A0) ()));
  // An identical redefinition is silent; #undef and define again is a new macro.
#define R 1 + 2
#define R 1  +  2
  SHOW(R);
#undef R
#define R 2
  SHOW(R);
  // The builtin macros.
  printf("%d %d %s %d %d %d %ld\n", __LINE__, __INCLUDE_LEVEL__, sizeof(__FILE__) > 1 ? "file" : "", __COUNTER__, __COUNTER__, (int)sizeof(__DATE__ __TIME__), __STDC_VERSION__ >= 201112L ? 1L : 0L);
#define L __LINE__
  printf("%d\n", L -
                     __LINE__);
  _Pragma("GCC diagnostic push") puts("a b"); _Pragma("GCC diagnostic pop")
#line 100 "other.c"
  printf("%d %s\n", __LINE__, __FILE__);

  // Conditionals.
#undef A
#if defined(A) && A > 1
  puts("no");
#elif !defined B
  puts("elif !defined");
#else
  puts("no");
#endif
#ifdef A
  puts("no");
#elifdef A
  puts("no");
#elifndef A
  puts("elifndef");
#endif
#define A 5
#if defined(A) && A > 1
  puts("defined and greater");
#endif
  // Arithmetic is done in intmax_t and uintmax_t.
#if -1 < 0u
  puts("no");
#else
  puts("-1 is not less than 0u");
#endif
#if (2 + 3) * 4 == 20 && 7 / 2 == 3 && -7 % 3 == -1 && (1 << 62) > 0 && 0x7fffffffffffffff + 1u > 0
  puts("arithmetic");
#endif
#if 'a' == 97 && '\n' == 10
  puts("characters");
#endif
  // What is not evaluated may be anything.
#if 1 ? 2 : (1 / 0)
  puts("conditional");
#endif
#if 0 && (1 / 0)
#else
  puts("short circuit");
#endif
#if UNKNOWN == 0 && !true_is_unknown
  puts("unknown identifiers are 0");
#endif
  // Skipped groups are lexed loosely and their directives ignored.
#if 0
#error don't
'unterminated "x
#bogus
#include <nothing.h>
#if 1
#else
#endif
#else
  puts("skipped group");
#endif
#
#pragma whatever
#ident "v"
  // Feature tests.
#ifdef __has_include
#if __has_include(<stddef.h>) && !__has_include("nope.h") && !__has_include(<nope.h>)
  puts("__has_include");
#endif
#endif
  // A stray quote in the arguments of a macro that drops them never reaches the compiler.
#define EAT(x)
  EAT(
  don't
  )
  puts("eaten");
  return 0;
}

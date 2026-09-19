// From chibicc (https://github.com/rui314/chibicc), test/unicode.c, MIT licence: see LICENSE and NOTICE in this directory.
// Changed here: test.h (as the standard headers it stands for) and the helper translation unit ("common") are
// folded into the file; ASSERT prints the value of every expression it checks and counts a failed check instead of
// ending the program, which ends by printing how many checks were made.
#define ASSERT(x, y) assert(x, y, #y)

static int checks_made, checks_wrong;
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
void assert(int expected, int actual, char *code);
static int checks_done(void);

#define STR(x) #x

typedef unsigned short char16_t;
typedef unsigned int char32_t;
typedef int wchar_t;

int π = 3;

int main() {
  ASSERT(4, sizeof(L'\0'));
  ASSERT(97, L'a');

  ASSERT(0, strcmp("αβγ", "\u03B1\u03B2\u03B3"));
  ASSERT(0, strcmp("日本語", "\u65E5\u672C\u8A9E"));
  ASSERT(0, strcmp("日本語", "\U000065E5\U0000672C\U00008A9E"));
  ASSERT(0, strcmp("🌮", "\U0001F32E"));

  ASSERT(-1, L'\xffffffff'>>31);
  ASSERT(946, L'β');
  ASSERT(12354, L'あ');
  ASSERT(127843, L'🍣');

  ASSERT(2, sizeof(u'\0'));
  ASSERT(1, u'\xffff'>>15);
  ASSERT(97, u'a');
  ASSERT(946, u'β');
  ASSERT(12354, u'あ');

  ASSERT(0, strcmp(STR(u'a'), "u'a'"));

  ASSERT(4, sizeof(U'\0'));
  ASSERT(1, U'\xffffffff'>>31);
  ASSERT(97, U'a');
  ASSERT(946, U'β');
  ASSERT(12354, U'あ');
  ASSERT(127843, U'🍣');

  ASSERT(0, strcmp(STR(U'a'), "U'a'"));

  ASSERT(4, sizeof(u8"abc"));
  ASSERT(0, strcmp(u8"abc", "abc"));

  ASSERT(0, strcmp(STR(u8"a"), "u8\"a\""));

  ASSERT(2, sizeof(u""));
  ASSERT(10, sizeof(u"\xffzzz"));
  ASSERT(0, memcmp(u"", "\0\0", 2));
  ASSERT(0, memcmp(u"abc", "a\0b\0c\0\0\0", 8));
  ASSERT(0, memcmp(u"日本語", "\345e,g\236\212\0\0", 8));
  ASSERT(0, memcmp(u"🍣", "<\330c\337\0\0", 6));
  ASSERT(u'β', u"βb"[0]);
  ASSERT(u'b', u"βb"[1]);
  ASSERT(0, u"βb"[2]);

  ASSERT(0, strcmp(STR(u"a"), "u\"a\""));

  ASSERT(4, sizeof(U""));
  ASSERT(20, sizeof(U"\xffzzz"));
  ASSERT(0, memcmp(U"", "\0\0\0\0", 4));
  ASSERT(0, memcmp(U"abc", "a\0\0\0b\0\0\0c\0\0\0\0\0\0\0", 16));
  ASSERT(0, memcmp(U"日本語", "\345e\0\0,g\0\0\236\212\0\0\0\0\0\0", 16));
  ASSERT(0, memcmp(U"🍣", "c\363\001\0\0\0\0\0", 8));
  ASSERT(u'β', U"βb"[0]);
  ASSERT(u'b', U"βb"[1]);
  ASSERT(0, U"βb"[2]);
  ASSERT(1, U"\xffffffff"[0] >> 31);

  ASSERT(0, strcmp(STR(U"a"), "U\"a\""));

  ASSERT(4, sizeof(L""));
  ASSERT(20, sizeof(L"\xffzzz"));
  ASSERT(0, memcmp(L"", "\0\0\0\0", 4));
  ASSERT(0, memcmp(L"abc", "a\0\0\0b\0\0\0c\0\0\0\0\0\0\0", 16));
  ASSERT(0, memcmp(L"日本語", "\345e\0\0,g\0\0\236\212\0\0\0\0\0\0", 16));
  ASSERT(0, memcmp(L"🍣", "c\363\001\0\0\0\0\0", 8));
  ASSERT(u'β', L"βb"[0]);
  ASSERT(u'b', L"βb"[1]);
  ASSERT(0, L"βb"[2]);
  ASSERT(-1, L"\xffffffff"[0] >> 31);

  ASSERT(0, strcmp(STR(L"a"), "L\"a\""));

  ASSERT(u'α', ({ char16_t x[] = u"αβ"; x[0]; }));
  ASSERT(u'β', ({ char16_t x[] = u"αβ"; x[1]; }));
  ASSERT(6, ({ char16_t x[] = u"αβ"; sizeof(x); }));

  ASSERT(U'🤔', ({ char32_t x[] = U"🤔x"; x[0]; }));
  ASSERT(U'x', ({ char32_t x[] = U"🤔x"; x[1]; }));
  ASSERT(12, ({ char32_t x[] = U"🤔x"; sizeof(x); }));

  ASSERT(L'🤔', ({ wchar_t x[] = L"🤔x"; x[0]; }));
  ASSERT(L'x', ({ wchar_t x[] = L"🤔x"; x[1]; }));
  ASSERT(12, ({ wchar_t x[] = L"🤔x"; sizeof(x); }));

  ASSERT(3, π);
  ASSERT(3, ({ int あβ0¾=3; あβ0¾; }));
  ASSERT(5, ({ int $$$=5; $$$; }));

  return checks_done();
}

// ---- what upstream links every test with (test/common) ----

void assert(int expected, int actual, char *code) {
  checks_made++;
  printf("%s => %d\n", code, actual);
  if (expected != actual) checks_wrong++;
}
static int checks_done(void) {
  printf("%d checks, %d wrong\n", checks_made, checks_wrong);
  return checks_wrong != 0;
}
#include <stdarg.h>


static int static_fn() { return 5; }
int ext1 = 5;
int *ext2 = &ext1;
int ext3 = 7;
int ext_fn1(int x) { return x; }
int ext_fn2(int x) { return x; }
int common_ext2 = 3;
static int common_local;

int false_fn() { return 512; }
int true_fn() { return 513; }
int char_fn() { return (2<<8)+3; }
int short_fn() { return (2<<16)+5; }

int uchar_fn() { return (2<<10)-1-4; }
int ushort_fn() { return (2<<20)-1-7; }

int schar_fn() { return (2<<10)-1-4; }
int sshort_fn() { return (2<<20)-1-7; }

int add_all(int n, ...) {
  va_list ap;
  va_start(ap, n);

  int sum = 0;
  for (int i = 0; i < n; i++)
    sum += va_arg(ap, int);
  return sum;
}

float add_float(float x, float y) {
  return x + y;
}

double add_double(double x, double y) {
  return x + y;
}

int add10_int(int x1, int x2, int x3, int x4, int x5, int x6, int x7, int x8, int x9, int x10) {
  return x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9 + x10;
}

float add10_float(float x1, float x2, float x3, float x4, float x5, float x6, float x7, float x8, float x9, float x10) {
  return x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9 + x10;
}

double add10_double(double x1, double x2, double x3, double x4, double x5, double x6, double x7, double x8, double x9, double x10) {
  return x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9 + x10;
}

typedef struct { int a,b; short c; char d; } Ty4;
typedef struct { int a; float b; double c; } Ty5;
typedef struct { unsigned char a[3]; } Ty6;
typedef struct { long a, b, c; } Ty7;

int struct_test4(Ty4 x, int n) {
  switch (n) {
  case 0: return x.a;
  case 1: return x.b;
  case 2: return x.c;
  default: return x.d;
  }
}

int struct_test5(Ty5 x, int n) {
  switch (n) {
  case 0: return x.a;
  case 1: return x.b;
  default: return x.c;
  }
}

int struct_test6(Ty6 x, int n) {
  return x.a[n];
}

int struct_test7(Ty7 x, int n) {
  switch (n) {
  case 0: return x.a;
  case 1: return x.b;
  default: return x.c;
  }
}

Ty4 struct_test24(void) {
  return (Ty4){10, 20, 30, 40};
}

Ty5 struct_test25(void) {
  return (Ty5){10, 20, 30};
}

Ty6 struct_test26(void) {
  return (Ty6){10, 20, 30};
}

typedef struct { unsigned char a[10]; } Ty20;
typedef struct { unsigned char a[20]; } Ty21;

Ty20 struct_test27(void) {
  return (Ty20){10, 20, 30, 40, 50, 60, 70, 80, 90, 100};
}

Ty21 struct_test28(void) {
  return (Ty21){1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20};
}

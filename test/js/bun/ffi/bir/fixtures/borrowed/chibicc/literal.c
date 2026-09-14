// From chibicc (https://github.com/rui314/chibicc), test/literal.c, MIT licence: see LICENSE and NOTICE in this directory.
// Changed here: test.h (as the standard headers it stands for) and the helper translation unit ("common") are
// folded into the file, a failed ASSERT is
// counted instead of ending the program, and the program ends by printing how many checks were made.
#define ASSERT(x, y) assert(x, y, #y)

static int checks_made, checks_wrong;
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
void assert(int expected, int actual, char *code);
static int checks_done(void);

int main() {
  ASSERT(97, 'a');
  ASSERT(10, '\n');
  ASSERT(-128, '\x80');

  ASSERT(511, 0777);
  ASSERT(0, 0x0);
  ASSERT(10, 0xa);
  ASSERT(10, 0XA);
  ASSERT(48879, 0xbeef);
  ASSERT(48879, 0xBEEF);
  ASSERT(48879, 0XBEEF);
  ASSERT(0, 0b0);
  ASSERT(1, 0b1);
  ASSERT(47, 0b101111);
  ASSERT(47, 0B101111);

  ASSERT(4, sizeof(0));
  ASSERT(8, sizeof(0L));
  ASSERT(8, sizeof(0LU));
  ASSERT(8, sizeof(0UL));
  ASSERT(8, sizeof(0LL));
  ASSERT(8, sizeof(0LLU));
  ASSERT(8, sizeof(0Ull));
  ASSERT(8, sizeof(0l));
  ASSERT(8, sizeof(0ll));
  ASSERT(8, sizeof(0x0L));
  ASSERT(8, sizeof(0b0L));
  ASSERT(4, sizeof(2147483647));
  ASSERT(8, sizeof(2147483648));
  ASSERT(-1, 0xffffffffffffffff);
  ASSERT(8, sizeof(0xffffffffffffffff));
  ASSERT(4, sizeof(4294967295U));
  ASSERT(8, sizeof(4294967296U));

  ASSERT(3, -1U>>30);
  ASSERT(3, -1Ul>>62);
  ASSERT(3, -1ull>>62);

  ASSERT(1, 0xffffffffffffffffl>>63);
  ASSERT(1, 0xffffffffffffffffll>>63);

  ASSERT(-1, 18446744073709551615);

  ASSERT(-1, 0xffffffffffffffff);
  ASSERT(8, sizeof(0xffffffffffffffff));
  ASSERT(1, 0xffffffffffffffff>>63);

  ASSERT(-1, 01777777777777777777777);
  ASSERT(8, sizeof(01777777777777777777777));
  ASSERT(1, 01777777777777777777777>>63);

  ASSERT(-1, 0b1111111111111111111111111111111111111111111111111111111111111111);
  ASSERT(8, sizeof(0b1111111111111111111111111111111111111111111111111111111111111111));
  ASSERT(1, 0b1111111111111111111111111111111111111111111111111111111111111111>>63);

  ASSERT(8, sizeof(2147483648));
  ASSERT(4, sizeof(2147483647));

  ASSERT(8, sizeof(0x1ffffffff));
  ASSERT(4, sizeof(0xffffffff));
  ASSERT(1, 0xffffffff>>31);

  ASSERT(8, sizeof(040000000000));
  ASSERT(4, sizeof(037777777777));
  ASSERT(1, 037777777777>>31);

  ASSERT(8, sizeof(0b111111111111111111111111111111111));
  ASSERT(4, sizeof(0b11111111111111111111111111111111));
  ASSERT(1, 0b11111111111111111111111111111111>>31);

  ASSERT(-1, 1 << 31 >> 31);
  ASSERT(-1, 01 << 31 >> 31);
  ASSERT(-1, 0x1 << 31 >> 31);
  ASSERT(-1, 0b1 << 31 >> 31);

  0.0;
  1.0;
  3e+8;
  0x10.1p0;
  .1E4f;

  ASSERT(4, sizeof(0.3F));
  ASSERT(8, sizeof(0.));
  ASSERT(8, sizeof(.0));
  ASSERT(16, sizeof(5.l));
  ASSERT(16, sizeof(2.0L));

  assert(1, size\
of(char), \
         "sizeof(char)");

  ASSERT(4, sizeof(L'\0'));
  ASSERT(97, L'a');

  return checks_done();
}

// ---- what upstream links every test with (test/common) ----

void assert(int expected, int actual, char *code) {
  checks_made++;
  if (expected != actual) {
    checks_wrong++;
    printf("%s => %d expected but got %d\n", code, expected, actual);
  }
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

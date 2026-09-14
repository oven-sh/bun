// From chibicc (https://github.com/rui314/chibicc), test/struct.c, MIT licence: see LICENSE and NOTICE in this directory.
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

int main() {
  ASSERT(1, ({ struct {int a; int b;} x; x.a=1; x.b=2; x.a; }));
  ASSERT(2, ({ struct {int a; int b;} x; x.a=1; x.b=2; x.b; }));
  ASSERT(1, ({ struct {char a; int b; char c;} x; x.a=1; x.b=2; x.c=3; x.a; }));
  ASSERT(2, ({ struct {char a; int b; char c;} x; x.b=1; x.b=2; x.c=3; x.b; }));
  ASSERT(3, ({ struct {char a; int b; char c;} x; x.a=1; x.b=2; x.c=3; x.c; }));



  ASSERT(6, ({ struct { struct { char b; } a; } x; x.a.b=6; x.a.b; }));

  ASSERT(4, ({ struct {int a;} x; sizeof(x); }));
  ASSERT(8, ({ struct {int a; int b;} x; sizeof(x); }));
  ASSERT(8, ({ struct {int a, b;} x; sizeof(x); }));
  ASSERT(12, ({ struct {int a[3];} x; sizeof(x); }));
  ASSERT(16, ({ struct {int a;} x[4]; sizeof(x); }));
  ASSERT(24, ({ struct {int a[3];} x[2]; sizeof(x); }));
  ASSERT(2, ({ struct {char a; char b;} x; sizeof(x); }));
  ASSERT(0, ({ struct {} x; sizeof(x); }));
  ASSERT(8, ({ struct {char a; int b;} x; sizeof(x); }));
  ASSERT(8, ({ struct {int a; char b;} x; sizeof(x); }));

  ASSERT(8, ({ struct t {int a; int b;} x; struct t y; sizeof(y); }));
  ASSERT(8, ({ struct t {int a; int b;}; struct t y; sizeof(y); }));
  ASSERT(2, ({ struct t {char a[2];}; { struct t {char a[4];}; } struct t y; sizeof(y); }));
  ASSERT(3, ({ struct t {int x;}; int t=1; struct t y; y.x=2; t+y.x; }));

  ASSERT(3, ({ struct t {char a;} x; struct t *y = &x; x.a=3; y->a; }));
  ASSERT(3, ({ struct t {char a;} x; struct t *y = &x; y->a=3; x.a; }));

  ASSERT(3, ({ struct {int a,b;} x,y; x.a=3; y=x; y.a; }));
  ASSERT(7, ({ struct t {int a,b;}; struct t x; x.a=7; struct t y; struct t *z=&y; *z=x; y.a; }));
  ASSERT(7, ({ struct t {int a,b;}; struct t x; x.a=7; struct t y, *p=&x, *q=&y; *q=*p; y.a; }));
  ASSERT(5, ({ struct t {char a, b;} x, y; x.a=5; y=x; y.a; }));

  ASSERT(3, ({ struct {int a,b;} x,y; x.a=3; y=x; y.a; }));
  ASSERT(7, ({ struct t {int a,b;}; struct t x; x.a=7; struct t y; struct t *z=&y; *z=x; y.a; }));
  ASSERT(7, ({ struct t {int a,b;}; struct t x; x.a=7; struct t y, *p=&x, *q=&y; *q=*p; y.a; }));
  ASSERT(5, ({ struct t {char a, b;} x, y; x.a=5; y=x; y.a; }));

  ASSERT(8, ({ struct t {int a; int b;} x; struct t y; sizeof(y); }));
  ASSERT(8, ({ struct t {int a; int b;}; struct t y; sizeof(y); }));

  ASSERT(16, ({ struct {char a; long b;} x; sizeof(x); }));
  ASSERT(4, ({ struct {char a; short b;} x; sizeof(x); }));

  ASSERT(8, ({ struct foo *bar; sizeof(bar); }));
  ASSERT(4, ({ struct T *foo; struct T {int x;}; sizeof(struct T); }));
  ASSERT(1, ({ struct T { struct T *next; int x; } a; struct T b; b.x=1; a.next=&b; a.next->x; }));
  ASSERT(4, ({ typedef struct T T; struct T { int x; }; sizeof(T); }));

  ASSERT(2, ({ struct {int a;} x={1}, y={2}; (x=y).a; }));
  ASSERT(1, ({ struct {int a;} x={1}, y={2}; (1?x:y).a; }));
  ASSERT(2, ({ struct {int a;} x={1}, y={2}; (0?x:y).a; }));

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

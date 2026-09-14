// From chibicc (https://github.com/rui314/chibicc), test/arith.c, MIT licence: see LICENSE and NOTICE in this directory.
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
  ASSERT(0, 0);
  ASSERT(42, 42);
  ASSERT(21, 5+20-4);
  ASSERT(41,  12 + 34 - 5 );
  ASSERT(47, 5+6*7);
  ASSERT(15, 5*(9-6));
  ASSERT(4, (3+5)/2);
  ASSERT(10, -10+20);
  ASSERT(10, - -10);
  ASSERT(10, - - +10);

  ASSERT(0, 0==1);
  ASSERT(1, 42==42);
  ASSERT(1, 0!=1);
  ASSERT(0, 42!=42);

  ASSERT(1, 0<1);
  ASSERT(0, 1<1);
  ASSERT(0, 2<1);
  ASSERT(1, 0<=1);
  ASSERT(1, 1<=1);
  ASSERT(0, 2<=1);

  ASSERT(1, 1>0);
  ASSERT(0, 1>1);
  ASSERT(0, 1>2);
  ASSERT(1, 1>=0);
  ASSERT(1, 1>=1);
  ASSERT(0, 1>=2);

  ASSERT(0, 1073741824 * 100 / 100);

  ASSERT(7, ({ int i=2; i+=5; i; }));
  ASSERT(7, ({ int i=2; i+=5; }));
  ASSERT(3, ({ int i=5; i-=2; i; }));
  ASSERT(3, ({ int i=5; i-=2; }));
  ASSERT(6, ({ int i=3; i*=2; i; }));
  ASSERT(6, ({ int i=3; i*=2; }));
  ASSERT(3, ({ int i=6; i/=2; i; }));
  ASSERT(3, ({ int i=6; i/=2; }));

  ASSERT(3, ({ int i=2; ++i; }));
  ASSERT(2, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; ++*p; }));
  ASSERT(0, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; --*p; }));

  ASSERT(2, ({ int i=2; i++; }));
  ASSERT(2, ({ int i=2; i--; }));
  ASSERT(3, ({ int i=2; i++; i; }));
  ASSERT(1, ({ int i=2; i--; i; }));
  ASSERT(1, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; *p++; }));
  ASSERT(1, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; *p--; }));

  ASSERT(0, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; (*p++)--; a[0]; }));
  ASSERT(0, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; (*(p--))--; a[1]; }));
  ASSERT(2, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; (*p)--; a[2]; }));
  ASSERT(2, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; (*p)--; p++; *p; }));

  ASSERT(0, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; (*p++)--; a[0]; }));
  ASSERT(0, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; (*p++)--; a[1]; }));
  ASSERT(2, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; (*p++)--; a[2]; }));
  ASSERT(2, ({ int a[3]; a[0]=0; a[1]=1; a[2]=2; int *p=a+1; (*p++)--; *p; }));

  ASSERT(0, !1);
  ASSERT(0, !2);
  ASSERT(1, !0);
  ASSERT(1, !(char)0);
  ASSERT(0, !(long)3);
  ASSERT(4, sizeof(!(char)0));
  ASSERT(4, sizeof(!(long)0));

  ASSERT(-1, ~0);
  ASSERT(0, ~-1);

  ASSERT(5, 17%6);
  ASSERT(5, ((long)17)%6);
  ASSERT(2, ({ int i=10; i%=4; i; }));
  ASSERT(2, ({ long i=10; i%=4; i; }));

  ASSERT(0, 0&1);
  ASSERT(1, 3&1);
  ASSERT(3, 7&3);
  ASSERT(10, -1&10);

  ASSERT(1, 0|1);
  ASSERT(0b10011, 0b10000|0b00011);

  ASSERT(0, 0^0);
  ASSERT(0, 0b1111^0b1111);
  ASSERT(0b110100, 0b111000^0b001100);

  ASSERT(2, ({ int i=6; i&=3; i; }));
  ASSERT(7, ({ int i=6; i|=3; i; }));
  ASSERT(10, ({ int i=15; i^=5; i; }));

  ASSERT(1, 1<<0);
  ASSERT(8, 1<<3);
  ASSERT(10, 5<<1);
  ASSERT(2, 5>>1);
  ASSERT(-1, -1>>1);
  ASSERT(1, ({ int i=1; i<<=0; i; }));
  ASSERT(8, ({ int i=1; i<<=3; i; }));
  ASSERT(10, ({ int i=5; i<<=1; i; }));
  ASSERT(2, ({ int i=5; i>>=1; i; }));
  ASSERT(-1, -1);
  ASSERT(-1, ({ int i=-1; i; }));
  ASSERT(-1, ({ int i=-1; i>>=1; i; }));

  ASSERT(2, 0?1:2);
  ASSERT(1, 1?1:2);
  ASSERT(-1, 0?-2:-1);
  ASSERT(-2, 1?-2:-1);
  ASSERT(4, sizeof(0?1:2));
  ASSERT(8, sizeof(0?(long)1:(long)2));
  ASSERT(-1, 0?(long)-2:-1);
  ASSERT(-1, 0?-2:(long)-1);
  ASSERT(-2, 1?(long)-2:-1);
  ASSERT(-2, 1?-2:(long)-1);

  1 ? -2 : (void)-1;

  ASSERT(20, ({ int x; int *p=&x; p+20-p; }));
  ASSERT(1, ({ int x; int *p=&x; p+20-p>0; }));
  ASSERT(-20, ({ int x; int *p=&x; p-20-p; }));
  ASSERT(1, ({ int x; int *p=&x; p-20-p<0; }));

  ASSERT(15, (char *)0xffffffffffffffff - (char *)0xfffffffffffffff0);
  ASSERT(-15, (char *)0xfffffffffffffff0 - (char *)0xffffffffffffffff);
  ASSERT(1, (void *)0xffffffffffffffff > (void *)0);

  ASSERT(3, 3?:5);
  ASSERT(5, 0?:5);
  ASSERT(4, ({ int i = 3; ++i?:10; }));

  ASSERT(3, (long double)3);
  ASSERT(5, (long double)3+2);
  ASSERT(6, (long double)3*2);
  ASSERT(5, (long double)3+2.0);

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

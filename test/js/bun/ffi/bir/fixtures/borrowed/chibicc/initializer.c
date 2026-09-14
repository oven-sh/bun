// From chibicc (https://github.com/rui314/chibicc), test/initializer.c, MIT licence: see LICENSE and NOTICE in this directory.
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

char g3 = 3;
short g4 = 4;
int g5 = 5;
long g6 = 6;
int g9[3] = {0, 1, 2};
struct {char a; int b;} g11[2] = {{1, 2}, {3, 4}};
struct {int a[2];} g12[2] = {{{1, 2}}};
union { int a; char b[8]; } g13[2] = {0x01020304, 0x05060708};
char g17[] = "foobar";
char g18[10] = "foobar";
char g19[3] = "foobar";
char *g20 = g17+0;
char *g21 = g17+3;
char *g23[] = {g17+0, g17+3, g17-3};
int g24=3;
int *g25=&g24;
int g26[3] = {1, 2, 3};
int *g27 = g26 + 1;
long g29 = (long)(long)g26;
struct { struct { int a[3]; } a; } g30 = {{{1,2,3}}};
int *g31=g30.a.a;
struct {int a[2];} g40[2] = {{1, 2}, 3, 4};
struct {int a[2];} g41[2] = {1, 2, 3, 4};
char g43[][4] = {'f', 'o', 'o', 0, 'b', 'a', 'r', 0};
char *g44 = {"foo"};
union { int a; char b[4]; } g50 = {.b[2]=0x12};
union { int a; } g51[2] = {};

typedef char T60[];
T60 g60 = {1, 2, 3};
T60 g61 = {1, 2, 3, 4, 5, 6};

typedef struct { char a, b[]; } T65;
T65 g65 = {'f','o','o',0};
T65 g66 = {'f','o','o','b','a','r',0};

int main() {
  ASSERT(1, ({ int x[3]={1,2,3}; x[0]; }));
  ASSERT(2, ({ int x[3]={1,2,3}; x[1]; }));
  ASSERT(3, ({ int x[3]={1,2,3}; x[2]; }));
  ASSERT(3, ({ int x[3]={1,2,3}; x[2]; }));

  ASSERT(2, ({ int x[2][3]={{1,2,3},{4,5,6}}; x[0][1]; }));
  ASSERT(4, ({ int x[2][3]={{1,2,3},{4,5,6}}; x[1][0]; }));
  ASSERT(6, ({ int x[2][3]={{1,2,3},{4,5,6}}; x[1][2]; }));

  ASSERT(0, ({ int x[3]={}; x[0]; }));
  ASSERT(0, ({ int x[3]={}; x[1]; }));
  ASSERT(0, ({ int x[3]={}; x[2]; }));

  ASSERT(2, ({ int x[2][3]={{1,2}}; x[0][1]; }));
  ASSERT(0, ({ int x[2][3]={{1,2}}; x[1][0]; }));
  ASSERT(0, ({ int x[2][3]={{1,2}}; x[1][2]; }));

  ASSERT('a', ({ char x[4]="abc"; x[0]; }));
  ASSERT('c', ({ char x[4]="abc"; x[2]; }));
  ASSERT(0, ({ char x[4]="abc"; x[3]; }));
  ASSERT('a', ({ char x[2][4]={"abc","def"}; x[0][0]; }));
  ASSERT(0, ({ char x[2][4]={"abc","def"}; x[0][3]; }));
  ASSERT('d', ({ char x[2][4]={"abc","def"}; x[1][0]; }));
  ASSERT('f', ({ char x[2][4]={"abc","def"}; x[1][2]; }));

  ASSERT(4, ({ int x[]={1,2,3,4}; x[3]; }));
  ASSERT(16, ({ int x[]={1,2,3,4}; sizeof(x); }));
  ASSERT(4, ({ char x[]="foo"; sizeof(x); }));

  ASSERT(4, ({ typedef char T[]; T x="foo"; T y="x"; sizeof(x); }));
  ASSERT(2, ({ typedef char T[]; T x="foo"; T y="x"; sizeof(y); }));
  ASSERT(2, ({ typedef char T[]; T x="x"; T y="foo"; sizeof(x); }));
  ASSERT(4, ({ typedef char T[]; T x="x"; T y="foo"; sizeof(y); }));

  ASSERT(1, ({ struct {int a; int b; int c;} x={1,2,3}; x.a; }));
  ASSERT(2, ({ struct {int a; int b; int c;} x={1,2,3}; x.b; }));
  ASSERT(3, ({ struct {int a; int b; int c;} x={1,2,3}; x.c; }));
  ASSERT(1, ({ struct {int a; int b; int c;} x={1}; x.a; }));
  ASSERT(0, ({ struct {int a; int b; int c;} x={1}; x.b; }));
  ASSERT(0, ({ struct {int a; int b; int c;} x={1}; x.c; }));

  ASSERT(1, ({ struct {int a; int b;} x[2]={{1,2},{3,4}}; x[0].a; }));
  ASSERT(2, ({ struct {int a; int b;} x[2]={{1,2},{3,4}}; x[0].b; }));
  ASSERT(3, ({ struct {int a; int b;} x[2]={{1,2},{3,4}}; x[1].a; }));
  ASSERT(4, ({ struct {int a; int b;} x[2]={{1,2},{3,4}}; x[1].b; }));

  ASSERT(0, ({ struct {int a; int b;} x[2]={{1,2}}; x[1].b; }));

  ASSERT(0, ({ struct {int a; int b;} x={}; x.a; }));
  ASSERT(0, ({ struct {int a; int b;} x={}; x.b; }));

  ASSERT(5, ({ typedef struct {int a,b,c,d,e,f;} T; T x={1,2,3,4,5,6}; T y; y=x; y.e; }));
  ASSERT(2, ({ typedef struct {int a,b;} T; T x={1,2}; T y, z; z=y=x; z.b; }));

  ASSERT(1, ({ typedef struct {int a,b;} T; T x={1,2}; T y=x; y.a; }));

  ASSERT(4, ({ union { int a; char b[4]; } x={0x01020304}; x.b[0]; }));
  ASSERT(3, ({ union { int a; char b[4]; } x={0x01020304}; x.b[1]; }));

  ASSERT(0x01020304, ({ union { struct { char a,b,c,d; } e; int f; } x={{4,3,2,1}}; x.f; }));

  ASSERT(3, g3);
  ASSERT(4, g4);
  ASSERT(5, g5);
  ASSERT(6, g6);

  ASSERT(0, g9[0]);
  ASSERT(1, g9[1]);
  ASSERT(2, g9[2]);

  ASSERT(1, g11[0].a);
  ASSERT(2, g11[0].b);
  ASSERT(3, g11[1].a);
  ASSERT(4, g11[1].b);

  ASSERT(1, g12[0].a[0]);
  ASSERT(2, g12[0].a[1]);
  ASSERT(0, g12[1].a[0]);
  ASSERT(0, g12[1].a[1]);

  ASSERT(4, g13[0].b[0]);
  ASSERT(3, g13[0].b[1]);
  ASSERT(8, g13[1].b[0]);
  ASSERT(7, g13[1].b[1]);

  ASSERT(7, sizeof(g17));
  ASSERT(10, sizeof(g18));
  ASSERT(3, sizeof(g19));

  ASSERT(0, memcmp(g17, "foobar", 7));
  ASSERT(0, memcmp(g18, "foobar\0\0\0", 10));
  ASSERT(0, memcmp(g19, "foo", 3));

  ASSERT(0, strcmp(g20, "foobar"));
  ASSERT(0, strcmp(g21, "bar"));

  ASSERT(0, strcmp(g23[0], "foobar"));
  ASSERT(0, strcmp(g23[1], "bar"));
  ASSERT(0, strcmp(g23[2]+3, "foobar"));

  ASSERT(3, g24);
  ASSERT(3, *g25);
  ASSERT(2, *g27);
  ASSERT(1, *(int *)g29);

  ASSERT(1, g31[0]);
  ASSERT(2, g31[1]);
  ASSERT(3, g31[2]);

  ASSERT(1, g40[0].a[0]);
  ASSERT(2, g40[0].a[1]);
  ASSERT(3, g40[1].a[0]);
  ASSERT(4, g40[1].a[1]);

  ASSERT(1, g41[0].a[0]);
  ASSERT(2, g41[0].a[1]);
  ASSERT(3, g41[1].a[0]);
  ASSERT(4, g41[1].a[1]);

  ASSERT(0, ({ int x[2][3]={0,1,2,3,4,5}; x[0][0]; }));
  ASSERT(3, ({ int x[2][3]={0,1,2,3,4,5}; x[1][0]; }));

  ASSERT(0, ({ struct {int a; int b;} x[2]={0,1,2,3}; x[0].a; }));
  ASSERT(2, ({ struct {int a; int b;} x[2]={0,1,2,3}; x[1].a; }));

  ASSERT(0, strcmp(g43[0], "foo"));
  ASSERT(0, strcmp(g43[1], "bar"));
  ASSERT(0, strcmp(g44, "foo"));

  ASSERT(3, ({ int a[]={1,2,3,}; a[2]; }));
  ASSERT(1, ({ struct {int a,b,c;} x={1,2,3,}; x.a; }));
  ASSERT(1, ({ union {int a; char b;} x={1,}; x.a; }));
  ASSERT(2, ({ enum {x,y,z,}; z; }));

  ASSERT(3, sizeof(g60));
  ASSERT(6, sizeof(g61));

  ASSERT(0, strcmp(g65.b, "oo"));
  ASSERT(0, strcmp(g66.b, "oobar"));

  ASSERT(4, ({ int x[3]={1, 2, 3, [0]=4, 5}; x[0]; }));
  ASSERT(5, ({ int x[3]={1, 2, 3, [0]=4, 5}; x[1]; }));
  ASSERT(3, ({ int x[3]={1, 2, 3, [0]=4, 5}; x[2]; }));

  ASSERT(10, ({ int x[2][3]={1,2,3,4,5,6,[0][1]=7,8,[0]=9,[0]=10,11,[1][0]=12}; x[0][0]; }));
  ASSERT(11, ({ int x[2][3]={1,2,3,4,5,6,[0][1]=7,8,[0]=9,[0]=10,11,[1][0]=12}; x[0][1]; }));
  ASSERT(8, ({ int x[2][3]={1,2,3,4,5,6,[0][1]=7,8,[0]=9,[0]=10,11,[1][0]=12}; x[0][2]; }));
  ASSERT(12, ({ int x[2][3]={1,2,3,4,5,6,[0][1]=7,8,[0]=9,[0]=10,11,[1][0]=12}; x[1][0]; }));
  ASSERT(5, ({ int x[2][3]={1,2,3,4,5,6,[0][1]=7,8,[0]=9,[0]=10,11,[1][0]=12}; x[1][1]; }));
  ASSERT(6, ({ int x[2][3]={1,2,3,4,5,6,[0][1]=7,8,[0]=9,[0]=10,11,[1][0]=12}; x[1][2]; }));

  ASSERT(7, ({ int x[2][3]={1,2,3,4,5,6,[0]={7,8},9,10}; x[0][0]; }));
  ASSERT(8, ({ int x[2][3]={1,2,3,4,5,6,[0]={7,8},9,10}; x[0][1]; }));
  ASSERT(9, ({ int x[2][3]={1,2,3,4,5,6,[0]={7,8},9,10}; x[1][0]; }));
  ASSERT(10, ({ int x[2][3]={1,2,3,4,5,6,[0]={7,8},9,10}; x[1][1]; }));
  ASSERT(6, ({ int x[2][3]={1,2,3,4,5,6,[0]={7,8},9,10}; x[1][2]; }));

  ASSERT(7, ((int[10]){ [3]=7 })[3]);
  ASSERT(0, ((int[10]){ [3]=7 })[4]);

  ASSERT(10, ({ char x[]={[10-3]=1,2,3}; sizeof(x); }));
  ASSERT(20, ({ char x[][2]={[8][1]=1,2}; sizeof(x); }));

  ASSERT(3, sizeof(g60));
  ASSERT(6, sizeof(g61));

  ASSERT(0, strcmp(g65.b, "oo"));
  ASSERT(0, strcmp(g66.b, "oobar"));

  ASSERT(7, ((int[10]){ [3] 7 })[3]);
  ASSERT(0, ((int[10]){ [3] 7 })[4]);

  ASSERT(4, ({ struct { int a,b; } x={1,2,.b=3,.a=4}; x.a; }));
  ASSERT(3, ({ struct { int a,b; } x={1,2,.b=3,.a=4}; x.b; }));

  ASSERT(1, ({ struct { struct { int a,b; } c; } x={.c=1,2}; x.c.a; }));
  ASSERT(2, ({ struct { struct { int a,b; } c; } x={.c=1,2}; x.c.b; }));

  ASSERT(0, ({ struct { struct { int a,b; } c; } x={.c.b=1}; x.c.a; }));
  ASSERT(1, ({ struct { struct { int a,b; } c; } x={.c.b=1}; x.c.b; }));

  ASSERT(1, ({ struct { int a[2]; } x={.a=1,2}; x.a[0]; }));
  ASSERT(2, ({ struct { int a[2]; } x={.a=1,2}; x.a[1]; }));

  ASSERT(0, ({ struct { int a[2]; } x={.a[1]=1}; x.a[0]; }));
  ASSERT(1, ({ struct { int a[2]; } x={.a[1]=1}; x.a[1]; }));

  ASSERT(3, ({ struct { int a,b; } x[]={[1].b=1,2,[0]=3,4,}; x[0].a; }));
  ASSERT(4, ({ struct { int a,b; } x[]={[1].b=1,2,[0]=3,4,}; x[0].b; }));
  ASSERT(0, ({ struct { int a,b; } x[]={[1].b=1,2,[0]=3,4,}; x[1].a; }));
  ASSERT(1, ({ struct { int a,b; } x[]={[1].b=1,2,[0]=3,4,}; x[1].b; }));
  ASSERT(2, ({ struct { int a,b; } x[]={[1].b=1,2,[0]=3,4,}; x[2].a; }));
  ASSERT(0, ({ struct { int a,b; } x[]={[1].b=1,2,[0]=3,4,}; x[2].b; }));

  ASSERT(1, ({ typedef struct { int a,b; } T; T x={1,2}; T y[]={x}; y[0].a; }));
  ASSERT(2, ({ typedef struct { int a,b; } T; T x={1,2}; T y[]={x}; y[0].b; }));
  ASSERT(3, ({ typedef struct { int a,b; } T; T x={1,2}; T y[]={x, [0].b=3}; y[0].b; }));

  ASSERT(5, ((struct { int a,b,c; }){ .c=5 }).c);
  ASSERT(0, ((struct { int a,b,c; }){ .c=5 }).a);

  ASSERT(0x00ff, ({ union { unsigned short a; char b[2]; } x={.b[0]=0xff}; x.a; }));
  ASSERT(0xff00, ({ union { unsigned short a; char b[2]; } x={.b[1]=0xff}; x.a; }));

  ASSERT(0x00120000, g50.a);
  ASSERT(0, g51[0].a);
  ASSERT(0, g51[1].a);

  ASSERT(1, ({ struct { struct { int a; struct { int b; }; }; int c; } x={1,2,3,.b=4,5}; x.a; }));
  ASSERT(4, ({ struct { struct { int a; struct { int b; }; }; int c; } x={1,2,3,.b=4,5}; x.b; }));
  ASSERT(5, ({ struct { struct { int a; struct { int b; }; }; int c; } x={1,2,3,.b=4,5}; x.c; }));

  ASSERT(16, ({ char x[]={[2 ... 10]='a', [7]='b', [15 ... 15]='c', [3 ... 5]='d'}; sizeof(x); }));
  ASSERT(0, ({ char x[]={[2 ... 10]='a', [7]='b', [15 ... 15]='c', [3 ... 5]='d'}; memcmp(x, "\0\0adddabaaa\0\0\0\0c", 16); }));

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

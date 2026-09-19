// A run of labels on one statement and a chain of `else if` are as long as the program needs them: generated lexers,
// option tables and character-class switches have thousands. Neither is nesting (C11 5.2.4.1 limits nesting only).
#include <stdio.h>

// Ten thousand consecutive case labels, written by macros that paste the digits together.
#define D10(m, p) m(p##0) m(p##1) m(p##2) m(p##3) m(p##4) m(p##5) m(p##6) m(p##7) m(p##8) m(p##9)
#define D100(m, p) D10(m, p##0) D10(m, p##1) D10(m, p##2) D10(m, p##3) D10(m, p##4) D10(m, p##5) D10(m, p##6) D10(m, p##7) D10(m, p##8) D10(m, p##9)
#define D1000(m, p) D100(m, p##0) D100(m, p##1) D100(m, p##2) D100(m, p##3) D100(m, p##4) D100(m, p##5) D100(m, p##6) D100(m, p##7) D100(m, p##8) D100(m, p##9)
#define CASE(n) case 1##n:
#define LABEL(n) l##n:
#define ELSE_IF(n) else if (x == 1##n) r = 1##n - 10000 + 1;

static int classify(int x) {
  switch (x) {
    D1000(CASE, 0) D1000(CASE, 1) D1000(CASE, 2) D1000(CASE, 3) D1000(CASE, 4)
      return 1;
    case 5:
    D1000(CASE, 5) default: D1000(CASE, 6) case 20000 ... 29999: D1000(CASE, 7)
      return 2;
    D1000(CASE, 8) __attribute__((fallthrough)); D1000(CASE, 9)
      return 3;
  }
}

static int labelled(int x) {
  if (x) goto l0777;
  D1000(LABEL, 0)
  return x + 1;
}

static int chain(int x) {
  int r;
  if (x == 0) r = -1;
  D1000(ELSE_IF, 0) D1000(ELSE_IF, 1)
  else r = -2;
  return r;
}

static int chain_without_else(int x) {
  int r = -3;
  if (x == 0) r = -1;
  D1000(ELSE_IF, 0)
  return r;
}

// The arms are blocks of their own and can declare, jump out of and nest what they like.
static int arms(int x) {
  for (int i = 0; i < 3; i++) {
    if (x == i) { int local = i * 10; if (local) return local; else continue; }
    else if (x == i + 10) break;
    else if (x == i + 20) { switch (i) { case 0: return 100; default: return 200; } }
    else if (x == i + 30) goto out;
  }
  return -1;
out:
  return -2;
}

int main(void) {
  printf("%d %d %d %d %d %d\n", classify(10000), classify(14999), classify(15000), classify(16000), classify(17999), classify(5));
  printf("%d %d %d %d %d\n", classify(18000), classify(19999), classify(25000), classify(-1), classify(30000));
  printf("%d %d\n", labelled(0), labelled(1));
  printf("%d %d %d %d %d %d\n", chain(0), chain(10000), chain(10001), chain(11999), chain(12000), chain(-5));
  printf("%d %d %d %d\n", chain_without_else(0), chain_without_else(10999), chain_without_else(11000), chain_without_else(10500));
  printf("%d %d %d %d %d %d\n", arms(0), arms(1), arms(10), arms(20), arms(21), arms(32));
  return 0;
}

// Where the x86-64 System V ABI puts a structure, checked against the ABI itself rather than against this compiler's
// other half: a function that takes the structure is called through a pointer to a function that takes plain scalars,
// and the other way round. Scalars go in rdi, rsi, rdx, ... and xmm0, xmm1, ... in order, which nobody gets wrong, so the
// scalars say which registers the structure's eightbytes were in. (Calling through a pointer of another type is outside
// the C standard; it is exactly what two separately compiled halves of a program do to each other.)
#include <stdio.h>
#include <string.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

// An eightbyte no member reaches into has no class and is not passed at all (psABI 3.2.3): these take one register.
typedef struct { long a; } __attribute__((aligned(16))) AL16;
typedef struct { double d; } __attribute__((aligned(16))) AL16D;
typedef struct { float f; } __attribute__((aligned(16))) AL16F;
typedef struct { _Alignas(16) char c; } AL16C;
// No padding eightbyte here: two registers.
typedef struct { long a, b; } __attribute__((aligned(16))) AL16_2;
// Two eightbytes of different classes: one general register and one vector register.
typedef struct { double a; int b; } DI;
typedef struct { int a; double b; } ID;
typedef struct { int a; float b; double c; } IFD;
typedef struct { char a; double b; } CD;
typedef struct { float a[2]; long b; } F2L;
// More than two eightbytes, or an unaligned member: memory.
typedef struct { long a, b, c; } MEM;

#define NOINLINE __attribute__((noinline))
// The address of a function with nothing left that says which function: what the other half of a program would hold.
static void *opaque(void *function) { __asm__ volatile("" : "+r"(function)); return function; }
#define AS(type, function) ((type)opaque((void *)(function)))
// The scalar side. (The bytes of an eightbyte that no member covers are anything: they are masked away.)
static NOINLINE long first_integer(long a) { return a; }
static NOINLINE long second_integer(long a, long b) { (void)a; return b; }
static NOINLINE long third_integer(long a, long b, long c) { (void)a; (void)b; return c; }
static NOINLINE long first_two_integers(long a, long b) { return a * 1000 + b; }
static NOINLINE long low_byte_then_integer(long a, long b) { return (a & 0xff) * 1000 + b; }
static NOINLINE long double_then_integer(double x, long a) { return (long)(x * 4) * 1000 + a; }
static NOINLINE long float_then_integer(float f, long a) { return (long)(f * 4) * 1000 + a; }
static NOINLINE long double_word_integer(double x, long word, long a) { return (long)(x * 4) * 1000000 + (word & 0xffffffff) * 1000 + a; }
static NOINLINE long word_double_integer(long word, double x, long a) { return (long)(x * 4) * 1000000 + (word & 0xffffffff) * 1000 + a; }
static NOINLINE long byte_double_integer(long byte, double x, long a) { return (long)(x * 4) * 1000000 + (byte & 0xff) * 1000 + a; }
static NOINLINE long two_words_double_integer(long words, double x, long a) {
  float second;
  int high = (int)(words >> 32);
  memcpy(&second, &high, 4);
  return (long)(x * 4) * 1000000 + (words & 0xffffffff) * 10000 + (long)(second * 4) * 100 + a;
}
static NOINLINE long float_integer_integer(float first, long b, long a) { return (long)(first * 4) * 1000000 + b * 1000 + a; }

// The structure side.
static NOINLINE long takes_al16(AL16 s, long after) { return s.a * 1000 + after; }
static NOINLINE long takes_al16d(AL16D s, long after) { return (long)(s.d * 4) * 1000 + after; }
static NOINLINE long takes_al16_after_five(long a, long b, long c, long d, long e, AL16 s, long after) { return a + b + c + d + e + s.a * 1000 + after * 100000; }
static NOINLINE long takes_di(DI s, long after) { return (long)(s.a * 4) * 1000000 + s.b * 1000 + after; }
static NOINLINE long takes_id(ID s, long after) { return (long)(s.b * 4) * 1000000 + s.a * 1000 + after; }
static NOINLINE long takes_cd(CD s, long after) { return (long)(s.b * 4) * 1000000 + s.a * 1000 + after; }
static NOINLINE AL16 returns_al16(long v) { AL16 s = { v }; return s; }
static NOINLINE AL16D returns_al16d(double v) { AL16D s = { v }; return s; }
static NOINLINE DI returns_di(double a, int b) { DI s = { a, b }; return s; }

static long sum_variadic(int n, ...) {
  __builtin_va_list ap;
  __builtin_va_start(ap, n);
  long total = 0;
  for (int i = 0; i < n; i++) {
    AL16 s = __builtin_va_arg(ap, AL16);
    long after = __builtin_va_arg(ap, long);
    total = total * 100 + s.a * 10 + after;
  }
  __builtin_va_end(ap);
  return total;
}
static NOINLINE long variadic_scalars(int n, ...) {
  __builtin_va_list ap;
  __builtin_va_start(ap, n);
  long total = 0;
  for (int i = 0; i < n; i++) total = total * 10 + __builtin_va_arg(ap, long);
  __builtin_va_end(ap);
  return total;
}

int main(void) {
  AL16 s = { 7 };
  AL16D d = { 2.5 };
  AL16F f = { 1.25f };
  AL16C c = { 9 };
  AL16_2 two = { 3, 4 };
  DI di = { 2.5, 6 };
  ID id = { 6, 2.5 };
  IFD ifd = { 6, 1.25f, 2.5 };
  CD cd = { 5, 2.5 };
  F2L f2l = { { 1.25f, 0 }, 8 };
  MEM mem = { 1, 2, 3 };

  // This compiler passes; scalars receive.
  CHECK(AS(long (*)(AL16, long), second_integer)(s, 42) == 42);
  CHECK(AS(long (*)(AL16, long), first_two_integers)(s, 42) == 7042);
  CHECK(AS(long (*)(AL16C, long), low_byte_then_integer)(c, 42) == 9042);
  CHECK(AS(long (*)(AL16D, long), double_then_integer)(d, 42) == 10042);
  CHECK(AS(long (*)(AL16F, long), float_then_integer)(f, 42) == 5042);
  CHECK(AS(long (*)(AL16_2, long), third_integer)(two, 42) == 42);
  CHECK(AS(long (*)(long, long, long, long, long, AL16, long), takes_al16_after_five)(1, 2, 3, 4, 5, s, 9) == 15 + 7000 + 900000);
  CHECK(AS(long (*)(DI, long), double_word_integer)(di, 42) == 10006042);
  CHECK(AS(long (*)(ID, long), word_double_integer)(id, 42) == 10006042);
  CHECK(AS(long (*)(CD, long), byte_double_integer)(cd, 42) == 10005042);
  CHECK(AS(long (*)(IFD, long), two_words_double_integer)(ifd, 42) == 10060542);
  CHECK(AS(long (*)(F2L, long), float_integer_integer)(f2l, 42) == 5008042);
  CHECK(AS(long (*)(MEM, long), first_integer)(mem, 42) == 42);

  // Scalars pass; this compiler receives.
  CHECK(AS(long (*)(long, long), takes_al16)(7, 5) == 7005);
  CHECK(AS(long (*)(double, long), takes_al16d)(2.5, 5) == 10005);
  CHECK(AS(long (*)(long, long, long, long, long, long, long), takes_al16_after_five)(1, 2, 3, 4, 5, 7, 9) == 15 + 7000 + 900000);
  CHECK(AS(long (*)(double, long, long), takes_di)(2.5, 6, 5) == 10006005);
  CHECK(AS(long (*)(long, double, long), takes_id)(6, 2.5, 5) == 10006005);
  CHECK(AS(long (*)(long, double, long), takes_cd)(5, 2.5, 5) == 10005005);
  // Results: rax for the one general eightbyte, xmm0 for the one vector eightbyte, both for one of each.
  CHECK(AS(long (*)(long), returns_al16)(77) == 77);
  CHECK(AS(double (*)(double), returns_al16d)(2.5) == 2.5);
  CHECK(AS(double (*)(double, int), returns_di)(2.5, 6) == 2.5 && (AS(long (*)(double, int), returns_di)(2.5, 6) & 0xffffffff) == 6);
  // Through an ellipsis the rules are the same, in both directions.
  CHECK(sum_variadic(2, s, 5L, (AL16){ 3 }, 4L) == (7 * 10 + 5) * 100 + 3 * 10 + 4);
  CHECK(variadic_scalars(4, s, 5L, (AL16){ 3 }, 4L) == 7534);
  CHECK(AS(long (*)(int, ...), sum_variadic)(2, 7L, 5L, 3L, 4L) == 7534);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

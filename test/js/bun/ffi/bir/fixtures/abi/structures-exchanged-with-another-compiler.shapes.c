// The shapes both sides agree to exchange, and for each what both need: a way to fill one from a seed and a way to
// reduce one to a number that ignores padding. Both compilers compile this file: this one as an include of the
// fixture, the other one (with THEIR_SIDE defined) by itself.
#ifndef SHAPES_H
#define SHAPES_H

typedef struct { char a; } S1;
typedef struct { char a, b, c; } S3;
typedef struct { short a; char b; } S4;
typedef struct { char a[5]; } S5;
typedef struct { int a; char b[3]; } S7;
typedef struct { long long a; } S8;
typedef struct { char a[9]; } S9;
typedef struct { int a, b, c; } S12;
typedef struct { long long a; int b; } S12B;
typedef struct { long long a, b; } S16;
typedef struct { char a[17]; } S17;
typedef struct { long long a, b, c; } S24;
typedef struct { float a; } F1;
typedef struct { float a, b; } F2;
typedef struct { float a, b, c; } F3;
typedef struct { float a, b, c, d; } F4;
typedef struct { double a; } D1;
typedef struct { double a, b; } D2;
typedef struct { double a, b, c; } D3;
typedef struct { double a, b, c, d; } D4;
typedef struct { float a; int b; } FI;
typedef struct { int a; float b; } IF;
typedef struct { float a, b; double c; } FFD;
typedef struct { double a; float b, c; } DFF;
typedef union { long long a; double b; } ULD;
typedef union { float a; int b; } UFI;
typedef struct { struct { float x, y; } p; float z; } NEST_F;
typedef struct { struct { int x; double y; } p; int z; } NEST_M;

// The union a C library takes an x87 `long double` apart with, and its like: integers over both halves of the long
// double make two integers of it, for every compiler.
#if defined __x86_64__ && !defined _WIN32
typedef union { long double f; struct { unsigned long long m; unsigned short se; } i; } LDSHAPE;
typedef union { long double f; int words[4]; } LDWORDS;
#define X87_SHAPES(X) X(LDSHAPE) X(LDWORDS)
#define X87_SHAPE_COUNT 2
#else
#define X87_SHAPES(X)
#define X87_SHAPE_COUNT 0
#endif

// (A structure of two eightbytes of different classes, like { double; int; }, is not here: on x86-64 TinyCC passes it in
// two integer registers, which is not what the System V ABI says. Those are pinned in register-images-of-structures-*.)
#define EVERY_SHAPE(X) \
  X(S1) X(S3) X(S4) X(S5) X(S7) X(S8) X(S9) X(S12) X(S12B) X(S16) X(S17) X(S24) X(F1) X(F2) X(F3) X(F4) X(D1) X(D2) X(D3) X(D4) \
  X(FI) X(IF) X(FFD) X(DFF) X(ULD) X(UFI) X(NEST_F) X(NEST_M) X87_SHAPES(X)

// One value per scalar member, so a member that arrived in the wrong register shows.
#define H(h, v) ((h) * 31 + (long long)((v) * 8))
static long long hash_S1(const S1 *s) { return H(7, s->a); }
static void fill_S1(S1 *s, int k) { s->a = (char)(k + 1); }
static long long hash_S3(const S3 *s) { return H(H(H(7, s->a), s->b), s->c); }
static void fill_S3(S3 *s, int k) { s->a = (char)(k + 1); s->b = (char)(k + 2); s->c = (char)(k + 3); }
static long long hash_S4(const S4 *s) { return H(H(7, s->a), s->b); }
static void fill_S4(S4 *s, int k) { s->a = (short)(k * 100 + 1); s->b = (char)(k + 2); }
static long long hash_S5(const S5 *s) { long long h = 7; for (int i = 0; i < 5; i++) h = H(h, s->a[i]); return h; }
static void fill_S5(S5 *s, int k) { for (int i = 0; i < 5; i++) s->a[i] = (char)(k + i + 1); }
static long long hash_S7(const S7 *s) { long long h = H(7, s->a); for (int i = 0; i < 3; i++) h = H(h, s->b[i]); return h; }
static void fill_S7(S7 *s, int k) { s->a = k * 1000 + 1; for (int i = 0; i < 3; i++) s->b[i] = (char)(k + i + 2); }
static long long hash_S8(const S8 *s) { return H(7, s->a); }
static void fill_S8(S8 *s, int k) { s->a = k * 100000LL + 1; }
static long long hash_S9(const S9 *s) { long long h = 7; for (int i = 0; i < 9; i++) h = H(h, s->a[i]); return h; }
static void fill_S9(S9 *s, int k) { for (int i = 0; i < 9; i++) s->a[i] = (char)(k + i + 1); }
static long long hash_S12(const S12 *s) { return H(H(H(7, s->a), s->b), s->c); }
static void fill_S12(S12 *s, int k) { s->a = k + 1; s->b = k + 2; s->c = k + 3; }
static long long hash_S12B(const S12B *s) { return H(H(7, s->a), s->b); }
static void fill_S12B(S12B *s, int k) { s->a = k * 100000LL + 1; s->b = k + 2; }
static long long hash_S16(const S16 *s) { return H(H(7, s->a), s->b); }
static void fill_S16(S16 *s, int k) { s->a = k * 100000LL + 1; s->b = k * 100000LL + 2; }
static long long hash_S17(const S17 *s) { long long h = 7; for (int i = 0; i < 17; i++) h = H(h, s->a[i]); return h; }
static void fill_S17(S17 *s, int k) { for (int i = 0; i < 17; i++) s->a[i] = (char)(k + i + 1); }
static long long hash_S24(const S24 *s) { return H(H(H(7, s->a), s->b), s->c); }
static void fill_S24(S24 *s, int k) { s->a = k + 1; s->b = k + 2; s->c = k + 3; }
static long long hash_F1(const F1 *s) { return H(7, s->a); }
static void fill_F1(F1 *s, int k) { s->a = k + 0.5f; }
static long long hash_F2(const F2 *s) { return H(H(7, s->a), s->b); }
static void fill_F2(F2 *s, int k) { s->a = k + 0.5f; s->b = k + 1.25f; }
static long long hash_F3(const F3 *s) { return H(H(H(7, s->a), s->b), s->c); }
static void fill_F3(F3 *s, int k) { s->a = k + 0.5f; s->b = k + 1.25f; s->c = k + 2.125f; }
static long long hash_F4(const F4 *s) { return H(H(H(H(7, s->a), s->b), s->c), s->d); }
static void fill_F4(F4 *s, int k) { s->a = k + 0.5f; s->b = k + 1.25f; s->c = k + 2.125f; s->d = k + 3.5f; }
static long long hash_D1(const D1 *s) { return H(7, s->a); }
static void fill_D1(D1 *s, int k) { s->a = k + 0.5; }
static long long hash_D2(const D2 *s) { return H(H(7, s->a), s->b); }
static void fill_D2(D2 *s, int k) { s->a = k + 0.5; s->b = k + 1.25; }
static long long hash_D3(const D3 *s) { return H(H(H(7, s->a), s->b), s->c); }
static void fill_D3(D3 *s, int k) { s->a = k + 0.5; s->b = k + 1.25; s->c = k + 2.125; }
static long long hash_D4(const D4 *s) { return H(H(H(H(7, s->a), s->b), s->c), s->d); }
static void fill_D4(D4 *s, int k) { s->a = k + 0.5; s->b = k + 1.25; s->c = k + 2.125; s->d = k + 3.5; }
static long long hash_FI(const FI *s) { return H(H(7, s->a), s->b); }
static void fill_FI(FI *s, int k) { s->a = k + 0.5f; s->b = k + 2; }
static long long hash_IF(const IF *s) { return H(H(7, s->a), s->b); }
static void fill_IF(IF *s, int k) { s->a = k + 1; s->b = k + 1.25f; }
static long long hash_FFD(const FFD *s) { return H(H(H(7, s->a), s->b), s->c); }
static void fill_FFD(FFD *s, int k) { s->a = k + 0.5f; s->b = k + 1.25f; s->c = k + 2.125; }
static long long hash_DFF(const DFF *s) { return H(H(H(7, s->a), s->b), s->c); }
static void fill_DFF(DFF *s, int k) { s->a = k + 0.5; s->b = k + 1.25f; s->c = k + 2.125f; }
static long long hash_ULD(const ULD *s) { return H(7, s->a); }
static void fill_ULD(ULD *s, int k) { s->a = k * 100000LL + 1; }
static long long hash_UFI(const UFI *s) { return H(7, s->b); }
static void fill_UFI(UFI *s, int k) { s->b = k * 1000 + 1; }
static long long hash_NEST_F(const NEST_F *s) { return H(H(H(7, s->p.x), s->p.y), s->z); }
static void fill_NEST_F(NEST_F *s, int k) { s->p.x = k + 0.5f; s->p.y = k + 1.25f; s->z = k + 2.125f; }
static long long hash_NEST_M(const NEST_M *s) { return H(H(H(7, s->p.x), s->p.y), s->z); }
static void fill_NEST_M(NEST_M *s, int k) { s->p.x = k + 1; s->p.y = k + 1.25; s->z = k + 3; }
#if X87_SHAPE_COUNT
static long long hash_LDSHAPE(const LDSHAPE *s) { return H(H(7, s->i.m >> 50), s->i.se); }
static void fill_LDSHAPE(LDSHAPE *s, int k) { s->i.m = 0; s->i.se = 0; s->f = k + 0.5L; }
static long long hash_LDWORDS(const LDWORDS *s) { return H(H(H(H(7, s->words[0]), s->words[1] >> 8), s->words[2] & 0xffff), s->words[3]); }
static void fill_LDWORDS(LDWORDS *s, int k) { s->words[2] = 0; s->f = k + 1.25L; s->words[3] = k + 4; }
#endif

// What each side offers for a shape T, under its own prefix: take one first, take one after the registers are gone,
// take one between scalars, make one, and call back through a pointer with one made here.
#define OFFER(P, T) \
  long long P##_first_##T(T s, long long after) { return hash_##T(&s) * 1000 + after; } \
  long long P##_late_##T(long long a, long long b, long long c, long long d, long long e, long long f, double g, double h, double i, double j, double k, double l, double m, double n, T s, long long after) { \
    return hash_##T(&s) * 1000 + after + a + b + c + d + e + f + (long long)(g + h + i + j + k + l + m + n); } \
  long long P##_between_##T(int a, double b, T s, float c, long long after) { return hash_##T(&s) * 1000 + after + a + (long long)(b * 2) + (long long)(c * 4); } \
  T P##_make_##T(int seed) { T s; fill_##T(&s, seed); return s; } \
  long long P##_back_##T(long long (*callee)(T, long long), int seed) { T s; fill_##T(&s, seed); return callee(s, 7); }

// The table one side hands the other: five function pointers per shape, in EVERY_SHAPE order.
#define ENTRIES(P, T) (void *)P##_first_##T, (void *)P##_late_##T, (void *)P##_between_##T, (void *)P##_make_##T, (void *)P##_back_##T,

// One side's check of the other: it calls every one of the other's functions for every shape, with a function of its
// own (`mine`) for the other to call back, and counts what does not come back as it should.
int printf(const char *, ...);
#define CHECK_AGAINST(T, mine) { \
    T s; fill_##T(&s, seed); long long h = hash_##T(&s); \
    long long (*first)(T, long long) = (long long (*)(T, long long))theirs[0]; \
    long long (*late)(long long, long long, long long, long long, long long, long long, double, double, double, double, double, double, double, double, T, long long) = \
      (long long (*)(long long, long long, long long, long long, long long, long long, double, double, double, double, double, double, double, double, T, long long))theirs[1]; \
    long long (*between)(int, double, T, float, long long) = (long long (*)(int, double, T, float, long long))theirs[2]; \
    T (*make)(int) = (T (*)(int))theirs[3]; \
    long long (*back)(long long (*)(T, long long), int) = (long long (*)(long long (*)(T, long long), int))theirs[4]; \
    wrong += expect(#T, "first", first(s, 5), h * 1000 + 5); \
    wrong += expect(#T, "late", late(1, 2, 3, 4, 5, 6, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, s, 9), h * 1000 + 9 + 21 + 36); \
    wrong += expect(#T, "between", between(3, 1.5, s, 0.25f, 11), h * 1000 + 11 + 3 + 3 + 1); \
    T made = make(seed + 1); T same; fill_##T(&same, seed + 1); \
    wrong += expect(#T, "result", hash_##T(&made), hash_##T(&same)); \
    wrong += expect(#T, "called back", back(mine##_first_##T, seed), h * 1000 + 7); \
    theirs += 5; seed += 3; shapes++; }
static int expect(const char *shape, const char *what, long long got, long long want) {
  if (got != want) printf("%s %s: got %lld, expected %lld\n", shape, what, got, want);
  return got != want;
}

#endif

#ifdef THEIR_SIDE
// The other compiler's side (bun:ffi's cc(), which is TinyCC): the same offers under its own prefix.
#define THEIRS(T) OFFER(theirs, T)
EVERY_SHAPE(THEIRS)
#define THEIR_ENTRIES(T) ENTRIES(theirs, T)
static void *table[] = { EVERY_SHAPE(THEIR_ENTRIES) 0 };
void **their_table(void) { return table; }
#define CHECK_THIS_SIDE(T) CHECK_AGAINST(T, theirs)
int their_check(void **theirs) {
  int seed = 1, shapes = 0, wrong = 0;
  EVERY_SHAPE(CHECK_THIS_SIDE)
  printf("the other compiler calls this one: %d shapes, %d wrong\n", shapes - X87_SHAPE_COUNT, wrong);
  return wrong;
}
#endif

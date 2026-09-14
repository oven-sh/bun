// Every structure size from 1 to 32 bytes, in each register class (all integer, all float, all double, mixed), as
// an argument in a register, as an argument after the registers are used up, as a return value, through a pointer
// to the function, and through a variable argument list: what arrives is what was sent.
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

// Filled with a pattern that depends on the size and a seed, and compared byte by byte.
#define SHAPE(name, ...) \
  struct name { __VA_ARGS__ }; \
  static NOINLINE struct name make_##name(int seed) { struct name s; unsigned char *p = (unsigned char *)&s; memset(&s, 0, sizeof s); for (unsigned i = 0; i < sizeof s; i++) p[i] = (unsigned char)(seed * 31 + i * 7 + sizeof s); fix_##name(&s, seed); return s; } \
  static NOINLINE int same_##name(struct name a, struct name b) { return fields_##name(&a, &b); } \
  static NOINLINE struct name first_##name(struct name s) { return s; } \
  static NOINLINE struct name after_the_registers_##name(long a, double x, long b, double y, long c, double z, long d, double w, long e, long f, double v, double u, double t, double r, struct name s, int tail) { (void)a; (void)b; (void)c; (void)d; (void)e; (void)f; (void)x; (void)y; (void)z; (void)w; (void)v; (void)u; (void)t; (void)r; CHECK(tail == 77); return s; } \
  static NOINLINE struct name between_##name(char lead, struct name s, double middle, struct name t, int which) { CHECK(lead == 'k' && middle == 2.5); return which ? t : s; } \
  static NOINLINE struct name variadic_##name(int count, ...) { va_list ap; va_start(ap, count); struct name last; memset(&last, 0, sizeof last); for (int i = 0; i < count; i++) { CHECK(va_arg(ap, int) == i); last = va_arg(ap, struct name); CHECK(va_arg(ap, double) == i + 0.5); } va_end(ap); return last; } \
  static void test_##name(void) { \
    struct name a = make_##name(1), b = make_##name(2); \
    CHECK(same_##name(a, make_##name(1)) && !same_##name(a, b)); \
    CHECK(same_##name(first_##name(a), a)); \
    CHECK(same_##name(after_the_registers_##name(1, 1.0, 2, 2.0, 3, 3.0, 4, 4.0, 5, 6, 5.0, 6.0, 7.0, 8.0, b, 77), b)); \
    CHECK(same_##name(between_##name('k', a, 2.5, b, 0), a) && same_##name(between_##name('k', a, 2.5, b, 1), b)); \
    struct name (*volatile pointer)(struct name) = first_##name; \
    CHECK(same_##name(pointer(b), b)); \
    CHECK(same_##name(variadic_##name(3, 0, a, 0.5, 1, b, 1.5, 2, a, 2.5), a)); \
    struct name array[3] = {a, b, a}; \
    array[1] = first_##name(array[2]); \
    CHECK(same_##name(array[1], a)); \
  }

// Bytes: compared whole. (There is nothing to fix up after the fill.)
#define BYTES(n) \
  static void fix_b##n(void *s, int seed) { (void)s; (void)seed; } \
  static int fields_b##n(const void *a, const void *b) { return memcmp(a, b, n) == 0; } \
  SHAPE(b##n, unsigned char bytes[n];)
BYTES(1)
BYTES(2)
BYTES(3)
BYTES(4)
BYTES(5)
BYTES(6)
BYTES(7)
BYTES(8)
BYTES(9)
BYTES(10)
BYTES(11)
BYTES(12)
BYTES(13)
BYTES(14)
BYTES(15)
BYTES(16)
BYTES(17)
BYTES(18)
BYTES(19)
BYTES(20)
BYTES(21)
BYTES(22)
BYTES(23)
BYTES(24)
BYTES(25)
BYTES(26)
BYTES(27)
BYTES(28)
BYTES(29)
BYTES(30)
BYTES(31)
BYTES(32)

// Floating members: the fill could make NaNs, which compare unequal to themselves, so they get real values.
#define FLOATS(n) \
  struct f##n; \
  static void fix_f##n(void *s, int seed) { float *f = s; for (int i = 0; i < n; i++) f[i] = seed * 1.5f + i; } \
  static int fields_f##n(const void *a, const void *b) { return memcmp(a, b, n * sizeof(float)) == 0; } \
  SHAPE(f##n, float values[n];)
#define DOUBLES(n) \
  static void fix_d##n(void *s, int seed) { double *d = s; for (int i = 0; i < n; i++) d[i] = seed * 2.25 + i; } \
  static int fields_d##n(const void *a, const void *b) { return memcmp(a, b, n * sizeof(double)) == 0; } \
  SHAPE(d##n, double values[n];)
FLOATS(1)
FLOATS(2)
FLOATS(3)
FLOATS(4)
FLOATS(5)
FLOATS(6)
FLOATS(7)
FLOATS(8)
DOUBLES(1)
DOUBLES(2)
DOUBLES(3)
DOUBLES(4)

#define MIXED(name, members, fill, equal) \
  struct name; \
  static void fix_##name(struct name *s, int seed); \
  static int fields_##name(const struct name *a, const struct name *b); \
  SHAPE(name, members) \
  static void fix_##name(struct name *s, int seed) { memset(s, 0, sizeof *s); fill } \
  static int fields_##name(const struct name *a, const struct name *b) { return equal; }
MIXED(double_int, double d; int i;, s->d = seed + 0.5; s->i = seed;, a->d == b->d && a->i == b->i)
MIXED(int_double, int i; double d;, s->d = seed + 0.5; s->i = seed;, a->d == b->d && a->i == b->i)
MIXED(float_float_int, float x; float y; int i;, s->x = seed; s->y = seed + 1; s->i = seed;, a->x == b->x && a->y == b->y && a->i == b->i)
MIXED(int_float, int i; float f;, s->i = seed; s->f = seed + 0.25f;, a->i == b->i && a->f == b->f)
MIXED(char_double, char c; double d;, s->c = (char)seed; s->d = seed * 3.0;, a->c == b->c && a->d == b->d)
MIXED(float_double, float f; double d;, s->f = seed; s->d = seed + 0.125;, a->f == b->f && a->d == b->d)
MIXED(long_float, long long l; float f;, s->l = seed * 1000000007LL; s->f = seed;, a->l == b->l && a->f == b->f)
MIXED(double_double_char, double x; double y; char c;, s->x = seed; s->y = -seed; s->c = (char)seed;, a->x == b->x && a->y == b->y && a->c == b->c)
MIXED(float_int_float_int, float a; int b; float c; int d;, s->a = seed; s->b = seed; s->c = seed + 2; s->d = seed + 3;, a->a == b->a && a->b == b->b && a->c == b->c && a->d == b->d)
MIXED(pointer_double, void *p; double d;, s->p = (void *)(unsigned long long)(seed * 4096); s->d = seed;, a->p == b->p && a->d == b->d)
MIXED(nested, struct { float x; float y; } inner; double after;, s->inner.x = seed; s->inner.y = seed + 0.5f; s->after = seed * 2;, a->inner.x == b->inner.x && a->inner.y == b->inner.y && a->after == b->after)
MIXED(short_char_char, short s; char a; char b;, s->s = (short)seed; s->a = 1; s->b = (char)seed;, a->s == b->s && a->a == b->a && a->b == b->b)
MIXED(bits, unsigned low : 3; unsigned mid : 17; unsigned long long high : 40;, s->low = seed; s->mid = seed * 1000; s->high = seed * 100000000ULL;, a->low == b->low && a->mid == b->mid && a->high == b->high)
MIXED(union_int_float, union { int i; float f; } u; int tag;, s->u.i = seed * 12345; s->tag = seed;, a->u.i == b->u.i && a->tag == b->tag)
MIXED(five_ints, int v[5];, for (int i = 0; i < 5; i++) s->v[i] = seed + i;, memcmp(a, b, sizeof *a) == 0)
MIXED(three_longs, long long v[3];, for (int i = 0; i < 3; i++) s->v[i] = seed * 100000000000LL + i;, memcmp(a, b, sizeof *a) == 0)

int main(void) {
  test_b1();
  test_b2();
  test_b3();
  test_b4();
  test_b5();
  test_b6();
  test_b7();
  test_b8();
  test_b9();
  test_b10();
  test_b11();
  test_b12();
  test_b13();
  test_b14();
  test_b15();
  test_b16();
  test_b17();
  test_b18();
  test_b19();
  test_b20();
  test_b21();
  test_b22();
  test_b23();
  test_b24();
  test_b25();
  test_b26();
  test_b27();
  test_b28();
  test_b29();
  test_b30();
  test_b31();
  test_b32();
  test_f1();
  test_f2();
  test_f3();
  test_f4();
  test_f5();
  test_f6();
  test_f7();
  test_f8();
  test_d1();
  test_d2();
  test_d3();
  test_d4();
  test_double_int();
  test_int_double();
  test_float_float_int();
  test_int_float();
  test_char_double();
  test_float_double();
  test_long_float();
  test_double_double_char();
  test_float_int_float_int();
  test_pointer_double();
  test_nested();
  test_short_char_char();
  test_bits();
  test_union_int_float();
  test_five_ints();
  test_three_longs();
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}

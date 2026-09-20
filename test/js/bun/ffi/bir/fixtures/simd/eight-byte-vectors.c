// Vectors of eight bytes (`vector_size(8)`): every operator, element access, conversions to and from
// 16-byte vectors, and the ways a value travels (arguments, results, members, an ellipsis, memory).
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

// GCC has `__builtin_shuffle`, Clang the `__builtin_*vector` and reduction builtins; this compiler has both.
#if defined(__clang__)
#define GNU_SHUFFLE 0
#define CLANG_BUILTINS 1
#elif defined(__BUN_CC__)
#define GNU_SHUFFLE 1
#define CLANG_BUILTINS 1
#else
#define GNU_SHUFFLE 1
#define CLANG_BUILTINS 0
#endif

typedef int8_t s8x8 __attribute__((vector_size(8)));
typedef uint8_t u8x8 __attribute__((vector_size(8)));
typedef int16_t s16x4 __attribute__((vector_size(8)));
typedef uint16_t u16x4 __attribute__((vector_size(8)));
typedef int32_t s32x2 __attribute__((vector_size(8)));
typedef uint32_t u32x2 __attribute__((vector_size(8)));
typedef int64_t s64x1 __attribute__((vector_size(8)));
typedef float f32x2 __attribute__((vector_size(8)));
typedef uint8_t u8x16 __attribute__((vector_size(16)));
typedef uint16_t u16x8 __attribute__((vector_size(16)));
typedef int32_t s32x4 __attribute__((vector_size(16)));
typedef int64_t s64x2 __attribute__((vector_size(16)));
typedef double f64x2 __attribute__((vector_size(16)));

static void show(const char *what, const void *p, int n) {
  const unsigned char *b = p;
  printf("%-18s", what);
  for (int i = 0; i < n; i++) printf(" %02x", b[i]);
  printf("\n");
}
#define SHOW(what, ...)                     \
  do {                                      \
    __typeof__(__VA_ARGS__) _v = __VA_ARGS__; \
    show(what, &_v, sizeof _v);             \
  } while (0)

#define OPERATORS(T, name)                                                                     \
  __attribute__((noinline)) T name##_add(T a, T b) { return a + b; }                           \
  __attribute__((noinline)) T name##_sub(T a, T b) { return a - b; }                           \
  __attribute__((noinline)) T name##_mul(T a, T b) { return a * b; }                           \
  __attribute__((noinline)) T name##_div(T a, T b) { return a / b; }                           \
  __attribute__((noinline)) T name##_neg(T a) { return -a; }                                   \
  __attribute__((noinline)) T name##_scalar(T a) { return 3 + a * 2 - 1; }                \
  static void name##_all(T a, T b) {                                                           \
    SHOW(#name " +", name##_add(a, b));                                                        \
    SHOW(#name " -", name##_sub(a, b));                                                        \
    SHOW(#name " *", name##_mul(a, b));                                                        \
    SHOW(#name " /", name##_div(a, b));                                                        \
    SHOW(#name " neg", name##_neg(a));                                                         \
    SHOW(#name " scalars", name##_scalar(a));                                                 \
    SHOW(#name " ==", a == b);                                                                 \
    SHOW(#name " <", a < b);                                                                   \
    SHOW(#name " >=", a >= b);                                                                 \
  }
#define INTEGER_OPERATORS(T, name)                                                   \
  __attribute__((noinline)) T name##_rem(T a, T b) { return a % b; }                 \
  __attribute__((noinline)) T name##_bits(T a, T b) { return (a & b) | (a ^ ~b); }   \
  __attribute__((noinline)) T name##_shl(T a, int n) { return a << n; }              \
  __attribute__((noinline)) T name##_shr(T a, int n) { return a >> n; }              \
  __attribute__((noinline)) T name##_shifts(T a, T n) { return (a << n) ^ (a >> n); } \
  static void name##_integer(T a, T b, T amounts) {                                  \
    SHOW(#name " %", name##_rem(a, b));                                              \
    SHOW(#name " bits", name##_bits(a, b));                                          \
    SHOW(#name " << 3", name##_shl(a, 3));                                           \
    SHOW(#name " >> 2", name##_shr(a, 2));                                           \
    SHOW(#name " shifts", name##_shifts(a, amounts));                                \
  }

OPERATORS(s8x8, s8x8)
OPERATORS(u8x8, u8x8)
OPERATORS(s16x4, s16x4)
OPERATORS(u16x4, u16x4)
OPERATORS(s32x2, s32x2)
OPERATORS(u32x2, u32x2)
OPERATORS(s64x1, s64x1)
OPERATORS(f32x2, f32x2)
INTEGER_OPERATORS(s8x8, s8x8)
INTEGER_OPERATORS(u8x8, u8x8)
INTEGER_OPERATORS(s16x4, s16x4)
INTEGER_OPERATORS(u16x4, u16x4)
INTEGER_OPERATORS(s32x2, s32x2)
INTEGER_OPERATORS(u32x2, u32x2)
INTEGER_OPERATORS(s64x1, s64x1)

// Elements, read and written, with the index known or not, in a register or in memory.
__attribute__((noinline)) int element(s16x4 v, int i) { return v[i]; }
__attribute__((noinline)) s16x4 with_element(s16x4 v, int i, int x) {
  v[i] = (int16_t)x;
  v[0] += 1;
  return v;
}
__attribute__((noinline)) void through_pointer(u8x8 *p, int i) {
  (*p)[i] ^= 0xff;
  p[1][7 - i] = (uint8_t)i;
}

// How a value travels.
struct mixed {
  s32x2 a;
  f32x2 b;
};
struct with_int {
  int tag;
  u8x8 v;
  char tail;
};
union overlay {
  u8x8 bytes;
  u16x4 halves;
  uint64_t bits;
  double number;
};
__attribute__((noinline)) struct mixed both(struct mixed p, s64x1 w) {
  p.a += (s32x2){(int)w[0], 1};
  p.b = -p.b;
  return p;
}
__attribute__((noinline)) struct with_int tagged(struct with_int in, u8x8 add) {
  in.v += add;
  in.tag += in.tail;
  return in;
}
// More vectors than there are registers for them, between integers and floating-point values.
__attribute__((noinline)) u8x8 many(int i0, u8x8 a, double d0, u8x8 b, u8x8 c, u8x8 d, float f0, u8x8 e, u8x8 f, u8x8 g, u8x8 h, u8x8 i, u8x8 j, int i1) {
  return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + (uint8_t)(i0 + i1 + (int)d0 + (int)f0);
}
__attribute__((noinline)) uint64_t sum_all(int count, ...) {
  va_list list;
  va_start(list, count);
  uint64_t sum = 0;
  for (int k = 0; k < count; k++) {
    u16x4 v = va_arg(list, u16x4);
    sum += (uint64_t)v[0] + v[1] + v[2] + v[3];
    sum += (uint64_t)va_arg(list, int);
    sum += (uint64_t)va_arg(list, double);
  }
  va_end(list);
  return sum;
}
typedef s16x4 (*binary)(s16x4, s16x4);
__attribute__((noinline)) s16x4 apply(binary f, s16x4 a, s16x4 b) { return f(f(a, b), b); }

__attribute__((noinline)) uint64_t as_bits(u8x8 v) { return (uint64_t)v; }
__attribute__((noinline)) u8x8 from_bits(uint64_t v) { return (u8x8)v; }
__attribute__((noinline)) s16x4 reinterpret(u8x8 v) { return (s16x4)v; }
__attribute__((noinline)) s32x2 compare(f32x2 a, f32x2 b) { return a < b; }
__attribute__((noinline)) void copy8(void *to, const void *from) { *(u8x8 *)to = *(const u8x8 *)from; }

static u8x8 table[3] = {{1, 2, 3, 4, 5, 6, 7, 8}, {9}, {255, 254}};
static const f32x2 halves = {0.5f, -0.5f};
static s16x4 zeroed;

#if CLANG_BUILTINS
__attribute__((noinline)) u8x8 low(u8x16 v) { return __builtin_shufflevector(v, v, 0, 1, 2, 3, 4, 5, 6, 7); }
__attribute__((noinline)) u8x8 high(u8x16 v) { return __builtin_shufflevector(v, v, 8, 9, 10, 11, 12, 13, 14, 15); }
__attribute__((noinline)) u8x16 combine(u8x8 lo, u8x8 hi) { return __builtin_shufflevector(lo, hi, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15); }
__attribute__((noinline)) u8x8 interleave(u8x8 a, u8x8 b) { return __builtin_shufflevector(a, b, 0, 8, 1, 9, 2, 10, 3, 11); }
__attribute__((noinline)) s16x4 reverse(s16x4 a) { return __builtin_shufflevector(a, a, 3, 2, 1, 0); }
__attribute__((noinline)) s64x2 two(s64x1 a, s64x1 b) { return __builtin_shufflevector(a, b, 1, 0); }
__attribute__((noinline)) u16x8 widen(u8x8 v) { return __builtin_convertvector(v, u16x8); }
__attribute__((noinline)) s32x4 widen_signed(s16x4 v) { return __builtin_convertvector(v, s32x4); }
__attribute__((noinline)) s64x2 widen_more(s32x2 v) { return __builtin_convertvector(v, s64x2); }
__attribute__((noinline)) f64x2 widen_float(f32x2 v) { return __builtin_convertvector(v, f64x2); }
__attribute__((noinline)) f64x2 to_double(s32x2 v) { return __builtin_convertvector(v, f64x2); }
__attribute__((noinline)) u8x8 narrow(u16x8 v) { return __builtin_convertvector(v, u8x8); }
__attribute__((noinline)) s16x4 narrow_more(s32x4 v) { return __builtin_convertvector(v, s16x4); }
__attribute__((noinline)) f32x2 narrow_float(f64x2 v) { return __builtin_convertvector(v, f32x2); }
__attribute__((noinline)) f32x2 to_float(s32x2 v) { return __builtin_convertvector(v, f32x2); }
__attribute__((noinline)) s32x2 to_int(f32x2 v) { return __builtin_convertvector(v, s32x2); }
static void clang_builtins(void) {
  u8x16 q = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};
  u8x8 lo = low(q), hi = high(q);
  SHOW("low", lo);
  SHOW("high", hi);
  SHOW("combine", combine(hi, lo));
  SHOW("interleave", interleave(lo, hi));
  SHOW("reverse", reverse((s16x4){1, -2, 3, -4}));
  SHOW("two", two((s64x1){-5}, (s64x1){6}));
  SHOW("widen", widen(hi + 250));
  SHOW("widen signed", widen_signed((s16x4){-1, 2, -30000, 30000}));
  SHOW("widen more", widen_more((s32x2){-7, 7}));
  SHOW("narrow", narrow(widen(hi) * 0x101 + 3));
  SHOW("narrow more", narrow_more((s32x4){0x12345, -2, 70000, -70000}));
  f64x2 d = widen_float((f32x2){1.5f, -2.25f});
  printf("%-18s %g %g\n", "widen float", d[0], d[1]);
  d = to_double((s32x2){-3, 1 << 30});
  printf("%-18s %g %g\n", "to double", d[0], d[1]);
  f32x2 f = narrow_float((f64x2){1.0 / 3, -1e10});
  printf("%-18s %g %g\n", "narrow float", f[0], f[1]);
  f = to_float((s32x2){-3, 16777217});
  printf("%-18s %g %g\n", "to float", f[0], f[1]);
  SHOW("to int", to_int((f32x2){-3.75f, 1e6f}));
  printf("%-18s %d %d %d %d\n", "reductions", __builtin_reduce_add((s32x2){5, 6}), __builtin_reduce_max((s16x4){3, -9, 12, 4}), __builtin_reduce_min((u8x8){9, 8, 7, 3, 200, 6, 5, 4}), __builtin_reduce_xor((u16x4){1, 2, 4, 0x8000}));
  SHOW("elementwise", __builtin_elementwise_max((s8x8){1, -2, 3, -4, 5, -6, 7, -8}, (s8x8){-1, 2, -3, 4, -5, 6, -7, 8}) + __builtin_elementwise_abs((s8x8){-100, 100, -1, 0, 1, -127, 9, -9}));
  SHOW("min float", __builtin_elementwise_min((f32x2){1, -5}, (f32x2){-1, 5}));
}
#endif

#if GNU_SHUFFLE
__attribute__((noinline)) u8x8 permute(u8x8 a, u8x8 m) { return __builtin_shuffle(a, m); }
__attribute__((noinline)) s16x4 permute_two(s16x4 a, s16x4 b, s16x4 m) { return __builtin_shuffle(a, b, m); }
static void gnu_shuffle(void) {
  SHOW("permute", permute((u8x8){10, 11, 12, 13, 14, 15, 16, 17}, (u8x8){7, 0, 9, 3, 3, 250, 1, 6}));
  SHOW("permute two", permute_two((s16x4){1, 2, 3, 4}, (s16x4){-1, -2, -3, -4}, (s16x4){0, 4, 7, 10}));
  SHOW("permute constant", __builtin_shuffle((s16x4){1, 2, 3, 4}, (s16x4){-1, -2, -3, -4}, (s16x4){7, 6, 1, 0}));
}
#endif

int main(void) {
  s8x8_all((s8x8){100, -100, 7, -7, 127, -128, 0, 1}, (s8x8){100, 3, -2, 7, 1, -3, 5, -128});
  u8x8_all((u8x8){250, 1, 2, 3, 40, 50, 60, 255}, (u8x8){10, 20, 30, 40, 5, 60, 7, 255});
  s16x4_all((s16x4){100, -200, 30000, -32768}, (s16x4){3, 3, -3, -2});
  u16x4_all((u16x4){100, 65535, 30000, 1}, (u16x4){3, 2, 40000, 65535});
  s32x2_all((s32x2){100, -7}, (s32x2){7, 2});
  u32x2_all((u32x2){4000000000u, 7}, (u32x2){7, 4000000000u});
  s64x1_all((s64x1){-100000000000}, (s64x1){7});
  f32x2_all((f32x2){1.5f, -2.0f}, (f32x2){0.25f, 3.0f});
  s8x8_integer((s8x8){100, -100, 7, -7, 127, -128, 0, 1}, (s8x8){9, 3, -2, 7, 1, -3, 5, -128}, (s8x8){0, 1, 2, 3, 4, 5, 6, 7});
  u8x8_integer((u8x8){250, 1, 2, 3, 40, 50, 60, 255}, (u8x8){10, 20, 30, 40, 5, 60, 7, 255}, (u8x8){7, 6, 5, 4, 3, 2, 1, 0});
  s16x4_integer((s16x4){100, -200, 30000, -32768}, (s16x4){3, 3, -3, -2}, (s16x4){0, 5, 10, 15});
  u16x4_integer((u16x4){100, 65535, 30000, 1}, (u16x4){3, 2, 40000, 65535}, (u16x4){15, 8, 1, 0});
  s32x2_integer((s32x2){100, -7}, (s32x2){7, 2}, (s32x2){31, 1});
  u32x2_integer((u32x2){4000000000u, 7}, (u32x2){7, 4000000000u}, (u32x2){1, 30});
  s64x1_integer((s64x1){-100000000000}, (s64x1){7}, (s64x1){40});

  s16x4 m = {100, -200, 300, -400};
  printf("%-18s %d %d %d %d\n", "element", element(m, 0), element(m, 1), element(m, 3), element(m, 2));
  SHOW("with element", with_element(m, 2, 77));
  u8x8 two_vectors[2] = {{1, 2, 3, 4, 5, 6, 7, 8}, {0}};
  through_pointer(two_vectors, 2);
  show("through pointer", two_vectors, 16);

  struct mixed p = both((struct mixed){{1, 2}, {3.0f, -4.0f}}, (s64x1){40});
  printf("%-18s %d %d %g %g %zu\n", "both", p.a[0], p.a[1], p.b[0], p.b[1], sizeof p);
  struct with_int t = tagged((struct with_int){5, {1, 2, 3, 4, 5, 6, 7, 8}, 9}, (u8x8){10, 20, 30, 40, 50, 60, 70, 80});
  printf("%-18s %d %d %d %zu %zu\n", "tagged", t.tag, t.v[0], t.v[7], sizeof t, _Alignof(struct with_int));
  u8x8 one = {1, 1, 1, 1, 1, 1, 1, 1};
  SHOW("many", many(1, one, 2.0, one * 2, one * 3, one * 4, 3.0f, one * 5, one * 6, one * 7, one * 8, one * 9, one * 10, 4));
  printf("%-18s %llu\n", "ellipsis", (unsigned long long)sum_all(3, (u16x4){1, 2, 3, 4}, 5, 0.5, (u16x4){65535, 65535, 0, 1}, -6, 8.0, (u16x4){1000, 1000, 1000, 1000}, 7, 100.0));
  SHOW("apply", apply(s16x4_mul, m, (s16x4){2, 3, -1, 0}));
  binary table_of[2] = {s16x4_add, s16x4_sub};
  SHOW("function table", table_of[1](table_of[0](m, m), (s16x4){1, 1, 1, 1}));

  u8x8 a = {250, 1, 2, 3, 4, 5, 6, 7};
  printf("%-18s %016llx\n", "as bits", (unsigned long long)as_bits(a));
  SHOW("from bits", from_bits(0x0102030405060708ull));
  SHOW("reinterpret", reinterpret(a));
  SHOW("compare", compare((f32x2){1, 5}, (f32x2){2, 4}));
  union overlay o = {.bits = 0x1122334455667788ull};
  o.halves += 1;
  o.bytes[7] = 0;
  printf("%-18s %016llx\n", "union", (unsigned long long)o.bits);
  unsigned char buffer[12] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}, out[8];
  copy8(out, buffer + 3);
  show("copy8", out, 8);

  show("table", table, 24);
  table[1] += table[0];
  SHOW("table[1]", table[1]);
  u8x8 *ptr = &table[2];
  (*ptr)[3] = 9;
  ptr[0][0] -= 1;
  SHOW("ptr", *ptr);
  SHOW("statics", (f32x2)halves * 4 + (f32x2){(float)zeroed[3], 1});
  printf("%-18s %zu %zu %zu %zu\n", "sizes", sizeof(u8x8), _Alignof(u8x8), sizeof table, sizeof(s64x1));
#if CLANG_BUILTINS
  clang_builtins();
#endif
#if GNU_SHUFFLE
  gnu_shuffle();
#endif
  return 0;
}

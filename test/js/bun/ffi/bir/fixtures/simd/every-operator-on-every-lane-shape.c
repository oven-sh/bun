/* Every operator of the vector extension on every element type: each vector result is compared
   lane by lane with the scalar operation, and the scalar results are printed, so the expected
   output (what clang prints for the same file) checks those too. */
#include <stdio.h>
#include <string.h>

/* GCC and Clang only have the logical operators and ?: on vectors in C++. */
#if defined(__GNUC__) || defined(__clang__)
#define LAND(a, b) (((a) != 0) & ((b) != 0))
#define LOR(a, b) (((a) != 0) | ((b) != 0))
#define LNOT(a) ((a) == 0)
#define SELECT(m, a, b) ({ __typeof__(a) r_; for (int i_ = 0; i_ < (int)(16 / sizeof r_[0]); i_++) r_[i_] = (m)[i_] ? (a)[i_] : (b)[i_]; r_; })
#else
#define LAND(a, b) ((a) && (b))
#define LOR(a, b) ((a) || (b))
#define LNOT(a) (!(a))
#define SELECT(m, a, b) ((m) ? (a) : (b))
#endif

static const long long ints[12] = { 0, 1, -1, 2, 7, -8, 100, -100, 127, -128, 0x7ffffff1, -0x7ffffff3 };
static const double floats[12] = { 0.0, 1.0, -1.0, 2.5, 7.25, -8.0, 100.0, -0.5, 1e10, -1e-3, 3.0, 0.125 };
static int failures;

#define LANES(T) (16 / (int)sizeof(T))
#define V(T) T __attribute__((vector_size(16)))

/* What is printed for a lane: its bits. */
static unsigned long long bits_of(const void *lane, int size) { unsigned long long v = 0; memcpy(&v, lane, size); return v; }

#define CHECK(T, NAME, what, vector, scalar)                                                        \
  do {                                                                                              \
    __typeof__(vector) got = (vector);                                                              \
    printf("  %-10s", what);                                                                        \
    for (int i = 0; i < LANES(T); i++) {                                                            \
      __typeof__(got[0]) want = (scalar), lane = got[i];                                            \
      printf(" %llx", bits_of(&want, sizeof want));                                                 \
      if (memcmp(&want, &lane, sizeof want) != 0) { failures++; printf("(MISMATCH %llx)", bits_of(&lane, sizeof want)); } \
    }                                                                                               \
    printf("\n");                                                                                   \
  } while (0)

#define COMMON(T, M, NAME)                                                                          \
  static V(T) NAME##_add(V(T) a, V(T) b) { return a + b; }                                          \
  static V(T) NAME##_sub(V(T) a, V(T) b) { return a - b; }                                          \
  static V(T) NAME##_mul(V(T) a, V(T) b) { return a * b; }                                          \
  static V(T) NAME##_div(V(T) a, V(T) b) { return a / b; }                                          \
  static V(T) NAME##_compound(V(T) a, V(T) b) { a += b; a -= 1; a *= b; return a; }                 \
  static V(M) NAME##_eq(V(T) a, V(T) b) { return a == b; }                                          \
  static V(M) NAME##_ne(V(T) a, V(T) b) { return a != b; }                                          \
  static V(M) NAME##_lt(V(T) a, V(T) b) { return a < b; }                                           \
  static V(M) NAME##_le(V(T) a, V(T) b) { return a <= b; }                                          \
  static V(M) NAME##_gt(V(T) a, V(T) b) { return a > b; }                                           \
  static V(M) NAME##_ge(V(T) a, V(T) b) { return a >= b; }                                          \
  static V(M) NAME##_land(V(T) a, V(T) b) { return LAND(a, b); }                                    \
  static V(M) NAME##_lor(V(T) a, V(T) b) { return LOR(a, b); }                                      \
  static V(M) NAME##_lnot(V(T) a) { return LNOT(a); }                                               \
  static V(T) NAME##_neg(V(T) a) { return -a; }                                                     \
  static V(T) NAME##_plus(V(T) a) { return +a; }                                                    \
  static V(T) NAME##_sel(V(M) m, V(T) a, V(T) b) { return SELECT(m, a, b); }                              \
  static V(T) NAME##_add_scalar(V(T) a, T s) { return a + s; }                                      \
  static V(T) NAME##_scalar_sub(T s, V(T) a) { return s - a; }                                      \
  static V(T) NAME##_add_const(V(T) a) { return a + 3; }

#define COMMON_CHECKS(T, M, NAME)                                                                   \
  CHECK(T, NAME, "+", NAME##_add(a, b), (T)(a[i] + b[i]));                                          \
  CHECK(T, NAME, "-", NAME##_sub(a, b), (T)(a[i] - b[i]));                                          \
  CHECK(T, NAME, "*", NAME##_mul(a, b), (T)(a[i] * b[i]));                                          \
  CHECK(T, NAME, "/", NAME##_div(a, d), (T)(a[i] / d[i]));                                          \
  CHECK(T, NAME, "compound", NAME##_compound(a, b), (T)((T)((T)(a[i] + b[i]) - 1) * b[i]));         \
  CHECK(T, NAME, "==", NAME##_eq(a, b), (M) - (a[i] == b[i]));                                      \
  CHECK(T, NAME, "!=", NAME##_ne(a, b), (M) - (a[i] != b[i]));                                      \
  CHECK(T, NAME, "<", NAME##_lt(a, b), (M) - (a[i] < b[i]));                                        \
  CHECK(T, NAME, "<=", NAME##_le(a, b), (M) - (a[i] <= b[i]));                                      \
  CHECK(T, NAME, ">", NAME##_gt(a, b), (M) - (a[i] > b[i]));                                        \
  CHECK(T, NAME, ">=", NAME##_ge(a, b), (M) - (a[i] >= b[i]));                                      \
  CHECK(T, NAME, "&&", NAME##_land(a, b), (M) - (a[i] && b[i]));                                    \
  CHECK(T, NAME, "||", NAME##_lor(a, b), (M) - (a[i] || b[i]));                                     \
  CHECK(T, NAME, "!", NAME##_lnot(a), (M) - !a[i]);                                                 \
  CHECK(T, NAME, "neg", NAME##_neg(a), (T)(-a[i]));                                                 \
  CHECK(T, NAME, "plus", NAME##_plus(a), (T)(+a[i]));                                               \
  CHECK(T, NAME, "?:", NAME##_sel(NAME##_lt(a, b), a, b), a[i] < b[i] ? a[i] : b[i]);               \
  CHECK(T, NAME, "+ scalar", NAME##_add_scalar(a, b[1]), (T)(a[i] + b[1]));                         \
  CHECK(T, NAME, "scalar -", NAME##_scalar_sub(b[0], a), (T)(b[0] - a[i]));                         \
  CHECK(T, NAME, "+ 3", NAME##_add_const(a), (T)(a[i] + 3));

#define INTEGER(T, M, NAME)                                                                         \
  COMMON(T, M, NAME)                                                                                \
  static V(T) NAME##_rem(V(T) a, V(T) b) { return a % b; }                                          \
  static V(T) NAME##_and(V(T) a, V(T) b) { return a & b; }                                          \
  static V(T) NAME##_or(V(T) a, V(T) b) { return a | b; }                                           \
  static V(T) NAME##_xor(V(T) a, V(T) b) { return a ^ b; }                                          \
  static V(T) NAME##_shl(V(T) a, V(T) b) { return a << b; }                                         \
  static V(T) NAME##_shr(V(T) a, V(T) b) { return a >> b; }                                         \
  static V(T) NAME##_not(V(T) a) { return ~a; }                                                     \
  static V(T) NAME##_shl_scalar(V(T) a, int n) { return a << n; }                                   \
  static V(T) NAME##_shr_scalar(V(T) a, int n) { return a >> n; }                                   \
  static V(T) NAME##_shl_three(V(T) a) { return a << 3; }                                           \
  static void NAME##_run(void) {                                                                    \
    printf(#NAME "\n");                                                                             \
    for (int seed = 0; seed < 4; seed++) {                                                          \
      V(T) a, b, d, s;                                                                              \
      for (int i = 0; i < LANES(T); i++) {                                                          \
        unsigned long long spread = sizeof(T) == 8 ? 0x100000001ULL : 0x010101010101ULL;            \
        a[i] = (T)((unsigned long long)ints[(seed + i * 5 + i / 3) % 12] * spread);                 \
        b[i] = (T)((unsigned long long)ints[(seed + 7 + i * 5 + i / 3) % 12] * spread);             \
        /* A divisor that is neither zero nor the one that overflows. */                            \
        d[i] = b[i] == 0 ? 3 : b[i] == (T)-1 ? 5 : b[i];                                            \
        s[i] = (T)((seed + i * 3) % (8 * (int)sizeof(T)));                                          \
      }                                                                                             \
      printf(" seed %d\n", seed);                                                                   \
      COMMON_CHECKS(T, M, NAME)                                                                     \
      CHECK(T, NAME, "%", NAME##_rem(a, d), (T)(a[i] % d[i]));                                      \
      CHECK(T, NAME, "&", NAME##_and(a, b), (T)(a[i] & b[i]));                                      \
      CHECK(T, NAME, "|", NAME##_or(a, b), (T)(a[i] | b[i]));                                       \
      CHECK(T, NAME, "^", NAME##_xor(a, b), (T)(a[i] ^ b[i]));                                      \
      CHECK(T, NAME, "<<", NAME##_shl(a, s), (T)((unsigned long long)a[i] << s[i]));                \
      CHECK(T, NAME, ">>", NAME##_shr(a, s), (T)(a[i] >> s[i]));                                    \
      CHECK(T, NAME, "~", NAME##_not(a), (T)~a[i]);                                                 \
      CHECK(T, NAME, "<< n", NAME##_shl_scalar(a, seed + 1), (T)((unsigned long long)a[i] << (seed + 1))); \
      CHECK(T, NAME, ">> n", NAME##_shr_scalar(a, seed + 1), (T)(a[i] >> (seed + 1)));              \
      CHECK(T, NAME, "<< 3", NAME##_shl_three(a), (T)((unsigned long long)a[i] << 3));              \
    }                                                                                               \
  }

#define FLOATING(T, M, NAME)                                                                        \
  COMMON(T, M, NAME)                                                                                \
  static void NAME##_run(void) {                                                                    \
    printf(#NAME "\n");                                                                             \
    for (int seed = 0; seed < 4; seed++) {                                                          \
      V(T) a, b, d;                                                                                 \
      for (int i = 0; i < LANES(T); i++) {                                                          \
        a[i] = (T)floats[(seed + i * 5 + i / 3) % 12];                                              \
        b[i] = (T)floats[(seed + 7 + i * 5 + i / 3) % 12];                                          \
        d[i] = b[i] == 0 ? 4 : b[i];                                                                \
      }                                                                                             \
      printf(" seed %d\n", seed);                                                                   \
      COMMON_CHECKS(T, M, NAME)                                                                     \
    }                                                                                               \
  }

INTEGER(signed char, signed char, s8)
INTEGER(unsigned char, signed char, u8)
INTEGER(short, short, s16)
INTEGER(unsigned short, short, u16)
INTEGER(int, int, s32)
INTEGER(unsigned int, int, u32)
INTEGER(long long, long long, s64)
INTEGER(unsigned long long, long long, u64)
FLOATING(float, int, f32)
FLOATING(double, long long, f64)

int main(void) {
  s8_run(); u8_run(); s16_run(); u16_run(); s32_run(); u32_run(); s64_run(); u64_run(); f32_run(); f64_run();
  printf("%d failures\n", failures);
  return 0;
}

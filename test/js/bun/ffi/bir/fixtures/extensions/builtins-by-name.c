// Every __builtin_ the compiler knows by name (the atomic and vector ones have fixtures of their own), each
// called and checked. Where GCC or Clang lacks one, they skip it; this compiler must have them all.
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#ifdef __BUN_CC__
#define HAVE(name) 1
#elif defined __has_builtin
#define HAVE(name) __has_builtin(name)
#else
#define HAVE(name) 0
#endif

static int wrong;
#define CHECK(c) do { if (!(c)) { wrong++; printf("WRONG (line %d): %s\n", __LINE__, #c); } } while (0)

static int sum(int count, ...) {
  __builtin_va_list ap, copy;
  __builtin_va_start(ap, count);
  __builtin_va_copy(copy, ap);
  int total = 0;
  for (int i = 0; i < count; i++) total += __builtin_va_arg(ap, int);
  total += __builtin_va_arg(copy, int) * 1000;
  __builtin_va_end(copy);
  __builtin_va_end(ap);
  return total;
}
static void *caller(void) { return __builtin_extract_return_addr(__builtin_return_address(0)); }
static int never(int x) { if (x > 1000) __builtin_unreachable(); if (x > 2000) __builtin_trap(); return x; }
struct record { char tag; int value; double weights[3]; };

int main(void) {
  volatile unsigned v32 = 0x00f00000u; volatile unsigned long long v64 = 0x0000000100000000ull; volatile unsigned long vl = 16;
  volatile int negative = -1, zero = 0;
  // Bits.
  CHECK(__builtin_clz(v32) == 8 && __builtin_clzl(vl) == (int)sizeof(long) * CHAR_BIT - 5 && __builtin_clzll(v64) == 31);
  CHECK(__builtin_ctz(v32) == 20 && __builtin_ctzl(vl) == 4 && __builtin_ctzll(v64) == 32);
  CHECK(__builtin_popcount(v32) == 4 && __builtin_popcountl(vl) == 1 && __builtin_popcountll(v64 - 1) == 32);
  CHECK(__builtin_parity(v32) == 0 && __builtin_parityl(vl) == 1 && __builtin_parityll(v64 | 1) == 0);
  CHECK(__builtin_ffs(v32) == 21 && __builtin_ffsl(vl) == 5 && __builtin_ffsll(v64) == 33 && __builtin_ffs(zero) == 0);
  CHECK(__builtin_clrsb(negative) == 31 && __builtin_clrsbl(negative) == (int)sizeof(long) * CHAR_BIT - 1 && __builtin_clrsbll(1) == 62);
  CHECK(__builtin_bswap16(0x1234) == 0x3412 && __builtin_bswap32(v32) == 0x0000f000u && __builtin_bswap64(v64) == 0x0000000001000000ull);
#if HAVE(__builtin_bitreverse32)
  CHECK(__builtin_bitreverse8(0x01) == 0x80 && __builtin_bitreverse16(0x0001) == 0x8000 && __builtin_bitreverse32(v32) == 0x00000f00u && __builtin_bitreverse64(v64) == 0x0000000080000000ull);
#endif
#if HAVE(__builtin_rotateleft32)
  CHECK(__builtin_rotateleft8(0x81, 1) == 0x03 && __builtin_rotateleft16(0x8001, 4) == 0x0018 && __builtin_rotateleft32(v32, 12) == 0x0000000fu && __builtin_rotateleft64(v64, 32) == 1);
  CHECK(__builtin_rotateright8(0x81, 1) == 0xc0 && __builtin_rotateright16(0x8001, 4) == 0x1800 && __builtin_rotateright32(v32, 20) == 0x0000000fu && __builtin_rotateright64(v64, 32) == 1);
#endif
  // Arithmetic that says whether it overflowed.
  int si; long sl; long long sll; unsigned ui; unsigned long ul; unsigned long long ull; short narrow;
  CHECK(!__builtin_add_overflow(1, 2, &si) && si == 3 && __builtin_add_overflow(INT_MAX, 1, &si) && si == INT_MIN);
  CHECK(__builtin_sub_overflow(INT_MIN, 1, &si) && !__builtin_sub_overflow(5, 7, &si) && si == -2 && __builtin_sub_overflow(5u, 7u, &ui));
  CHECK(__builtin_mul_overflow(65536, 65536, &si) && !__builtin_mul_overflow(65536LL, 65536LL, &sll) && sll == 4294967296LL);
  CHECK(__builtin_add_overflow(30000, 30000, &narrow) && !__builtin_add_overflow(100, 200, &narrow) && narrow == 300);
  CHECK(__builtin_sadd_overflow(INT_MAX, 1, &si) && __builtin_saddl_overflow(LONG_MAX, 1L, &sl) && __builtin_saddll_overflow(LLONG_MAX, 1LL, &sll));
  CHECK(__builtin_ssub_overflow(INT_MIN, 1, &si) && __builtin_ssubl_overflow(LONG_MIN, 1L, &sl) && __builtin_ssubll_overflow(LLONG_MIN, 1LL, &sll));
  CHECK(__builtin_smul_overflow(INT_MAX, 2, &si) && __builtin_smull_overflow(LONG_MAX, 2L, &sl) && __builtin_smulll_overflow(LLONG_MAX, 2LL, &sll));
  CHECK(__builtin_uadd_overflow(UINT_MAX, 1u, &ui) && ui == 0 && __builtin_uaddl_overflow(ULONG_MAX, 1ul, &ul) && __builtin_uaddll_overflow(ULLONG_MAX, 1ull, &ull));
  CHECK(__builtin_usub_overflow(0u, 1u, &ui) && ui == UINT_MAX && __builtin_usubl_overflow(0ul, 1ul, &ul) && __builtin_usubll_overflow(0ull, 1ull, &ull));
  CHECK(__builtin_umul_overflow(UINT_MAX, 2u, &ui) && __builtin_umull_overflow(ULONG_MAX, 2ul, &ul) && !__builtin_umulll_overflow(3ull, 4ull, &ull) && ull == 12);
  // Floating point: constants, signs, classification, quiet comparisons.
  volatile double d = -2.5, dz = 0.0; volatile float f = 1.5f; volatile long double l = -3.0L;
  double nan = dz / dz;
  CHECK(__builtin_inf() > 1e308 && __builtin_inff() > 1e38f && __builtin_infl() > 1e308L && __builtin_huge_val() == __builtin_inf() && __builtin_huge_valf() == __builtin_inff() && __builtin_huge_vall() == __builtin_infl());
  CHECK(__builtin_nan("") != __builtin_nan("") && __builtin_nanf("") != __builtin_nanf("") && __builtin_nanl("") != __builtin_nanl("") && !__builtin_signbit(__builtin_nan("")));
  CHECK(__builtin_fabs(d) == 2.5 && __builtin_fabsf(-f) == 1.5f && __builtin_fabsl(l) == 3.0L);
  CHECK(__builtin_copysign(1.0, d) == -1.0 && __builtin_copysignf(2.0f, -0.0f) == -2.0f && __builtin_copysignl(3.0L, l) == -3.0L);
  CHECK(__builtin_isnan(nan) && !__builtin_isnan(d) && __builtin_isinf(__builtin_inf()) && !__builtin_isinf(d) && __builtin_isfinite(d) && !__builtin_isfinite(nan) && __builtin_isnormal(d) && !__builtin_isnormal(dz));
  CHECK(__builtin_isinf_sign(-__builtin_inf()) == -1 && __builtin_isinf_sign(__builtin_inf()) == 1 && __builtin_isinf_sign(d) == 0);
  CHECK(__builtin_signbit(d) && __builtin_signbitf(-f) && __builtin_signbitl(l) && !__builtin_signbit(2.0));
  CHECK(__builtin_fpclassify(1, 2, 3, 4, 5, nan) == 1 && __builtin_fpclassify(1, 2, 3, 4, 5, __builtin_inf()) == 2 && __builtin_fpclassify(1, 2, 3, 4, 5, d) == 3 && __builtin_fpclassify(1, 2, 3, 4, 5, 1e-310) == 4 && __builtin_fpclassify(1, 2, 3, 4, 5, dz) == 5);
#if HAVE(__builtin_isnanf)
  CHECK(__builtin_isnanf(f) == 0 && __builtin_isinff(f) == 0 && __builtin_isnanl(l) == 0 && __builtin_isinfl(l) == 0 && __builtin_finite(d) && __builtin_finitef(f) && __builtin_finitel(l));
#endif
  CHECK(__builtin_isgreater(2.0, 1.0) && __builtin_isgreaterequal(1.0, 1.0) && __builtin_isless(1.0, 2.0) && __builtin_islessequal(1.0, 1.0) && __builtin_islessgreater(1.0, 2.0) && !__builtin_isunordered(1.0, 2.0));
  CHECK(!__builtin_isgreater(nan, 1.0) && !__builtin_isless(nan, 1.0) && !__builtin_islessgreater(nan, nan) && __builtin_isunordered(nan, 1.0));
#if HAVE(__builtin_complex)
  double _Complex z = __builtin_complex(1.0, -2.0);
  CHECK(__real__ z == 1.0 && __imag__ z == -2.0);
#endif
  // What is known when the program is translated.
  enum { FOLDED = __builtin_constant_p(42) + 2 * __builtin_constant_p(sizeof(int) * 3) };
  CHECK(FOLDED == 3 && !__builtin_constant_p(v32));
  CHECK(__builtin_types_compatible_p(int, signed) && !__builtin_types_compatible_p(int, long) && __builtin_types_compatible_p(int[], int[3]) && __builtin_types_compatible_p(__typeof__(v32), unsigned));
  CHECK(__builtin_choose_expr(1, 10, "never looked at" + 1) == 10 && sizeof(__builtin_choose_expr(0, 1, 1.0)) == sizeof(double));
  CHECK(__builtin_offsetof(struct record, value) == sizeof(int) && __builtin_offsetof(struct record, weights[2]) == __builtin_offsetof(struct record, weights) + 2 * sizeof(double));
  CHECK(__builtin_expect(v32 == 0, 0) == 0 && __builtin_expect(zero + 5L, 5L) == 5);
#if HAVE(__builtin_expect_with_probability)
  CHECK(__builtin_expect_with_probability(zero + 7, 7, 0.9) == 7);
#endif
#if HAVE(__builtin_unpredictable)
  CHECK(__builtin_unpredictable(zero == 0));
#endif
#if HAVE(__builtin_assume)
  __builtin_assume(zero == 0);
#endif
  static _Alignas(64) char aligned[64];
  CHECK(__builtin_assume_aligned(aligned, 64) == (void *)aligned && __builtin_assume_aligned(aligned + 8, 64, 8) == (void *)(aligned + 8));
  char small[10];
  // (The size, or "unknown" when the compiler does not track it: all ones for the maximum, zero for the minimum.)
  CHECK(__builtin_object_size(small, 0) == 10 || __builtin_object_size(small, 0) == (size_t)-1);
  CHECK(__builtin_object_size((void *)(unsigned long long)v64, 0) == (size_t)-1 && __builtin_object_size((void *)(unsigned long long)v64, 2) == 0);
#if HAVE(__builtin_dynamic_object_size)
  CHECK(__builtin_dynamic_object_size(small, 0) == 10 || __builtin_dynamic_object_size(small, 0) == (size_t)-1);
#endif
  CHECK(never(5) == 5);
  // Frames and the machine.
  CHECK(caller() != 0 && __builtin_frame_address(0) != 0 && __builtin_return_address(0) != 0);
#if HAVE(__builtin_frob_return_addr)
  CHECK(__builtin_frob_return_addr(__builtin_return_address(0)) != 0);
#endif
  __builtin_prefetch(aligned); __builtin_prefetch(aligned, 1); __builtin_prefetch(aligned, 0, 3);
  __builtin___clear_cache(aligned, aligned + 64);
#if defined __x86_64__
  __builtin_cpu_init();
  CHECK(__builtin_cpu_supports("sse2") != 0 && (__builtin_cpu_is("intel") != 0) + (__builtin_cpu_is("amd") != 0) <= 1);
#endif
  char *stack = __builtin_alloca(32);
  memset(stack, 7, 32);
  char *stack_aligned = __builtin_alloca_with_align(64, 512);
  CHECK(stack[31] == 7 && (unsigned long long)stack_aligned % 64 == 0);
  CHECK(sum(3, 10, 20, 30) == 60 + 10000);
  // The library's functions under their __builtin_ names.
  char text[16];
  CHECK(__builtin_memcpy(text, "abc", 4) == text && __builtin_strlen(text) == 3 && __builtin_strcmp(text, "abd") < 0 && __builtin_memcmp(text, "abc", 3) == 0 && __builtin_strchr(text, 'c') == text + 2);
  CHECK(__builtin_memset(text, 'x', 3) == text && text[2] == 'x' && __builtin_strncmp("abc", "abd", 2) == 0 && __builtin_memmove(text + 1, text, 2) == text + 1 && __builtin_strcpy(text, "z") == text);
  CHECK(__builtin_abs(negative) == 1 && __builtin_labs(-2L) == 2 && __builtin_llabs(-3LL) == 3);
  CHECK(__builtin_sqrt(16.0) == 4.0 && __builtin_floor(d) == -3.0 && __builtin_ceil(d) == -2.0 && __builtin_trunc(d) == -2.0 && __builtin_fmax(1.0, 2.0) == 2.0 && __builtin_fmin(1.0f, 2.0f) == 1.0f && __builtin_sqrtf(4.0f) == 2.0f);
  printf("%d wrong\n", wrong);
  return wrong != 0;
}

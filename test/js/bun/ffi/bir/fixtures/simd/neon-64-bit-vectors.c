// The 64-bit (d register) NEON vector types, and the intrinsics that connect them to the 128-bit ones:
// every result is compared with the same thing worked out one lane at a time in plain C.
#include <arm_acle.h>
#include <arm_neon.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int checks, failures;

static void same(const char *what, const void *got, const void *want, int bytes) {
  checks++;
  if (memcmp(got, want, bytes) == 0) return;
  failures++;
  if (failures > 20) return;
  printf("MISMATCH %s\n  got ", what);
  for (int i = 0; i < bytes; i++) printf(" %02x", ((const unsigned char *)got)[i]);
  printf("\n  want");
  for (int i = 0; i < bytes; i++) printf(" %02x", ((const unsigned char *)want)[i]);
  printf("\n");
}

static uint64_t seed = 0x9e3779b97f4a7c15ull;
static uint64_t next(void) {
  seed ^= seed << 13;
  seed ^= seed >> 7;
  seed ^= seed << 17;
  return seed;
}
// Random bits, with the values where carries, signs and saturation show up mixed in.
static uint64_t pick(void) {
  static const uint64_t edges[] = {0, 1, 2, 0x7f, 0x80, 0xff, 0x7fff, 0x8000, 0xffff, 0x7fffffff, 0x80000000, 0xffffffff, 0x7fffffffffffffffull, 0x8000000000000000ull, ~0ull, 0xfe, 0x100};
  uint64_t r = next();
  return r % 3 == 0 ? edges[(r >> 8) % (sizeof edges / sizeof *edges)] : r >> 5;
}

#define ROUNDS 24
#define ALL_ONES(E, c) ((E)((c) ? ~(E)0 : (E)0))
#define SAT(v, lo, hi) ((v) < (lo) ? (lo) : (v) > (hi) ? (hi) : (v))

// want[i] from `expr` over x = a[i], y = b[i], z = c[i]; got from `call` over the vectors A, B, C.
#define LANES(what, RS, RE, RN, expr, call)                  \
  do {                                                       \
    RE want[RN], got[RN];                                    \
    for (int i = 0; i < RN; i++) {                           \
      E x = a[i % (2 * N)], y = b[i % (2 * N)], z = c[i % (2 * N)]; \
      (void)x, (void)y, (void)z;                             \
      want[i] = (RE)(expr);                                  \
    }                                                        \
    RS(got, call);                                           \
    same(what, got, want, sizeof got);                       \
  } while (0)

static int popcount8(unsigned v) {
  int n = 0;
  for (; v; v >>= 1) n += v & 1;
  return n;
}

// Everything a 64-bit vector of integers with lanes narrower than 64 bits has. S is the suffix, US the
// suffix of the unsigned type of that width; LN the lanes in 64 bits.
#define INT_SUITE(S, US, BASE, UBASE, LN, BITS)                                                         \
  static void suite_##S(void) {                                                                              \
    typedef BASE##_t E;                                                                                      \
    typedef UBASE##_t UE;                                                                                   \
    typedef BASE##x##LN##_t D;                                                                               \
    enum { N = LN };                                                                                         \
    for (int round = 0; round < ROUNDS; round++) {                                                           \
      E a[2 * N], b[2 * N], c[2 * N];                                                                        \
      for (int i = 0; i < 2 * N; i++) a[i] = (E)pick(), b[i] = (E)pick(), c[i] = (E)pick();                  \
      D A = vld1_##S(a), B = vld1_##S(b), C = vld1_##S(c);                                                   \
      LANES("vadd_" #S, vst1_##S, E, N, (uint64_t)x + (uint64_t)y, vadd_##S(A, B));                          \
      LANES("vsub_" #S, vst1_##S, E, N, (uint64_t)x - (uint64_t)y, vsub_##S(A, B));                          \
      LANES("vmul_" #S, vst1_##S, E, N, (uint64_t)x * (uint64_t)y, vmul_##S(A, B));                          \
      LANES("vmla_" #S, vst1_##S, E, N, (uint64_t)x + (uint64_t)y * (uint64_t)z, vmla_##S(A, B, C));         \
      LANES("vmls_" #S, vst1_##S, E, N, (uint64_t)x - (uint64_t)y * (uint64_t)z, vmls_##S(A, B, C));         \
      LANES("vmin_" #S, vst1_##S, E, N, x < y ? x : y, vmin_##S(A, B));                                      \
      LANES("vmax_" #S, vst1_##S, E, N, x > y ? x : y, vmax_##S(A, B));                                      \
      LANES("vand_" #S, vst1_##S, E, N, x & y, vand_##S(A, B));                                              \
      LANES("vorr_" #S, vst1_##S, E, N, x | y, vorr_##S(A, B));                                              \
      LANES("veor_" #S, vst1_##S, E, N, x ^ y, veor_##S(A, B));                                              \
      LANES("vbic_" #S, vst1_##S, E, N, x & ~y, vbic_##S(A, B));                                             \
      LANES("vorn_" #S, vst1_##S, E, N, x | ~y, vorn_##S(A, B));                                             \
      LANES("vmvn_" #S, vst1_##S, E, N, ~x, vmvn_##S(A));                                                    \
      LANES("vshl_n_" #S " 1", vst1_##S, E, N, (uint64_t)x << 1, vshl_n_##S(A, 1));                          \
      LANES("vshl_n_" #S " top", vst1_##S, E, N, (uint64_t)x << (BITS - 1), vshl_n_##S(A, BITS - 1));        \
      LANES("vshr_n_" #S " 3", vst1_##S, E, N, (int64_t)x >> 3, vshr_n_##S(A, 3));                           \
      LANES("vshr_n_" #S " all", vst1_##S, E, N, (int64_t)x >> BITS, vshr_n_##S(A, BITS));                   \
      LANES("vsra_n_" #S, vst1_##S, E, N, (uint64_t)x + (uint64_t)((int64_t)y >> 2), vsra_n_##S(A, B, 2));   \
      LANES("vrshr_n_" #S, vst1_##S, E, N, ((int64_t)x + 4) >> 3, vrshr_n_##S(A, 3));                        \
      LANES("vrshr_n_" #S " all", vst1_##S, E, N, ((int64_t)x + ((int64_t)1 << (BITS - 1))) >> BITS, vrshr_n_##S(A, BITS)); \
      LANES("vsli_n_" #S, vst1_##S, E, N, ((UE)x & 7) | (UE)((uint64_t)y << 3), vsli_n_##S(A, B, 3));        \
      LANES("vsri_n_" #S, vst1_##S, E, N, ((UE)x & (UE)~((UE)~(UE)0 >> 3)) | ((UE)y >> 3), vsri_n_##S(A, B, 3)); \
      LANES("vsri_n_" #S " all", vst1_##S, E, N, x, vsri_n_##S(A, B, BITS));                                 \
      LANES("vhadd_" #S, vst1_##S, E, N, ((int64_t)x + (int64_t)y) >> 1, vhadd_##S(A, B));                   \
      LANES("vrhadd_" #S, vst1_##S, E, N, ((int64_t)x + (int64_t)y + 1) >> 1, vrhadd_##S(A, B));             \
      LANES("vhsub_" #S, vst1_##S, E, N, ((int64_t)x - (int64_t)y) >> 1, vhsub_##S(A, B));                   \
      LANES("vabd_" #S, vst1_##S, E, N, x > y ? (int64_t)x - (int64_t)y : (int64_t)y - (int64_t)x, vabd_##S(A, B)); \
      LANES("vceq_" #S, vst1_##US, UE, N, ALL_ONES(UE, x == y), vceq_##S(A, B));                             \
      LANES("vcgt_" #S, vst1_##US, UE, N, ALL_ONES(UE, x > y), vcgt_##S(A, B));                              \
      LANES("vclt_" #S, vst1_##US, UE, N, ALL_ONES(UE, x < y), vclt_##S(A, B));                              \
      LANES("vcge_" #S, vst1_##US, UE, N, ALL_ONES(UE, x >= y), vcge_##S(A, B));                             \
      LANES("vcle_" #S, vst1_##US, UE, N, ALL_ONES(UE, x <= y), vcle_##S(A, B));                             \
      LANES("vceqz_" #S, vst1_##US, UE, N, ALL_ONES(UE, x == 0), vceqz_##S(A));                              \
      LANES("vtst_" #S, vst1_##US, UE, N, ALL_ONES(UE, (x & y) != 0), vtst_##S(A, B));                       \
      LANES("vbsl_" #S, vst1_##S, E, N, (z & x) | (~z & y), vbsl_##S(vld1_##US((const UE *)c), A, B));       \
      LANES("vdup_n_" #S, vst1_##S, E, N, a[1], vdup_n_##S(a[1]));                                           \
      LANES("vdup_lane_" #S, vst1_##S, E, N, a[N - 1], vdup_lane_##S(A, N - 1));                             \
      LANES("vdupq_lane_" #S, vst1q_##S, E, 2 * N, a[1], vdupq_lane_##S(A, 1));                              \
      LANES("vld1_dup_" #S, vst1_##S, E, N, b[0], vld1_dup_##S(b));                                          \
      LANES("vset_lane_" #S, vst1_##S, E, N, i == 1 ? b[0] : x, vset_lane_##S(b[0], A, 1));                  \
      LANES("vld1_lane_" #S, vst1_##S, E, N, i == N - 1 ? c[3] : x, vld1_lane_##S(c + 3, A, N - 1));         \
      LANES("vget_low_" #S, vst1_##S, E, N, a[i], vget_low_##S(vld1q_##S(a)));                               \
      LANES("vget_high_" #S, vst1_##S, E, N, a[i + N], vget_high_##S(vld1q_##S(a)));                         \
      LANES("vcombine_" #S, vst1q_##S, E, 2 * N, i < N ? b[i] : a[i - N], vcombine_##S(B, A));               \
      LANES("vext_" #S, vst1_##S, E, N, i + 1 < N ? a[i + 1] : b[i + 1 - N], vext_##S(A, B, 1));             \
      LANES("vextq_" #S, vst1q_##S, E, 2 * N, i + 3 < 2 * N ? a[i + 3] : b[i + 3 - 2 * N], vextq_##S(vld1q_##S(a), vld1q_##S(b), 3)); \
      LANES("vrev64_" #S, vst1_##S, E, N, a[N - 1 - i], vrev64_##S(A));                                      \
      LANES("vzip1_" #S, vst1_##S, E, N, i % 2 ? b[i / 2] : a[i / 2], vzip1_##S(A, B));                      \
      LANES("vzip2_" #S, vst1_##S, E, N, i % 2 ? b[N / 2 + i / 2] : a[N / 2 + i / 2], vzip2_##S(A, B));      \
      LANES("vuzp1_" #S, vst1_##S, E, N, 2 * i < N ? a[2 * i] : b[2 * i - N], vuzp1_##S(A, B));              \
      LANES("vuzp2_" #S, vst1_##S, E, N, 2 * i + 1 < N ? a[2 * i + 1] : b[2 * i + 1 - N], vuzp2_##S(A, B));  \
      LANES("vtrn1_" #S, vst1_##S, E, N, i % 2 ? b[i - 1] : a[i], vtrn1_##S(A, B));                          \
      LANES("vtrn2_" #S, vst1_##S, E, N, i % 2 ? b[i] : a[i + 1], vtrn2_##S(A, B));                          \
      LANES("vzip_" #S ".val[1]", vst1_##S, E, N, i % 2 ? b[N / 2 + i / 2] : a[N / 2 + i / 2], vzip_##S(A, B).val[1]); \
      LANES("vuzpq_" #S ".val[1]", vst1q_##S, E, 2 * N, 2 * i + 1 < 2 * N ? a[2 * i + 1] : b[2 * i + 1 - 2 * N], vuzpq_##S(vld1q_##S(a), vld1q_##S(b)).val[1]); \
      LANES("vpadd_" #S, vst1_##S, E, N, 2 * i < N ? (uint64_t)a[2 * i] + (uint64_t)a[2 * i + 1] : (uint64_t)b[2 * i - N] + (uint64_t)b[2 * i + 1 - N], vpadd_##S(A, B)); \
      LANES("vpmax_" #S, vst1_##S, E, N, 2 * i < N ? (a[2 * i] > a[2 * i + 1] ? a[2 * i] : a[2 * i + 1]) : (b[2 * i - N] > b[2 * i + 1 - N] ? b[2 * i - N] : b[2 * i + 1 - N]), vpmax_##S(A, B)); \
      {                                                                                                      \
        E sum = 0, most = a[0], least = a[0];                                                                \
        for (int i = 0; i < N; i++) sum = (E)((uint64_t)sum + (uint64_t)a[i]), most = a[i] > most ? a[i] : most, least = a[i] < least ? a[i] : least; \
        E got[3] = {vaddv_##S(A), vmaxv_##S(A), vminv_##S(A)}, want[3] = {sum, most, least};                 \
        same("vaddv/vmaxv/vminv_" #S, got, want, sizeof got);                                                \
        E lane[2] = {vget_lane_##S(A, 0), vget_lane_##S(A, N - 1)}, lanes[2] = {a[0], a[N - 1]};             \
        same("vget_lane_" #S, lane, lanes, sizeof lane);                                                     \
        E stored[2] = {0, 0}, kept[2] = {a[N - 1], 0};                                                       \
        vst1_lane_##S(stored, A, N - 1);                                                                     \
        same("vst1_lane_" #S, stored, kept, sizeof stored);                                                  \
        uint64_t bits;                                                                                       \
        memcpy(&bits, a, 8);                                                                                 \
        LANES("vcreate_" #S, vst1_##S, E, N, a[i], vcreate_##S(bits));                                       \
        uint64_t back = vget_lane_u64(vreinterpret_u64_##S(A), 0);                                           \
        same("vreinterpret_u64_" #S, &back, &bits, 8);                                                       \
      }                                                                                                      \
      {                                                                                                      \
        E memory[4 * 2 * N], out[4 * 2 * N];                                                                 \
        for (int i = 0; i < 4 * 2 * N; i++) memory[i] = (E)pick();                                           \
        BASE##x##LN##x2_t two = vld2_##S(memory);                                                                \
        LANES("vld2_" #S ".val[0]", vst1_##S, E, N, memory[2 * i], two.val[0]);                              \
        LANES("vld2_" #S ".val[1]", vst1_##S, E, N, memory[2 * i + 1], two.val[1]);                          \
        memset(out, 0, sizeof out), vst2_##S(out, two);                                                      \
        same("vst2_" #S, out, memory, 2 * N * sizeof(E));                                                    \
        BASE##x##LN##x4_t four = vld4_##S(memory);                                                               \
        LANES("vld4_" #S ".val[0]", vst1_##S, E, N, memory[4 * i], four.val[0]);                             \
        LANES("vld4_" #S ".val[1]", vst1_##S, E, N, memory[4 * i + 1], four.val[1]);                         \
        LANES("vld4_" #S ".val[2]", vst1_##S, E, N, memory[4 * i + 2], four.val[2]);                         \
        LANES("vld4_" #S ".val[3]", vst1_##S, E, N, memory[4 * i + 3], four.val[3]);                         \
        memset(out, 0, sizeof out), vst4_##S(out, four);                                                     \
        same("vst4_" #S, out, memory, 4 * N * sizeof(E));                                                    \
        memset(out, 0, sizeof out), vst4q_##S(out, vld4q_##S(memory));                                       \
        same("vld4q/vst4q_" #S, out, memory, sizeof out);                                                    \
        memset(out, 0, sizeof out), vst2q_##S(out, vld2q_##S(memory));                                       \
        same("vld2q/vst2q_" #S, out, memory, 4 * N * sizeof(E));                                             \
        LANES("vld4q_" #S ".val[2]", vst1q_##S, E, 2 * N, memory[4 * i + 2], vld4q_##S(memory).val[2]);      \
        memset(out, 0, sizeof out), vst1_##S##_x4(out, vld1_##S##_x4(memory));                               \
        same("vld1/vst1_" #S "_x4", out, memory, 4 * N * sizeof(E));                                         \
        memset(out, 0, sizeof out), vst1q_##S##_x4(out, vld1q_##S##_x4(memory));                             \
        same("vld1q/vst1q_" #S "_x4", out, memory, sizeof out);                                              \
        memset(out, 0, sizeof out), vst1q_##S##_x2(out, vld1q_##S##_x2(memory));                             \
        same("vld1q/vst1q_" #S "_x2", out, memory, 4 * N * sizeof(E));                                       \
        memset(out, 0, sizeof out), vst1_##S##_x3(out, vld1_##S##_x3(memory));                               \
        same("vld1/vst1_" #S "_x3", out, memory, 3 * N * sizeof(E));                                         \
      }                                                                                                      \
    }                                                                                                        \
  }

INT_SUITE(s8, u8, int8, uint8, 8, 8)
INT_SUITE(u8, u8, uint8, uint8, 8, 8)
INT_SUITE(s16, u16, int16, uint16, 4, 16)
INT_SUITE(u16, u16, uint16, uint16, 4, 16)
INT_SUITE(s32, u32, int32, uint32, 2, 32)
INT_SUITE(u32, u32, uint32, uint32, 2, 32)

// What takes lanes to twice their width, and back. S and WS are the suffixes of the narrow and the wide type.
#define WIDE_SUITE(S, WS, BASE, WBASE, LN, BITS, WMIN, WMAX, UNSIGNED_MAX)                                   \
  static void wide_##S(void) {                                                                               \
    typedef BASE##_t E;                                                                                      \
    typedef WBASE##_t W;                                                                                     \
    enum { N = LN };                                                                                         \
    for (int round = 0; round < ROUNDS; round++) {                                                           \
      E a[2 * N], b[2 * N], c[2 * N];                                                                        \
      W wide[N], other[N];                                                                                   \
      for (int i = 0; i < 2 * N; i++) a[i] = (E)pick(), b[i] = (E)pick(), c[i] = (E)pick();                  \
      for (int i = 0; i < N; i++) wide[i] = (W)pick(), other[i] = (W)pick();                                 \
      BASE##x##LN##_t A = vld1_##S(a), B = vld1_##S(b);                                                      \
      WBASE##x##LN##_t WQ = vld1q_##WS(wide), OQ = vld1q_##WS(other);                                        \
      LANES("vmovl_" #S, vst1q_##WS, W, N, x, vmovl_##S(A));                                                 \
      LANES("vmovl_high_" #S, vst1q_##WS, W, N, a[i + N], vmovl_high_##S(vld1q_##S(a)));                     \
      LANES("vshll_n_" #S, vst1q_##WS, W, N, (uint64_t)(W)x << 3, vshll_n_##S(A, 3));                        \
      LANES("vaddl_" #S, vst1q_##WS, W, N, (W)x + (W)y, vaddl_##S(A, B));                                    \
      LANES("vaddl_high_" #S, vst1q_##WS, W, N, (W)a[i + N] + (W)b[i + N], vaddl_high_##S(vld1q_##S(a), vld1q_##S(b))); \
      LANES("vsubl_" #S, vst1q_##WS, W, N, (W)x - (W)y, vsubl_##S(A, B));                                    \
      LANES("vaddw_" #S, vst1q_##WS, W, N, (uint64_t)wide[i] + (uint64_t)(W)x, vaddw_##S(WQ, A));            \
      LANES("vaddw_high_" #S, vst1q_##WS, W, N, (uint64_t)wide[i] + (uint64_t)(W)a[i + N], vaddw_high_##S(WQ, vld1q_##S(a))); \
      LANES("vsubw_" #S, vst1q_##WS, W, N, (uint64_t)wide[i] - (uint64_t)(W)x, vsubw_##S(WQ, A));            \
      LANES("vmull_" #S, vst1q_##WS, W, N, (W)x * (W)y, vmull_##S(A, B));                                    \
      LANES("vmull_high_" #S, vst1q_##WS, W, N, (W)a[i + N] * (W)b[i + N], vmull_high_##S(vld1q_##S(a), vld1q_##S(b))); \
      LANES("vmlal_" #S, vst1q_##WS, W, N, (uint64_t)wide[i] + (uint64_t)((W)x * (W)y), vmlal_##S(WQ, A, B)); \
      LANES("vmlal_high_" #S, vst1q_##WS, W, N, (uint64_t)wide[i] + (uint64_t)((W)a[i + N] * (W)b[i + N]), vmlal_high_##S(WQ, vld1q_##S(a), vld1q_##S(b))); \
      LANES("vmlsl_" #S, vst1q_##WS, W, N, (uint64_t)wide[i] - (uint64_t)((W)x * (W)y), vmlsl_##S(WQ, A, B)); \
      LANES("vabdl_" #S, vst1q_##WS, W, N, x > y ? (W)x - (W)y : (W)y - (W)x, vabdl_##S(A, B));              \
      LANES("vpaddl_" #S, vst1_##WS, W, N / 2, (W)a[2 * i] + (W)a[2 * i + 1], vpaddl_##S(A));                \
      LANES("vpaddlq_" #S, vst1q_##WS, W, N, (W)a[2 * i] + (W)a[2 * i + 1], vpaddlq_##S(vld1q_##S(a)));      \
      LANES("vpadalq_" #S, vst1q_##WS, W, N, (uint64_t)wide[i] + (uint64_t)((W)a[2 * i] + (W)a[2 * i + 1]), vpadalq_##S(WQ, vld1q_##S(a))); \
      LANES("vpadal_" #S, vst1_##WS, W, N / 2, (uint64_t)wide[i] + (uint64_t)((W)a[2 * i] + (W)a[2 * i + 1]), vpadal_##S(vget_low_##WS(WQ), A)); \
      LANES("vmovn_" #WS, vst1_##S, E, N, wide[i], vmovn_##WS(WQ));                                          \
      LANES("vmovn_high_" #WS, vst1q_##S, E, 2 * N, i < N ? a[i] : other[i - N], vmovn_high_##WS(A, OQ));    \
      LANES("vqmovn_" #WS, vst1_##S, E, N, SAT(wide[i], WMIN, WMAX), vqmovn_##WS(WQ));                       \
      LANES("vshrn_n_" #WS, vst1_##S, E, N, (int64_t)wide[i] >> 3, vshrn_n_##WS(WQ, 3));                     \
      LANES("vshrn_n_" #WS " all", vst1_##S, E, N, (int64_t)wide[i] >> BITS, vshrn_n_##WS(WQ, BITS));        \
      LANES("vrshrn_n_" #WS, vst1_##S, E, N, ((int64_t)wide[i] + 4) >> 3, vrshrn_n_##WS(WQ, 3));             \
      LANES("vaddhn_" #WS, vst1_##S, E, N, (W)((uint64_t)wide[i] + (uint64_t)other[i]) >> BITS, vaddhn_##WS(WQ, OQ)); \
      LANES("vsubhn_" #WS, vst1_##S, E, N, (W)((uint64_t)wide[i] - (uint64_t)other[i]) >> BITS, vsubhn_##WS(WQ, OQ)); \
      {                                                                                                      \
        W sum = 0, sumq = 0;                                                                                 \
        for (int i = 0; i < N; i++) sum += a[i];                                                             \
        for (int i = 0; i < 2 * N; i++) sumq += a[i];                                                        \
        W got[2] = {vaddlv_##S(A), vaddlvq_##S(vld1q_##S(a))}, want[2] = {sum, sumq};                        \
        same("vaddlv/vaddlvq_" #S, got, want, sizeof got);                                                   \
      }                                                                                                      \
    }                                                                                                        \
  }

WIDE_SUITE(s8, s16, int8, int16, 8, 8, INT8_MIN, INT8_MAX, UINT8_MAX)
WIDE_SUITE(u8, u16, uint8, uint16, 8, 8, 0, UINT8_MAX, UINT8_MAX)
WIDE_SUITE(s16, s32, int16, int32, 4, 16, INT16_MIN, INT16_MAX, UINT16_MAX)
WIDE_SUITE(u16, u32, uint16, uint32, 4, 16, 0, UINT16_MAX, UINT16_MAX)
WIDE_SUITE(s32, s64, int32, int64, 2, 32, INT32_MIN, INT32_MAX, UINT32_MAX)
WIDE_SUITE(u32, u64, uint32, uint64, 2, 32, 0, UINT32_MAX, UINT32_MAX)

// Signed lanes saturated to unsigned ones of half the width, and the saturating sums.
#define SATURATING_SUITE(S, US, WS, BASE, UBASE, WBASE, LN, MIN, MAX, UMAX)                                  \
  static void saturating_##S(void) {                                                                         \
    typedef BASE##_t E;                                                                                      \
    typedef UBASE##_t UE;                                                                                    \
    typedef WBASE##_t W;                                                                                     \
    enum { N = LN };                                                                                         \
    for (int round = 0; round < ROUNDS; round++) {                                                           \
      E a[2 * N], b[2 * N], c[2 * N];                                                                        \
      W wide[N];                                                                                             \
      for (int i = 0; i < 2 * N; i++) a[i] = (E)pick(), b[i] = (E)pick(), c[i] = (E)pick();                  \
      for (int i = 0; i < N; i++) wide[i] = (W)pick();                                                       \
      LANES("vqmovun_" #WS, vst1_##US, UE, N, SAT(wide[i], 0, UMAX), vqmovun_##WS(vld1q_##WS(wide)));        \
      LANES("vqadd_" #S, vst1_##S, E, N, SAT((int64_t)x + (int64_t)y, MIN, MAX), vqadd_##S(vld1_##S(a), vld1_##S(b))); \
      LANES("vqsub_" #S, vst1_##S, E, N, SAT((int64_t)x - (int64_t)y, MIN, MAX), vqsub_##S(vld1_##S(a), vld1_##S(b))); \
      LANES("vqadd_" #US, vst1_##US, UE, N, SAT((int64_t)(UE)x + (int64_t)(UE)y, 0, UMAX), vqadd_##US(vld1_##US((const UE *)a), vld1_##US((const UE *)b))); \
      LANES("vqsub_" #US, vst1_##US, UE, N, SAT((int64_t)(UE)x - (int64_t)(UE)y, 0, UMAX), vqsub_##US(vld1_##US((const UE *)a), vld1_##US((const UE *)b))); \
      LANES("vqshl_n_" #US, vst1_##US, UE, N, SAT((int64_t)(UE)x << 3, 0, (int64_t)UMAX), vqshl_n_##US(vld1_##US((const UE *)a), 3)); \
      LANES("vneg_" #S, vst1_##S, E, N, 0 - (uint64_t)x, vneg_##S(vld1_##S(a)));                             \
      LANES("vabs_" #S, vst1_##S, E, N, x < 0 ? 0 - (uint64_t)x : (uint64_t)x, vabs_##S(vld1_##S(a)));       \
    }                                                                                                        \
  }

SATURATING_SUITE(s8, u8, s16, int8, uint8, int16, 8, INT8_MIN, INT8_MAX, UINT8_MAX)
SATURATING_SUITE(s16, u16, s32, int16, uint16, int32, 4, INT16_MIN, INT16_MAX, UINT16_MAX)

// One lane of 64 bits.
#define LONG_SUITE(S, BASE)                                                                                  \
  static void long_##S(void) {                                                                               \
    typedef BASE##_t E;                                                                                      \
    enum { N = 1 };                                                                                          \
    for (int round = 0; round < ROUNDS; round++) {                                                           \
      E a[2], b[2], c[2];                                                                                    \
      for (int i = 0; i < 2; i++) a[i] = (E)(pick() * 0x9e3779b97f4a7c15ull), b[i] = (E)(pick() << 17 ^ pick()), c[i] = (E)pick(); \
      BASE##x1_t A = vld1_##S(a), B = vld1_##S(b);                                                           \
      LANES("vadd_" #S, vst1_##S, E, 1, (uint64_t)x + (uint64_t)y, vadd_##S(A, B));                          \
      LANES("vsub_" #S, vst1_##S, E, 1, (uint64_t)x - (uint64_t)y, vsub_##S(A, B));                          \
      LANES("vand_" #S, vst1_##S, E, 1, x & y, vand_##S(A, B));                                              \
      LANES("veor_" #S, vst1_##S, E, 1, x ^ y, veor_##S(A, B));                                              \
      LANES("vorn_" #S, vst1_##S, E, 1, x | ~y, vorn_##S(A, B));                                             \
      LANES("vshl_n_" #S, vst1_##S, E, 1, (uint64_t)x << 13, vshl_n_##S(A, 13));                             \
      LANES("vshr_n_" #S, vst1_##S, E, 1, x >> 13, vshr_n_##S(A, 13));                                       \
      LANES("vsra_n_" #S, vst1_##S, E, 1, (uint64_t)x + (uint64_t)(y >> 60), vsra_n_##S(A, B, 60));          \
      LANES("vceq_" #S, vst1_u64, uint64_t, 1, ALL_ONES(uint64_t, x == y), vceq_##S(A, B));                  \
      LANES("vcgt_" #S, vst1_u64, uint64_t, 1, ALL_ONES(uint64_t, x > y), vcgt_##S(A, B));                   \
      LANES("vcle_" #S, vst1_u64, uint64_t, 1, ALL_ONES(uint64_t, x <= y), vcle_##S(A, B));                  \
      LANES("vget_low_" #S, vst1_##S, E, 1, a[0], vget_low_##S(vld1q_##S(a)));                               \
      LANES("vget_high_" #S, vst1_##S, E, 1, a[1], vget_high_##S(vld1q_##S(a)));                             \
      LANES("vcombine_" #S, vst1q_##S, E, 2, i ? a[0] : b[0], vcombine_##S(B, A));                           \
      LANES("vextq_" #S, vst1q_##S, E, 2, i ? b[0] : a[1], vextq_##S(vld1q_##S(a), vld1q_##S(b), 1));        \
      LANES("vdup_n_" #S, vst1_##S, E, 1, c[0], vdup_n_##S(c[0]));                                           \
      LANES("vdupq_lane_" #S, vst1q_##S, E, 2, b[0], vdupq_lane_##S(B, 0));                                  \
      LANES("vcreate_" #S, vst1_##S, E, 1, c[1], vcreate_##S((uint64_t)c[1]));                               \
      LANES("vzip1q_" #S, vst1q_##S, E, 2, i ? b[0] : a[0], vzip1q_##S(vld1q_##S(a), vld1q_##S(b)));         \
      LANES("vzip2q_" #S, vst1q_##S, E, 2, i ? b[1] : a[1], vzip2q_##S(vld1q_##S(a), vld1q_##S(b)));         \
      LANES("vbsl_" #S, vst1_##S, E, 1, (c[0] & x) | (~c[0] & y), vbsl_##S(vld1_u64((const uint64_t *)c), A, B)); \
      E lane = vget_lane_##S(A, 0);                                                                          \
      same("vget_lane_" #S, &lane, a, 8);                                                                    \
    }                                                                                                        \
  }

LONG_SUITE(s64, int64)
LONG_SUITE(u64, uint64)

static void tables_and_bits(void) {
  typedef uint8_t E;
  enum { N = 8 };
  for (int round = 0; round < ROUNDS; round++) {
    E a[16], b[16], c[16];
    for (int i = 0; i < 16; i++) a[i] = (E)pick(), b[i] = (E)(round % 2 ? pick() % 24 : pick()), c[i] = (E)pick();
    uint8x8x2_t pair = {{vld1_u8(a), vld1_u8(a + 8)}};
    LANES("vtbl1_u8", vst1_u8, E, 8, y < 8 ? a[y] : 0, vtbl1_u8(vld1_u8(a), vld1_u8(b)));
    LANES("vtbl2_u8", vst1_u8, E, 8, y < 16 ? a[y] : 0, vtbl2_u8(pair, vld1_u8(b)));
    LANES("vqtbl1_u8", vst1_u8, E, 8, y < 16 ? a[y] : 0, vqtbl1_u8(vld1q_u8(a), vld1_u8(b)));
    LANES("vqtbl1q_u8", vst1q_u8, E, 16, y < 16 ? a[y] : 0, vqtbl1q_u8(vld1q_u8(a), vld1q_u8(b)));
    LANES("vtbl1_s8", vst1_s8, int8_t, 8, y < 8 ? (int8_t)a[y] : 0, vtbl1_s8(vld1_s8((const int8_t *)a), vld1_s8((const int8_t *)b)));
    LANES("vcnt_u8", vst1_u8, E, 8, popcount8(x), vcnt_u8(vld1_u8(a)));
    LANES("vcntq_u8", vst1q_u8, E, 16, popcount8(x), vcntq_u8(vld1q_u8(a)));
    LANES("vcnt_s8", vst1_s8, int8_t, 8, popcount8(x), vcnt_s8(vld1_s8((const int8_t *)a)));
    LANES("vrev16_u8", vst1_u8, E, 8, a[i ^ 1], vrev16_u8(vld1_u8(a)));
    LANES("vrev32_u8", vst1_u8, E, 8, a[i ^ 3], vrev32_u8(vld1_u8(a)));
    LANES("vrev64q_u8", vst1q_u8, E, 16, a[i ^ 7], vrev64q_u8(vld1q_u8(a)));
    LANES("vrev32_u16", vst1_u16, uint16_t, 4, ((const uint16_t *)a)[i ^ 1], vrev32_u16(vld1_u16((const uint16_t *)a)));
    LANES("vsriq_n_u8", vst1q_u8, E, 16, (x & 0xf0) | (y >> 4), vsriq_n_u8(vld1q_u8(a), vld1q_u8(b), 4));
    LANES("vsliq_n_u8", vst1q_u8, E, 16, (x & 0x0f) | (y << 4), vsliq_n_u8(vld1q_u8(a), vld1q_u8(b), 4));
    LANES("vqshlq_n_u32", vst1q_u32, uint32_t, 4, SAT((uint64_t)((const uint32_t *)a)[i] << 9, 0, UINT32_MAX), vqshlq_n_u32(vld1q_u32((const uint32_t *)a), 9));
    LANES("vreinterpret_u8_u64", vst1_u8, E, 8, a[i], vreinterpret_u8_u64(vld1_u64((const uint64_t *)a)));
    LANES("vreinterpret_u16_u8", vst1_u16, uint16_t, 4, ((const uint16_t *)a)[i], vreinterpret_u16_u8(vld1_u8(a)));
    LANES("vreinterpret_p8_s8", vst1_p8, poly8_t, 8, a[i], vreinterpret_p8_s8(vld1_s8((const int8_t *)a)));
    LANES("vreinterpretq_p64_u8", vst1q_p64, poly64_t, 2, ((const uint64_t *)a)[i], vreinterpretq_p64_u8(vld1q_u8(a)));
    poly64_t high = vgetq_lane_p64(vreinterpretq_p64_u8(vld1q_u8(a)), 1);
    same("vgetq_lane_p64", &high, a + 8, 8);
    // The copy of eight bytes that a compressor's inner loop is made of.
    E copied[8];
    vst1_u8(copied, vld1_u8(c + 3));
    same("vld1_u8/vst1_u8 unaligned", copied, c + 3, 8);
  }
}

static void floats(void) {
  typedef float E;
  enum { N = 2 };
  static const float values[] = {0.0f, -0.0f, 1.0f, -1.5f, 2.25f, 1e10f, -3e-5f, 100.0f, 0.1f, -7.0f, 16777216.0f, 3.5f};
  for (int round = 0; round < ROUNDS; round++) {
    E a[4], b[4], c[4];
    for (int i = 0; i < 4; i++) a[i] = values[next() % 12], b[i] = values[next() % 12], c[i] = values[next() % 12];
    float32x2_t A = vld1_f32(a), B = vld1_f32(b), C = vld1_f32(c);
    LANES("vadd_f32", vst1_f32, E, 2, x + y, vadd_f32(A, B));
    LANES("vsub_f32", vst1_f32, E, 2, x - y, vsub_f32(A, B));
    LANES("vmul_f32", vst1_f32, E, 2, x * y, vmul_f32(A, B));
    LANES("vmul_n_f32", vst1_f32, E, 2, x * c[0], vmul_n_f32(A, c[0]));
    LANES("vdiv_f32", vst1_f32, E, 2, x / (y == 0 ? 1 : y), vdiv_f32(A, vbsl_f32(vceqz_f32(B), vdup_n_f32(1), B)));
    LANES("vneg_f32", vst1_f32, E, 2, -x, vneg_f32(A));
    LANES("vabs_f32", vst1_f32, E, 2, x < 0 || (x == 0 && 1 / x < 0) ? -x : x, vabs_f32(A));
    LANES("vabd_f32", vst1_f32, E, 2, x - y < 0 ? y - x : x - y, vabd_f32(A, B));
    LANES("vmax_f32", vst1_f32, E, 2, x > y ? x : y, vmax_f32(A, vbsl_f32(vceq_f32(A, B), A, B)));
    LANES("vmin_f32", vst1_f32, E, 2, x < y ? x : y, vmin_f32(A, vbsl_f32(vceq_f32(A, B), A, B)));
    LANES("vsqrt_f32", vst1_f32, E, 2, __builtin_sqrtf(x < 0 || (x == 0 && 1 / x < 0) ? -x : x), vsqrt_f32(vabs_f32(A)));
    LANES("vcgt_f32", vst1_u32, uint32_t, 2, ALL_ONES(uint32_t, x > y), vcgt_f32(A, B));
    LANES("vcle_f32", vst1_u32, uint32_t, 2, ALL_ONES(uint32_t, x <= y), vcle_f32(A, B));
    LANES("vpadd_f32", vst1_f32, E, 2, i ? b[0] + b[1] : a[0] + a[1], vpadd_f32(A, B));
    LANES("vget_high_f32", vst1_f32, E, 2, a[i + 2], vget_high_f32(vld1q_f32(a)));
    LANES("vcombine_f32", vst1q_f32, E, 4, i < 2 ? c[i] : a[i - 2], vcombine_f32(C, A));
    LANES("vext_f32", vst1_f32, E, 2, i ? b[0] : a[1], vext_f32(A, B, 1));
    LANES("vrev64_f32", vst1_f32, E, 2, a[1 - i], vrev64_f32(A));
    LANES("vzip_f32.val[0]", vst1_f32, E, 2, i ? b[0] : a[0], vzip_f32(A, B).val[0]);
    LANES("vcvt_s32_f32", vst1_s32, int32_t, 2, x >= 2147483648.0f ? INT32_MAX : x <= -2147483648.0f ? INT32_MIN : (int32_t)x, vcvt_s32_f32(A));
    LANES("vcvt_f32_s32", vst1_f32, E, 2, (float)((const int32_t *)a)[i], vcvt_f32_s32(vld1_s32((const int32_t *)a)));
    LANES("vcvt_f32_u32", vst1_f32, E, 2, (float)((const uint32_t *)a)[i], vcvt_f32_u32(vld1_u32((const uint32_t *)a)));
    LANES("vcvt_f64_f32", vst1q_f64, double, 2, (double)x, vcvt_f64_f32(A));
    LANES("vcvt_high_f64_f32", vst1q_f64, double, 2, (double)a[i + 2], vcvt_high_f64_f32(vld1q_f32(a)));
    double d[2] = {(double)a[0] * 1.000000001, (double)b[1] / 3};
    LANES("vcvt_f32_f64", vst1_f32, E, 2, (float)d[i], vcvt_f32_f64(vld1q_f64(d)));
    LANES("vget_low_f64 + vadd_f64", vst1_f64, double, 1, d[0] + d[1], vadd_f64(vget_low_f64(vld1q_f64(d)), vget_high_f64(vld1q_f64(d))));
    LANES("vcvt_s64_f64", vst1_s64, int64_t, 1, (int64_t)d[0], vcvt_s64_f64(vld1_f64(d)));
    float sums[2] = {vaddv_f32(A), vmaxv_f32(A)}, wanted[2] = {a[0] + a[1], a[0] > a[1] ? a[0] : a[1]};
    same("vaddv/vmaxv_f32", sums, wanted, sizeof sums);
  }
}

// Shifts by a register, leading zeros, saturating arithmetic and multiplies, lanes as operands, structures of three.
static int64_t shifted(int64_t x, int count, int bits, int is_signed) {
  if (count >= bits) return 0;
  if (count >= 0) return (int64_t)((uint64_t)x << count);
  if (-count >= bits) return is_signed && x < 0 ? -1 : 0;
  return x >> -count;
}
static int leading_zeros(uint64_t x, int bits) {
  int n = 0;
  for (int i = bits - 1; i >= 0 && !((x >> i) & 1); i--) n++;
  return n;
}
#define SHIFT_SUITE(S, SS, BASE, SBASE, LN, BITS, SIGNED)                                                   \
  static void shifts_##S(void) {                                                                             \
    typedef BASE##_t E;                                                                                      \
    typedef SBASE##_t SE;                                                                                    \
    enum { N = LN };                                                                                         \
    static const int counts[] = {0, 1, -1, BITS - 1, 1 - BITS, BITS, -BITS, 100, -100, 3, -3, 127, -128};    \
    for (int round = 0; round < ROUNDS; round++) {                                                           \
      E a[2 * N], b[2 * N], c[2 * N];                                                                        \
      SE n[2 * N];                                                                                           \
      for (int i = 0; i < 2 * N; i++) a[i] = (E)pick(), b[i] = (E)pick(), c[i] = (E)pick(), n[i] = (SE)(counts[next() % 13] + (BITS > 8 ? (int)(next() % 4) * 256 : 0)); \
      LANES("vshl_" #S, vst1_##S, E, N, shifted(x, (int8_t)n[i], BITS, SIGNED), vshl_##S(vld1_##S(a), vld1_##SS(n))); \
      LANES("vshlq_" #S, vst1q_##S, E, 2 * N, shifted(x, (int8_t)n[i], BITS, SIGNED), vshlq_##S(vld1q_##S(a), vld1q_##SS(n))); \
      LANES("vrsra_n_" #S, vst1_##S, E, N, (uint64_t)x + (uint64_t)(((int64_t)y + 2) >> 2), vrsra_n_##S(vld1_##S(a), vld1_##S(b), 2)); \
    }                                                                                                        \
  }
SHIFT_SUITE(s8, s8, int8, int8, 8, 8, 1)
SHIFT_SUITE(u8, s8, uint8, int8, 8, 8, 0)
SHIFT_SUITE(s16, s16, int16, int16, 4, 16, 1)
SHIFT_SUITE(u16, s16, uint16, int16, 4, 16, 0)
SHIFT_SUITE(s32, s32, int32, int32, 2, 32, 1)
SHIFT_SUITE(u32, s32, uint32, int32, 2, 32, 0)

static void more(void) {
  typedef int16_t E;
  enum { N = 4 };
  for (int round = 0; round < ROUNDS; round++) {
    E a[8], b[8], c[8];
    for (int i = 0; i < 8; i++) a[i] = (E)pick(), b[i] = (E)pick(), c[i] = (E)pick();
    if (round == 0) a[0] = b[0] = a[5] = b[5] = INT16_MIN;
    int16x4_t A = vld1_s16(a), B = vld1_s16(b);
    LANES("vclz_s16", vst1_s16, E, 4, leading_zeros((uint16_t)x, 16), vclz_s16(A));
    LANES("vclzq_u8", vst1q_u8, uint8_t, 16, leading_zeros(((const uint8_t *)a)[i], 8), vclzq_u8(vld1q_u8((const uint8_t *)a)));
    LANES("vclz_u32", vst1_u32, uint32_t, 2, leading_zeros(((const uint32_t *)a)[i], 32), vclz_u32(vld1_u32((const uint32_t *)a)));
    LANES("vcltz_s16", vst1_u16, uint16_t, 4, ALL_ONES(uint16_t, x < 0), vcltz_s16(A));
    LANES("vcgezq_s16", vst1q_u16, uint16_t, 8, ALL_ONES(uint16_t, x >= 0), vcgezq_s16(vld1q_s16(a)));
    LANES("vqdmulh_s16", vst1_s16, E, 4, SAT(((int64_t)x * y * 2) >> 16, INT16_MIN, INT16_MAX), vqdmulh_s16(A, B));
    LANES("vqrdmulhq_s16", vst1q_s16, E, 8, SAT(((int64_t)x * y * 2 + 0x8000) >> 16, INT16_MIN, INT16_MAX), vqrdmulhq_s16(vld1q_s16(a), vld1q_s16(b)));
    LANES("vqdmulhq_n_s16", vst1q_s16, E, 8, SAT(((int64_t)x * c[0] * 2) >> 16, INT16_MIN, INT16_MAX), vqdmulhq_n_s16(vld1q_s16(a), c[0]));
    LANES("vqdmulh_lane_s16", vst1_s16, E, 4, SAT(((int64_t)x * b[3] * 2) >> 16, INT16_MIN, INT16_MAX), vqdmulh_lane_s16(A, B, 3));
    int32_t wide[4], other[4];
    for (int i = 0; i < 4; i++) wide[i] = (int32_t)pick(), other[i] = (int32_t)pick();
    if (round == 1) wide[0] = other[0] = INT32_MIN;
    LANES("vqrdmulhq_s32", vst1q_s32, int32_t, 4, SAT(((int64_t)wide[i] * other[i] + 0x40000000) >> 31, INT32_MIN, INT32_MAX), vqrdmulhq_s32(vld1q_s32(wide), vld1q_s32(other)));
    LANES("vqaddq_s32", vst1q_s32, int32_t, 4, SAT((int64_t)wide[i] + other[i], INT32_MIN, INT32_MAX), vqaddq_s32(vld1q_s32(wide), vld1q_s32(other)));
    LANES("vqsub_s32", vst1_s32, int32_t, 2, SAT((int64_t)wide[i] - other[i], INT32_MIN, INT32_MAX), vqsub_s32(vld1_s32(wide), vld1_s32(other)));
    LANES("vqaddq_u32", vst1q_u32, uint32_t, 4, SAT((int64_t)(uint32_t)wide[i] + (uint32_t)other[i], 0, UINT32_MAX), vqaddq_u32(vld1q_u32((const uint32_t *)wide), vld1q_u32((const uint32_t *)other)));
    LANES("vqsubq_u32", vst1q_u32, uint32_t, 4, SAT((int64_t)(uint32_t)wide[i] - (uint32_t)other[i], 0, UINT32_MAX), vqsubq_u32(vld1q_u32((const uint32_t *)wide), vld1q_u32((const uint32_t *)other)));
    int64_t big[2] = {(int64_t)(pick() << 20 ^ pick()), (int64_t)pick()}, large[2] = {(int64_t)(pick() << 33), round % 2 ? INT64_MAX : INT64_MIN};
    LANES("vqaddq_s64", vst1q_s64, int64_t, 2, SAT((__int128)big[i] + large[i], INT64_MIN, INT64_MAX), vqaddq_s64(vld1q_s64(big), vld1q_s64(large)));
    LANES("vqsubq_s64", vst1q_s64, int64_t, 2, SAT((__int128)big[i] - large[i], INT64_MIN, INT64_MAX), vqsubq_s64(vld1q_s64(big), vld1q_s64(large)));
    LANES("vqaddq_u64", vst1q_u64, uint64_t, 2, SAT((unsigned __int128)(uint64_t)big[i] + (uint64_t)large[i], 0, UINT64_MAX), vqaddq_u64(vld1q_u64((const uint64_t *)big), vld1q_u64((const uint64_t *)large)));
    LANES("vqshrn_n_s32", vst1_s16, E, 4, SAT((int64_t)wide[i] >> 9, INT16_MIN, INT16_MAX), vqshrn_n_s32(vld1q_s32(wide), 9));
    LANES("vqrshrn_n_s32", vst1_s16, E, 4, SAT(((int64_t)wide[i] + 256) >> 9, INT16_MIN, INT16_MAX), vqrshrn_n_s32(vld1q_s32(wide), 9));
    LANES("vqshrun_n_s32", vst1_u16, uint16_t, 4, SAT((int64_t)wide[i] >> 9, 0, UINT16_MAX), vqshrun_n_s32(vld1q_s32(wide), 9));
    LANES("vqrshrun_n_s16", vst1_u8, uint8_t, 8, SAT(((int64_t)a[i] + 2) >> 2, 0, UINT8_MAX), vqrshrun_n_s16(vld1q_s16(a), 2));
    LANES("vqrshrn_n_u16", vst1_u8, uint8_t, 8, SAT(((int64_t)(uint16_t)a[i] + 2) >> 2, 0, UINT8_MAX), vqrshrn_n_u16(vld1q_u16((const uint16_t *)a), 2));
    LANES("vqshluq_n_s16", vst1q_u16, uint16_t, 8, SAT((int64_t)a[i] * 8, 0, UINT16_MAX), vqshluq_n_s16(vld1q_s16(a), 3));
    LANES("vmull_lane_s16", vst1q_s32, int32_t, 4, (int32_t)x * b[2], vmull_lane_s16(A, B, 2));
    LANES("vmlal_lane_s16", vst1q_s32, int32_t, 4, (uint32_t)wide[i] + (uint32_t)((int32_t)x * b[1]), vmlal_lane_s16(vld1q_s32(wide), A, B, 1));
    LANES("vmlsl_laneq_s16", vst1q_s32, int32_t, 4, (uint32_t)wide[i] - (uint32_t)((int32_t)x * b[6]), vmlsl_laneq_s16(vld1q_s32(wide), A, vld1q_s16(b), 6));
    LANES("vmlal_high_lane_s16", vst1q_s32, int32_t, 4, (uint32_t)wide[i] + (uint32_t)((int32_t)a[i + 4] * b[0]), vmlal_high_lane_s16(vld1q_s32(wide), vld1q_s16(a), B, 0));
    LANES("vmulq_lane_s16", vst1q_s16, E, 8, x * b[3], vmulq_lane_s16(vld1q_s16(a), B, 3));
    LANES("vmla_lane_s16", vst1_s16, E, 4, x + y * c[2], vmla_lane_s16(A, B, vld1_s16(c), 2));
    LANES("vmlsl_n_s16", vst1q_s32, int32_t, 4, (uint32_t)wide[i] - (uint32_t)((int32_t)x * c[5]), vmlsl_n_s16(vld1q_s32(wide), A, c[5]));

    uint8_t memory[64], out[64], zero[64] = {0};
    for (int i = 0; i < 64; i++) memory[i] = (uint8_t)pick();
    uint8x8x3_t three = vld3_u8(memory);
    LANES("vld3_u8.val[0]", vst1_u8, uint8_t, 8, memory[3 * i], three.val[0]);
    LANES("vld3_u8.val[2]", vst1_u8, uint8_t, 8, memory[3 * i + 2], three.val[2]);
    memset(out, 0, sizeof out), vst3_u8(out, three);
    same("vst3_u8", out, memory, 24);
    memset(out, 0, sizeof out), vst3q_u8(out, vld3q_u8(memory));
    same("vld3q/vst3q_u8", out, memory, 48);
    LANES("vld3q_u8.val[1]", vst1q_u8, uint8_t, 16, memory[3 * i + 1], vld3q_u8(memory).val[1]);
    uint8x8x4_t four = vld4_u8(memory);
    memset(out, 0, sizeof out), vst4_lane_u8(out + 1, four, 5);
    uint8_t lane_want[8] = {0, memory[20], memory[21], memory[22], memory[23], 0, 0, 0};
    same("vst4_lane_u8", out, lane_want, 8);
    memset(out, 0, sizeof out), vst3_lane_u8(out, three, 7);
    same("vst3_lane_u8", out, memory + 21, 3);
    same("vst3_lane_u8 stops", out + 3, zero, 8);
    memset(out, 0, sizeof out), vst2_lane_u16((uint16_t *)out, vld2_u16((const uint16_t *)memory), 3);
    same("vst2_lane_u16", out, memory + 12, 4);
    four = vld4_lane_u8(memory + 40, four, 0);
    LANES("vld4_lane_u8.val[2]", vst1_u8, uint8_t, 8, i == 0 ? memory[42] : memory[4 * i + 2], four.val[2]);
    three = vld3_lane_u8(memory + 50, three, 6);
    LANES("vld3_lane_u8.val[1]", vst1_u8, uint8_t, 8, i == 6 ? memory[51] : memory[3 * i + 1], three.val[1]);
    LANES("vld4_dup_u8.val[3]", vst1_u8, uint8_t, 8, memory[3], vld4_dup_u8(memory).val[3]);
    LANES("vld3_dup_u8.val[1]", vst1_u8, uint8_t, 8, memory[1], vld3_dup_u8(memory).val[1]);
    LANES("vld2q_dup_u16.val[1]", vst1q_u16, uint16_t, 8, ((const uint16_t *)memory)[1], vld2q_dup_u16((const uint16_t *)memory).val[1]);

    uint8_t index[16];
    for (int i = 0; i < 16; i++) index[i] = (uint8_t)(round % 3 ? pick() % 80 : pick());
    uint8x16x4_t tables = vld1q_u8_x4(memory);
    uint8x16x2_t two_tables = {{tables.val[0], tables.val[1]}};
    uint8x16x3_t three_tables = {{tables.val[0], tables.val[1], tables.val[2]}};
    uint8x8x4_t small = vld1_u8_x4(memory);
    uint8x8x3_t small_three = {{small.val[0], small.val[1], small.val[2]}};
    LANES("vqtbl2q_u8", vst1q_u8, uint8_t, 16, index[i] < 32 ? memory[index[i]] : 0, vqtbl2q_u8(two_tables, vld1q_u8(index)));
    LANES("vqtbl3q_u8", vst1q_u8, uint8_t, 16, index[i] < 48 ? memory[index[i]] : 0, vqtbl3q_u8(three_tables, vld1q_u8(index)));
    LANES("vqtbl4q_u8", vst1q_u8, uint8_t, 16, index[i] < 64 ? memory[index[i]] : 0, vqtbl4q_u8(tables, vld1q_u8(index)));
    LANES("vqtbl4_u8", vst1_u8, uint8_t, 8, index[i] < 64 ? memory[index[i]] : 0, vqtbl4_u8(tables, vld1_u8(index)));
    LANES("vtbl3_u8", vst1_u8, uint8_t, 8, index[i] < 24 ? memory[index[i]] : 0, vtbl3_u8(small_three, vld1_u8(index)));
    LANES("vtbl4_u8", vst1_u8, uint8_t, 8, index[i] < 32 ? memory[index[i]] : 0, vtbl4_u8(small, vld1_u8(index)));
    LANES("vtbx1_u8", vst1_u8, uint8_t, 8, index[i] < 8 ? memory[index[i]] : memory[40 + i], vtbx1_u8(vld1_u8(memory + 40), small.val[0], vld1_u8(index)));
    LANES("vtbx3_u8", vst1_u8, uint8_t, 8, index[i] < 24 ? memory[index[i]] : memory[40 + i], vtbx3_u8(vld1_u8(memory + 40), small_three, vld1_u8(index)));
    LANES("vtbx4_u8", vst1_u8, uint8_t, 8, index[i] < 32 ? memory[index[i]] : memory[40 + i], vtbx4_u8(vld1_u8(memory + 40), small, vld1_u8(index)));
    LANES("vqtbx1q_u8", vst1q_u8, uint8_t, 16, index[i] < 16 ? memory[index[i]] : memory[40 + i], vqtbx1q_u8(vld1q_u8(memory + 40), tables.val[0], vld1q_u8(index)));
  }
}

// What the CRC, polynomial-multiply, SHA-3 and dot-product extensions add: this compiler works them out
// with ordinary instructions.
static uint32_t crc_by_bits(uint32_t crc, uint64_t data, int bits, uint32_t polynomial) {
  for (int i = 0; i < bits; i++) {
    crc ^= (uint32_t)((data >> i) & 1);
    crc = (crc >> 1) ^ (crc & 1 ? polynomial : 0);
  }
  return crc;
}
static void extensions(void) {
  typedef uint8_t E;
  enum { N = 8 };
  for (int round = 0; round < ROUNDS; round++) {
    E a[16], b[16], c[16];
    for (int i = 0; i < 16; i++) a[i] = (E)pick(), b[i] = (E)pick(), c[i] = (E)pick();
    uint64_t data = next();
    uint32_t crc = (uint32_t)next();
    uint32_t got[8] = {__crc32b(crc, (uint8_t)data), __crc32h(crc, (uint16_t)data), __crc32w(crc, (uint32_t)data), __crc32d(crc, data),
                       __crc32cb(crc, (uint8_t)data), __crc32ch(crc, (uint16_t)data), __crc32cw(crc, (uint32_t)data), __crc32cd(crc, data)};
    uint32_t want[8] = {crc_by_bits(crc, data, 8, 0xedb88320), crc_by_bits(crc, data, 16, 0xedb88320), crc_by_bits(crc, data, 32, 0xedb88320), crc_by_bits(crc, data, 64, 0xedb88320),
                        crc_by_bits(crc, data, 8, 0x82f63b78), crc_by_bits(crc, data, 16, 0x82f63b78), crc_by_bits(crc, data, 32, 0x82f63b78), crc_by_bits(crc, data, 64, 0x82f63b78)};
    same("__crc32*", got, want, sizeof got);
    // A carry-less product, from the four 32x32 ones.
    uint64_t x = next(), y = pick() | pick() << 40, low = 0, high = 0;
    for (int i = 0; i < 64; i++)
      if ((y >> i) & 1) low ^= x << i, high ^= i ? x >> (64 - i) : 0;
    uint64_t product[2] = {low, high}, halves[2] = {x, y}, other[2] = {y, x};
    uint8x16_t bytes = vreinterpretq_u8_p128(vmull_p64((poly64_t)x, (poly64_t)y));
    same("vmull_p64", &bytes, product, 16);
    uint64x2_t words = vreinterpretq_u64_p128(vmull_high_p64(vreinterpretq_p64_u64(vld1q_u64(other)), vreinterpretq_p64_u64(vld1q_u64(halves))));
    same("vmull_high_p64", &words, product, 16);
    LANES("veor3q_u8", vst1q_u8, E, 16, x ^ y ^ z, veor3q_u8(vld1q_u8(a), vld1q_u8(b), vld1q_u8(c)));
    LANES("vbcaxq_u8", vst1q_u8, E, 16, x ^ (y & ~z), vbcaxq_u8(vld1q_u8(a), vld1q_u8(b), vld1q_u8(c)));
    uint32_t sums[4] = {1, 0xffffff00u, 3, (uint32_t)next()};
    LANES("vdotq_u32", vst1q_u32, uint32_t, 4, sums[i] + a[4 * i] * b[4 * i] + a[4 * i + 1] * b[4 * i + 1] + a[4 * i + 2] * b[4 * i + 2] + a[4 * i + 3] * b[4 * i + 3], vdotq_u32(vld1q_u32(sums), vld1q_u8(a), vld1q_u8(b)));
    LANES("vdotq_s32", vst1q_s32, int32_t, 4, (uint32_t)((int32_t)sums[i] + (int8_t)a[4 * i] * (int8_t)b[4 * i] + (int8_t)a[4 * i + 1] * (int8_t)b[4 * i + 1] + (int8_t)a[4 * i + 2] * (int8_t)b[4 * i + 2] + (int8_t)a[4 * i + 3] * (int8_t)b[4 * i + 3]), vdotq_s32(vld1q_s32((const int32_t *)sums), vld1q_s8((const int8_t *)a), vld1q_s8((const int8_t *)b)));
    LANES("vdot_u32", vst1_u32, uint32_t, 2, sums[i] + a[4 * i] * b[4 * i] + a[4 * i + 1] * b[4 * i + 1] + a[4 * i + 2] * b[4 * i + 2] + a[4 * i + 3] * b[4 * i + 3], vdot_u32(vld1_u32(sums), vld1_u8(a), vld1_u8(b)));
    unsigned bit_tricks[6] = {__clz((uint32_t)data | 1), __clz(0), __rbit((uint32_t)data), __rev((uint32_t)data), __ror((uint32_t)data, 7), __cls((uint32_t)data)};
    uint32_t v = (uint32_t)data, reversed = 0, leading = 0, sign_run = 0;
    for (int i = 0; i < 32; i++) reversed |= ((v >> i) & 1) << (31 - i);
    for (int i = 31; i >= 0 && !(((v | 1) >> i) & 1); i--) leading++;
    for (int i = 30; i >= 0 && ((v >> i) & 1) == (v >> 31); i--) sign_run++;
    unsigned bit_want[6] = {leading, 32, reversed, (v >> 24) | ((v >> 8) & 0xff00) | ((v << 8) & 0xff0000) | (v << 24), (v >> 7) | (v << 25), sign_run};
    same("__clz/__rbit/__rev/__ror/__cls", bit_tricks, bit_want, sizeof bit_tricks);
  }
}

// A 64-bit vector is an argument, a result, and a member like any other value.
struct two_halves {
  uint8x8_t low;
  int16x4_t high;
};
__attribute__((noinline)) static uint8x8_t swap_nibbles(uint8x8_t v) { return vorr_u8(vshl_n_u8(v, 4), vshr_n_u8(v, 4)); }
__attribute__((noinline)) static struct two_halves both(struct two_halves in, float32x2_t scale, int extra) {
  in.low = vadd_u8(in.low, vdup_n_u8((uint8_t)extra));
  in.high = vmul_s16(in.high, vmovn_s32(vcvtq_s32_f32(vcombine_f32(scale, scale))));
  return in;
}
__attribute__((noinline)) static uint64_t sum_all(int count, ...) {
  __builtin_va_list list;
  __builtin_va_start(list, count);
  uint64_t sum = 0;
  for (int i = 0; i < count; i++) {
    uint16x4_t v = __builtin_va_arg(list, uint16x4_t);
    sum += vaddlv_u16(v) + (uint64_t)__builtin_va_arg(list, int);
  }
  __builtin_va_end(list);
  return sum;
}

static void through_calls(void) {
  uint8_t bytes[8] = {0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0}, swapped[8] = {0x21, 0x43, 0x65, 0x87, 0xa9, 0xcb, 0xed, 0x0f}, got[8];
  vst1_u8(got, swap_nibbles(vld1_u8(bytes)));
  same("a 64-bit vector argument and result", got, swapped, 8);
  int16_t halves[4] = {1, -2, 300, -400};
  struct two_halves out = both((struct two_halves){vld1_u8(bytes), vld1_s16(halves)}, (float32x2_t){3.0f, -2.0f}, 0x10);
  uint8_t low_want[8] = {0x22, 0x44, 0x66, 0x88, 0xaa, 0xcc, 0xee, 0x00};
  int16_t high_want[4] = {3, 4, 900, 800}, high_got[4];
  vst1_u8(got, out.low), vst1_s16(high_got, out.high);
  same("a struct of 64-bit vectors: low", got, low_want, 8);
  same("a struct of 64-bit vectors: high", high_got, high_want, 8);
  uint64_t total = sum_all(3, (uint16x4_t){1, 2, 3, 4}, 5, (uint16x4_t){0xffff, 0xffff, 0, 1}, -6, vdup_n_u16(1000), 7), expected = 10 + 5 + 0x1ffff - 6 + 4000 + 7;
  same("64-bit vectors through an ellipsis", &total, &expected, 8);
  uint64_t sizes[4] = {sizeof(uint8x8_t), _Alignof(uint8x8_t), sizeof(struct two_halves), sizeof(uint16x4x4_t)}, sizes_want[4] = {8, 8, 16, 32};
  same("sizes", sizes, sizes_want, sizeof sizes);
}

int main(void) {
  suite_s8(), suite_u8(), suite_s16(), suite_u16(), suite_s32(), suite_u32();
  printf("64-bit integer vectors: %d checks, %d wrong\n", checks, failures);
  wide_s8(), wide_u8(), wide_s16(), wide_u16(), wide_s32(), wide_u32();
  printf("with widening and narrowing: %d checks, %d wrong\n", checks, failures);
  saturating_s8(), saturating_s16();
  printf("with saturation: %d checks, %d wrong\n", checks, failures);
  long_s64(), long_u64();
  printf("with one 64-bit lane: %d checks, %d wrong\n", checks, failures);
  tables_and_bits();
  printf("with tables, reversals and reinterpretation: %d checks, %d wrong\n", checks, failures);
  floats();
  printf("with floating point: %d checks, %d wrong\n", checks, failures);
  shifts_s8(), shifts_u8(), shifts_s16(), shifts_u16(), shifts_s32(), shifts_u32(), more();
  printf("with register shifts, saturating multiplies, lanes and structures of three: %d checks, %d wrong\n", checks, failures);
  extensions();
  printf("with the architecture extensions: %d checks, %d wrong\n", checks, failures);
  through_calls();
  printf("with calls: %d checks, %d wrong\n", checks, failures);
  return failures != 0;
}

// What FMIN, FMAX, FMINNM and FMAXNM do with NaNs and with zeros of either sign, through the intrinsics: `vmin` and `vmax`
// give a NaN when either operand is one; `vminnm` and `vmaxnm` give the number when only one is; all of them put -0 below
// +0. In every lane, for four floats, two doubles, two floats and one double, across the lanes of one vector, and
// pairwise. (The expected values are written from the architecture's rules, not from a run.)
#include <arm_neon.h>
#include <stdio.h>
#include <string.h>

static unsigned bits32(float x) { unsigned b; memcpy(&b, &x, 4); return b; }
static unsigned long long bits64(double x) { unsigned long long b; memcpy(&b, &x, 8); return b; }
// A NaN is a NaN, whichever; everything else is its bits (which tell -0 from +0).
static void show32(float x) { if (x != x) printf(" nan"); else printf(" %08x", bits32(x)); }
static void show64(double x) { if (x != x) printf(" nan"); else printf(" %016llx", bits64(x)); }
static void show_f32x4(float32x4_t v) { show32(vgetq_lane_f32(v, 0)); show32(vgetq_lane_f32(v, 1)); show32(vgetq_lane_f32(v, 2)); show32(vgetq_lane_f32(v, 3)); }
static void show_f64x2(float64x2_t v) { show64(vgetq_lane_f64(v, 0)); show64(vgetq_lane_f64(v, 1)); }
static void show_f32x2(float32x2_t v) { show32(vget_lane_f32(v, 0)); show32(vget_lane_f32(v, 1)); }
static void show_f64x1(float64x1_t v) { show64(vget_lane_f64(v, 0)); }

int main(void) {
  volatile float nan = __builtin_nanf(""), inf = __builtin_inff(), zero = 0.0f;
  volatile double dnan = __builtin_nan(""), dinf = __builtin_inf(), dzero = 0.0;
  float values[8] = { nan, -inf, -2.5f, -zero, zero, 1.5f, inf, nan };
  double doubles[8] = { dnan, -dinf, -2.5, -dzero, dzero, 1.5, dinf, dnan };
  enum { N = 7 };
  // One value against every value, which puts each pair in every lane as the second operand goes round.
  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j++) {
      float32x4_t a = vdupq_n_f32(values[i]);
      float from_j[4] = { values[j], values[(j + 1) % N], values[(j + 2) % N], values[(j + 3) % N] };
      float32x4_t b = vld1q_f32(from_j);
      printf("f32x4 %d %d min", i, j); show_f32x4(vminq_f32(a, b));
      printf(" max"); show_f32x4(vmaxq_f32(b, a));
      printf(" minnm"); show_f32x4(vminnmq_f32(a, b));
      printf(" maxnm"); show_f32x4(vmaxnmq_f32(b, a));
      printf("\n");
    }
  }
  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j++) {
      float64x2_t a = vdupq_n_f64(doubles[i]);
      double from_j[2] = { doubles[j], doubles[(j + 1) % N] };
      float64x2_t b = vld1q_f64(from_j);
      printf("f64x2 %d %d min", i, j); show_f64x2(vminq_f64(b, a));
      printf(" max"); show_f64x2(vmaxq_f64(a, b));
      printf(" minnm"); show_f64x2(vminnmq_f64(b, a));
      printf(" maxnm"); show_f64x2(vmaxnmq_f64(a, b));
      printf("\n");
    }
  }
  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j++) {
      float32x2_t a = vdup_n_f32(values[i]);
      float from_j[2] = { values[j], values[(j + 1) % N] };
      float32x2_t b = vld1_f32(from_j);
      float64x1_t c = vdup_n_f64(doubles[i]), d = vdup_n_f64(doubles[j]);
      printf("f32x2 %d %d min", i, j); show_f32x2(vmin_f32(a, b));
      printf(" max"); show_f32x2(vmax_f32(a, b));
      printf(" minnm"); show_f32x2(vminnm_f32(a, b));
      printf(" maxnm"); show_f32x2(vmaxnm_f32(a, b));
      printf(" pmin"); show_f32x2(vpmin_f32(a, b));
      printf(" pmax"); show_f32x2(vpmax_f32(b, a));
      printf(" f64x1"); show_f64x1(vmin_f64(c, d)); show_f64x1(vmax_f64(c, d)); show_f64x1(vminnm_f64(c, d)); show_f64x1(vmaxnm_f64(c, d));
      printf("\n");
    }
  }
  // Across the lanes: a NaN in any lane is the answer.
  for (int j = 0; j < N; j++) {
    float four[4] = { 1.0f, values[j], values[(j + 1) % N], -1.0f };
    double two[2] = { doubles[j], doubles[(j + 3) % N] };
    printf("across %d:", j);
    show32(vminvq_f32(vld1q_f32(four))); show32(vmaxvq_f32(vld1q_f32(four)));
    show32(vminv_f32(vld1_f32(four + 1))); show32(vmaxv_f32(vld1_f32(four + 1)));
    show64(vminvq_f64(vld1q_f64(two))); show64(vmaxvq_f64(vld1q_f64(two)));
    printf("\n");
  }
  return 0;
}

// The reference's histogram costs on made-up histograms. The .c file is included for its static functions; every symbol
// but hs_* is made local afterwards (objcopy), so that it can be linked next to the library.
#include "src/enc/histogram_enc.c"

static VP8LHistogram* Make(int cache_bits, const uint32_t* v) {
  VP8LHistogram* h = VP8LAllocateHistogram(cache_bits);
  const int n = VP8LHistogramNumCodes(cache_bits);
  memcpy(h->literal, v, n * sizeof(*v)); v += n;
  memcpy(h->red, v, 256 * sizeof(*v)); v += 256;
  memcpy(h->blue, v, 256 * sizeof(*v)); v += 256;
  memcpy(h->alpha, v, 256 * sizeof(*v)); v += 256;
  memcpy(h->distance, v, NUM_DISTANCE_CODES * sizeof(*v));
  return h;
}
uint64_t hs_estimate(int cache_bits, const uint32_t* v) {
  VP8LHistogram* h = Make(cache_bits, v);
  const uint64_t r = VP8LHistogramEstimateBits(h);
  VP8LFreeHistogram(h);
  return r;
}
uint64_t hs_bits_entropy(const uint32_t* v, int n) { return VP8LBitsEntropy(v, n); }
// out: bit_cost of a, bit_cost of b, whether below the threshold, the difference
void hs_add_thresh(int cache_bits, const uint32_t* a, const uint32_t* b, int64_t threshold, int64_t* out) {
  VP8LHistogram* ha = Make(cache_bits, a);
  VP8LHistogram* hb = Make(cache_bits, b);
  int64_t cost = 0;
  ComputeHistogramCost(ha);
  ComputeHistogramCost(hb);
  out[0] = (int64_t)ha->bit_cost;
  out[1] = (int64_t)hb->bit_cost;
  out[2] = HistogramAddThresh(ha, hb, threshold, &cost);
  out[3] = out[2] ? cost : 0;
  VP8LFreeHistogram(ha);
  VP8LFreeHistogram(hb);
}
void hs_init(void) { VP8LEncDspInit(); }

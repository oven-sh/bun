// Flat entry points over the reference libwebp for the differential harness.
#include <stdlib.h>
#include <string.h>
#include "src/webp/decode.h"
#include "src/webp/encode.h"
#include "src/webp/mux.h"
#include "src/webp/demux.h"
#include "src/dsp/cpu.h"

extern VP8CPUInfo VP8GetCPUInfo;
static int NoSimd(CPUFeature f) { (void)f; return 0; }
// Must run before the first encode/decode: the dsp tables are initialised once.
void ref_disable_simd(void) { VP8GetCPUInfo = NoSimd; }

// WebPDecode into caller memory; returns the VP8StatusCode (0 = OK).
int ref_decode_status(const uint8_t* data, size_t size, uint8_t* out, size_t out_size, int stride) {
  WebPDecoderConfig config;
  if (!WebPInitDecoderConfig(&config)) return -1;
  config.output.colorspace = MODE_RGBA;
  config.output.u.RGBA.rgba = out;
  config.output.u.RGBA.stride = stride;
  config.output.u.RGBA.size = out_size;
  config.output.is_external_memory = 1;
  return (int)WebPDecode(data, size, &config);
}

// What codec_webp.rs did to find the ICC profile. Returns 1 and a view into `data`.
int ref_icc(const uint8_t* bytes, size_t size, const uint8_t** icc, size_t* icc_size) {
  WebPData data = { bytes, size };
  WebPDemuxer* dmux;
  WebPChunkIterator iter;
  int ok = 0;
  if (size <= 20 || memcmp(bytes + 12, "VP8X", 4) || !(bytes[20] & 0x20)) return 0;
  dmux = WebPDemux(&data);
  if (dmux == NULL) return 0;
  if (WebPDemuxGetI(dmux, WEBP_FF_FORMAT_FLAGS) & ICCP_FLAG) {
    memset(&iter, 0, sizeof(iter));
    if (WebPDemuxGetChunk(dmux, "ICCP", 1, &iter)) {
      if (iter.chunk.bytes != NULL && iter.chunk.size != 0) {
        *icc = iter.chunk.bytes; *icc_size = iter.chunk.size; ok = 1;
      }
      WebPDemuxReleaseChunkIterator(&iter);
    }
  }
  WebPDemuxDelete(dmux);
  return ok;
}

// What codec_webp.rs did to attach an ICC profile. Returns the size, 0 on error; free with WebPFree.
size_t ref_mux_icc(const uint8_t* file, size_t size, const uint8_t* icc, size_t icc_size, uint8_t** out) {
  WebPMux* mux = WebPMuxNew();
  WebPData img = { file, size }, prof = { icc, icc_size }, assembled = { NULL, 0 };
  size_t n = 0;
  if (mux == NULL) return 0;
  if (WebPMuxSetImage(mux, &img, 0) == WEBP_MUX_OK &&
      WebPMuxSetChunk(mux, "ICCP", &prof, 0) == WEBP_MUX_OK &&
      WebPMuxAssemble(mux, &assembled) == WEBP_MUX_OK) {
    *out = (uint8_t*)assembled.bytes; n = assembled.size;
  } else {
    WebPFree((void*)assembled.bytes);
  }
  WebPMuxDelete(mux);
  return n;
}

// The advanced encoder, to make decoder test files that Bun's own settings never produce.
// p: lossless, quality, method, segments, sns_strength, filter_strength, filter_sharpness, filter_type, autofilter,
//    alpha_compression, alpha_filtering, alpha_quality, pass, preprocessing, partitions, partition_limit,
//    near_lossless, exact, use_sharp_yuv, image_hint, low_memory, use_delta_palette(ignored), target_size
size_t ref_encode_advanced(const uint8_t* rgba, int w, int h, int stride, const int* p, uint8_t** out) {
  WebPConfig c; WebPPicture pic; WebPMemoryWriter wr; int ok;
  if (!WebPConfigInit(&c) || !WebPPictureInit(&pic)) return 0;
  c.lossless = p[0]; c.quality = (float)p[1]; c.method = p[2]; c.segments = p[3]; c.sns_strength = p[4];
  c.filter_strength = p[5]; c.filter_sharpness = p[6]; c.filter_type = p[7]; c.autofilter = p[8];
  c.alpha_compression = p[9]; c.alpha_filtering = p[10]; c.alpha_quality = p[11]; c.pass = p[12];
  c.preprocessing = p[13]; c.partitions = p[14]; c.partition_limit = p[15]; c.near_lossless = p[16];
  c.exact = p[17]; c.use_sharp_yuv = p[18]; c.image_hint = (WebPImageHint)p[19]; c.low_memory = p[20];
  c.target_size = p[22];
  if (!WebPValidateConfig(&c)) return 0;
  pic.use_argb = !!c.lossless; pic.width = w; pic.height = h;
  WebPMemoryWriterInit(&wr); pic.writer = WebPMemoryWrite; pic.custom_ptr = &wr;
  ok = WebPPictureImportRGBA(&pic, rgba, stride) && WebPEncode(&c, &pic);
  WebPPictureFree(&pic);
  if (!ok) { WebPMemoryWriterClear(&wr); return 0; }
  *out = wr.mem; return wr.size;
}

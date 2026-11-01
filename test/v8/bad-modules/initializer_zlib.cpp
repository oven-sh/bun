#include <node.h>
#include <zlib.h>

#include <string>
#include <vector>

// As in uWebSockets.js, libz is not linked: Node's executable exports zlib.

static const Bytef dictionary[] = "a preset dictionary";

// Compresses and decompresses twice per stream, with a reset in between.
static bool deflate_and_inflate(bool raw, std::string &input,
                                std::string &output) {
  z_stream deflater = {};
  if ((raw ? deflateInit2(&deflater, Z_BEST_SPEED, Z_DEFLATED, -MAX_WBITS, 8,
                          Z_DEFAULT_STRATEGY)
           : deflateInit(&deflater, Z_BEST_SPEED)) != Z_OK)
    return false;
  std::vector<Bytef> compressed(deflateBound(&deflater, input.size()));
  for (int pass = 0; pass < 2; pass++) {
    if (pass == 1 && deflateReset(&deflater) != Z_OK)
      return false;
    if (raw &&
        deflateSetDictionary(&deflater, dictionary, sizeof dictionary) != Z_OK)
      return false;
    deflater.next_in = reinterpret_cast<Bytef *>(input.data());
    deflater.avail_in = input.size();
    deflater.next_out = compressed.data();
    deflater.avail_out = compressed.size();
    if (deflate(&deflater, Z_FINISH) != Z_STREAM_END)
      return false;
  }
  uLong compressed_size = deflater.total_out;
  if (deflateEnd(&deflater) != Z_OK)
    return false;

  z_stream inflater = {};
  if ((raw ? inflateInit2(&inflater, -MAX_WBITS) : inflateInit(&inflater)) !=
      Z_OK)
    return false;
  for (int pass = 0; pass < 2; pass++) {
    if (pass == 1 && inflateReset(&inflater) != Z_OK)
      return false;
    if (raw &&
        inflateSetDictionary(&inflater, dictionary, sizeof dictionary) != Z_OK)
      return false;
    inflater.next_in = compressed.data();
    inflater.avail_in = compressed_size;
    inflater.next_out = reinterpret_cast<Bytef *>(output.data());
    inflater.avail_out = output.size();
    if (inflate(&inflater, Z_FINISH) != Z_STREAM_END)
      return false;
  }
  return inflateEnd(&inflater) == Z_OK;
}

// roundTrip(text, raw): zlib format, or raw deflate with a dictionary.
static void round_trip(const v8::FunctionCallbackInfo<v8::Value> &info) {
  v8::Isolate *isolate = info.GetIsolate();
  v8::Local<v8::String> text = info[0].As<v8::String>();
  std::string input(text->Utf8LengthV2(isolate), '\0');
  text->WriteUtf8V2(isolate, input.data(), input.size());
  std::string output(input.size(), '\0');
  if (deflate_and_inflate(info[1]->IsTrue(), input, output))
    info.GetReturnValue().Set(
        v8::String::NewFromUtf8(isolate, output.data(),
                                v8::NewStringType::kNormal,
                                static_cast<int>(output.size()))
            .ToLocalChecked());
}

extern "C" NODE_MODULE_EXPORT void
NODE_MODULE_INITIALIZER(v8::Local<v8::Object> exports,
                        v8::Local<v8::Value> module,
                        v8::Local<v8::Context> context) {
  NODE_SET_METHOD(exports, "roundTrip", round_trip);
}

// The digests of compressed data are Bun's own, and the same on every CPU. google/brotli 1.2 reads these streams, and
// many of the inputs are made for corners of its encoder. What is expected of the decoder is what google/brotli does.
import { describe, expect, it } from "bun:test";
import { createCipheriv } from "node:crypto";
import { totalmem } from "node:os";
import * as zlib from "node:zlib";

const {
  BROTLI_ENCODE: ENCODE,
  BROTLI_DECODE: DECODE,
  BROTLI_PARAM_MODE: MODE,
  BROTLI_PARAM_QUALITY: QUALITY,
  BROTLI_PARAM_LGWIN: LGWIN,
  BROTLI_PARAM_LGBLOCK: LGBLOCK,
  BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: NO_CONTEXTS,
  BROTLI_PARAM_SIZE_HINT: SIZE_HINT,
  BROTLI_PARAM_LARGE_WINDOW: LARGE_WINDOW,
  BROTLI_PARAM_NPOSTFIX: NPOSTFIX,
  BROTLI_PARAM_NDIRECT: NDIRECT,
  BROTLI_DECODER_PARAM_LARGE_WINDOW: DECODER_LARGE_WINDOW,
  BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: DECODER_WHOLE_WINDOW,
  BROTLI_OPERATION_PROCESS: PROCESS,
  BROTLI_OPERATION_FLUSH: FLUSH,
  BROTLI_OPERATION_FINISH: FINISH,
  BROTLI_OPERATION_EMIT_METADATA: METADATA,
} = zlib.constants;
const STREAM_OFFSET = 9;
const qualities = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const isShortOfMemory = Math.min(totalmem(), process.constrainedMemory() || Infinity) < 10 * 1024 ** 3;

const noise = createCipheriv("aes-128-ctr", Buffer.alloc(16, 1), Buffer.alloc(16)).update(Buffer.alloc(1 << 16));
const vocabulary = (
  'the|of|and|The|time|TIME|people|Information|function|return|<div class="|">|</div>|</a>|href="http://www.|.com/|' +
  "qzx|vvkj|1987|3.14|, |. |\n|\n\t|(|)|='|=\"|ing|ed|ful|ous|été|ÉTÉ|привет|мир|中文|日本語|한국어|😀|\u00a0"
).split("|");
const pickWord = (byte, i) => vocabulary[byte % vocabulary.length] + (i % 3 ? " " : "");
const text = Buffer.from(Array.from(noise.subarray(0, 6000), pickWord).join(""));
const samples = Buffer.from(Int16Array.from(noise.subarray(0, 2500), (byte, i) => i * 7 + (byte & 15)).buffer);
const mixed = Buffer.concat([
  text,
  noise.subarray(0, 9000),
  Buffer.alloc(40000),
  samples,
  text.subarray(5000, 15000),
  Buffer.alloc(30000, "period"),
  noise.subarray(8000, 12000),
  samples.subarray(1, 2001),
  text.subarray(100, 9000),
]);

/** Takes a quarter of the time of `map` in debug builds. */
function bytesOf(length, byteAt) {
  const bytes = Buffer.alloc(length);
  for (let i = 0; i < length; i++) bytes[i] = byteAt(i);
  return bytes;
}

function* window(buffer, size) {
  for (let at = 0; at <= buffer.length; at += size) yield buffer.subarray(at, at + size);
}

function once(compute) {
  let value;
  return () => (value ??= compute());
}

const digest = bytes => `${bytes.length} ${zlib.crc32(bytes).toString(16).padStart(8, "0")}`;

/** Runs `[operation, input]` pairs on one stream, with `room` bytes of output at a time. */
function drive(engine, steps, room) {
  const chunks = [];
  const out = Buffer.allocUnsafe(room);
  let error;
  engine._handle.onerror = (message, errno, code) => (error = { message, errno, code });
  for (const [operation, input] of steps) {
    const state = engine._writeState;
    let availIn = input.length;
    do {
      engine._handle.writeSync(operation, input, input.length - availIn, availIn, out, 0, room);
      availIn = state[1];
      if (state[0] < room) chunks.push(Buffer.copyBytesFrom(out, 0, room - state[0]));
    } while (state[0] === 0 && !error);
    if (error) break;
  }
  engine.close();
  return error ?? Buffer.concat(chunks);
}

const { constructor: Handle } = zlib.createBrotliCompress()._handle;

/** What `drive` needs of a stream, in a fraction of the time in debug builds. */
function bare(mode, params, dictionary) {
  const handle = new Handle(mode);
  const state = new Uint32Array(2);
  handle.init(Object.assign(new Uint32Array(STREAM_OFFSET + 1).fill(-1), params), state, () => {}, dictionary);
  return { _handle: handle, _writeState: state, close: () => handle.close() };
}

const decompress = (stream, params, dictionary) => drive(bare(DECODE, params, dictionary), [[FINISH, stream]], 1 << 14);

function roundTripInSteps(steps, params, dictionary, room = 1 << 16) {
  const compressed = drive(bare(ENCODE, params, dictionary), steps, room);
  const decompressed = decompress(compressed, { [DECODER_LARGE_WINDOW]: params[LARGE_WINDOW] ?? 0 }, dictionary);
  expect(Buffer.concat(steps.map(step => step[1])).equals(decompressed)).toBe(true);
  return digest(compressed);
}

const roundTrip = (input, params, dictionary) => roundTripInSteps([[FINISH, input]], params, dictionary, 1 << 14);

function roundTrips(inputs, params) {
  const streams = inputs.map(input => drive(bare(ENCODE, params), [[FINISH, input]], 1 << 14));
  expect(inputs.filter((input, i) => !decompress(streams[i]).equals(input))).toEqual([]);
  return digest(Buffer.concat(streams));
}

const shortDistance = (last, code) =>
  code < 4 ? last[code] : last[+(code > 9)] + [-1, 1, -2, 2, -3, 3][(code - 4) % 6];

it("has the inputs that the answers are for", () => {
  expect([text, samples, mixed].map(digest)).toEqual(["32231 e1fc2f33", "5000 9d6ad7d7", "141131 fda6fcc3"]);
});

it("has the constants", () => {
  const constants = Object.entries(zlib.constants).filter(([name]) => name.startsWith("BROTLI_"));
  expect(Object.fromEntries(constants)).toEqual({
    "BROTLI_DECODE": 8,
    "BROTLI_DECODER_ERROR_ALLOC_BLOCK_TYPE_TREES": -30,
    "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MAP": -25,
    "BROTLI_DECODER_ERROR_ALLOC_CONTEXT_MODES": -21,
    "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_1": -26,
    "BROTLI_DECODER_ERROR_ALLOC_RING_BUFFER_2": -27,
    "BROTLI_DECODER_ERROR_ALLOC_TREE_GROUPS": -22,
    "BROTLI_DECODER_ERROR_DICTIONARY_NOT_SET": -19,
    "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_1": -9,
    "BROTLI_DECODER_ERROR_FORMAT_BLOCK_LENGTH_2": -10,
    "BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH": -17,
    "BROTLI_DECODER_ERROR_FORMAT_CL_SPACE": -6,
    "BROTLI_DECODER_ERROR_FORMAT_CONTEXT_MAP_REPEAT": -8,
    "BROTLI_DECODER_ERROR_FORMAT_DICTIONARY": -12,
    "BROTLI_DECODER_ERROR_FORMAT_DISTANCE": -16,
    "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_META_NIBBLE": -3,
    "BROTLI_DECODER_ERROR_FORMAT_EXUBERANT_NIBBLE": -1,
    "BROTLI_DECODER_ERROR_FORMAT_HUFFMAN_SPACE": -7,
    "BROTLI_DECODER_ERROR_FORMAT_PADDING_1": -14,
    "BROTLI_DECODER_ERROR_FORMAT_PADDING_2": -15,
    "BROTLI_DECODER_ERROR_FORMAT_RESERVED": -2,
    "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET": -4,
    "BROTLI_DECODER_ERROR_FORMAT_SIMPLE_HUFFMAN_SAME": -5,
    "BROTLI_DECODER_ERROR_FORMAT_TRANSFORM": -11,
    "BROTLI_DECODER_ERROR_FORMAT_WINDOW_BITS": -13,
    "BROTLI_DECODER_ERROR_INVALID_ARGUMENTS": -20,
    "BROTLI_DECODER_ERROR_UNREACHABLE": -31,
    "BROTLI_DECODER_NEEDS_MORE_INPUT": 2,
    "BROTLI_DECODER_NEEDS_MORE_OUTPUT": 3,
    "BROTLI_DECODER_NO_ERROR": 0,
    "BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION": 0,
    "BROTLI_DECODER_PARAM_LARGE_WINDOW": 1,
    "BROTLI_DECODER_RESULT_ERROR": 0,
    "BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT": 2,
    "BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT": 3,
    "BROTLI_DECODER_RESULT_SUCCESS": 1,
    "BROTLI_DECODER_SUCCESS": 1,
    "BROTLI_DEFAULT_MODE": 0,
    "BROTLI_DEFAULT_QUALITY": 11,
    "BROTLI_DEFAULT_WINDOW": 22,
    "BROTLI_ENCODE": 9,
    "BROTLI_LARGE_MAX_WINDOW_BITS": 30,
    "BROTLI_MAX_INPUT_BLOCK_BITS": 24,
    "BROTLI_MAX_QUALITY": 11,
    "BROTLI_MAX_WINDOW_BITS": 24,
    "BROTLI_MIN_INPUT_BLOCK_BITS": 16,
    "BROTLI_MIN_QUALITY": 0,
    "BROTLI_MIN_WINDOW_BITS": 10,
    "BROTLI_MODE_FONT": 2,
    "BROTLI_MODE_GENERIC": 0,
    "BROTLI_MODE_TEXT": 1,
    "BROTLI_OPERATION_EMIT_METADATA": 3,
    "BROTLI_OPERATION_FINISH": 2,
    "BROTLI_OPERATION_FLUSH": 1,
    "BROTLI_OPERATION_PROCESS": 0,
    "BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING": 4,
    "BROTLI_PARAM_LARGE_WINDOW": 6,
    "BROTLI_PARAM_LGBLOCK": 3,
    "BROTLI_PARAM_LGWIN": 2,
    "BROTLI_PARAM_MODE": 0,
    "BROTLI_PARAM_NDIRECT": 8,
    "BROTLI_PARAM_NPOSTFIX": 7,
    "BROTLI_PARAM_QUALITY": 1,
    "BROTLI_PARAM_SIZE_HINT": 5,
  });
});

it("compresses short inputs", () => {
  const lengths = [0, 1, 2, 3, 4, 15, 16, 17, 64, 200, 1000, 3000];
  const row = quality => lengths.map(length => roundTrip(text.subarray(0, length), { [QUALITY]: quality }));
  expect(qualities.map(quality => row(quality).join())).toEqual([
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,20 0d83f0a8,21 638e8cfe,68 a377100b,204 09b45c05,641 4b3bf569,1417 a1599778",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,20 0d83f0a8,21 638e8cfe,68 a377100b,170 58abd1d7,514 2697c2c5,1258 813afecc",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,20 0d83f0a8,21 638e8cfe,68 a377100b,170 58abd1d7,514 2697c2c5,1122 df0c1400",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 1aec7020,15 30eda504,16 eccc31e3,61 6f7b02cf,126 003c12e9,506 475720d7,1122 df0c1400",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 1aec7020,15 30eda504,16 eccc31e3,61 6f7b02cf,126 003c12e9,445 8944ee39,1122 df0c1400",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 1aec7020,15 30eda504,16 eccc31e3,61 c94ddd50,126 003c12e9,444 cd89aa05,1051 f44a2c0d",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 1aec7020,15 30eda504,16 eccc31e3,61 c94ddd50,126 003c12e9,444 cd89aa05,1051 f44a2c0d",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 1aec7020,15 30eda504,16 eccc31e3,61 c94ddd50,126 003c12e9,444 cd89aa05,1051 f44a2c0d",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 1aec7020,15 30eda504,16 eccc31e3,61 c94ddd50,126 003c12e9,444 cd89aa05,1051 f44a2c0d",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 1aec7020,15 30eda504,16 eccc31e3,61 c94ddd50,126 003c12e9,444 cd89aa05,1051 f44a2c0d",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 2377b550,14 bfcf9a2a,14 dac6e5f5,55 c63d4af3,117 eea9dbb0,397 fe6b9d1e,977 a21fd5fa",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 2377b550,14 bfcf9a2a,14 dac6e5f5,55 c63d4af3,117 8e07bfcf,400 772b28bc,971 bc691099",
  ]);
});

it("compresses with the default window", () => {
  expect(qualities.map(quality => roundTrip(mixed, { [QUALITY]: quality }))).toEqual([
    "31280 af6a4de2",
    "28640 364f5962",
    "26171 ab2af3f4",
    "26168 1bf87c3a",
    "25661 90678be7",
    "25265 3e93e3a5",
    "25265 3e93e3a5",
    "25253 f3b7acd1",
    "25253 f3b7acd1",
    "25280 dd49d826",
    "23365 902f24b7",
    "23315 b083a8f9",
  ]);
});

it("compresses with a window of 10 bits", () => {
  expect(qualities.map(quality => roundTrip(mixed, { [QUALITY]: quality, [LGWIN]: 10 }))).toEqual([
    "55231 fc71d46d",
    "50361 05adb89d",
    "36709 2b08a906",
    "36703 689a620b",
    "35490 fef731d4",
    "35042 ecd94ec4",
    "35042 ecd94ec4",
    "34981 709858d4",
    "34981 709858d4",
    "34981 709858d4",
    "32023 092c528f",
    "31934 61b24d85",
  ]);
});

it("stores what does not compress", () => {
  expect(qualities.map(quality => roundTrip(noise, { [QUALITY]: quality }))).toEqual([
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65543 e3080259",
    "65543 e3080259",
    "65543 e3080259",
    "65543 e3080259",
    "65543 e3080259",
    "65543 e3080259",
    "65543 e3080259",
    "65543 e3080259",
    "65540 64d0bad2",
    "65540 64d0bad2",
  ]);
});

it("compresses with the hint of a large input", () => {
  const params = quality => ({ [QUALITY]: quality, [SIZE_HINT]: 1 << 20 });
  expect([4, 5, 6, 7, 9].map(quality => roundTrip(mixed, params(quality)))).toEqual([
    "25661 90678be7",
    "25265 3e93e3a5",
    "25265 3e93e3a5",
    "25253 f3b7acd1",
    "25280 dd49d826",
  ]);
});

it("compresses with a large window", () => {
  const params = quality => ({ [QUALITY]: quality, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: 25 });
  expect([2, 3, 4, 5, 6, 9, 10].map(quality => roundTrip(mixed, params(quality)))).toEqual([
    "26171 18b38f54",
    "26171 df300f1d",
    "25664 b17982f8",
    "25268 08ad5737",
    "25268 08ad5737",
    "25199 5f231392",
    "23370 47ba515d",
  ]);
});

it("compresses with a dictionary", () => {
  const [dictionary, input] = [text.subarray(0, 15000), mixed.subarray(10000, 45000)];
  expect(qualities.map(quality => roundTrip(input, { [QUALITY]: quality }, dictionary))).toEqual([
    "18168 26faaac6",
    "17488 2de29d71",
    "13660 a4229f6b",
    "13644 dca70031",
    "13639 9c4e4400",
    "13641 b7cd5b56",
    "13641 b7cd5b56",
    "13564 daf789f5",
    "13564 daf789f5",
    "13525 a179b4ad",
    "13299 2161efc8",
    "13238 a9dc2b8b",
  ]);
});

it("compresses with a dictionary of more than 64 KiB", () => {
  const dictionary = Buffer.concat([noise, text, samples]);
  const input = Buffer.concat(Array.from(window(dictionary, 2500), part => part.subarray(0, 40)));
  expect([5, 9, 11].map(quality => roundTrip(input, { [QUALITY]: quality }, dictionary))).toEqual([
    "125 f80f2969",
    "125 f80f2969",
    "149 1d4a7966",
  ]);
});

it("copies all of a dictionary that is longer than a block of input", () => {
  const dictionary = Buffer.concat([noise, bytesOf(40000, i => ~noise[i])]);
  const answers = [5, 9, 10].map(quality => roundTrip(dictionary, { [QUALITY]: quality, [LGWIN]: 16 }, dictionary));
  expect(answers).toEqual(["15 8f48cd77", "15 8f48cd77", "15 bfcd67a1"]);
});

it("compresses about 2 and 4 KiB", () => {
  const answers = [2047, 2048, 2049, 4095, 4096, 4097].map(length =>
    [2, 3, 4].map(quality => roundTrip(text.subarray(0, length), { [QUALITY]: quality })).join(),
  );
  expect(answers).toEqual([
    "848 3e928a75,827 b022b318,758 6848c77f",
    "848 8f0aa8b2,827 2984044d,827 2984044d",
    "847 7fa05e5f,827 ddb4cbb0,827 ddb4cbb0",
    "1434 7ec9d458,1434 7ec9d458,1434 7ec9d458",
    "1434 79f74136,1434 79f74136,1434 79f74136",
    "1434 63bdeeb8,1434 63bdeeb8,1434 63bdeeb8",
  ]);
});

it("tells neighbors with similar hashes apart in a short input at quality 2", () => {
  const input = Buffer.concat([noise.subarray(689, 698), noise.subarray(690, 698), Buffer.alloc(47)]);
  expect(roundTrip(input, { [QUALITY]: 2 })).toBe("25 148193e8");
});

it("tells hashes that differ in the last bit apart in about 512 and 1024 bytes at quality 2", () => {
  const parts = [noise.subarray(161, 171), noise.subarray(250, 258), noise.subarray(163, 171), Buffer.alloc(1000)];
  const inputs = [512, 513, 1024, 1025].map(length => Buffer.concat(parts, length));
  expect(roundTrips(inputs, { [QUALITY]: 2 })).toBe("148 d958ce82");
});

it.each([
  [64, "442 80a53eff"],
  [65, "444 90d48e08"],
])("looks at 64 of %d places that start alike at quality 10", (count, expected) => {
  const [start, withNextHash] = [noise.subarray(223, 227), noise.subarray(535, 539)];
  const first = [start, Buffer.from("\0abcdefgh")];
  const others = Array.from({ length: count - 1 }, (_, i) => [start, Buffer.of(i + 1)]).flat();
  const inputs = [511, 512, 1023, 1024].map(length =>
    Buffer.concat([...first, ...others, withNextHash, ...first], length),
  );
  expect(roundTrips(inputs, { [QUALITY]: 10 })).toBe(expected);
});

it.each([
  [{ [QUALITY]: 2 }, "c3c2c4c4c4c2c4c3c2c2c4c4c4c2c4c3c2c2c4", "14 5fa6c3cb"],
  [{ [QUALITY]: 2 }, "0000000000000000000064000000000000000000", "12 0cc4d1bc"],
  [{ [QUALITY]: 2 }, "656363656363656365636365", "16 37b62bb3"],
  [{ [QUALITY]: 2 }, "20207363726f6c6c696e673d226e6f2220", "21 0990cadc"],
  [
    { [QUALITY]: 3 },
    "b2529ab29aaf5252b25252b2af529ab25252af52af529ab29a9aaf529aaf9aaf529ab2b2b29aaf529aafb29ab252",
    "34 0de78a11",
  ],
  [
    { [QUALITY]: 4 },
    "00010000000000000000000000000000000000000000000000000000000000000001000000ff000001000000000000",
    "22 7b453f99",
  ],
  [{ [QUALITY]: 5 }, "00000000000000000000000000283d0000000000", "14 559d7e60"],
  [{ [QUALITY]: 5, [SIZE_HINT]: 1 << 20 }, "ffffffffff213fffffffffff00000000", "20 e043ea45"],
  [{ [QUALITY]: 9, [LGWIN]: 10 }, "000000ffe7ffffffffff000000ff0000ffffffffffff", "19 1d208c65"],
  [{ [QUALITY]: 11, [NO_CONTEXTS]: 0 }, "6567742d686f6f6b732d6c69737429207c207c0a0a652074657374", "31 73ed628f"],
  [{ [QUALITY]: 3 }, "7c4f00000000000000555527000000000000000000", "19 7f1354bc"],
  [{ [QUALITY]: 11 }, "adad350c340c0c340d34a60e34356f3488adad0cadadadadadadadadadad34ada734ad34", "31 ffc7d7f4"],
  [{ [QUALITY]: 11 }, "6a177c7c7c7c7c7c0b0b0b0b6a6a6a0b0b6a0b6a6a6a6a6a6a6a0b", "19 18681aba"],
  [{ [QUALITY]: 11 }, "00000000000000000000000000000000000000190000000000000000000000000019", "15 99003832"],
  [{ [QUALITY]: 11 }, "a5dbf44060006040a54060404060e04060604040e0009f40e0e00000000000000000", "30 a3ac86f4"],
  [
    { [QUALITY]: 11 },
    "020202020202020202020202020202018a020202020202020202024500018a020202020202020202024500018a",
    "21 1be0be1a",
  ],
  [
    { [QUALITY]: 11 },
    "111100424211002111110042424211002110444b10444b10211044444b1042110010421100421100bf544211116fbf1111a5a5",
    "47 6dd1894a",
  ],
  [
    { [QUALITY]: 11 },
    "161c16161c1629391c16169eb19e5c399e5c399e29295c399e29295c399e5c399e5c299e5c399e5c39689e5c3939399e5c292929392929292a62298a29292939",
    "52 c43a62b9",
  ],
  [
    { [QUALITY]: 7, [SIZE_HINT]: 1 << 20 },
    "6162636465666768696a6b6c6d6162636465ffffffffff515758ffffffffff00000000",
    "34 b353c83d",
  ],
  [
    { [QUALITY]: 6 },
    "636794ed6794ed6c0064636363616562626264656268666763666167636361666165616565686864686364676864636363616562626264656268666763666167",
    "40 15298aa3",
  ],
  [
    { [QUALITY]: 6, [SIZE_HINT]: 1 << 20 },
    "6f6fd66dc7726f6f7072726feb976fb96f6cd1727070701a30706f6f6f0a727272c26c72727272726f306f6f72686f706f707272c76f726f70706cde6c93706f302f70726f64196fb908",
    "66 e0b2e1e1",
  ],
  [
    { [QUALITY]: 7, [SIZE_HINT]: 1 << 20 },
    "f3bacee76239997f3cab7bedc057e3abd7b22b507b2e69e4b2eb9bff76781d5615df38ece521eda0352d6ca8a66ca1c5e3abd7b22b5023bacee76239997f3cab7bedc057e3abd7b22b",
    "68 f30eafd8",
  ],
  [
    { [QUALITY]: 3, [LGWIN]: 28, [LARGE_WINDOW]: 1 },
    "01010101010101010b9c448f14eae492dc3bd15b813dd6b6dcf1ec16aad550f7bfeee7ebe67ddd31000000000000000000000000000000000b9c448f42eae492f13bd15bf53dd6b635f1ec16f0d550f767eee7ebc87ddd31",
    "66 bc1a105d",
  ],
])("makes a close call with %j (%#)", (params, hex, expected) => {
  expect(roundTrip(Buffer.from(hex, "hex"), params)).toBe(expected);
});

describe("a short input with crowded hashes", () => {
  const allBases = bytesOf(noise.length, i => "ACGT".charCodeAt(noise[i] & 3));
  const bases = allBases.subarray(0, 32768);
  // 0x22b54b95 is the inverse of the multiplier.
  const alike = Buffer.from(Int32Array.from({ length: 300 }, (_, i) => Math.imul(i + 1, 0x22b54b95)).buffer);

  it("is compressed", () => {
    const answers = [5, 6, 7, 8, 9].map(quality => [
      roundTrip(bases, { [QUALITY]: quality }),
      roundTrip(bases, { [QUALITY]: quality }, bases.subarray(20000, 21000)),
    ]);
    expect(answers.map(String)).toEqual([
      "9799 6ff324ec,9683 d7b8a98f",
      "9799 6ff324ec,9683 d7b8a98f",
      "9880 d2e389df,9700 349d4430",
      "9880 d2e389df,9700 349d4430",
      "9880 d2e389df,9700 349d4430",
    ]);
  });

  it("may be as long as a block of input", () => {
    expect([7, 8].map(quality => roundTrip(allBases, { [QUALITY]: quality }))).toEqual([
      "19549 c53759ec",
      "19549 c53759ec",
    ]);
  });

  it("stays without words once they were given up", () => {
    const input = Buffer.concat([noise.subarray(0, 300), bases.subarray(0, 9000), text.subarray(0, 9000)]);
    expect([7, 8, 9].map(quality => roundTrip(input, { [QUALITY]: quality }))).toEqual([
      "6083 2a137859",
      "6095 9a0d53fb",
      "6095 9a0d53fb",
    ]);
  });

  it("may have them without matches", () => {
    const records = gap => Array.from(window(alike, 4), (four, i) => [four, noise.subarray(gap * i, gap * (i + 1))]);
    const inputs = [
      Buffer.concat([noise.subarray(0, 1800), ...records(6).flat(), text.subarray(0, 8000)]),
      // Searches end up 17 bytes apart.
      Buffer.concat([...records(13).flat(), text.subarray(0, 8000)]).subarray(15),
    ];
    expect(inputs.map(input => roundTrip(input, { [QUALITY]: 8 }))).toEqual(["6229 69166863", "7651 6b522fd6"]);
  });

  it("keeps the last hash apart from the first", () => {
    const last = Buffer.from(Int32Array.of(-0x22b54b95).buffer);
    const input = Buffer.concat([last, alike.subarray(0, 64), Buffer.from("12345"), last, Buffer.alloc(100)]);
    expect(roundTrip(input, { [QUALITY]: 5 })).toBe("93 5b2d705e");
  });

  it("goes on looking for matches in what follows", () => {
    // Searches begin to skip bytes shortly before each match.
    const records = Array.from(window(alike, 96), part => [part, part.subarray(-16)]);
    const input = Buffer.concat([...records.flat(), Buffer.alloc(10000)]);
    expect([7, 8].map(quality => roundTrip(input, { [QUALITY]: quality }))).toEqual(Array(2).fill("1238 b2800fd0"));
  });
});

it("compresses runs that end in one of a few values", () => {
  const runs = Buffer.alloc(70000, "f");
  for (let at = 40; at < runs.length; at += 41) runs[at] = noise[at & 0xffff] % 9;
  const inputs = [...Array.from({ length: 41 }, (_, i) => runs.subarray(0, 1000 + i)), runs];
  expect([5, 6, 7, 9].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
    "3981 83b45c61",
    "3981 83b45c61",
    "3981 83b45c61",
    "3981 83b45c61",
  ]);
  expect(roundTrips(inputs, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("3965 3f5c44bb");
});

it("compresses a short period that now and then gets out of step", () => {
  const parts = [700, 4, 900, 9, 1101, 1, 800, 2, 333, 1, 64].map((length, i) =>
    Buffer.alloc(length, i & 1 ? "\x01" : "xA"),
  );
  const inputs = parts.map((_, i) => Buffer.concat(parts.slice(0, i + 1)));
  inputs.push(Buffer.concat(Array(20).fill(inputs.at(-1))));
  expect([5, 6, 7, 9].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
    "335 e047c22a",
    "335 e047c22a",
    "335 e047c22a",
    "335 e047c22a",
  ]);
  expect([5, 9].map(quality => roundTrips(inputs, { [QUALITY]: quality, [LGWIN]: 16 }))).toEqual([
    "332 59f10327",
    "332 59f10327",
  ]);
});

it("compresses runs that are too short to skip at qualities 10 and 11", () => {
  const inputs = [69, 70, 71, 72, 73, 74, 150, 151, 325, 326].map(length =>
    Buffer.concat([
      Buffer.alloc(length),
      Buffer.of(2, 1),
      Buffer.alloc(length + 1),
      Buffer.of(3),
      Buffer.alloc(length),
    ]),
  );
  expect([10, 11].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual(["203 55cb9e19", "206 4b887f26"]);
});

it("compresses about 32 KiB at quality 9", () => {
  const answers = [32767, 32768, 32769].map(length => roundTrip(mixed.subarray(0, length), { [QUALITY]: 9 }));
  expect(answers).toEqual(["9324 f147e3a0", "9325 ab1e4f9d", "9324 ccc3d146"]);
});

it("compresses about 64 KiB", () => {
  const input = Buffer.concat([text, samples, text]);
  const answers = [65535, 65536, 65537].map(length =>
    [5, 6, 7, 9].map(quality => roundTrip(input.subarray(0, length), { [QUALITY]: quality })).join(),
  );
  expect(answers).toEqual([
    "12559 628b79b5,12559 628b79b5,12339 717ef42f,12481 65bc1011",
    "12621 83a47152,12621 83a47152,12541 b16578bc,12362 9a568912",
    "12621 54ef69f9,12621 54ef69f9,12541 1eee16e4,12362 f95c0811",
  ]);
});

it("finishes with up to three bytes after a flush", () => {
  const answers = [0, 1, 2, 5].map(quality =>
    [0, 1, 2, 3].map(length => {
      const steps = [
        [FLUSH, text.subarray(0, 100)],
        [FINISH, text.subarray(0, length)],
      ];
      return drive(bare(ENCODE, { [QUALITY]: quality }), steps, 1024)
        .subarray(-8)
        .toString("hex");
    }),
  );
  expect(answers.map(String)).toEqual([
    "656470656f706c03,6f706c0000083103,706c080008313903,6c10000831393803",
    "656470656f706c03,6f706c0000083103,706c080008313903,6c10000831393803",
    "656470656f706c03,6f706c0000083103,706c080008313903,6c10000831393803",
    "29b468729d5acf03,9d5acf0000083103,5acf080008313903,cf10000831393803",
  ]);
});

it("follows the other parameters", () => {
  const input = mixed.subarray(80000, 95000);
  const answers = {};
  for (const [name, params] of Object.entries({
    "font": { [MODE]: zlib.constants.BROTLI_MODE_FONT },
    "postfix 3, direct 120": { [NPOSTFIX]: 3, [NDIRECT]: 120 },
    "postfix 1, direct 3": { [NPOSTFIX]: 1, [NDIRECT]: 3 },
    "no contexts": { [NO_CONTEXTS]: 1 },
    "window 5": { [LGWIN]: 5 },
    "window 17": { [LGWIN]: 17 },
    "window 40": { [LGWIN]: 40 },
  })) {
    const qualities = LGWIN in params ? [4, 7] : [4, 7, 10];
    answers[name] = qualities.map(quality => roundTrip(input, { ...params, [QUALITY]: quality })).join();
  }
  answers["block 17"] = [4, 7].map(quality => roundTrip(mixed, { [QUALITY]: quality, [LGBLOCK]: 17 })).join();
  expect(answers).toEqual({
    "block 17": "25661 90678be7,25253 f3b7acd1",
    "font": "6615 15d117d1,6608 0cadc3a3,5766 095986f8",
    "no contexts": "7580 cf003f20,7548 30a7ae21,6635 db49d93d",
    "postfix 1, direct 3": "6614 5756e6e9,6607 b1a98be1,5769 9c561bac",
    "postfix 3, direct 120": "6635 76ca10f1,6628 5208f864,5784 cad74027",
    "window 17": "6615 6bde2059,6608 9da312e0",
    "window 40": "6614 27a53be7,6607 92527d38",
    "window 5": "7569 375df55b,6664 e8dbfed5",
  });
});

it.each([
  [NPOSTFIX, "1237 79aec634"],
  [NDIRECT, "1237 f649dc14"],
])("prices distances by parameter %d alone at quality 10", (key, expected) => {
  expect(roundTrip(text.subarray(0, 4000), { [QUALITY]: 10, [key]: 1 })).toBe(expected);
});

it("has more than 64 distance codes with 15 direct ones", () => {
  const input = Buffer.concat([
    noise.subarray(0, 40),
    Buffer.alloc(1 << 20),
    text.subarray(0, 6000),
    noise.subarray(0, 40),
  ]);
  expect(roundTrip(input, { [QUALITY]: 5, [NDIRECT]: 15 })).toBe("2526 2d67a36a");
});

describe("lengths", () => {
  // No pair of bytes occurs twice.
  const unique = Buffer.alloc(40000);
  for (let [a, at] = [56, 0]; a < 256; a++) {
    unique[at++] = a;
    for (let b = a + 1; b < 256; b++) at = unique.writeUInt16BE((a << 8) | b, at);
  }
  const around = (...bases) => bases.flatMap(base => [base - 1, base, base + 1, base + 2]);
  const short = Array.from({ length: 140 }, (_, i) => i + 1);

  it("has a code for each number of literals", () => {
    const bases = [14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114, 6210, 22594];
    const inputs = [...short.slice(0, 12), ...around(...bases)].map(length =>
      Buffer.concat([Buffer.alloc(1000 + length), unique.subarray(0, length)]),
    );
    expect([0, 1, 2].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
      "140416 e3f28b1d",
      "120140 4d180f53",
      "114470 db4cfe24",
    ]);
  });

  it("has a hash table for each length of the input", () => {
    const inputs = around(...[8, 9, 10, 11, 12, 13, 14, 15, 16].map(bits => 2 ** bits)).map(length =>
      Buffer.alloc(length, text),
    );
    expect([0, 1].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
      "141168 eecb820e",
      "131321 4d0eeee8",
    ]);
  });

  it("closes a gap among 16 or more kinds of literals", () => {
    const inputs = around(15, 27).map(count =>
      Buffer.from(noise.subarray(0, 200).map((byte, i) => (i === 99 ? 0 : 2 + (byte % (count - 1))))),
    );
    expect(roundTrips(inputs, { [QUALITY]: 4 })).toBe("984 0b19df93");
  });

  it("has prefix codes for each number of commands that are alike", () => {
    const record = i => Buffer.concat([noise.subarray(0, 20), unique.subarray(i * 4, i * 4 + 4)]);
    const inputs = around(2, 126, 130).map(length => Buffer.concat(Array.from({ length }, (_, i) => record(i))));
    expect([0, 1, 2, 3, 4].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
      "6745 4c165e65",
      "4053 ca33027d",
      "3865 6f89e049",
      "3865 6f89e049",
      "3865 6f89e049",
    ]);
  });

  it("stores a long run of literals that follows little else at quality 0", () => {
    const inputs = [124, 125, 126, 98404].flatMap(zeros =>
      [3000, 6209, 6210, 6250, 20000].map(length => Buffer.concat([Buffer.alloc(zeros), noise.subarray(0, length)])),
    );
    expect(inputs.map(input => roundTrip(input, { [QUALITY]: 0 })).join()).toBe(
      "3110 2ad34680,6301 d5e37a0f,6338 3147b62c,6378 b292f6aa,20128 56d62187,3110 88cba62a,6301 09bc4db3,6302 26f27a80,6379 7fbd3774,20129 d8011453,3110 b378eba4,6301 eabb1a45,6302 c4d9eda4,6344 81ab6c1c,20130 9a8cf559,3442 b5e4e95a,6360 724805d0,6391 d871e7c0,6431 5532a496,20181 da5d3ac0",
    );
  });

  it.each([
    [10, 4096, "43492 0cc1e901"],
    [22, 12287, "129906 e1a1828a"],
  ])("ends a meta-block in a window of %d bits after %d symbols at quality 2", (size, limit, expected) => {
    const inputs = short.slice(38, 50).map(length => {
      const input = Buffer.concat([Buffer.alloc(16384), text.subarray(0, 300)]);
      unique.copy(input, 0, 0, limit - 60);
      noise.copy(input, limit - 20, 0, length);
      return input;
    });
    expect(roundTrips(inputs, { [QUALITY]: 2, [LGWIN]: size })).toBe(expected);
  });

  it("puts off a match up to four times", () => {
    const better = [0, 1, 2, 3, 4, 5, 6].flatMap(i => [
      noise.subarray(i, 3 * i + 5),
      noise.subarray(99 * i + 99, 99 * i + 104),
    ]);
    const inputs = short
      .slice(14, 22)
      .map(length => Buffer.concat([Buffer.alloc(200), ...better, noise.subarray(0, length)]));
    expect(qualities.slice(2, 10).map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
      "824 9f9fe025",
      "796 8b400a3e",
      "796 8b400a3e",
      "792 91f9d695",
      "792 91f9d695",
      "792 91f9d695",
      "792 91f9d695",
      "792 91f9d695",
    ]);
  });

  it("has a code for each length of a copy", () => {
    let at = 0;
    const lengths = [...short, ...around(198, 326, 582, 1094, 2118)];
    const slices = lengths.map(length => unique.subarray(at, (at += length)));
    const input = Buffer.concat([
      ...slices.flatMap(slice => [Buffer.alloc(20), slice]),
      ...slices.toReversed(),
      ...lengths.map((length, i) => Buffer.alloc(length, i % 50)),
    ]);
    expect([0, 1, 2, 5, 10].map(quality => roundTrip(input, { [QUALITY]: quality }))).toEqual([
      "29966 77ba463f",
      "27712 45bff5e8",
      "29606 60e501e0",
      "21463 345c7ce2",
      "13973 560a1064",
    ]);
  });

  it("has a header for each length of a meta-block", () => {
    const inputs = [...around(2 ** 16, 3 * 2 ** 15, 2 ** 20), 1250000].map(length => Buffer.alloc(length, text));
    const row = quality => inputs.map(input => roundTrip(input, { [QUALITY]: quality })).join();
    expect([0, 5].map(row)).toEqual([
      "10982 dd133af6,10982 ce1036b0,10982 61536006,10982 08c636fc,10976 a16d7472,10976 b785038d,10978 032115e7,10979 5e10c5f4,42184 8f895f98,42184 ed5e4cbc,42350 7927a4c8,42350 39f56438,44238 5794a09d",
      "8504 fd136bf3,8550 669a98eb,8550 4f086092,8550 14cb18c4,8550 366b6c23,8550 69d213d8,8550 f0c71a4d,8550 ab04621b,8749 7684f8c3,8749 1533eb89,8749 9c2d3f7f,8749 3710fd0b,8749 23eeff85",
    ]);
  });
});

it("ends a meta-block after 32768 commands in a window of 17 bits", () => {
  const input = bytesOf(132000, i => noise[i % 6 < 3 ? i % 894 : 900 + (i % 912)]);
  input.copyWithin(894, 0, 12).copyWithin(932, 20, 32);
  expect(roundTrip(input, { [QUALITY]: 5, [LGWIN]: 17 })).toBe("50105 69663dbd");
});

it("counts the literals that the last block of input left over at quality 11", () => {
  const input = Buffer.concat([Buffer.alloc(65531), noise.subarray(0, 25), text.subarray(0, 300)]);
  expect(roundTrip(input, { [QUALITY]: 11, [LGWIN]: 16 })).toBe("216 78ea64d3");
});

it.each([
  [0, "388 1061cdf2"],
  [1008, "391 0c2242af"],
])("finds what is about to leave the window after a long copy and a flush of %d bytes", (size, expected) => {
  const wanted = Buffer.concat([Buffer.alloc(4), noise.subarray(0, 20)]);
  const long = Buffer.concat([noise.subarray(100, 430), Buffer.alloc(1)]);
  const input = Buffer.concat([wanted, long, Buffer.alloc(322, 1), long, wanted, Buffer.alloc(200, 1)]);
  const steps = [
    [FLUSH, input.subarray(0, size)],
    [FINISH, input.subarray(size)],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 10, [LGWIN]: 10 })).toBe(expected);
});

it.each([
  [[1, 2, 3, 4, 5, 6, 8], "2853 070c0b91"],
  [[8, 10], "1150 58c32e48"],
])("has a command for %p literals and each short copy from the last distance", (inserts, expected) => {
  const changed = Buffer.from(noise.subarray(0, 2169));
  let at = 10;
  for (const insert of inserts) {
    for (const copy of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 18, 22, 30, 38, 54]) {
      for (const end = at + insert; at < end; at++) changed[at] ^= 255;
      at += copy;
    }
  }
  changed[at++] ^= 255;
  const steps = [
    [FLUSH, noise.subarray(0, at)],
    [FINISH, changed.subarray(0, at)],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 5 })).toBe(expected);
});

it("extends a copy with a short distance code into the next block of input", () => {
  const inputs = Array.from({ length: 16 }, (_, code) => {
    const [input, last] = [Buffer.concat([noise.subarray(0, 3000), Buffer.alloc(13500)]), [14000, 14500, 15000, 15500]];
    let at = 16384 - 110;
    for (const distance of [...last.toReversed(), shortDistance(last, code)]) {
      input[at++] = 255;
      input.copyWithin(at, at - distance, at - distance + 60);
      at += 20;
    }
    return input;
  });
  expect(roundTrips(inputs, { [QUALITY]: 3 })).toBe("49100 692b14f2");
});

it("extends a copy from a dictionary into the next block of input", () => {
  const input = Buffer.concat([Buffer.alloc(65536 - 20), noise.subarray(0, 40)]);
  expect(roundTrip(input, { [QUALITY]: 5, [LGWIN]: 10 }, noise.subarray(0, 50))).toBe("18 dd722765");
});

it.each([
  [0, "one kind of literal after many", [Buffer.alloc(98304, text), Buffer.alloc(1000, 255)], "11056 cc3117fe"],
  [
    0,
    "a block to store after 10 KiB of output",
    [Buffer.alloc(98304, text), noise.subarray(0, 9000), Buffer.alloc(200)],
    "20050 00768a47",
  ],
  [
    0,
    "a match at the end of the first block",
    [noise.subarray(0, 16), Buffer.alloc(98280), "abc", noise.subarray(1, 16), Buffer.alloc(40)],
    "113 4abdbd71",
  ],
  [
    0,
    "five bytes that differ in the last bit",
    ["0123456789abcdefghij0123456789?bcde", [0xe6], Buffer.alloc(200)],
    "104 6c0d0d87",
  ],
  [
    0,
    "a copy that ends six bytes before the end of the first block",
    [
      "0123456789abcdefghijklmnopqrst#QWERTYUIOPASab",
      Buffer.alloc(98210, text),
      "0123456789abcdefghijklmnopqrstQWERTYUIOPAS",
      Buffer.alloc(30, "a"),
    ],
    "11063 ea19460d",
  ],
  [1, "a copy that ends after five bytes", [Buffer.alloc(5), Buffer.alloc(200, noise.subarray(0, 20))], "43 f2091f30"],
  [
    2,
    "a word after many literals",
    ["ta", noise.subarray(0, 510), "throughout the", Buffer.alloc(900)],
    "557 39d7d6d4",
  ],
  [2, "a long copy after many literals", [noise.subarray(0, 23000), Buffer.alloc(3000)], "23128 6116d55e"],
  [
    4,
    "more than 64 KiB of literals",
    [
      bytesOf(noise.length, i => noise[i] & 127),
      "xyz",
      Buffer.alloc(200),
      bytesOf(noise.length, i => noise[i] >> 1),
      bytesOf(1100, i => noise[i] | 128),
    ],
    "115914 3aa03bc9",
  ],
  [
    5,
    "better and better matches at the end",
    ["ABCD!", Buffer.alloc(16500), "BCDE!", Buffer.alloc(300), "CDEFABCDEF"],
    "33 a64d17fb",
  ],
  [
    7,
    "the same hash for another start",
    [Buffer.alloc(70000), "aV234567.1323!x132?.........x13234567~~~~~~~~"],
    "59 421de5f4",
  ],
  [
    7,
    "a last distance that leads to a byte less than what is left",
    [Buffer.alloc(70000), "0123qrstu?qrst#", text.subarray(0, 300), "0123qrstu!qrstu"],
    "287 99967858",
  ],
  [
    7,
    "matches of two bytes less, a byte less, and all that is left",
    [
      Buffer.alloc(70000),
      "0123?qjxzvkwbgfpmydhlcu#",
      text.subarray(0, 300),
      "qjxzvkwbgfpmydhlcuts_qjxzvkwbgfpmydhlcut$0123!qjxzvkwbgfpmydhlcuts",
    ],
    "317 02597420",
  ],
  [
    10,
    "a word with the longest suffix that is nearly all there already",
    [
      noise.subarray(0, 200),
      "time. This!",
      Buffer.alloc(300),
      noise.subarray(200, 210),
      "time. This ",
      noise.subarray(300, 310),
    ],
    "259 98d5887d",
  ],
  [
    10,
    "the longest that a word can get, which is nearly all there already",
    [" the document.getElementById( of the!", Buffer.alloc(300), " the document.getElementById( of the ", "0123456789"],
    "38 22904c9f",
  ],
  [
    10,
    "a better second to last distance at the end",
    ["01234567.abcdefgh,wxyzABCDEFGH;ijklmnop:wxy$", Buffer.alloc(130), "01234567!ijklmnop?wxyz"],
    "67 e8092154",
  ],
  [10, "a better second to last distance at the start", ["012345601xy0123456", Buffer.alloc(100)], "23 fb59c2ed"],
  [10, "a copy of more than 64 KiB", [Buffer.alloc(66000, noise.subarray(0, 100))], "125 ed6fe00c"],
  [10, "more than 64 KiB of literals", [noise, "wxyz.wxyz", noise.subarray(100, 1100)], "65563 c91c17d8"],
])("at quality %d, handles %s", (quality, _, parts, expected) => {
  expect(roundTrip(Buffer.concat(parts.map(part => Buffer.from(part))), { [QUALITY]: quality })).toBe(expected);
});

it.each([
  [
    "other bytes with its hash",
    0,
    ["#inf!", Buffer.alloc(300), [0x69, 0x6e, 0xd1, 0x23], "rmat?%"],
    "44 df12a818,44 df12a818",
  ],
  [
    "three of its bytes with the hash of five",
    1 << 20,
    ["#info!", Buffer.alloc(300), "inf", [0xca, 0xe6], "?%"],
    "45 5c75ab91,45 5c75ab91",
  ],
  [
    "four of its bytes that are too far",
    0,
    ["-infoz-", Buffer.alloc(33000), "#inf!0123456789abcdefg"],
    "56 94c02507,63 4438720c",
  ],
])("finds a word after %s", (_, hint, parts, expected) => {
  const input = Buffer.concat([...parts, "#information~~~~~~~~~"].map(part => Buffer.from(part)));
  expect([5, 7].map(quality => roundTrip(input, { [QUALITY]: quality, [SIZE_HINT]: hint })).join()).toBe(expected);
});

it("stores some blocks and compresses others at quality 1", () => {
  const random = createCipheriv("aes-128-ctr", Buffer.alloc(16, 2), Buffer.alloc(16)).update(Buffer.alloc(3 << 17));
  const block = (kind, i) => (kind === "s" ? random.subarray(i << 17, (i + 1) << 17) : Buffer.alloc(1 << 17, text));
  const compress = kinds => `${kinds}: ${roundTrip(Buffer.concat(Array.from(kinds, block)), { [QUALITY]: 1 })}`;
  expect(["s", "ss", "sss", "sc", "ssc", "scs", "css", "csc"].map(compress)).toEqual([
    "s: 131077 3741cc0d",
    "ss: 262149 53c9b22e",
    "sss: 393221 58cad9fb",
    "sc: 141571 846a1d5d",
    "ssc: 272646 30a8988e",
    "scs: 272646 7f434bb8",
    "css: 272646 349d5bf4",
    "csc: 152071 da863d26",
  ]);
});

it.each([
  [1, 65500, [1311, 1312], "65508 6e1a1e06,64224 092c8548"],
  [5, 40000, [400, 401], "39618 bc9a4868,39617 7f3f9951"],
])("stores a block with just too many literals at quality %d", (quality, size, ones, expected) => {
  const inputs = ones.map(count => Buffer.from(noise.subarray(0, size)).fill(1, 0, count));
  const steps = input => [
    [FLUSH, Buffer.of(1)],
    [FINISH, input],
  ];
  expect(inputs.map(input => roundTripInSteps(steps(input), { [QUALITY]: quality })).join()).toBe(expected);
});

it("stores what repeats too late for quality 0", () => {
  const input = Buffer.concat([noise.subarray(0, 30000), noise.subarray(0, 30000)]);
  expect(roundTrip(input, { [QUALITY]: 0 })).toBe("30075 16afea95");
});

const nearlyOutOfReach = once(() => Buffer.alloc(2 ** 26 - 4 - 257).fill(noise, 0, 400));

it.each([
  [5, "483 aa2baaf7"],
  [10, "275 9741704b"],
])("reaches as far behind the window as quality %d has codes for", (quality, expected) => {
  // The long words are 14 below the largest distance, at it and one above. The copies go from four below to four above.
  const digits = noise.hexSlice(0, 30);
  const near = digits.slice(0, 40) + digits.slice(0, 16) + digits.slice(40, 45) + digits.slice(16, 32);
  const copied = Array.from({ length: 9 }, (_, i) => [Buffer.alloc(20), noise.subarray(39 * i + 24, 39 * i + 44)]);
  const far = [Buffer.from("progress\0\0disabled"), Buffer.alloc(31), ...copied.flat(), Buffer.alloc(20)];
  const steps = [
    [FLUSH, Buffer.from(("details" + near).padEnd(200, "#!") + "settings")],
    [FINISH, Buffer.concat([...far, text.subarray(0, 200)])],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: quality }, nearlyOutOfReach())).toBe(expected);
});

it.each([
  [2 ** 20, "3361 0f1348ab"],
  [2 ** 21, "1101 d1f2c4e4"],
  [2 ** 21 + 1, "1101 d1f2c4e4"],
  [2 ** 26 + 1, "1086 63becf6f"],
])("finds what is not crowded out of the table for a dictionary of %d bytes", (size, expected) => {
  const dictionary = Buffer.alloc(size).fill(noise.subarray(4000, 34000), size - 2 ** 20);
  noise.copy(dictionary, size - 2 ** 20, 0, 4000);
  const input = Buffer.concat(Array.from(window(noise.subarray(0, 4000), 10)).toReversed());
  expect(roundTrip(input, { [QUALITY]: 5 }, dictionary)).toBe(expected);
});

it.each([
  [5, "25 1d88e733"],
  [10, "26 5e952c75"],
])("takes four bytes from a dictionary at quality %d, but not three", (quality, expected) => {
  // "qxz!#" and "qxzFV" have the same hash.
  const dictionary = Buffer.concat([Buffer.from("ABCDE"), noise, Buffer.from("qxz!#BCDE\0...")]);
  const input = Buffer.concat([Buffer.alloc(20), Buffer.from("qxzFV"), Buffer.alloc(15), Buffer.from("ABCDE")]);
  expect(roundTrip(input, { [QUALITY]: quality }, dictionary)).toBe(expected);
});

it("stops looking for longer matches in a dictionary where its buffer wraps around", () => {
  const [first, second] = [noise.subarray(0, 24), noise.subarray(24, 48)];
  const dictionary = Buffer.concat([first, second, Buffer.alloc(1), second.subarray(0, 9), Buffer.alloc(8)]);
  const pieces = [Buffer.alloc(2 ** 17 - 4), first, Buffer.alloc(2 ** 17 - 26), second, Buffer.alloc(2 ** 17 - 24)];
  const steps = [...pieces, second, Buffer.alloc(2 ** 17 - 21)].map(piece => [FLUSH, piece]);
  expect(roundTripInSteps([...steps, [FINISH, first]], { [QUALITY]: 5, [LGWIN]: 10 }, dictionary)).toBe("182 1f6d4656");
});

it("takes the most recent of the distances that reach into a dictionary", () => {
  const entries = ["wxyz", "wxyz", "wxyz", "", "WXYZ", "WXYZ", "", ""].map((start, i) =>
    Buffer.concat([Buffer.from(start), noise.subarray(20 * i, 20 * i + 20)]),
  );
  const parts = [...entries.slice(0, 4), "wxyz", ...entries.slice(4), "WXYZ"].flatMap((part, i) => [part, [i]]);
  const input = Buffer.concat([Buffer.alloc(1100), ...parts.map(part => Buffer.from(part)), Buffer.alloc(9, 255)]);
  expect(roundTrip(input, { [QUALITY]: 5, [LGWIN]: 10 }, Buffer.concat(entries))).toBe("53 14286aec");
});

it.each([
  [5, "ABCDE01234567890123456789ABCDxxxxxxx", "14 d3084ae0"],
  [10, "ABCDExxxxxxxxxxx", "13 421e5f3e"],
  [10, "ABCxxxxxxxxxxx", "15 9d263ec4"],
  [11, "ABCxxxxxxxxxxx", "15 9d263ec4"],
])("weighs the distances it starts with at quality %d", (quality, dictionary, expected) => {
  const input = Buffer.concat([Buffer.from("ABCDE"), Buffer.alloc(40)]);
  expect(roundTrip(input, { [QUALITY]: quality }, Buffer.from(dictionary))).toBe(expected);
});

it("copies all of a dictionary of two bytes at quality 10", () => {
  const input = Buffer.concat([noise.subarray(0, 32), Buffer.alloc(60)]);
  expect(roundTrip(input, { [QUALITY]: 10 }, noise.subarray(0, 2))).toBe("56 3cb2d45f");
});

it("reaches into a dictionary with short distance codes", () => {
  const dictionary = Buffer.concat([Buffer.alloc(1 << 16, 255), noise.subarray(0, 4000)]);
  const parts = [Buffer.alloc(5000)];
  let next = 5000;
  const copy = (back, length) =>
    parts.push(noise.subarray(next, ++next), dictionary.subarray(-back).subarray(0, length));
  function afterTheLongestCopy(far, ...others) {
    parts.push(far, ...[0, ...others].map(at => far.subarray(at, at + 8)));
    copy(3, 3);
  }
  afterTheLongestCopy(noise.subarray(6000, 7008));
  for (let code = 0; code < 16; code++) {
    const last = [900, 1500, 2100, 2700].map(back => back + 31 * code);
    for (const back of last.toReversed()) copy(back, 8);
    copy(shortDistance(last, code), 3);
  }
  afterTheLongestCopy(noise.subarray(7100, 8108), 500);
  const input = Buffer.concat([...parts, noise.subarray(8200, 8208)]);
  expect([5, 9, 10, 11].map(quality => roundTrip(input, { [QUALITY]: quality, [LGWIN]: 10 }, dictionary))).toEqual([
    "2326 882ac9f5",
    "2326 882ac9f5",
    "2293 5e9d08d2",
    "2289 dac07752",
  ]);
});

it("reaches as far back as the window allows", () => {
  const answers = qualities.map(quality => {
    const [size, limit, reach] = quality < 2 ? [22, 2 ** 18 - 16, [95000]] : [12, 2 ** 12 - 16, []];
    const inputs = [...reach, limit - 1, limit, limit + 1].map(distance =>
      Buffer.concat([noise.subarray(0, 3000), Buffer.alloc(distance - 3000), noise.subarray(0, 3020)]),
    );
    return roundTrips(inputs, { [QUALITY]: quality, [LGWIN]: size });
  });
  expect(answers).toEqual([
    "18954 68b241e5",
    "15899 cb3f6c0e",
    "12203 ad7741fb",
    "12203 ad7741fb",
    "12203 ad7741fb",
    "12203 ad7741fb",
    "12203 ad7741fb",
    "12203 ad7741fb",
    "12203 ad7741fb",
    "12203 ad7741fb",
    "12276 0ec6ac04",
    "12276 0ec6ac04",
  ]);
});

it("copies 2118 bytes from 250000 bytes back at quality 0", () => {
  const far = Buffer.concat([noise.subarray(0, 8), text.subarray(0, 2110).toReversed()]);
  const input = Buffer.concat([far, Buffer.alloc(250000 - far.length, text), far, noise.subarray(100, 120)]);
  expect(roundTrip(input, { [QUALITY]: 0 })).toBe("12053 31c6890d");
});

it("limits the length of prefix codes", () => {
  /** Repeats new bytes with that period. Each kind of record is more frequent than all but one of the later ones together. */
  function records(kindCount, period, copied) {
    const counts = [1, 1];
    while (counts.length < kindCount) counts.unshift(counts[0] + counts[1] + 1);
    const kinds = counts.flatMap((count, kind) => Array(count).fill(kind));
    let at = 0;
    const record = (kind, i) =>
      Buffer.alloc(period(kind, i) + copied(kind), noise.subarray(at, (at += period(kind, i))));
    return Buffer.concat(kinds.map((_, i) => record(kinds[(i * 1009) % kinds.length], i)));
  }
  const distance = (kind, i) => ((3 - (kind & 1)) << ((kind + 3) >> 1)) - 3 + (i & 1);
  const inputs = [
    records(
      14,
      () => 12,
      kind => [6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 32, 40, 56][kind],
    ),
    ...[15, 16].map(count => records(count, distance, kind => 8 + kind)),
  ];
  const twice = (input, quality) =>
    roundTripInSteps(
      [
        [FLUSH, input],
        [FINISH, input],
      ],
      { [QUALITY]: quality },
    );
  expect([0, 1, 2].map(quality => inputs.map(input => twice(input, quality)).join())).toEqual([
    "54747 0e42aabd,92658 5c2251f6,153076 1b8667ff",
    "50813 44c45294,88749 b74adfa0,147413 aeb53f23",
    "25014 330224a1,42430 f9825e33,70582 21b985de",
  ]);
});

describe("literals that are equally frequent", () => {
  const runs = counts => Buffer.concat(counts.map((count, i) => Buffer.alloc(count, 255 - i)));
  function shuffled(bytes) {
    for (let i = bytes.length - 1; i > 0; i--) {
      const j = noise.readUInt16LE(i) % (i + 1);
      const byte = bytes[i];
      bytes[i] = bytes[j];
      bytes[j] = byte;
    }
    return bytes;
  }

  it("get their lengths for each number of kinds", () => {
    const counts = [30, ...noise.subarray(0, 255).map(byte => 9 + (byte % 3))];
    const all = runs(counts);
    let end = 0;
    const inputs = counts.map(count => all.subarray(0, (end += count)));
    expect(roundTrips(inputs, { [QUALITY]: 0 })).toBe("120838 8f1bbdc4");
  });

  it.each([
    [[4, 10, 23], "5117 042ab525"],
    [[10, 23, 57, 132], "6124 a1205831"],
  ])("get their lengths if they are in order at sums of %j", (gaps, expected) => {
    const isSum = [true];
    for (let i = 1; i < 256; i++) isSum[i] = gaps.some(gap => isSum[i - gap]);
    const inputs = [0, 1, 15, 16, 100].map(first => runs(isSum.map((_, i) => (isSum[i - first] ? 20 : 5))));
    expect(roundTrips(inputs, { [QUALITY]: 0 })).toBe(expected);
  });

  it("get their lengths next to one that occurs up to 32747 times", () => {
    const inputs = [16400, 32743, 32744, 32745, 32746, 32747].map(count =>
      runs([count, ...Array(16 + (count % 5)).fill(1)]),
    );
    expect(roundTrips(inputs, { [QUALITY]: 0 })).toBe("554 5d50caa8");
  });

  it("get their lengths next to one that is every other byte", () => {
    const others = shuffled(runs(Array.from(noise.subarray(0, 255), byte => 60 + 40 * (byte % 5))));
    const input = Buffer.from(new Uint16Array(others).buffer);
    expect([1, 3].map(quality => roundTrip(input, { [QUALITY]: quality }))).toEqual([
      "45156 81a0d1b5",
      "44610 41ed3a00",
    ]);
  });

  it("get their lengths next to one that occurs more than 65536 times", () => {
    const input = Buffer.from(new Uint16Array(Buffer.alloc(70000, noise)).buffer);
    expect(roundTrip(input, { [QUALITY]: 4, [LGWIN]: 10, [LGBLOCK]: 21 })).toBe("82838 1eaef64c");
  });

  it("are left alone if they are the last seven", () => {
    const input = shuffled(runs([...Array(7).fill(12), ...Array.from({ length: 149 }, (_, i) => 8 + (i & 1))]));
    expect(roundTrip(input, { [QUALITY]: 4 })).toBe("1267 6c55f5e3");
  });

  it("are not evened out with one that is just too rare after 175 of them", () => {
    const counts = Array.from({ length: 178 }, (_, i) => (i === 175 ? 0 : i < 53 ? 4 + (i % 2) : 4 + (i % 3)));
    expect(counts.slice(0, 175).reduce((a, b) => a + b)).toBe(848);
    const input = shuffled(Buffer.concat(counts.map((count, i) => Buffer.alloc(count, i))));
    expect(roundTrip(input, { [QUALITY]: 4 })).toBe("862 a0c052d4");
  });
});

it("has long copies after each few literals", () => {
  const records = Array.from({ length: 120 }, (_, i) => [
    noise.subarray(9 * i, 9 * i + (i % 7)),
    Buffer.alloc(2200, i),
  ]);
  const input = Buffer.concat(records.flat());
  expect([0, 1, 2, 3, 5].map(quality => roundTrip(input, { [QUALITY]: quality }))).toEqual([
    "1406 125687ca",
    "1190 86c01120",
    "950 ae368797",
    "950 ae368797",
    "950 ae368797",
  ]);
});

it("has many literals and a long copy after about a thousand symbols", () => {
  const record = (i, length) => [
    noise.subarray(40 * i, 40 * i + length),
    noise.subarray(9000 + (i % 2) * 8, 9008 + (i % 2) * 8),
  ];
  const records = Array.from({ length: 52 }, (_, i) => record(i + 2, 16)).flat();
  const inputs = Array.from({ length: 20 }, (_, first) =>
    Buffer.concat([
      noise.subarray(9000, 9016),
      ...record(0, 1),
      ...record(1, 1 + first),
      ...records,
      noise.subarray(5000, 5031),
      Buffer.alloc(2300),
    ]),
  );
  expect([0, 2].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
    "26548 688acc02",
    "19684 49676f67",
  ]);
});

it("keeps distance parameters that beat those it tries", () => {
  let at = 0;
  const periods = Array.from({ length: 300 }, (_, i) => [67, 75, 83, 91, 99, 107, 115, 119][(i * 3) % 8]);
  const input = Buffer.concat(periods.map(period => Buffer.alloc(period + 12, noise.subarray(at, (at += period)))));
  expect(roundTrip(input, { [QUALITY]: 10, [NPOSTFIX]: 3, [NDIRECT]: 120 })).toBe("28741 e05d0a6d");
});

it("stores a block that would grow by more than four bytes", () => {
  const digits = Buffer.from(noise.hexSlice(0, 30)).subarray(21);
  const flushed = size => [
    [FLUSH, digits.subarray(0, size)],
    [FINISH, Buffer.alloc(0)],
  ];
  expect([19, 20].map(size => roundTripInSteps(flushed(size), { [QUALITY]: 3 }))).toEqual([
    "23 55e6f784",
    "24 0142bee2",
  ]);
});

it("stores what hardly compresses", () => {
  const bytes = Buffer.from(noise);
  const inputs = Array.from({ length: 26 }, (_, i) => {
    for (let at = 0; (at = bytes.indexOf(255 - i, at)) >= 0;) bytes[at] = 40 + i;
    return Buffer.from(bytes);
  });
  expect(
    [inputs.slice(22), inputs.slice(5, 9)].map((some, quality) => roundTrips(some, { [QUALITY]: quality })),
  ).toEqual(["260620 28ccdd23", "261148 d3bd11e1"]);
});

it("goes by its matches and every 13th byte whether to compress", () => {
  function withPairs(count) {
    const input = Buffer.from(noise).copyWithin(40, 0, 8);
    for (let at = 240; at <= 240 * count; at += 240) input.copyWithin(at, at - 40, at - 38);
    return input;
  }
  const inputs = [
    ...[660, 670].map(length => Buffer.from(noise).copyWithin(1000, 0, length)),
    ...[252, 253].map(withPairs),
    bytesOf(noise.length, i => (i % 13 ? noise[i] & 127 : noise[i])),
  ];
  expect(inputs.map(input => roundTrip(input, { [QUALITY]: 9 }))).toEqual([
    "64931 a007f61b",
    "64921 c450911e",
    "65543 ca1cb147",
    "65543 303c0720",
    "59520 dcbe39a3",
  ]);
});

it("remembers more than a block of input at quality 10", () => {
  const [first, second] = [0, 20].map(at => Buffer.concat([Buffer.from("wxyz"), noise.subarray(at, at + 20)]));
  const input = Buffer.concat([first, second, Buffer.alloc(65500), noise.subarray(100, 130), first, Buffer.alloc(130)]);
  expect(roundTrip(input, { [QUALITY]: 10, [LGBLOCK]: 16 })).toBe("116 33b629e6");
});

it("finds matches after 16 MiB at quality 9 in a small window", () => {
  const input = Buffer.concat([Buffer.alloc(16 << 20, noise.subarray(-100)), text.subarray(0, 600)]);
  expect(roundTrip(input, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("519 07a51aa7");
});

it("finds nothing before the first position with a hash after 8 MiB at quality 9 in a small window", () => {
  // What follows 520 literals is skipped, so 200 bytes on its hash is new, and the empty head is 8 MiB + 200 back.
  const rest = Buffer.alloc(1000);
  noise.copy(rest, 0, 0, 550);
  noise.copy(rest, 720, 520, 524);
  noise.copy(rest, 920, 520, 550);
  const steps = [
    [FLUSH, Buffer.alloc((8 << 20) - (1 << 16) - 520, noise.subarray(-100))],
    [FINISH, rest],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("1476 2db92469");
});

it("has 512 links for the hashes that share them at quality 9", () => {
  const records = Array.from({ length: 490 }, (_, i) => ["lgax", noise.subarray(2 * i, 2 * i + 2)]);
  const input = Buffer.concat(
    ["qzvk0#qzvk!", ...records.flat(), "qzvk0", Buffer.alloc(20)].map(part => Buffer.from(part)),
  );
  expect(roundTrip(input, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("1091 3cd8c6f3");
});

it.each([
  [42, ["98 e53b1b37", "305 7416cd38"]],
  [43, ["100 580d77b2", "315 a8602468"]],
])("runs out of these links in a short input, or not, after %d runs of zeros", (length, expected) => {
  const records = Array.from({ length }, (_, i) => [Buffer.alloc(15), [128 + i]]);
  const input = Buffer.concat(["qwbk0#qwbk!", ...records.flat(), "qwbk0#~~~~~~~~"].map(part => Buffer.from(part)));
  const steps = [...Array.from(window(input, 64), chunk => [FLUSH, chunk]), [FINISH, Buffer.alloc(0)]];
  const params = { [QUALITY]: 9, [LGWIN]: 16 };
  expect([roundTrip(input, params), roundTripInSteps(steps, params)]).toEqual(expected);
});

it("keeps these links apart from those of other hashes", () => {
  // The words are in banks 511, 1 and 510, and zeros are in bank 0.
  const parts = ["qjwz0#qjwz!jzwk1%jzwk?xgbz2xgbz3", Buffer.alloc(500), "qjwz0#jzwk1%~~~~~~~~"];
  const input = Buffer.concat(parts.map(part => Buffer.from(part)));
  expect(roundTrip(input, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("56 23bc57f7");
});

it("tries all recent distances shortly before its buffer wraps around", () => {
  // The last two distances lead to two and three bytes of the last "ijk".
  const steps = [
    [FLUSH, Buffer.alloc(2 ** 18 - 200)],
    [FINISH, Buffer.from("0123456789abcdefghijklmnopqrsijtuvwxyzAB01234567!klmnopqr?ijk~~~~~~~~")],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 5, [LGWIN]: 17 })).toBe("72 c740d538");
});

it("stops trying recent distances where its buffer wraps around", () => {
  // The last two distances lead to five and nine bytes of what follows.
  const before = "01234567tuvwxyzABCijklminop#abcdefgh-ijklm$01234567!abcdefgh?";
  const steps = [
    [FLUSH, Buffer.alloc(2 ** 18 - before.length - 5)],
    [FINISH, Buffer.from(`${before}ijklminop~~~~~~~~`)],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 5, [LGWIN]: 17 })).toBe("79 5682f3c9");
});

it.each([
  [5, "44 08ed580a"],
  [10, "39 266f52d0"],
])("finds three bytes that start at the last byte of its buffer at quality %d", (quality, expected) => {
  const input = Buffer.concat([Buffer.alloc(2 ** 17 - 10), Buffer.from("01234567!01234567?012~~~~~~~~")]);
  expect(roundTrip(input, { [QUALITY]: quality, [LGWIN]: 10 })).toBe(expected);
});

it("starts over with what occurred 65536 times", () => {
  const frequent = Buffer.alloc(40000, "abcd?");
  for (let i = 0; i < 8000; i++) frequent[i * 5 + 4] = noise[i];
  let next = 0;
  function record() {
    const start = 20000 + 4 * ((++next >> 4) + (noise[next] & 7));
    return [noise.subarray(9000 + next, 9001 + next), frequent.subarray(0, 4), noise.subarray(start, start + 4)];
  }
  const input = Buffer.concat(
    [32668, 32568].flatMap(count => [Buffer.alloc(count * 5, frequent), ...Array.from({ length: 200 }, record).flat()]),
  );
  const steps = [...Array.from(window(input, 40000), chunk => [FLUSH, chunk]), [FINISH, Buffer.alloc(0)]];
  expect([5, 6, 7].map(quality => roundTripInSteps(steps, { [QUALITY]: quality, [LGWIN]: 18 }))).toEqual([
    "14164 0b6ec92f",
    "14164 0b6ec92f",
    "10324 c5a73f6f",
  ]);
});

it("splits tens of thousands of commands into blocks", () => {
  const input = Buffer.alloc(193312);
  for (let [i, at] = [0, 0]; i < 30000; i++) {
    const start = (noise[i] % (2 + ((i >> 8) % 61))) * 8;
    at += noise.copy(input, at, start, start + 4 + ((i >> 10) & 3));
    input[at++] = noise.at(-1 - i);
  }
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("62339 d188c902");
});

it("makes do with 256 prefix codes for literals", () => {
  const [starts, sizes] = [
    [1, 16, 64, 128, 192, 240],
    [15, 48, 64, 64, 48, 15],
  ];
  let context = 0;
  // Each eighth has bytes of its own, and the last two bytes narrow them down to twelve.
  const input = bytesOf(56000, i => {
    const byte = noise[i];
    const part = Math.floor(i / 7000);
    const range = byte % 6;
    const share = Math.max(2, sizes[range] >> 3);
    const choice = noise[(part * 36 + context) * 12 + range * 2 + (byte >> 7)] % share;
    context = range * 6 + Math.floor(context / 6);
    return starts[range] + ((part * share + choice) % sizes[range]);
  });
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("30300 24b099e5");
});

it.each([
  ["all at once", 500, "30896 47af38ae"],
  // Changes with that step. Checked against google/brotli with the same step added.
  ["in larger batches first", 400, "25773 da35b22d"],
])("combines the prefix codes for literals %s, for parts of %d bytes", (_, size, expected) => {
  let context = 0;
  // In each part, the last two bytes narrow the next one down to four.
  const input = bytesOf(100 * size, i => {
    const part = Math.floor(i / size);
    const range = noise[65535 - i] & 3;
    const choice = noise[(part * 16 + context) * 4 + range] % 12;
    context = range * 4 + (context >> 2);
    return [16, 64, 128, 192][range] + ((noise[60000 + part * 4 + range] + choice) % 48);
  });
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe(expected);
});

it.each([
  [4, 260, 512, 15, "120396 cf001d97"],
  [10, 280, 120, 15, "28753 0b8097a8"],
  [10, 67, 200, 15, "8573 77087cbf"],
  [10, 64, 608, 31, "27173 3682f570"],
])("has up to 256 types of blocks at quality %d, for %d parts", (quality, count, size, mask, expected) => {
  // Each part has values of its own.
  const parts = bytesOf(count * size, i => noise[60000 + Math.floor(i / size) * 16 + (noise[i & 0xffff] & mask)]);
  expect(roundTrip(Buffer.concat([Buffer.alloc(2000), parts]), { [QUALITY]: quality, [NO_CONTEXTS]: 1 })).toBe(
    expected,
  );
});

it("has a block of 64 values that occur more than 4096 times each", () => {
  const evenly = createCipheriv("aes-128-ctr", Buffer.alloc(16, 2), Buffer.alloc(16)).update(Buffer.alloc(266000));
  for (let i = 0; i < evenly.length; i++) {
    const j = i - (evenly[i] % ((i & 63) + 1));
    evenly[i] = evenly[j];
    evenly[j] = i & 63;
  }
  const input = Buffer.concat([evenly, bytesOf(2000, i => noise[i] | 192)]);
  expect(roundTrip(input, { [QUALITY]: 10, [NO_CONTEXTS]: 1, [LGBLOCK]: 19 })).toBe("201036 923303ce");
});

it("counts on codes of no more than 15 bits when it merges blocks", () => {
  const input = bytesOf(48000, i => (noise[i] < 128 ? noise[i] & 15 : noise[i] - 64));
  for (let i = 0; i < 166; i++) input[47999 - 7 * i] = 0;
  for (let i = 0; i < 3; i++) input[47970 - 49 * i] = 200 + i;
  expect(roundTrip(input, { [QUALITY]: 10, [NO_CONTEXTS]: 1, [LGWIN]: 16 })).toBe("39007 1af0514b");
});

it.each([
  [513, 102, 87, "5080 733f9add"],
  [514, 134, 78, "5054 d08bd290"],
  [514, 134, 29, "4710 08367f83"],
])("counts %d unused commands in a row when it merges blocks (%#)", (_, copy, count, expected) => {
  const short = (length, kinds) => Array.from(noise.subarray(0, length), byte => [1, 2 + (byte % kinds)]);
  const commands = [...short(300, 8), ...Array(240).fill([2, 4]), [18, copy], ...short(count, 6)];
  const changed = Buffer.from(noise);
  let at = 20;
  for (const [insert, copy] of commands) {
    for (const end = at + insert; at < end; at++) changed[at] ^= 255;
    at += copy;
  }
  const steps = [
    [FLUSH, noise.subarray(0, at)],
    [FLUSH, changed.subarray(0, 20)],
    [FINISH, changed.subarray(20, at)],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 10 })).toBe(expected);
});

it("counts 128 and more unused literals between others when it merges contexts", () => {
  const input = Buffer.alloc(400);
  for (let i = 1; i < 200; i++) input[i] = 3 * ((noise[i] % 43) + (input[i - 1] < 128 ? 43 : 0));
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("209 ca339260");
});

it("counts more unused literals between others than there are literals", () => {
  const record = (_, i) => (i < 86 ? "abcdefgh" : "ijklmnop") + String.fromCharCode(3 * (i % 86));
  const input = Buffer.from("001011100" + Array.from({ length: 128 }, record).join(""), "latin1");
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("187 eef15ea7");
});

it("counts 256 and more unused commands between others when it merges blocks", () => {
  const source = bytesOf(3100, i => noise[i] & 127);
  const fresh = bytesOf(3000, i => noise[9000 + i] | 128);
  let [from, next] = [0, 0];
  // Without `skip`, the distance stays the same.
  const each = (copies, inserts, skip) =>
    copies.flatMap(copy =>
      inserts.flatMap(insert => [
        fresh.subarray(next, (next += insert)),
        source.subarray((from = (from + (skip ?? insert)) % 2500), (from += copy)),
      ]),
    );
  const copies = [54, 30, 14, 9, 7, 4];
  const few = [0, 1, 2, 3, 4, 5, 6, 8];
  const input = Buffer.concat([
    source,
    ...each(copies, few, 10),
    ...each(copies, few.slice(1)),
    ...each([4], Array(400).fill(1)),
    ...each(copies, [10, 14, 18, 26, 34, 50, 66, 98], 10),
    ...each([70, 198, 582], few, 10),
  ]);
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("5664 019c1d45");
});

it("prices distances from 256 KiB on at quality 10", () => {
  const bytes = bytesOf(5100, i => noise[i] & 63);
  const records = Array.from({ length: 20 }, (_, i) => {
    const at = 13 * ((i * 7) % 20);
    return [bytes.subarray(at, at + (i & 1 ? 5 : 8)), bytes.subarray(5000 + 3 * i, 5003 + 3 * i)];
  });
  const input = Buffer.concat([bytes.subarray(0, 260), Buffer.alloc(1 << 18), ...records.flat()]);
  expect(roundTrip(input, { [QUALITY]: 10, [LGWIN]: 19 })).toBe("324 1620c998");
});

it("has several codes for 128 contexts in a row that share a prefix code", () => {
  let at = 0;
  const among = (first, count, length) => noise.subarray(at, (at += length)).map(byte => first + (byte % count));
  const parts = Array.from({ length: 150 }, () => [
    Buffer.of(1, 2, 3, 4, 5, 6, 7, 8),
    among(1, 15, 4),
    Buffer.of(20, 21, 22, 23, 24, 25, 40, 100),
    among(192, 48, 4),
  ]);
  const input = Buffer.concat([...parts.flat(), among(192, 48, 1500), among(64, 64, 1000)]);
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("2637 dfc0b82d");
});

it("finds what a flush cut in two", () => {
  const [steps, repeated] = [[], []];
  for (let [i, at] = [0, 0]; i < 36; i++) {
    repeated.push(noise.subarray(at + 19 - (i % 3), at + 33), noise.subarray(9000 + i, 9001 + i));
    for (const size of [20, 1 + Math.floor(i / 3), 20]) steps.push([FLUSH, noise.subarray(at, (at += size))]);
  }
  steps.push([FINISH, Buffer.concat(repeated)]);
  expect(roundTripInSteps(steps, { [QUALITY]: 3, [LARGE_WINDOW]: 1, [LGWIN]: 25 })).toBe("2117 ed030a5d");
  expect([2, 4, 5, 7, 10].map(quality => roundTripInSteps(steps, { [QUALITY]: quality }))).toEqual([
    "2132 3d81e6bd",
    "2114 a96ad4cb",
    "2114 a96ad4cb",
    "2114 a96ad4cb",
    "2122 aa1e2de2",
  ]);
});

it.each([
  [3, 10, [noise.subarray(0, 128), noise.subarray(128, 131), noise.subarray(1, 40)], "151 5fa644c1"],
  [32, 5, [noise.subarray(3000, 4024), noise.subarray(3600, 3632)], "1041 e9ead631"],
])("does not skip a flush of %d bytes at quality %d", (_, quality, parts, expected) => {
  const params = { [QUALITY]: quality, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: quality < 10 ? 25 : 16 };
  expect(roundTripInSteps([...parts.map(part => [FLUSH, part]), [FINISH, Buffer.alloc(0)]], params)).toBe(expected);
});

it("finds nothing in a first flush of 127 bytes at quality 10", () => {
  const steps = [
    [FLUSH, noise.subarray(0, 127)],
    [FINISH, noise.subarray(1, 40)],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 10 })).toBe("140 5eaf59b9");
});

it.each([
  [127, "160 6926fdf4"],
  [128, "161 c25d38ec"],
  [129, "162 451fb976"],
])("prefers the older match that has all of the last %d bytes at quality 10", (length, expected) => {
  const seen = noise.subarray(0, length);
  const input = Buffer.concat([seen, Buffer.alloc(70), seen.subarray(0, -1), Buffer.alloc(200), seen]);
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe(expected);
});

it.each([
  [0, "160 a87a5f47"],
  [1, "162 33d9539e"],
])("remembers a pattern that ends %d bytes before a flush at quality 10", (rest, expected) => {
  const pattern = noise.subarray(0, 13);
  const steps = [
    [FLUSH, Buffer.concat([Buffer.alloc(150, pattern), Buffer.alloc(rest)])],
    [FINISH, Buffer.concat([noise.subarray(200, 300), Buffer.alloc(148, pattern)])],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 10 })).toBe(expected);
});

it("takes a better second to last distance right after a flush at quality 10", () => {
  const steps = [
    [PROCESS, Buffer.from("01234567.abcdefgh,stuvwxyzABCDEFGH;ijklmnop:stuvw$")],
    [PROCESS, Buffer.alloc(130)],
    [FLUSH, Buffer.from("01234567!ijklmnop?")],
    [FINISH, Buffer.from("stuvwxyz")],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 10 })).toBe("78 e462123b");
});

it.each([
  [16383, 10, 0, [1005, 1011], "20275 e433d7bd"],
  [16384, 10, 0, [1005, 1011], "20275 3f9c3d2a"],
  [16384, 10, 0, [1004, 1074], "20271 6c503a23"],
  [16383, 10, 1, [1005, 1011], "20275 e8c03ff4"],
  [16384, 10, 1, [1005, 1011], "20275 c776cf29"],
  [16384, 11, 0, [1005, 1011], "20275 398a4b57"],
])("takes %d bytes from the last distance, quality %d, direct %d (%#)", (length, quality, direct, near, expected) => {
  const seen = noise.subarray(0, 20000);
  const gap = Buffer.concat([Buffer.alloc(500), seen.subarray(...near)], 20000);
  const changed = Buffer.from(seen);
  for (const at of [1003, 1004 + length]) changed[at] ^= 1;
  const slices = Array.from({ length: 16 }, (_, i) => seen.subarray(5000 + 301 * i, 5012 + 301 * i));
  const input = Buffer.concat([Buffer.alloc(2000), seen, gap, seen, gap, changed, gap, gap, ...slices]);
  input[65600] = 1;
  expect(roundTrip(input, { [QUALITY]: quality, [LGWIN]: 16, [NDIRECT]: direct })).toBe(expected);
});

it("takes 16384 bytes from the last distance after even more literals", () => {
  const [seen, unseen] = [noise.subarray(0, 20000), noise.subarray(20000, 40000)];
  const changed = Buffer.from(seen);
  for (const at of [1003, 1004 + 16384]) changed[at] ^= 1;
  const input = Buffer.concat([Buffer.alloc(2000), seen, Buffer.alloc(20000), seen, unseen, changed]);
  expect(roundTrip(input, { [QUALITY]: 10, [LGWIN]: 16 })).toBe("40066 70fe8671");
});

it("remembers the context after a flush of one byte", () => {
  const steps = input => [
    ...Array.from(window(input, 1200)).flatMap(chunk => [
      [FLUSH, chunk.subarray(0, 1)],
      [FLUSH, chunk.subarray(1)],
    ]),
    [FINISH, Buffer.alloc(0)],
  ];
  expect([
    roundTripInSteps(steps(text.subarray(0, 12000)), { [QUALITY]: 5, [SIZE_HINT]: 1 << 20 }),
    roundTripInSteps(steps(text.subarray(0, 12000)), { [QUALITY]: 10 }),
    roundTripInSteps(steps(samples), { [QUALITY]: 10 }),
  ]).toEqual(["3997 dcf256b6", "3707 b6ee5db0", "3354 502da705"]);
});

it.each([
  [5, 10, false, "2510 4c307290"],
  [5, 17, false, "2617 26111c00"],
  [9, 10, false, "2510 4c307290"],
  [5, 10, true, "2489 c4b23f83"],
])(
  "stops looking for matches where its buffer wraps around at quality %d, window %d, dictionary %p",
  (quality, size, hasDictionary, expected) => {
    let next = 0;
    const fresh = length => noise.subarray(next, (next += length));
    const [wanted, first, second] = [fresh(24), fresh(8), fresh(8)];
    // The last two distances lead to five and nine bytes of it.
    const before = Buffer.concat([
      ...[wanted.subarray(0, 16), fresh(3)],
      ...[first, fresh(10), wanted.subarray(0, 9), fresh(3)],
      ...[second, fresh(1), wanted.subarray(0, 5), fresh(3)],
      ...[first, fresh(1), second, fresh(1)],
    ]);
    const piece = Buffer.concat([before, wanted, fresh(20)]);
    const steps = [];
    for (let [i, at] = [1, 0]; i <= 18; i++) {
      const start = i * 2 ** Math.max(17, size + 1) - before.length - i;
      steps.push([FLUSH, Buffer.alloc(start - at)], [FLUSH, piece]);
      at = start + piece.length;
    }
    steps.push([FINISH, Buffer.alloc(0)]);
    const dictionary = hasDictionary ? Buffer.concat([wanted, fresh(10)]) : undefined;
    expect(roundTripInSteps(steps, { [QUALITY]: quality, [LGWIN]: size }, dictionary)).toBe(expected);
  },
);

it("weighs matches that start or end where its buffer wraps around", () => {
  let next = 24;
  const fresh = length => noise.subarray(next, (next += length));
  const [wanted, mark] = [noise.subarray(0, 24), Buffer.from("!")];
  const worse = [mark, wanted.subarray(0, 6), fresh(9)];
  const shorter = gap => [Buffer.alloc(gap), wanted.subarray(0, 17), Buffer.alloc(520), wanted.subarray(0, 16), mark];
  // What comes before the last few bytes of the buffer, how many those are, and the rest of one or two flushes.
  const cases = [
    ...[3, 4].map(left => [[], left, [wanted, fresh(9), wanted, fresh(9)]]),
    ...[8, 9].map(left => [[], left, [wanted, fresh(13), wanted.subarray(0, 8), fresh(left), wanted, fresh(9)]]),
    [worse, 5, [wanted, fresh(17), mark, wanted, fresh(9)]],
    [worse, 5, [wanted, fresh(21)], [mark, wanted, fresh(9)]],
    [worse, 5, [wanted, fresh(22)], [mark, wanted, fresh(9), Buffer.alloc(1100)]],
    [[...worse, wanted.subarray(0, 9), fresh(25)], 9, [mark, wanted.subarray(0, 9)]],
    [[], 17, [wanted], [...shorter(100), wanted, fresh(9)]],
    [[wanted, ...shorter(200)], 17, [wanted, fresh(9)]],
  ];
  let at = 0;
  const steps = cases.flatMap(([before, left, first, second = []], i) => {
    const flushes = [[Buffer.alloc(1200), ...before], first, second].map(parts => Buffer.concat(parts));
    const zeros = Buffer.alloc((i + 1) * 2 ** 18 - left - flushes[0].length - at);
    at += zeros.length + flushes[0].length + flushes[1].length + flushes[2].length;
    return [zeros, Buffer.concat(flushes.slice(0, 2)), flushes[2]].map(chunk => [FLUSH, chunk]);
  });
  steps.push([FINISH, Buffer.alloc(0)]);
  expect(roundTripInSteps(steps, { [QUALITY]: 7, [LGWIN]: 17 })).toBe("1079 3b601a55");
  expect(roundTripInSteps(steps, { [QUALITY]: 9, [LGWIN]: 10 })).toBe("1146 66b469c9");
});

it.each([
  [4, 0, [4, 0, 4, 4, 7, 8, -3], "92 ffc7f0fb,87 47dfde92,89 a0dc619e"],
  [7, 5, [0, 0, 0, 0, 0, 0, 0], "98 05893d0a,93 24df2799,96 3c6729f4"],
])("weighs %d bytes with the same rolling hash against %d that are closer", (far, near, changes, expected) => {
  // The hash is of every fourth byte, and stays the same with these changes.
  const seen = noise.subarray(6, 38);
  const similar = seen.map((byte, i) => (i < far ? byte : i % 4 ? ~byte : byte + changes[i / 4 - 1]));
  const gap = Buffer.alloc(near ? 20000 : 96);
  const parts = [
    Buffer.alloc(32),
    seen,
    gap,
    seen.subarray(0, near),
    Buffer.alloc(32 - near),
    similar,
    Buffer.alloc(900),
  ];
  const [input, large] = [Buffer.concat(parts), { [QUALITY]: 3, [LARGE_WINDOW]: 1, [LGWIN]: 25 }];
  // There is no hash for the last 31 bytes, and none in a smaller window.
  const answers = [
    roundTrip(input, large),
    roundTrip(input.subarray(0, -901), large),
    roundTrip(input, { [QUALITY]: 4, [SIZE_HINT]: 1 << 20 }),
  ];
  expect(answers.join()).toBe(expected);
});

it("finds a far chunk again after a similar one at quality 3 in a large window", () => {
  // Their rolling hashes differ only in bit 6.
  const chunk = noise.subarray(1716, 1748);
  const similar = Buffer.from(chunk);
  similar[28] += 64;
  const digits = Buffer.from(noise.hexSlice());
  const parts = [chunk, digits.subarray(0, 32768), similar, digits.subarray(65536, 98304), Buffer.alloc(1000), chunk];
  const input = Buffer.concat([...parts, Buffer.alloc(40)]);
  expect(roundTrip(input, { [QUALITY]: 3, [LARGE_WINDOW]: 1, [LGWIN]: 25 })).toBe("33999 c384e73d");
});

it("reaches more than 16 MiB back", () => {
  const input = Buffer.concat([noise, Buffer.alloc(16 << 20), noise.subarray(1001)]);
  const params = { [QUALITY]: 5, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: 25 };
  expect(roundTrip(input, params)).toBe("65586 65afaac4");
});

it.each([
  [2, 27, "340 204d5d49"],
  [3, 13, "335 312b80c3"],
])("has %d groups of contexts if the sample is just so", (_, start, expected) => {
  const kind = (byte, i) => (i & 1 && byte & 7 ? 0x80 : byte < 128 ? 0x61 : 0xc3);
  const input = Buffer.concat([noise.subarray(start, start + 64).map(kind), text.subarray(0, 600)]);
  expect(roundTrip(input, { [QUALITY]: 7 })).toBe(expected);
});

it("samples only where 64 bytes are left", () => {
  const params = { [QUALITY]: 5, [NO_CONTEXTS]: 0 };
  const after = (ascii, size) => [
    [FLUSH, Buffer.from("a")],
    [FINISH, Buffer.concat([Buffer.alloc(ascii, noise.hexSlice(0, 300)), Buffer.alloc(size, "éàçü")])],
  ];
  expect([after(0, 63), after(4096, 63), after(4096, 64)].map(steps => roundTripInSteps(steps, params))).toEqual([
    "22 cc5a7ac0",
    "351 ff844c3c",
    "351 9b568a4c",
  ]);
});

it("tells UTF-8 from other bytes", () => {
  const limits = "01 7f c280 dfbf e0a080 e0bfbf e18080 efbfbf f0908080 f0bfbfbf f1808080 f3bfbfbf f4808080 f48fbfbf";
  const neighbors = bytes => [bytes, ...bytes.flatMap((byte, i) => [bytes.with(i, byte - 1), bytes.with(i, byte + 1)])];
  const inputs = `${limits} 61626380`
    .split(" ")
    .flatMap(hex => neighbors([...Buffer.from(hex, "hex")]))
    .map(bytes => Buffer.alloc(60, Buffer.from(bytes)));
  expect(roundTrips(inputs, { [QUALITY]: 10, [LGWIN]: 10 })).toBe("1368 92205967");
});

it("tells UTF-8 from other bytes where its buffer wraps around", () => {
  // Three quarters are valid, which is just not enough.
  const unit = Buffer.concat([Buffer.from("a😀é中bc"), Buffer.alloc(4, 255)]);
  const steps = [];
  for (let [i, at] = [0, 0]; i < 8; i++) {
    const [start, piece] = [(i + 1) * 2 ** 17 - 1 - (i >> 1), Buffer.alloc(64 + (i & 1), unit)];
    steps.push([FLUSH, Buffer.alloc(start - at)], [FLUSH, piece]);
    at = start + piece.length;
  }
  steps.push([FINISH, Buffer.alloc(0)]);
  expect(roundTripInSteps(steps, { [QUALITY]: 10, [LGWIN]: 10 })).toBe("378 3acfa6f6");
});

it("has costs for the bytes of UTF-8 sequences once there are 25 of them", () => {
  const ascii = text.toString().replace(/[^\0-\x7f]/gu, "");
  const inputs = Object.entries({ é: 24, 中: 12 }).flatMap(([letter, enough]) =>
    [enough - 1, enough].flatMap(count => {
      const some = Buffer.from(ascii.slice(0, 1500).replaceAll("e", e => (count-- > 0 ? letter : e)));
      return [[], letter, [0xbf], [0xc0]].map(first => Buffer.concat([Buffer.from(first), some]));
    }),
  );
  expect(roundTrips(inputs, { [QUALITY]: 10, [LGWIN]: 12 })).toBe("8905 25e07c29");
});

it("flushes and emits metadata", () => {
  let at = 0;
  const steps = [0, 1, 2, 5, 300, 0, 40000, 7, 30000, 66000].flatMap((size, i) => [
    [i % 4 === 3 ? PROCESS : FLUSH, mixed.subarray(at, (at += size))],
    ...(i % 3 === 1 ? [[METADATA, noise.subarray(0, i * i * 9)]] : []),
  ]);
  steps.push([FINISH, mixed.subarray(at)]);
  const answers = [0, 1, 2, 4, 5, 7, 10].map(quality => {
    const compressed = drive(zlib.createBrotliCompress({ params: { [QUALITY]: quality } }), steps, 1 << 18);
    expect(digest(zlib.brotliDecompressSync(compressed))).toBe(digest(mixed));
    return digest(compressed);
  });
  expect(answers).toEqual([
    "42022 bb038424",
    "38158 119d842e",
    "26154 c35dcd38",
    "25757 ce210525",
    "24953 e7c6d890",
    "24906 b51979a8",
    "23910 910c2368",
  ]);
});

it.each(qualities)("makes what was flushed decodable at quality %d", quality => {
  const input = text.subarray(0, 700);
  const flushed = drive(zlib.createBrotliCompress({ params: { [QUALITY]: quality } }), [[FLUSH, input]], 5);
  expect(drive(zlib.createBrotliDecompress(), [[PROCESS, flushed]], 5)).toEqual(input);
});

it.each([0, 1, 5, 11])("finishes while a flush is not out yet at quality %d", quality => {
  const [input, out] = [text.subarray(0, 700), Buffer.alloc(4)];
  const engine = zlib.createBrotliCompress({ params: { [QUALITY]: quality } });
  engine._handle.writeSync(FLUSH, input, 0, input.length, out, 0, out.length);
  const rest = drive(engine, [[FINISH, Buffer.alloc(0)]], 1024);
  expect(zlib.brotliDecompressSync(Buffer.concat([out, rest]))).toEqual(input);
});

it.each([0, 1, 5, 11])("fills a chunk to the last byte at quality %d", quality => {
  const [input, params] = [text.subarray(0, 700), { [QUALITY]: quality }];
  const compressed = zlib.brotliCompressSync(input, { params });
  expect(zlib.brotliCompressSync(input, { params, chunkSize: compressed.length })).toEqual(compressed);
  expect(zlib.brotliDecompressSync(compressed, { chunkSize: input.length })).toEqual(input);
});

it("continues another stream", () => {
  const [head, tail] = [text.subarray(0, 5000), text.subarray(5000, 9000)];
  const first = drive(zlib.createBrotliCompress({ params: { [QUALITY]: 5 } }), [[FLUSH, head]], 8192);
  const answers = [2, 5, 9, 11].map(quality => {
    const second = zlib.brotliCompressSync(tail, { params: { [QUALITY]: quality, [STREAM_OFFSET]: head.length } });
    expect(zlib.brotliDecompressSync(Buffer.concat([first, second]))).toEqual(text.subarray(0, 9000));
    return digest(second);
  });
  expect(answers).toEqual(["1387 20abd2c0", "1343 eccd2070", "1343 eccd2070", "1238 1a964749"]);
});

it("continues a stream of quality 1, which has a larger window than was asked for", () => {
  const [head, dictionary, params] = [text.subarray(0, 5000), noise.subarray(0, 1500), { [QUALITY]: 1, [LGWIN]: 10 }];
  const tail = dictionary.subarray(200, 1200);
  const first = drive(bare(ENCODE, params, dictionary), [[FLUSH, head]], 8192);
  const second = drive(bare(ENCODE, { ...params, [STREAM_OFFSET]: head.length }, dictionary), [[FINISH, tail]], 8192);
  expect(decompress(Buffer.concat([first, second]), {}, dictionary)).toEqual(Buffer.concat([head, tail]));
});

it.skipIf(isShortOfMemory)("writes more than 56 bits between two literals", () => {
  // The distance of a word has 29 extra bits.
  const input = Buffer.concat([
    text.subarray(0, 16000),
    Buffer.from("\0government"),
    Buffer.alloc(180, noise.subarray(0, 140)),
    Buffer.from("!"),
  ]);
  const params = { [QUALITY]: 4, [LARGE_WINDOW]: 1, [LGWIN]: 30, [STREAM_OFFSET]: 2 ** 30 };
  expect(digest(zlib.brotliCompressSync(input, { params }))).toBe("4988 9deec83a");
});

it.each([2, 5, 9, 11])("does not count on the distances of the stream it continues at quality %d", quality => {
  const [head, tail] = [text.subarray(0, 2000), Buffer.alloc(200, noise.subarray(0, 16))];
  const first = drive(zlib.createBrotliCompress({ params: { [LGWIN]: 10 } }), [[FLUSH, head]], 8192);
  const second = zlib.brotliCompressSync(tail, {
    params: { [QUALITY]: quality, [LGWIN]: 10, [STREAM_OFFSET]: 2 ** 30 },
  });
  expect(zlib.brotliDecompressSync(Buffer.concat([first, second]))).toEqual(Buffer.concat([head, tail]));
});

it.each([
  [12, 11],
  [2 ** 32 - 2, 0],
])("clamps a quality of %d to %d", (value, clamped) => {
  const input = text.subarray(0, 4000);
  expect(roundTrip(input, { [QUALITY]: value })).toBe(roundTrip(input, { [QUALITY]: clamped }));
});

it.each([
  [0, 2 ** 16 + 10, "82 432fe67e"],
  [1, 31, "84 c3ab76cb"],
])("clamps the window (large: %d, bits: %d)", (large, bits, expected) => {
  expect(roundTrip(text.subarray(0, 100), { [QUALITY]: 5, [LARGE_WINDOW]: large, [LGWIN]: bits })).toBe(expected);
});

it("clamps the block size", () => {
  // The end of a block cuts a match in two.
  const input = Buffer.alloc(2 ** 24 + 64);
  for (let bits = 14; bits <= 24; bits++) {
    noise.copy(input, 2 ** bits - 40, bits * 100 + 1, bits * 100 + 9);
    noise.copy(input, 2 ** bits - 3, bits * 100, bits * 100 + 9);
  }
  const compress = (bits, size) =>
    `${bits}: ${roundTrip(input.subarray(0, size), { [QUALITY]: 5, [LGWIN]: 24, [LGBLOCK]: bits })}`;
  const small = [2 ** 32 - 2, 1, 15, 16, 17, 18].map(bits => compress(bits, 2 ** 19 + 64));
  expect([...small, compress(25)]).toEqual([
    "4294967294: 159 7f63f388",
    "1: 159 7f63f388",
    "15: 159 7f63f388",
    "16: 159 7f63f388",
    "17: 159 7f63f388",
    "18: 159 7f63f388",
    "25: 245 a243a439",
  ]);
});

it("holds the header back until something follows", () => {
  const engine = zlib.createBrotliCompress({ params: { [LARGE_WINDOW]: 1 } });
  expect(drive(engine, [[PROCESS, text.subarray(0, 10)]], 64)).toHaveLength(0);
});

it("takes the size of the input that follows metadata for a hint", () => {
  const steps = [
    [METADATA, text.subarray(0, 3)],
    [FINISH, Buffer.alloc(1 << 20, text)],
  ];
  expect(digest(drive(zlib.createBrotliCompress({ params: { [QUALITY]: 4 } }), steps, 1 << 16))).toBe("9552 343ea539");
});

it("emits metadata in several steps", () => {
  const steps = [
    [METADATA, text.subarray(0, 300)],
    [FINISH, text.subarray(300, 400)],
  ];
  expect(drive(zlib.createBrotliCompress(), steps, 70)).toEqual(drive(zlib.createBrotliCompress(), steps, 1024));
});

it.each([
  ["another operation", PROCESS, 0],
  ["another length", METADATA, 1],
])("refuses %s in the middle of metadata", (_, operation, dropped) => {
  const engine = zlib.createBrotliCompress();
  engine._handle.writeSync(METADATA, text, 0, 300, Buffer.alloc(70), 0, 70);
  const rest = text.subarray(300 - engine._writeState[1], 300 - dropped);
  expect(drive(engine, [[operation, rest]], 1024).code).toBe("ERR_BROTLI_COMPRESSION_FAILED");
});

it("emits 16 MiB of metadata", () => {
  const steps = [
    [METADATA, Buffer.alloc(2 ** 24)],
    [FINISH, Buffer.from("a")],
  ];
  const compressed = drive(zlib.createBrotliCompress(), steps, 2 ** 24 + 64);
  expect(zlib.brotliDecompressSync(compressed).toString()).toBe("a");
});

it.each([
  ["input after the end of the stream", FINISH, PROCESS, 10],
  ["metadata after the end of the stream", FINISH, METADATA, 0],
  ["more than 16 MiB of metadata", FLUSH, METADATA, 2 ** 24 + 1],
])("refuses %s", (_, first, second, length) => {
  const steps = [
    [first, text.subarray(0, 10)],
    [second, Buffer.alloc(length)],
  ];
  expect(drive(zlib.createBrotliCompress(), steps, 64)).toEqual({
    message: "Compression failed",
    errno: -1,
    code: "ERR_BROTLI_COMPRESSION_FAILED",
  });
});

it.each([
  ["createBrotliCompress", NO_CONTEXTS, 2],
  ["createBrotliCompress", STREAM_OFFSET, 2 ** 30 + 1],
  ["createBrotliDecompress", 2, 0],
])("%s refuses parameter %d with value %d", (create, key, value) => {
  expect(() => zlib[create]({ params: { [key]: value } })).toThrow(
    expect.objectContaining({ code: "ERR_ZLIB_INITIALIZATION_FAILED" }),
  );
});

describe("reset()", () => {
  const input = text.subarray(0, 700);
  const compressed = zlib.brotliCompressSync(input);

  function resetAfter(engine, written) {
    engine._handle.onerror = () => {};
    engine._handle.writeSync(PROCESS, written, 0, written.length, Buffer.alloc(8), 0, 8);
    engine.reset();
    return engine;
  }

  it("makes the encoder forget its input, parameters and dictionary", () => {
    const engine = zlib.createBrotliCompress({ params: { [QUALITY]: 5, [LGWIN]: 10 }, dictionary: input });
    expect(drive(resetAfter(engine, samples), [[FINISH, input]], 1024)).toEqual(compressed);
  });

  it("makes the decoder forget its input", () => {
    const engine = resetAfter(zlib.createBrotliDecompress(), compressed.subarray(0, 200));
    expect(drive(engine, [[FINISH, compressed]], 1024)).toEqual(input);
  });

  it.each([
    ["parameters", "WINDOW_BITS", { params: { [LARGE_WINDOW]: 1 } }, { params: { [DECODER_LARGE_WINDOW]: 1 } }],
    ["dictionary", "DICTIONARY", { dictionary: input }, { dictionary: input }],
  ])("makes the decoder forget its %s", (_, error, forEncoder, forDecoder) => {
    const engine = resetAfter(zlib.createBrotliDecompress(forDecoder), Buffer.alloc(0));
    const steps = [[FINISH, zlib.brotliCompressSync(input, forEncoder)]];
    expect(drive(engine, steps, 1024).code).toBe(`ERR__ERROR_FORMAT_${error}`);
  });

  it("keeps the error of the decoder", () => {
    const engine = resetAfter(zlib.createBrotliDecompress(), Buffer.from([0x11]));
    expect(drive(engine, [[FINISH, compressed]], 1024).code).toBe("ERR__ERROR_FORMAT_WINDOW_BITS");
  });
});

it.each([5, 11])("decodes a stream of quality %d in pieces of any size", quality => {
  const input = Buffer.concat([text.subarray(0, 2500), samples.subarray(0, 1200), noise.subarray(0, 100)]);
  const compressed = zlib.brotliCompressSync(input, { params: { [QUALITY]: quality, [LGWIN]: 10 } });
  for (const [piece, room] of [
    [1, 8192],
    [9, 61],
    [8192, 7],
  ]) {
    const steps = [Buffer.alloc(0), ...window(compressed, piece)].map(chunk => [PROCESS, chunk]);
    expect(drive(zlib.createBrotliDecompress(), steps, room)).toEqual(input);
  }
});

it("switches blocks in a stream that comes in pieces", () => {
  const compressed = zlib.brotliCompressSync(mixed, { params: { [QUALITY]: 10 } });
  const steps = Array.from(window(compressed, 97), chunk => [PROCESS, chunk]);
  expect(digest(drive(zlib.createBrotliDecompress(), steps, 1 << 16))).toBe(digest(mixed));
});

it("reports the end of the input at every length of a stream", () => {
  const steps = [
    [METADATA, noise.subarray(0, 3)],
    [FLUSH, noise.subarray(0, 12)],
    [FINISH, text.subarray(0, 400)],
  ];
  const compressed = drive(zlib.createBrotliCompress(), steps, 1024);
  const codes = new Set();
  for (let length = 1; length < compressed.length; length++) {
    codes.add(drive(bare(DECODE), [[FINISH, compressed.subarray(0, length)]], 1024).code);
  }
  expect([...codes]).toStrictEqual(["Z_BUF_ERROR"]);
});

it("leaves what follows the stream", () => {
  const compressed = zlib.brotliCompressSync(text.subarray(0, 400));
  const followed = Buffer.concat([compressed, noise.subarray(0, 20)]);
  const { buffer, engine } = zlib.brotliDecompressSync(followed, { info: true });
  expect({ buffer, used: engine.bytesWritten }).toEqual({ buffer: text.subarray(0, 400), used: compressed.length });
});

it("decodes with the whole window allocated up front", () => {
  const compressed = zlib.brotliCompressSync(mixed, { params: { [QUALITY]: 5, [LGWIN]: 16 } });
  const decompressed = zlib.brotliDecompressSync(compressed, { params: { [DECODER_WHOLE_WINDOW]: 1 } });
  expect(digest(decompressed)).toBe(digest(mixed));
});

/** Writes streams by hand (RFC 7932 section 9). */
class Bits {
  bytes = [];
  pending = 0;
  count = 0;

  /** `[count, value]` pairs of up to 24 bits. */
  put(...fields) {
    for (let i = 0; i < fields.length; i++) this.number24(fields[i][0], fields[i][1]);
    return this;
  }

  number24(count, value) {
    this.pending |= value << this.count;
    for (this.count += count; this.count >= 8; this.count -= 8) {
      this.bytes.push(this.pending & 255);
      this.pending >>>= 8;
    }
    return this;
  }

  /** The highest bit comes first. */
  code(length, code) {
    let reversed = 0;
    for (let i = 0; i < length; i++) reversed = (reversed << 1) | ((code >> i) & 1);
    return this.number24(length, reversed);
  }

  simpleCode(symbolBits, ...symbols) {
    return this.put([2, 1], [2, symbols.length - 1], ...symbols.map(symbol => [symbolBits, symbol]));
  }

  /** Spells out each length in four bits. */
  complexCode(lengths) {
    this.put([2, 0], ...[1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1].map(used => [2, used]));
    for (const length of lengths) this.code(4, length);
    return this;
  }

  /** Returns what writes a symbol. */
  evenCode(size) {
    const length = 32 - Math.clz32(size - 1);
    const shorter = 2 ** length - size;
    this.complexCode(Array.from({ length: size }, (_, symbol) => length - (symbol < shorter)));
    return symbol => (symbol < shorter ? this.code(length - 1, symbol) : this.code(length, symbol + shorter));
  }

  /** Of block types or trees. */
  number(value) {
    const bits = 31 - Math.clz32(value - 1);
    return value === 1 ? this.put([1, 0]) : this.put([4, 2 * bits + 1], [bits, value - 1 - 2 ** bits]);
  }

  /** For 64 symbols, as the encoder describes it at quality 2. */
  sixBitCode() {
    return this.put([14, 0x1c03], [14, 0xda7]);
  }

  uncompressed(bytes) {
    this.put([1, 0], [2, 0], [16, bytes.length - 1], [1, 1]).align();
    for (let i = 0; i < bytes.length; i++) this.bytes.push(bytes[i]);
    return this;
  }

  lastHeader(length) {
    const nibbles = Math.max(4, (35 - Math.clz32(length - 1)) >> 2);
    return this.put([2, 1], [2, nibbles - 4], [nibbles * 4, length - 1]);
  }

  /** With one block type of each category, no distance parameters and no contexts. */
  plainHeader(length) {
    return this.put([1, 0], [2, 0], [16, length - 1], [1, 0], [13, 0]);
  }

  plainLastHeader(length) {
    return this.lastHeader(length).put([13, 0]);
  }

  /** The first 448 commands have 9 bits. */
  fixedCommandCode() {
    return this.put([24, 0x307003], [24, 0x624416], [11, 0x92]);
  }

  /** What `copy` and `distance` use: the codes of quality 2 for short inputs. */
  fixedCodes() {
    return this.simpleCode(8, 0).fixedCommandCode().sixBitCode();
  }

  copy(length) {
    const extraBits = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24];
    let index = 0;
    let base = 2;
    while (length >= base + (1 << extraBits[index])) base += 1 << extraBits[index++];
    return this.code(9, [128, 192, 384][index >> 3] + (index & 7)).number24(extraBits[index], length - base);
  }

  distance(distance) {
    const extraBits = 30 - Math.clz32(distance + 3);
    this.code(6, 12 + 2 * extraBits + ((distance + 3) >> extraBits));
    return this.number24(extraBits, (distance + 3) & ((1 << extraBits) - 1));
  }

  align() {
    return this.put([-this.count & 7, 0]);
  }

  finish() {
    return Buffer.from(this.align().bytes);
  }
}

const windowOf = bits =>
  new Bits().put(bits > 17 ? [4, ((bits - 17) << 1) | 1] : bits === 16 ? [1, 0] : [7, (((bits - 8) % 9) << 4) | 1]);
const largeWindowOf = (bits, reserved = 0) => new Bits().put([7, 0x11], [1, reserved], [6, bits]);
const WORD_INDEX_BITS = [10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5];

/** `words` are `[length, index, transform]`, and come to `total` bytes. */
function decodeWords(words, total) {
  const fullWindow = Buffer.alloc(1024 - 16);
  const bits = windowOf(10).uncompressed(fullWindow).plainLastHeader(total).fixedCodes();
  for (const word of words) {
    bits.copy(word[0]).distance(fullWindow.length + 1 + word[1] + (word[2] << WORD_INDEX_BITS[word[0] - 4]));
  }
  return zlib.brotliDecompressSync(bits.finish()).subarray(fullWindow.length);
}

const everyWord = (transform, total) =>
  decodeWords(
    WORD_INDEX_BITS.flatMap((bits, i) => Array.from({ length: 1 << bits }, (_, j) => [i + 4, j, transform])),
    total,
  );

const allWords = once(() => everyWord(0, 122784));

it("has every word of the static dictionary", () => {
  // RFC 7932 appendix A
  expect(digest(allWords())).toBe("122784 5136cb04");
});

it("finds the words of the static dictionary", () => {
  const withSpaces = everyWord(1, 136288);
  expect([
    ...[2, 4].map(quality => roundTrip(withSpaces, { [QUALITY]: quality, [LGWIN]: 10 })),
    ...[5, 10].map(quality => roundTrip(allWords(), { [QUALITY]: quality, [LGWIN]: 10 })),
  ]).toEqual(["75532 b6209c0f", "52263 35edc8ab", "53114 63312b3e", "23221 769610c5"]);
});

it.each([
  [4, "136288 2c9bbe95", "30334 d0b23ce8"],
  [44, "122784 f88c78a5", "36237 58b56d03"],
])("has and finds every word in the upper case of transform %d", (transform, ...expected) => {
  const words = everyWord(transform, parseInt(expected[0]));
  expect([digest(words), roundTrip(words, { [QUALITY]: 10, [LGWIN]: 10 })]).toEqual(expected);
});

it("has every transform", () => {
  const words = WORD_INDEX_BITS.flatMap((bits, i) =>
    [0, (1 << bits) - 1].flatMap(index => Array.from({ length: 121 }, (_, transform) => [i + 4, index, transform])),
  );
  expect(digest(decodeWords(words, 79752))).toBe("79752 aee2cea4");
});

const transformedWords = once(() =>
  decodeWords(
    WORD_INDEX_BITS.slice(0, 17).flatMap((bits, i) =>
      Array.from({ length: 121 }, (_, transform) => [i + 4, (transform * 37 + i) % (1 << bits), transform]),
    ),
    28178,
  ),
);

it("finds words right before a flush", () => {
  const chunks = Array.from(window(transformedWords().subarray(0, 12000), 19));
  const steps = [...chunks.map(chunk => [FLUSH, Buffer.concat([Buffer.alloc(80), chunk])]), [FINISH, Buffer.alloc(0)]];
  expect([2, 5].map(quality => roundTripInSteps(steps, { [QUALITY]: quality }))).toEqual([
    "20114 fa967924",
    "18737 4f6917f9",
  ]);
});

it("finds words with what little follows them before a flush at quality 10", () => {
  const ends =
    " 2020|\u00a0time|e time |.com/time| the time|Information,|INFORMATION. | information,| information, |" +
    " the information of | the information of the |experiencing |government and #|government and #~|" +
    " the document.getElementById( of the ~";
  const steps = ends.split("|").map(end => [FLUSH, Buffer.concat([Buffer.alloc(40), Buffer.from(end)])]);
  expect(roundTripInSteps([...steps, [FINISH, Buffer.alloc(0)]], { [QUALITY]: 10, [LGWIN]: 10 })).toBe("222 b4f97f68");
});

it("takes the more recent of two distances that both match up to the end", () => {
  const input = Buffer.from(noise.subarray(100, 465));
  for (const at of [156, 206]) input.copyWithin(at, 356);
  input[165] = 0;
  [200, 150, 90, 60].forEach((distance, i) => {
    const at = 300 + 14 * i;
    input.copyWithin(at, at - distance, at - distance + 10);
  });
  expect(roundTrip(input, { [QUALITY]: 9 })).toBe("340 385fed28");
});

it("finds a word for every transform", () => {
  expect(qualities.map(quality => roundTrip(transformedWords(), { [QUALITY]: quality }))).toEqual([
    "17351 2df44e89",
    "16968 f8acc7a0",
    "16201 ad27437f",
    "16201 ad27437f",
    "16201 ad27437f",
    "12180 078d1f81",
    "12180 078d1f81",
    "12180 078d1f81",
    "12185 2887c38e",
    "12185 2887c38e",
    "6931 88be329a",
    "6260 128ec084",
  ]);
});

describe("patchwork", () => {
  const without = pattern => Buffer.from(text.toString().replace(pattern, ""));
  const sources = once(() => [
    text,
    noise,
    samples,
    mixed,
    allWords(),
    Buffer.from(allWords().latin1Slice(0, 60000).toUpperCase()),
    Buffer.from(noise.hexSlice()),
    Buffer.from(noise.base64Slice()),
    without(/[^\0-\x7f]/gu),
    without(/[^\u0400-\u04ff]/gu),
    without(/[\0-\u04ff]/gu),
  ]);

  /** Slices of three sources, and of what it has so far. */
  function patchwork(pick, size) {
    const out = Buffer.alloc(size);
    const [chosen, bits] = [[0, 1, 2].map(() => sources()[pick(sources().length)]), 6 + pick(11)];
    for (let at = 0; at < size;) {
      const source = chosen[pick(4)] ?? out.subarray(0, at + 1);
      const start = pick(source.length);
      at += source.copy(out, at, start, start + 1 + pick(1 + (size >> 8)) + pick(2 << pick(bits)));
    }
    return out;
  }

  function roundTripOf(quality, seed, wraps) {
    let state = noise.readUInt32LE(seed * 4) >>> 1;
    const pick = below => (state = (state * 48271) % 0x7fffffff) % below;
    const oneOf = (...values) => values[pick(values.length)];
    const params = {
      [QUALITY]: quality,
      [LGWIN]: oneOf(10, 12, 15, 16, 17, 18, 19, 22, 24, 25),
      [SIZE_HINT]: oneOf(0, 1 << 20),
      ...oneOf(
        {},
        {},
        { [MODE]: 2 },
        { [NO_CONTEXTS]: 1 },
        { [LGBLOCK]: 17 },
        { [NPOSTFIX]: pick(4), [NDIRECT]: 8 * pick(4) },
      ),
    };
    params[LARGE_WINDOW] = +(params[LGWIN] === 25);
    const input = patchwork(pick, 1 + pick(1 << oneOf(6, 9, 12, 14, 16, 17, 18, 19)));
    const dictionary = params[LARGE_WINDOW] || pick(4) ? undefined : patchwork(pick, 1 + pick(64 << pick(11)));
    let at = 0;
    const steps = Array.from({ length: oneOf(0, 0, 1, 2, 6) }, () => [
      oneOf(PROCESS, FLUSH),
      input.subarray(at, (at += pick(1 + (input.length >> 1)))),
    ]);
    if (wraps) steps.unshift([FLUSH, Buffer.alloc(2 ** 18 - pick(input.length))]);
    return roundTripInSteps([...steps, [FINISH, input.subarray(at)]], params, dictionary);
  }

  function answers(quality, expected, wraps) {
    const seeds = expected.split(",").map(answer => parseInt(answer));
    return seeds.map(seed => `${seed} ${roundTripOf(quality, seed, wraps)}`).join();
  }

  // Each seed leads to a decision of the encoder that no other test depends on.
  it.each([
    [0, "12 159942 eed5d9d1,3240 37762 7a379a87,5071 80840 8eb31fde,8745 191 379cc8a7"],
    [1, "769 78 985c5eb1,1561 340 54dfc55e"],
    [2, "566 66055 348cae62,2822 89229 428b9f3c,4480 933 561fd28a,4834 3069 bfa715ee"],
    [
      3,
      "29 73 e7b2554f,423 20302 3284c673,507 143744 272f8768,543 873 e5845b25,1071 1023 a0176c05,3138 1203 fd8df8d8,6413 1448 f812d2d8,7203 20497 f6bfca5d,8593 12016 f112b26b",
    ],
    [
      4,
      "676 96192 d40113d5,3027 3095 d5806ad6,6793 2859 037aab5b,8350 1571 224f246b,8739 2464 72bd4260,9467 13696 2e983d31,10116 21 ee827abb",
    ],
    [
      5,
      "1193 111114 1be564e8,2165 19022 fbfeedd6,2418 1753 8587401d,2765 120648 c2461a21,2777 14586 9ae43528,3185 52963 b6d67ba6",
    ],
    [
      6,
      "1242 151444 eb214725,1602 7976 d5fdd829,1926 219421 a156bd34,1986 17172 0d91d007,2346 6172 6cb5e7ea,2454 2933 b88b827d,5590 71048 03c6c8da",
    ],
    [7, "2707 2686 293328d6,2995 39091 215ced56,3499 9199 61960188,6756 1872 8b57ee6b,6857 135813 341c340a"],
    [8, "104 17891 862f56bc,500 14246 908efc05,584 650 b7359f31,1148 159415 814e5037,2192 10276 8fa5a01f"],
    [
      9,
      "165 82259 b2b371b7,741 7837 21a4e167,1089 272 ddd91caa,1293 61960 9a3db333,1437 31802 9fcf5255,1497 31541 ae4b0209,2361 34010 980a3e25,2445 48654 d920f4a9,8993 3458 2161fa04",
    ],
    [
      10,
      "430 24354 2cf2ccdf,1486 1257 ccc70223,1940 35 05b9bde1,2038 18865 e9265a34,2542 8803 9b111719,2590 304 ce198296,3418 33270 efe17438,3526 73 910dccb5,3930 149 13ade797,4542 2596 96b9dffc,4940 715 25b748e9,7522 90 45f15e28,9327 9822 a0300db4",
    ],
    [
      10,
      "9335 18318 e325929b,9375 58012 95cde25d,9578 10510 d2766637,9919 20076 e00edcac,10458 8857 246eddc7,10475 8366 68a4dcd8,10507 46 098cd3de",
    ],
    [
      10,
      "2745 1979 0d437198,5448 47 212e9356,10528 18381 5e1451de,11336 23 10284daa,12042 867 436acf33,14366 3793 6706bacd",
    ],
    [
      11,
      "227 12754 e30c2226,755 30 64accfb9,1079 19 fd9bd8bf,1134 131 4f16fb25,1665 141 b0b1dbd1,1932 1476 af22ec02,2041 1182 fd1d6506,2426 234 141e3ee2,3203 6983 ccd7b4b9,3227 1337 0a13347e,3299 668 ecdc9487,3828 1659 27b85e7c,4285 666 b0bfa729,5853 649 22175d72,11605 42 3061e079,12145 177 5cf35ef2,12182 3635 6eecb6ae,12250 179 7dc545fb,12483 9104 17940018,12723 8179 cd08cf62,13815 655 d1650a72,13877 8608 eb8e136e",
    ],
    [
      11,
      "10588 753 16f202ae,12281 435 808922ad,14240 163 15e0b351,16267 995 6a9f06be,16278 188 21c55d12,16342 781 86c079e9",
    ],
  ])("compresses at quality %d (%#)", (quality, expected) => {
    expect(answers(quality, expected, false)).toBe(expected);
  });

  it.each([
    [10, "8793 2038 b8828a94"],
    [11, "1189 129 7ab2bf76,8705 148 ed0db7fb"],
  ])("compresses where the buffer wraps around at quality %d", (quality, expected) => {
    expect(answers(quality, expected, true)).toBe(expected);
  });
});

it("has every context mode", () => {
  const pairs = Array.from({ length: 256 }, (_, byte) => [0, byte, byte, 0]).flat();
  const answers = [0, 1, 2, 3].map(mode => {
    // After a copy of each pair, a literal that is the number of its context.
    const bits = windowOf(11).uncompressed(pairs).lastHeader(1536).put([9, 0], [2, mode]);
    bits.put([4, 11], [5, 31], [1, 0]).sixBitCode();
    for (let context = 0; context < 64; context++) bits.code(6, context);
    bits.put([1, 0], [1, 0]);
    for (let tree = 0; tree < 64; tree++) bits.simpleCode(8, tree);
    bits.simpleCode(10, 128, 136).simpleCode(6, 5, 32);
    bits.put([1, 0], [1, 1], [9, 3]);
    for (let pair = 1; pair < 512; pair++) bits.put([1, 1], [1, 0]);
    return digest(zlib.brotliDecompressSync(bits.put([1, 1]).finish()));
  });
  expect(answers).toEqual(["2560 2dabbf67", "2560 95f42902", "2560 79080a22", "2560 65e3dadc"]);
});

it("has every short distance code", () => {
  const bits = windowOf(16)
    .uncompressed(noise.subarray(0, 100))
    .plainLastHeader(16 * 5 * 3)
    .fixedCodes();
  for (let code = 0; code < 16; code++) {
    for (const distance of [80, 60, 40, 20]) bits.copy(3).distance(distance + code);
    bits.copy(3).code(6, code);
  }
  expect(digest(zlib.brotliDecompressSync(bits.finish()))).toBe("340 9c0bc6cf");
});

it("copies byte by byte where source and target overlap", () => {
  const expected = [];
  const bits = windowOf(10);
  for (let distance = 1; distance <= 34; distance++) {
    const fresh = noise.subarray(distance * 40, distance * 40 + 40);
    for (const length of [2, 3, 8, 15, 16, 17, 31, 32, 33, 64, 100]) {
      bits.uncompressed(fresh).plainHeader(length).fixedCodes().copy(length).distance(distance);
      expected.push(fresh, Buffer.alloc(length, fresh.subarray(-distance)));
    }
  }
  expect(zlib.brotliDecompressSync(bits.put([2, 3]).finish())).toEqual(Buffer.concat(expected));
});

it.each([
  ["a", [97], [], []],
  ["ab", [98, 97], [], ["0", "1"]],
  ["cab", [99, 98, 97], [], ["0", "10", "11"]],
  ["abcd", [100, 99, 98, 97], [[1, 0]], ["00", "01", "10", "11"]],
  ["dcab", [100, 99, 98, 97], [[1, 1]], ["0", "10", "110", "111"]],
])("decodes the simple prefix code for %p", (expected, symbols, shape, codes) => {
  const bits = windowOf(16).plainLastHeader(expected.length);
  bits.simpleCode(8, ...symbols).put(...shape);
  bits.simpleCode(10, expected.length << 3).simpleCode(6, 0);
  for (const code of codes) bits.code(code.length, parseInt(code, 2));
  expect(zlib.brotliDecompressSync(bits.finish()).toString()).toBe(expected);
});

it("has every code for block types", () => {
  const bits = windowOf(16).lastHeader(6);
  bits.put([4, 3], [1, 0]).simpleCode(3, 0, 1, 4).simpleCode(5, 0).put([2, 0]);
  bits.put([14, 0], [4, 3], [1, 0], [1, 0]).simpleCode(2, 0, 1, 2);
  for (let context = 0; context < 192; context++) bits.code(1 + (context > 63), [0, 2, 3][context >> 6]);
  bits.put([2, 0]).simpleCode(8, 97).simpleCode(8, 98).simpleCode(8, 99);
  bits
    .simpleCode(10, 6 << 3)
    .simpleCode(6, 0)
    .put([1, 0]);
  // The second to last type, the next type, and the third type.
  for (const code of ["0", "10", "10", "0", "11"]) bits.code(code.length, parseInt(code, 2)).put([2, 0]);
  expect(zlib.brotliDecompressSync(bits.finish()).toString()).toBe("abcacc");
});

const upTo15 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15];
const decodeInPieces = (stream, pieces, room) =>
  pieces.map(piece => {
    const steps = Array.from(window(stream, piece), chunk => [PROCESS, chunk]);
    return digest(drive(bare(DECODE), [...steps, [FINISH, Buffer.alloc(0)]], room));
  });

it("decodes codes of up to 15 bits", () => {
  const bits = windowOf(16)
    .uncompressed(noise.subarray(0, 40))
    .plainLastHeader(112 * 16);
  const symbol = i => bits.code(upTo15[i], 2 ** upTo15[i] - (i < 15 ? 2 : 1));
  // The commands insert one or two literals and copy two to nine bytes from a short distance.
  bits
    .complexCode(upTo15)
    .complexCode([...Array(136).fill(0), ...upTo15])
    .complexCode(upTo15);
  for (let i = 0; i < 256; i++) {
    for (const each of [i & 15, i >> 4, ...(i & 8 ? [i % 13] : []), (i * 3 + (i >> 4) + 1) & 15]) symbol(each);
  }
  expect(decodeInPieces(bits.finish(), [1, 5, 4096], 4096)).toEqual(Array(3).fill("1832 40335292"));
});

it("decodes lengths whose two kinds of repeats take turns", () => {
  // One bit for a length of seven, and five bits for each kind of repeat.
  const bits = windowOf(16).plainLastHeader(128);
  bits.put([2, 0], [2, 2], [2, 1], [4, 0], [3, 3], [2, 0], [4, 15], [2, 0], [4, 15], [4, 7], [1, 0]);
  for (let i = 0; i < 21; i++) bits.code(5, 31).put([3, 0]).code(5, 30).put([2, 3]);
  bits.put([1, 0]).simpleCode(10, 312).simpleCode(6, 0).put([5, 30]);
  for (let i = 0; i < 128; i++) bits.code(7, i);
  const expected = Array.from({ length: 190 }, (_, i) => i).filter(i => i % 9 === 0 || i % 9 > 3);
  expect([...zlib.brotliDecompressSync(bits.finish())]).toEqual([...expected, 190]);
});

it("needs no more input to tell that a code is incomplete", () => {
  const stream = windowOf(16).plainLastHeader(1).complexCode(Array(256).fill(9)).finish();
  expect(drive(zlib.createBrotliDecompress(), [[FINISH, stream]], 64).code).toBe("ERR__ERROR_FORMAT_HUFFMAN_SPACE");
});

it.each(upTo15.slice(1, 15))("decodes commands of 34 or 48 + %d bits at each alignment", length => {
  // The code of one bit is for a literal and two bytes from the last distance.
  const lengths = Array(704).fill(0).fill(length, 702);
  lengths.splice(8, length - 1, ...upTo15.slice(0, length - 1));
  const out = Buffer.alloc(1 << 19, "a");
  function write(total) {
    const bits = windowOf(20).uncompressed(noise.subarray(0, 40)).plainLastHeader(total);
    bits.simpleCode(8, 97).complexCode(lengths).sixBitCode();
    let [at, last] = [noise.copy(out, 0, 0, 40), 4];
    for (let i = 0; i < 16; i++) {
      for (let short = 0; short < 8 || bits.count !== (15 - i) % 8; short++, at += 3) {
        bits.put([1, 0]);
        out.copyWithin(at + 1, at + 1 - last, at + 3 - last);
      }
      last = at += 22594 + 37 * i;
      const [code, base, extra] = i < 8 ? [2, 1094, [10, 1023 - i]] : [1, 2118, [24, 1592 - 99 * i]];
      bits
        .code(length, 2 ** length - code)
        .put([24, 37 * i], extra)
        .distance(last);
      out.copyWithin(at, 0, base + extra[1]);
      at += base + extra[1];
    }
    return [bits.finish(), at];
  }
  const [stream, end] = write(write(1 << 17)[1] - 40);
  expect(decodeInPieces(stream, [stream.length, 1], 1 << 18)).toEqual(Array(2).fill(digest(out.subarray(0, end))));

  function withHighestBit(insert, copy) {
    const bits = windowOf(16).plainLastHeader(22594 + 2118);
    bits.simpleCode(8, 97).complexCode(lengths).simpleCode(6, 0);
    bits.code(length, 2 ** length - 1).put([24, insert << 23], [24, copy << 23]);
    const result = decompress(bits.finish());
    return result.code ?? digest(result);
  }
  expect([withHighestBit(0, 0), withHighestBit(1, 0), withHighestBit(0, 1)]).toEqual([
    digest(Buffer.alloc(22594 + 2118, "a")),
    "ERR__ERROR_FORMAT_BLOCK_LENGTH_1",
    "ERR__ERROR_FORMAT_BLOCK_LENGTH_1",
  ]);
});

it.each([
  [0xff0000, 5, [1]],
  [5, 0xff0000, [4096, 1]],
])("decodes a command with lengths of %d and %d in its extra bits", (insert, copy, pieces) => {
  const total = 22594 + insert + 2118 + copy;
  const bits = windowOf(16).plainLastHeader(total).simpleCode(8, 97);
  bits.complexCode([...Array(688).fill(0), ...upTo15]).simpleCode(6, 0);
  const stream = bits.code(15, 0x7fff).put([24, insert], [24, copy]).finish();
  expect(decodeInPieces(stream, pieces, 1 << 20)).toEqual(Array(pieces.length).fill(digest(Buffer.alloc(total, "a"))));
});

it.each([
  [[3, 1, 1], [1], "3294 155c1ee4"],
  [[1, 3, 1], [0], "3299 51017558"],
  [[1, 1, 3], [], "3171 cb48c33e"],
  [[3, 3, 3], [0, 1, 2], "3597 fbeada8b"],
])("switches between %p block types, with contexts in %p", (typeCounts, inContext, expected) => {
  let next = 0;
  const random = (fields, count, value = noise[next++] & (2 ** count - 1)) => (fields.push([count, value]), value);
  /** From 1 to 48. */
  function blockLength(fields) {
    const code = [0, 4, 2, 6, 1, 5, 3, 7][random(fields, 3)];
    return [1, 5, 9, 13, 17, 25, 33, 41][code] + random(fields, code < 4 ? 2 : 3);
  }
  const blocks = typeCounts.map(count => {
    const first = [];
    return { count, first, left: count > 1 ? blockLength(first) : Infinity, types: [0, 1] };
  });
  const body = [];
  function typeOf(block) {
    if (block.left-- === 0) {
      const code = [0, 2, 1, 3][random(body, 2)];
      block.types.unshift([block.types[1], (block.types[0] + 1) % 3, 0, 2][code]);
      block.left = blockLength(body) - 1;
    }
    return block.types[0];
  }
  const commands = type => [8 + type, 66 + 8 * type, 131 + type, 170 - 8 * type];
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const command = commands(typeOf(blocks[1]))[[0, 2, 1, 3][random(body, 2)]];
    total += ((command >> 3) & 7) + (command & 64 ? 14 + random(body, 2) : 2 + (command & 7));
    for (let literals = (command >> 3) & 7; literals--; random(body, 2)) typeOf(blocks[0]);
    if (command >= 128 && (typeOf(blocks[2]), random(body, 2) === 3)) random(body, 3);
  }

  const bits = windowOf(16).uncompressed(noise.subarray(0, 64)).lastHeader(total);
  for (const { count, first } of blocks) {
    if (bits.number(count) && count > 1) bits.simpleCode(3, 0, 1, 2, 4).put([1, 0]).evenCode(8);
    bits.put(...first);
  }
  bits.put([2, 0], [4, 15], ...[0, 2, 3].slice(0, typeCounts[0]).map(mode => [2, mode]));
  for (const [count, contexts, varies] of [
    [typeCounts[0], 64, type => inContext.includes(type)],
    [typeCounts[2], 4, () => true],
  ]) {
    bits.number(4).put([1, 0]).simpleCode(2, 0, 1, 2, 3).put([1, 0]);
    for (let i = 0; i < count * contexts; i++) bits.put([2, varies(i >> 6) ? noise[next++] & 3 : i >> 6]);
    bits.put([1, 0]);
  }
  for (let tree = 0; tree < 4; tree++) bits.simpleCode(8, tree, 32 + tree, 101 + tree, 200 + tree).put([1, 0]);
  for (let type = 0; type < typeCounts[1]; type++) bits.simpleCode(10, ...commands(type)).put([1, 0]);
  for (let tree = 0; tree < 4; tree++) bits.simpleCode(7, tree, 16 + tree, 25 + tree, 35 + (tree & 1)).put([1, 0]);
  expect(decodeInPieces(bits.put(...body).finish(), [4096, 100, 13, 1], 1000)).toEqual(Array(4).fill(expected));
});

it("decodes a literal of 15 bits after a command of 46 bits at each alignment", () => {
  const bits = windowOf(16)
    .uncompressed(noise.subarray(0, 40))
    .plainLastHeader(8 * (194 + 2118));
  bits
    .complexCode(upTo15)
    .complexCode([...Array(640).fill(0), ...upTo15])
    .simpleCode(6, 0);
  for (let i = 0; i < 8; i++) {
    bits.code(15, 2 ** 15 - 1).put([7, 0], [24, 0]);
    bits.code(15, 2 ** 15 - 1).put([3, 3], ...Array(8).fill([24, 0]));
  }
  expect(digest(zlib.brotliDecompressSync(bits.finish()))).toBe("18536 f5819abd");
});

it("decodes a distance of 29 bits after a command of 28 bits at each alignment", () => {
  const bits = windowOf(23)
    .uncompressed(noise.subarray(0, 40))
    .plainLastHeader(2 ** 22 + 8 * (2118 + 71));
  bits.simpleCode(8, 97).complexCode([...Array(384).fill(0), 1, 2, 3, 5, 6, 7, 8, 4, 8]);
  bits.complexCode([...Array(16).fill(0), ...upTo15.slice(0, 7), ...Array(33).fill(0), 8, 8]);
  bits.code(4, 14).put([24, 2 ** 22 - 2118], [2, 0]);
  for (let i = 0; i < 8; i++) {
    bits.code(4, 14).put([24, 0]);
    bits.code(8, 254).put([21, 43 + 2189 * i]);
    bits.code(8, 255).put([5, 0], [3, 1]);
  }
  expect(digest(zlib.brotliDecompressSync(bits.finish()))).toBe("4211856 186c610e");
});

it("has a context mode for each block of a long insert", () => {
  const bits = windowOf(16).uncompressed(noise.subarray(0, 2)).lastHeader(800);
  // Four blocks of 177 + 23 literals.
  bits.number(4).simpleCode(3, 1).simpleCode(5, 14).put([5, 23], [8, 0], [2, 0], [2, 1], [2, 2], [2, 3]);
  bits.number(4).put([1, 0]).simpleCode(2, 0, 1, 2, 3).put([1, 0]);
  for (let context = 0; context < 256; context++) bits.put([2, noise[context] & 3]);
  bits.put([2, 0]);
  for (let tree = 0; tree < 4; tree++) bits.simpleCode(8, tree, 32 + tree, 101 + tree, 200 + tree).put([1, 0]);
  bits
    .simpleCode(10, 472)
    .simpleCode(6, 0)
    .put([9, 800 - 578]);
  for (let i = 0; i < 800; i++) {
    if (i && i % 200 === 0) bits.put([5, 23]);
    bits.put([2, noise[256 + i] & 3]);
  }
  expect(decodeInPieces(bits.finish(), [4096, 1], 1000)).toEqual(Array(2).fill("802 40bce842"));
});

it("decodes more than 64 KiB of short commands after the window is full", () => {
  const input = Buffer.concat([Buffer.alloc(1 << 18), noise, noise.toReversed()]);
  for (let at = 0; at < input.length; at += 64) input.fill(0, at, at + 12);
  expect(roundTrip(input, { [QUALITY]: 1, [LGWIN]: 18 })).toBe("110437 e35598cb");
});

it.each([
  [2 ** 18 + 10, "466374 51782f07"],
  // The literals start 6 bytes after the output reaches 2 ** 18 bytes.
  [2 ** 18 - 134114, "332250 f6819f8d"],
])("takes steps of more than 64 KiB after %d stored bytes", (size, expected) => {
  const stored = Buffer.alloc(size, noise);
  const header = windowOf(18)
    .put([3, 2], [20, stored.length - 1], [1, 1])
    .finish();
  const bits = new Bits().lastHeader(2119 + 66001 + 66000 + 70100);
  // A block of 70002 literals of eight bits, and then one that has only "z".
  bits
    .number(2)
    .simpleCode(2, 1)
    .simpleCode(5, 25)
    .put([24, 70002 - 16625], [12, 0]);
  bits.number(2).put([5, 9]).simpleCode(3, 5, 0, 6);
  for (const code of [2, 3]) bits.code(2, code).put([1, 0], [5, 31]);
  bits.put([1, 1], [1, 0]).complexCode(Array(256).fill(8)).simpleCode(8, 122);
  bits.simpleCode(10, 391, 399, 504).sixBitCode();
  for (const [insert, copy, distance] of [
    [1, 2118, 1],
    [1, 66000, 1],
    [0, 66000, 100000],
  ]) {
    bits
      .code(1 + insert, 2 * insert)
      .put([24, copy - 2118], [8 * insert, 70 * insert])
      .distance(distance);
  }
  bits.code(2, 3).put([24, 70100 - 22594]);
  const stream = Buffer.concat([header, stored, bits.finish(), stored.subarray(0, 69999), Buffer.alloc(4)]);
  const [whole, inPieces] = decodeInPieces(stream, [stream.length, 4096], 1 << 19);
  expect(inPieces).toBe(whole);
  expect(whole).toBe(expected);
});

it("switches blocks with up to 54 bits", () => {
  const total = 81 + 16 * (113 + 16625);
  const bits = windowOf(16).lastHeader(total).number(16).complexCode(upTo15);
  bits.complexCode([...Array(10).fill(0), ...upTo15]).put([5, 0], [8, 0], [16, 0], [16, 0]);
  // The types take turns with two trees.
  bits.number(2).put([5, 9]).simpleCode(3, 5, 0, 6);
  for (let type = 0; type < 16; type++) bits.code(2, type ? 3 : 2).put([1, 0], [5, 31]);
  bits.put([1, 1], [1, 0]).simpleCode(8, 97).simpleCode(8, 98).simpleCode(10, 504).simpleCode(6, 0);
  bits.put([24, total - 22594]);
  const blocks = [Buffer.alloc(81, "a")];
  for (let symbol = 0; symbol < 16; symbol++) {
    bits
      .code(upTo15[symbol], 2 ** upTo15[symbol] - (symbol < 15 ? 2 : 1))
      .code(3, 6)
      .put([5, 0]);
    bits.code(15, 0x7fff).code(15, 0x7fff).put([24, 0]);
    blocks.push(Buffer.alloc(113, "ab"[([1, 14][symbol] ?? symbol - 2) & 1]), Buffer.alloc(16625, "b"));
  }
  expect(decodeInPieces(bits.finish(), [4096, 24, 1], 1 << 16)).toEqual(Array(3).fill(digest(Buffer.concat(blocks))));
});

it("moves trees of any number to the front", () => {
  const pairs = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7];
  const bits = windowOf(16).uncompressed(pairs).lastHeader(24).put([11, 0]).number(130);
  bits.put([1, 0]).simpleCode(8, 0, 1, 2, 129).put([1, 0]);
  for (const code of [3, 1, 1, 3, 2, 1, 2, ...Array(57).fill(0)]) bits.code(2, code);
  bits.put([1, 1], [1, 0]);
  for (let tree = 0; tree < 130; tree++) bits.simpleCode(8, tree);
  bits.simpleCode(10, 128, 136).simpleCode(6, 5, 20).put([1, 0], [1, 1], [3, 3], [14, 0x1555], [1, 1]);
  const literals = zlib.brotliDecompressSync(bits.finish()).filter((_, i) => i > 16 && i % 3 === 0);
  expect([...literals]).toEqual([129, 0, 129, 128, 0, 128, 129, 129]);
});

it("has room for many long codes in each tree", () => {
  const bits = windowOf(16).lastHeader(4).put([1, 0]).number(4).simpleCode(3, 1).simpleCode(5, 0).put([13, 0]);
  bits.complexCode([1, 2, 3, 4, 5, 6, 8, 9, 9, ...Array(63).fill(14), ...Array(130).fill(15)]);
  for (let type = 0; type < 4; type++) bits.fixedCommandCode();
  bits.sixBitCode().code(9, 32).code(9, 507).code(14, 16318).code(15, 32638).code(15, 32767);
  expect([...zlib.brotliDecompressSync(bits.finish())]).toEqual([8, 71, 72, 201]);
});

it("makes room for more trees in each meta-block", () => {
  const [bits, expected] = [windowOf(16).uncompressed(noise.subarray(0, 15)), [...noise.subarray(0, 15)]];
  for (const count of [2, 5, 33, 70, 256, 40]) {
    const trees = Array.from({ length: count }, (_, i) => i);
    const isDeep = tree => tree % 8 === 7;
    bits.put([1, 0], [2, 0], [16, trees.reduce((sum, tree) => sum + 2 * (3 + (tree & 7)), -1)], [1, 0]);
    // Blocks of one symbol, each of the next type.
    for (let i = 0; i < 3; i++)
      bits
        .number(count)
        .simpleCode(32 - Math.clz32(count + 1), 1)
        .simpleCode(5, 0)
        .put([2, 0]);
    bits.put([2, 0], [4, 15], ...trees.map(() => [2, 0]));
    // One tree for all contexts of a type.
    for (const runCode of [5, 1]) {
      const symbol = bits
        .number(count)
        .put([5, 2 * runCode - 1])
        .evenCode(count + runCode);
      for (const tree of trees) (symbol(tree && tree + runCode), symbol(runCode).put([runCode, 2 ** runCode - 1]));
      bits.put([1, 1]);
    }
    for (const [symbolBits, skipped, symbol] of [
      [8, 0, tree => tree],
      [10, 128, tree => 136 + (tree & 7)],
      [7, 15, tree => 16 + (tree % 15)],
    ]) {
      for (const tree of trees) {
        if (isDeep(tree)) bits.complexCode([...Array(skipped).fill(0), ...upTo15]);
        else bits.simpleCode(symbolBits, symbol(tree));
      }
    }
    [...trees, ...trees].forEach((tree, i) => {
      for (let kind = 0; kind < 3; kind++) bits.put([i ? 2 : 0, 0], isDeep(tree) ? [15, 0x7fff] : [0, 0]);
      expected.push(isDeep(tree) ? 15 : tree);
      for (let copied = 0; copied < 2 + (tree & 7); copied++)
        expected.push(expected.at(isDeep(tree) ? -15 : -1 - (tree % 15)));
    });
  }
  const stream = bits.put([2, 3]).finish();
  expect(decodeInPieces(stream, [stream.length, 11], 1 << 13)).toEqual(Array(2).fill(digest(Buffer.from(expected))));
});

it.each([
  [1, 1],
  [256, 7],
  [257, 7],
  [65536, 1000],
  [65537, 1000],
])("skips %d bytes of metadata that come %d at a time", (length, piece) => {
  const steps = [
    [FLUSH, text.subarray(0, 50)],
    [METADATA, mixed.subarray(0, length)],
    [FINISH, text.subarray(50, 100)],
  ];
  const compressed = drive(zlib.createBrotliCompress(), steps, 1 << 17);
  const pieces = Array.from(window(compressed, piece), chunk => [PROCESS, chunk]);
  expect(drive(zlib.createBrotliDecompress(), pieces, 1024)).toEqual(text.subarray(0, 100));
});

const allowingLarge = { params: { [DECODER_LARGE_WINDOW]: 1 } };

it.each([
  ["16 bits", windowOf(16), 6, "b"],
  ["17 bits", windowOf(17), 6, "b"],
  ["a large window of 10 bits", largeWindowOf(10), 8, "b"],
  ["a large window of 30 bits", largeWindowOf(30), 8, "b"],
  ["a large window of 9 bits", largeWindowOf(9), 8, "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["a large window of 31 bits", largeWindowOf(31), 8, "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["the reserved bit", largeWindowOf(10, 1), 8, "ERR__ERROR_FORMAT_WINDOW_BITS"],
])("reads a header with %s if large windows are allowed", (_, bits, distanceBits, expected) => {
  bits.plainLastHeader(1).simpleCode(8, 97, 98).simpleCode(10, 8).simpleCode(distanceBits, 0).put([1, 1]);
  const answer = drive(zlib.createBrotliDecompress(allowingLarge), [[FINISH, bits.finish()]], 64);
  expect(answer.code ?? answer.toString()).toBe(expected);
});

it("refuses a large window if told to", () => {
  const engine = zlib.createBrotliDecompress({ params: { [DECODER_LARGE_WINDOW]: 0 } });
  const stream = largeWindowOf(10).put([2, 3]).finish();
  expect(drive(engine, [[FINISH, stream]], 64).code).toBe("ERR__ERROR_FORMAT_WINDOW_BITS");
});

it.each([
  ["a large window", largeWindowOf(20).put([2, 3]), 0],
  ["metadata", windowOf(22).put([2, 1], [2, 3], [3, 0]), 0],
  ["5 stored bytes", windowOf(10).put([3, 0], [16, 4], [1, 1]), 5],
  ["65537 stored bytes", windowOf(16).put([1, 0], [2, 1], [20, 65536], [1, 1]), 65537],
])("waits for the last bits of the header of %s", (_, header, length) => {
  const rest = length ? [Buffer.alloc(length), Buffer.of(3)] : [];
  const steps = [...window(header.finish(), 1), ...rest].map(chunk => [PROCESS, chunk]);
  const answer = drive(zlib.createBrotliDecompress(allowingLarge), [...steps, [FINISH, Buffer.alloc(0)]], 1 << 17);
  expect(answer).toEqual(Buffer.alloc(length));
});

it.each([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])("finds the words behind a window of %d bits", size => {
  for (const bits of [windowOf(size), largeWindowOf(size)]) {
    const filled = 3000 + 2 ** size;
    bits
      .uncompressed([97])
      .plainLastHeader(filled + 8)
      .fixedCodes()
      .copy(filled)
      .distance(1);
    bits
      .copy(4)
      .distance(2 ** size - 16)
      .copy(4)
      .distance(2 ** size - 15);
    expect(zlib.brotliDecompressSync(bits.finish(), allowingLarge).latin1Slice(filled)).toBe("aaaaatime");
  }
});

it.each([7, 1024, 8192])("copies from the dictionary across the end of the window into %d bytes", room => {
  const [dictionary, head] = [noise.subarray(0, 3000), text.subarray(0, 1000)];
  const bits = windowOf(10)
    .uncompressed(head)
    .plainLastHeader(24 + 100 + 2500)
    .fixedCodes();
  bits
    .copy(24)
    .distance(1000 + 50)
    .copy(100)
    .distance(1008 + 100)
    .copy(2500)
    .distance(1008 + 2600);
  const copied = [dictionary.subarray(-50, -26), dictionary.subarray(-100), dictionary.subarray(-2600, -100)];
  const answer = drive(zlib.createBrotliDecompress({ dictionary }), [[FINISH, bits.finish()]], room);
  expect(answer).toEqual(Buffer.concat([head, ...copied]));
});

it.each([1023, 1024, 1025])("ends a meta-block %d bytes into a window of 1024", end => {
  const start = () =>
    windowOf(10)
      .uncompressed(Buffer.alloc(end - 4, "b"))
      .plainLastHeader(4);
  const streams = [
    start()
      .simpleCode(8, 97)
      .simpleCode(10, 4 << 3)
      .simpleCode(6, 0),
    ...[1, 1008 + 4, 1008 + 5].map(distance => start().fixedCodes().copy(4).distance(distance)),
  ];
  const decode = bits => zlib.brotliDecompressSync(bits.finish(), { dictionary: Buffer.from("cdef") });
  expect(streams.map(bits => decode(bits).latin1Slice(end - 5))).toEqual(["baaaa", "bbbbb", "bcdef", "btime"]);
});

it("ends a meta-block with the longest that a word can get", () => {
  const stored = text.subarray(0, 40);
  const bits = windowOf(16).uncompressed(stored).plainHeader(37).fixedCodes();
  bits.copy(24).distance(41 + (73 << 5));
  expect(zlib.brotliDecompressSync(bits.uncompressed(stored).put([2, 3]).finish()).toString()).toBe(
    `${stored} the <script type="text/javas of the ${stored}`,
  );
});

it.each([
  [16, 0, 480, [10, 0], "ERR__ERROR_FORMAT_BLOCK_LENGTH_1"],
  [16, 1, 480, [10, 0], "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  [18, 1, 504, [24, 50000], "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
])("notices too many literals in a window of %d bits, allocated up front: %d", (size, whole, command, extra, code) => {
  const bits = windowOf(size).plainLastHeader(1).simpleCode(8, 0).simpleCode(10, command).simpleCode(6, 0);
  const engine = zlib.createBrotliDecompress({ params: { [DECODER_WHOLE_WINDOW]: whole } });
  expect(drive(engine, [[FINISH, bits.put(extra).finish()]], 64).code).toBe(code);
});

it.each([undefined, text])("takes two zeros for the context of the first literal", dictionary => {
  const bits = windowOf(10).lastHeader(1090).put([9, 0], [2, 3], [4, 1], [1, 0]).simpleCode(1, 0, 1);
  bits
    .put([16, 2 ** 16 - 2], [24, 2 ** 24 - 1], [24, 2 ** 24 - 1], [2, 0])
    .simpleCode(8, 0)
    .simpleCode(8, 65);
  bits.simpleCode(10, 480).simpleCode(6, 0).put([10, 0]);
  expect(zlib.brotliDecompressSync(bits.finish(), { dictionary })).toEqual(Buffer.alloc(1090));
});

it("reads on without room for output until the window is full", () => {
  const bits = windowOf(12).uncompressed(noise.subarray(0, 1000));
  for (const length of [24, 3072]) bits.plainHeader(length).fixedCodes().copy(length).distance(1);
  const stream = bits.uncompressed(noise.subarray(0, 100)).put([2, 3]).finish();
  const engine = zlib.createBrotliDecompress();
  engine._handle.writeSync(PROCESS, stream, 0, stream.length, Buffer.alloc(8), 0, 8);
  expect([...engine._writeState]).toEqual([0, 103]);
  engine.close();
});

it.each([4080 + 4, 4080 + 5])("stops reading where a copy from %d bytes back fills the window", distance => {
  const bits = windowOf(12).uncompressed([97]).plainLastHeader(4195).fixedCodes();
  bits.copy(4091).distance(1).copy(4).distance(distance);
  const used = bits.bytes.length + (bits.count > 0);
  const stream = bits.copy(100).distance(1).finish();
  const engine = zlib.createBrotliDecompress({ dictionary: Buffer.from("cdef") });
  engine._handle.writeSync(PROCESS, stream, 0, stream.length, Buffer.alloc(8), 0, 8);
  expect([...engine._writeState]).toEqual([0, stream.length - used]);
  engine.close();
});

it("limits the distance codes of a large window", () => {
  function countCodes(postfix, direct) {
    const symbolBits = 32 - Math.clz32(15 + ((direct + 124) << postfix));
    let count = 0;
    for (let step = 1 << (symbolBits - 1); step; step >>= 1) {
      const bits = largeWindowOf(10).lastHeader(1).put([3, 0], [2, postfix], [4, direct], [4, 0]);
      bits
        .simpleCode(8, 97, 98)
        .simpleCode(10, 8)
        .simpleCode(symbolBits, count + step - 1)
        .put([1, 1]);
      const answer = drive(bare(DECODE, allowingLarge.params), [[FINISH, bits.finish()]], 64);
      if (answer.toString() === "b") count += step;
    }
    return count;
  }
  expect([0, 1, 2, 3].map(postfix => [0, 1, 15].map(direct => countCodes(postfix, direct)).join())).toEqual([
    "74,74,88",
    "128,130,156",
    "232,236,288",
    "432,440,544",
  ]);
});

it("takes the longest distance of a large window for a word", () => {
  const bits = largeWindowOf(10).plainLastHeader(4).simpleCode(8, 0).simpleCode(10, 130).simpleCode(8, 73);
  const steps = [[FINISH, bits.put([24, 2 ** 24 - 1], [5, 31]).finish()]];
  expect(drive(zlib.createBrotliDecompress(allowingLarge), steps, 64).code).toBe("ERR__ERROR_FORMAT_TRANSFORM");
});

it("repeats its error", () => {
  const [engine, out, errors] = [zlib.createBrotliDecompress(), Buffer.alloc(64), []];
  engine._handle.onerror = (_, errno) => errors.push(errno);
  for (const bits of [windowOf(16).put([20, 1 << 19], [3, 7]), new Bits().uncompressed([97])]) {
    const input = bits.finish();
    engine._handle.writeSync(PROCESS, input, 0, input.length, out, 0, out.length);
  }
  expect({ errors, out }).toEqual({ errors: [-14, -14], out: Buffer.alloc(64) });
});

it("reads a length of metadata that ends with a byte", () => {
  const bits = windowOf(16).plainHeader(4).simpleCode(8, 65, 66).simpleCode(10, 32).simpleCode(6, 0).put([4, 10]);
  expect(bits.put([1, 0], [2, 3], [1, 0], [2, 1], [8, 2]).count).toBe(0);
  expect(zlib.brotliDecompressSync(bits.put([24, 0xffffff], [2, 3]).finish()).toString()).toBe("ABAB");
});

it("copies right after stored bytes filled the window", () => {
  const stored = noise.subarray(0, 1024);
  const bits = windowOf(10).uncompressed(stored).plainLastHeader(4).fixedCodes().copy(4).distance(9);
  expect(zlib.brotliDecompressSync(bits.finish())).toEqual(Buffer.concat([stored, stored.subarray(-9, -5)]));
});

it("accepts metadata as the last meta-block", () => {
  const bits = windowOf(16).uncompressed([97]).put([2, 1], [2, 3], [1, 0], [2, 1], [8, 1]).align();
  expect(zlib.brotliDecompressSync(bits.put([16, 0xffff]).finish()).toString()).toBe("a");
});

it("has an answer for flipped bits", () => {
  // From google/brotli, like the answers.
  const stream = Buffer.from(
    "Gz8GAK4KbLcEkR0UzY5srj7bDZ6nUy3jC73MXb0IHWD3pjJfUOo2dpZTxOvqBq1+FUBCk6HV2S3MzwYVTExt/51JHCDc2ZlcNy3lBYOhYn+p" +
      "WO4NGNBeBliV8Jp1SjO/gBXKTJzxRxR4Yq3N+svV5fvG4Pndtk0Y4N9WYmL6vdjg3kLqGBdABqSy0wpLtOrLFQsAXNvXVJCsxohOT8tpu/54" +
      "b8E03dtTiVSCdqrnFnMe/iABkmg0ywIhl3I/wPi5CULUDsp6AuwN9E//fi+ptdhzMp6WGmGErfyFoe5m9Y/TbmQlpLytvxUqYcEqnL6QAz8q" +
      "jqCebLfkAr53Gk7g0JNEBC+EUDlfaYxFZjPPJraMBUpmFLBdKlGLgJ0VZtzLZbnCx0ZylGHBtORjZqSEni03xZONQOIemnvCBxFCDQlw2lkz" +
      "Gg/eAak5j4Htb5MWILESo63z1AA=",
    "base64",
  );
  const [out, answers] = [Buffer.alloc(4096), []];
  for (let bit = 0; bit < stream.length * 8; bit += bit < 1200 ? 1 : 3) {
    const { _handle: handle, _writeState: state } = bare(DECODE);
    let answer;
    handle.onerror = (_, errno) => (answer = errno);
    stream[bit >> 3] ^= 1 << (bit & 7);
    handle.writeSync(FINISH, stream, 0, stream.length, out, 0, out.length);
    stream[bit >> 3] ^= 1 << (bit & 7);
    handle.close();
    answers.push(answer ?? `${state[1]},${zlib.crc32(out.subarray(0, out.length - state[0]))}`);
  }
  expect(digest(Buffer.from(answers.join()))).toBe("10228 e9269d46");
});

const zeroLengths = count => Array(count).fill([2, 0]);

it.each([
  ["FORMAT_EXUBERANT_NIBBLE", -1, windowOf(16).put([1, 0], [2, 1], [20, 0xffff])],
  ["FORMAT_EXUBERANT_NIBBLE", -1, windowOf(16).put([1, 0], [2, 2], [24, 0xfffff])],
  ["FORMAT_RESERVED", -2, windowOf(16).put([1, 0], [2, 3], [1, 1])],
  ["FORMAT_EXUBERANT_META_NIBBLE", -3, windowOf(16).put([1, 0], [2, 3], [1, 0], [2, 2], [16, 0xff])],
  ["FORMAT_EXUBERANT_META_NIBBLE", -3, windowOf(16).put([1, 0], [2, 3], [1, 0], [2, 2], [16, 1])],
  ["FORMAT_SIMPLE_HUFFMAN_ALPHABET", -4, windowOf(16).plainLastHeader(1).simpleCode(8, 0).simpleCode(10, 704)],
  ["FORMAT_SIMPLE_HUFFMAN_SAME", -5, windowOf(16).plainLastHeader(1).simpleCode(8, 7, 7)],
  [
    "FORMAT_CL_SPACE",
    -6,
    windowOf(16)
      .plainLastHeader(1)
      .put([2, 0], [3, 3], [3, 3], ...zeroLengths(16)),
  ],
  [
    "FORMAT_HUFFMAN_SPACE",
    -7,
    windowOf(16)
      .plainLastHeader(1)
      .put([2, 0], ...zeroLengths(11), [4, 7], ...zeroLengths(6)),
  ],
  [
    "FORMAT_HUFFMAN_SPACE",
    -7,
    windowOf(16)
      .plainLastHeader(1)
      .put([2, 0], ...zeroLengths(4), [4, 7], ...zeroLengths(3), [4, 7], [1, 0], [3, 5], [3, 5], [3, 5], [3, 3]),
  ],
  [
    "FORMAT_CONTEXT_MAP_REPEAT",
    -8,
    windowOf(16).lastHeader(1).put([11, 0], [4, 1], [5, 11]).simpleCode(3, 6).put([6, 1]),
  ],
  [
    "FORMAT_BLOCK_LENGTH_1",
    -9,
    windowOf(10).plainLastHeader(1).simpleCode(8, 0).simpleCode(10, 488).simpleCode(6, 0).put([12, 0]),
  ],
  [
    "FORMAT_BLOCK_LENGTH_1",
    -9,
    windowOf(16).plainLastHeader(1).simpleCode(8, 0, 1).simpleCode(10, 488).simpleCode(6, 0).put([12, 0]),
  ],
  ["FORMAT_BLOCK_LENGTH_2", -10, windowOf(16).plainLastHeader(1).simpleCode(8, 0).simpleCode(10, 16).simpleCode(6, 0)],
  [
    "FORMAT_TRANSFORM",
    -11,
    windowOf(16)
      .plainLastHeader(4)
      .fixedCodes()
      .copy(4)
      .distance(5 + (121 << 10)),
  ],
  ["FORMAT_DICTIONARY", -12, windowOf(16).plainLastHeader(3).fixedCodes().copy(3).distance(5)],
  ["FORMAT_WINDOW_BITS", -13, windowOf(9)],
  ["FORMAT_PADDING_1", -14, windowOf(16).put([1, 0], [2, 0], [16, 0], [1, 1], [1, 1])],
  ["FORMAT_PADDING_2", -15, windowOf(16).put([2, 3], [1, 1])],
  [
    "FORMAT_DISTANCE",
    -16,
    windowOf(16).uncompressed([0]).plainLastHeader(9).fixedCodes().copy(2).distance(1).copy(2).code(6, 4),
  ],
  [
    "FORMAT_DISTANCE",
    -16,
    windowOf(16).uncompressed([0, 0]).plainLastHeader(9).fixedCodes().copy(2).distance(1).copy(2).code(6, 8),
  ],
  ["COMPOUND_DICTIONARY", -18, windowOf(16).plainLastHeader(5).fixedCodes().copy(5).distance(4)],
])("fails with ERR__ERROR_%s (%#)", (name, errno, bits) => {
  const expected = { message: "Decompression failed", errno, code: `ERR__ERROR_${name}` };
  const stream = Buffer.concat([bits.finish(), Buffer.alloc(40)]);
  for (const steps of [[[FINISH, stream]], Array.from(window(stream, 1), chunk => [PROCESS, chunk])]) {
    expect(drive(zlib.createBrotliDecompress({ dictionary: Buffer.from("abcd") }), steps, 4096)).toEqual(expected);
  }
});

describe.each([10, 11])("quality %d", quality => {
  const size = (input, params = {}) => parseInt(roundTrip(input, { [QUALITY]: quality, ...params }));

  it("does not depend on what was compressed before", () => {
    const input = text.subarray(0, 3000);
    const answers = [Buffer.alloc(0), input, noise, mixed, text.subarray(1, 900), samples].map(before => {
      roundTrip(before, { [QUALITY]: 21 - quality });
      return roundTrip(input, { [QUALITY]: quality });
    });
    expect(new Set(answers).size).toBe(1);
  });

  it("does not depend on it after a long copy among few kinds of bytes", () => {
    const part = (start, length, first, kinds) => bytesOf(length, i => first + (noise[start + i] % kinds));
    for (let i = 0; i < 40; i++) {
      const parts = [part(i, 1400 + 7 * i, 32, 40), part(0, 60 + 5 * i, 97, 16), Buffer.alloc(330 + 7 * i, "z")];
      const input = Buffer.concat([...parts, part(9000, 900, 32, 40)]);
      const answers = [noise, text].map(before => {
        roundTrip(before.subarray(0, 5000), { [QUALITY]: quality });
        return roundTrip(input, { [QUALITY]: quality });
      });
      expect(answers[1]).toBe(answers[0]);
    }
  });

  it("finds the middle of long copies after their source has left the window", () => {
    let version = noise.subarray(0, 20000);
    const versions = Array.from({ length: 20 }, (_, i) => {
      const at = 900 * i + 500;
      const added = noise.subarray(30000 + 40 * i, 30040 + 40 * i);
      return (version = Buffer.concat([version.subarray(0, at), added, version.subarray(at + 7)]));
    });
    expect(size(Buffer.concat(versions), { [LGWIN]: 16 })).toBeLessThan(21200);
  });

  it("keeps a few other bytes out of a code for two", () => {
    const bits = bytesOf(40000, i => noise[i] & 1);
    expect(size(Buffer.concat([bits, Buffer.from("stray!")]))).toBeLessThan(5100);
  });

  it("compresses what only looks random as a whole", () => {
    expect(size(bytesOf(60000, i => (i >> 8) + (noise[i] % 24)))).toBeLessThan(45000);
  });

  it("finds the repetition of a repetition", () => {
    const period = Buffer.alloc(695, noise.subarray(0, 28));
    expect(size(Buffer.alloc(30000, period))).toBeLessThan(70);
  });
});

describe.each([2, 3, 4, 5, 6, 7, 8, 9])("quality %d", quality => {
  const size = input => parseInt(roundTrip(input, { [QUALITY]: quality }));
  const random = createCipheriv("aes-128-ctr", Buffer.alloc(16, 3), Buffer.alloc(16)).update(Buffer.alloc(240000));
  const repeated = (width, times, kinds = 256, first = 0) =>
    bytesOf(240000, i => first + (random[Math.floor(i / (width * times)) * width + (i % width)] % kinds));
  const prefixes = {
    nothing: Buffer.alloc(0),
    noise: noise.subarray(0, 9000),
    letters: bytesOf(9000, i => 97 + (noise[i] & 3)),
    text: text.subarray(0, 9000),
  };
  const kinds = [
    ["four bytes twice", repeated(4, 2), 136000],
    ["two bytes seven times", repeated(2, 7), 50000],
    ["five printable bytes twice", repeated(5, 2, 90, 33), 114000],
    [
      "words of four bytes",
      bytesOf(240000, i => (i % 5 ? noise[4 * (random[i - (i % 5) + 1] % 100) + (i % 5)] : random[i])),
      146000,
    ],
    ["a counter", Buffer.from(Uint32Array.from({ length: 60000 }, (_, i) => i).buffer), quality < 5 ? 152000 : 45000],
  ];

  it.each(kinds)("finds the short copies in %s, whatever is before", (_, data, most) => {
    const large = Object.entries(prefixes).filter(([, prefix]) => size(Buffer.concat([prefix, data])) >= most);
    expect(large.map(([name]) => name)).toEqual([]);
  });
});

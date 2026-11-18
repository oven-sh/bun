// Unless a comment says otherwise, the digests are of what google/brotli 1.2 writes, so they are never to be updated.
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
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,20 0d83f0a8,21 638e8cfe,68 a377100b,203 ea75fdcc,563 7f4192dd,1258 813afecc",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,20 0d83f0a8,21 638e8cfe,68 a377100b,192 a11e6bac,586 6f323566,1252 2213e656",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,20 0d83f0a8,21 638e8cfe,68 a377100b,169 22807ec7,532 1ad07bd2,1217 45cd25e7",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,14 e72d9d9d,18 344be1e0,60 45553a72,133 57ecb59f,463 34df1f1f,1147 de847d39",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,14 bfcf9a2a,15 0151a062,60 2378b17d,120 9669d39c,417 fd853810,1029 5eff65f7",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,14 bfcf9a2a,15 0151a062,60 2378b17d,120 9669d39c,417 fd853810,1029 5eff65f7",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,14 bfcf9a2a,15 0151a062,64 9bcccc8d,125 99ae1572,423 f7856dcc,1030 e00484ec",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,14 bfcf9a2a,15 0151a062,64 9bcccc8d,125 99ae1572,423 f7856dcc,1030 e00484ec",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,19 37882ea1,14 bfcf9a2a,15 0151a062,64 9bcccc8d,125 99ae1572,423 f7856dcc,1030 f211206f",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 0cf2e110,14 9341d523,18 5798879d,62 98bcc005,138 c5a0f513,418 f8b3ad88,1010 e2b92a0c",
    "1 630906a9,5 0f938b84,6 9ac8a024,7 086a4429,8 e1a03a32,15 0cf2e110,14 9341d523,18 5798879d,62 98bcc005,138 6f44a6fe,403 c9e76c07,966 04f0d9e9",
  ]);
});

it("compresses with the default window", () => {
  expect(qualities.map(quality => roundTrip(mixed, { [QUALITY]: quality }))).toEqual([
    "31280 af6a4de2",
    "28640 364f5962",
    "27376 42893bef",
    "27386 5b5ee8f9",
    "26008 908c11ee",
    "25710 57141f65",
    "25455 13baa67c",
    "25197 e68f0263",
    "25129 66e9728f",
    "25051 dc4ea02e",
    "23433 1427ab98",
    "23277 11ae21b0",
  ]);
});

it("compresses with a window of 10 bits", () => {
  expect(qualities.map(quality => roundTrip(mixed, { [QUALITY]: quality, [LGWIN]: 10 }))).toEqual([
    "55231 fc71d46d",
    "50361 05adb89d",
    "38117 5d650089",
    "38046 4b7e42ec",
    "36416 248a04c3",
    "34696 1e516991",
    "34696 1e516991",
    "34831 4abde730",
    "34831 4abde730",
    "34866 be5586c1",
    "32447 4d2f5adf",
    "31896 2c201660",
  ]);
});

it("stores what does not compress", () => {
  expect(qualities.map(quality => roundTrip(noise, { [QUALITY]: quality }))).toEqual([
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
    "65540 64d0bad2",
  ]);
});

it("compresses with the hint of a large input", () => {
  const params = quality => ({ [QUALITY]: quality, [SIZE_HINT]: 1 << 20 });
  expect([4, 5, 6, 7, 9].map(quality => roundTrip(mixed, params(quality)))).toEqual([
    "27177 0504fffc",
    "28502 50fd6c5b",
    "28321 3e4fd6b9",
    "28079 b32316d6",
    "27921 03540c11",
  ]);
});

it("compresses with a large window", () => {
  const params = quality => ({ [QUALITY]: quality, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: 25 });
  expect([2, 3, 4, 5, 6, 9, 10].map(quality => roundTrip(mixed, params(quality)))).toEqual([
    "27376 5f478bae",
    "27387 0899932c",
    "27179 58ddf1be",
    "28503 9191c487",
    "28322 0de4657d",
    "27923 ab893317",
    "23434 5e2facf8",
  ]);
});

it("compresses with a dictionary", () => {
  const [dictionary, input] = [text.subarray(0, 15000), mixed.subarray(10000, 45000)];
  expect(qualities.map(quality => roundTrip(input, { [QUALITY]: quality }, dictionary))).toEqual([
    "18168 26faaac6",
    "17488 2de29d71",
    "16537 16ef46aa",
    "16558 fba79c4c",
    "16047 1edfd8f4",
    "13606 4b90028c",
    "13531 eb6bc1b6",
    "14057 49e64e92",
    "14056 bf27f352",
    "14052 7c3de2d1",
    "13326 035b080d",
    "13240 b65855fc",
  ]);
});

it("compresses with a dictionary of more than 64 KiB", () => {
  const dictionary = Buffer.concat([noise, text, samples]);
  const input = Buffer.concat(Array.from(window(dictionary, 2500), part => part.subarray(0, 40)));
  expect([5, 9, 11].map(quality => roundTrip(input, { [QUALITY]: quality }, dictionary))).toEqual([
    "151 d3cce7d8",
    "151 d3cce7d8",
    "148 bdba310a",
  ]);
});

it("copies all of a dictionary that is longer than a block of input", () => {
  const dictionary = Buffer.concat([noise, bytesOf(40000, i => ~noise[i])]);
  const answers = [5, 9, 10].map(quality => roundTrip(dictionary, { [QUALITY]: quality, [LGWIN]: 16 }, dictionary));
  expect(answers).toEqual(["15 0f141423", "15 0f141423", "15 91372644"]);
});

it("compresses about 2 and 4 KiB", () => {
  const answers = [2047, 2048, 2049, 4095, 4096, 4097].map(length =>
    [2, 3, 4].map(quality => roundTrip(text.subarray(0, length), { [QUALITY]: quality })).join(),
  );
  expect(answers).toEqual([
    "923 99dc8a57,884 0cfb4011,815 3bb0fd1f",
    "922 c1ee5295,884 f8c94da1,814 c1539c38",
    "922 57d90c74,884 4ecc2954,814 7bef9b58",
    "1591 2669b27d,1568 874b0df4,1499 1ddad14c",
    "1592 86aacd98,1569 4ffa73a0,1499 d787c166",
    "1587 108b07f5,1564 5dea45ad,1495 b2669815",
  ]);
});

it("tells neighbors with similar hashes apart in a short input at quality 2", () => {
  const input = Buffer.concat([noise.subarray(689, 698), noise.subarray(690, 698), Buffer.alloc(47)]);
  expect(roundTrip(input, { [QUALITY]: 2 })).toBe("45 498a8a7a");
});

it("tells hashes that differ in the last bit apart in about 512 and 1024 bytes at quality 2", () => {
  const parts = [noise.subarray(161, 171), noise.subarray(250, 258), noise.subarray(163, 171), Buffer.alloc(1000)];
  const inputs = [512, 513, 1024, 1025].map(length => Buffer.concat(parts, length));
  expect(roundTrips(inputs, { [QUALITY]: 2 })).toBe("256 9a48e897");
});

it.each([
  [64, "448 bf7284df"],
  [65, "446 0fdf172d"],
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
  [{ [QUALITY]: 2 }, "c3c2c4c4c4c2c4c3c2c2c4c4c4c2c4c3c2c2c4", "23 8b883bc2"],
  [{ [QUALITY]: 2 }, "0000000000000000000064000000000000000000", "24 10eb13ea"],
  [{ [QUALITY]: 2 }, "656363656363656365636365", "16 37b62bb3"],
  [{ [QUALITY]: 2 }, "20207363726f6c6c696e673d226e6f2220", "20 8c708632"],
  [
    { [QUALITY]: 3 },
    "b2529ab29aaf5252b25252b2af529ab25252af52af529ab29a9aaf529aaf9aaf529ab2b2b29aaf529aafb29ab252",
    "25 ee80226e",
  ],
  [
    { [QUALITY]: 4 },
    "00010000000000000000000000000000000000000000000000000000000000000001000000ff000001000000000000",
    "17 d01775f0",
  ],
  [{ [QUALITY]: 5 }, "00000000000000000000000000283d0000000000", "15 47be563f"],
  [{ [QUALITY]: 5, [SIZE_HINT]: 1 << 20 }, "ffffffffff213fffffffffff00000000", "14 6a7355d2"],
  [{ [QUALITY]: 9, [LGWIN]: 10 }, "000000ffe7ffffffffff000000ff0000ffffffffffff", "22 f501c9a7"],
  [{ [QUALITY]: 11, [NO_CONTEXTS]: 0 }, "6567742d686f6f6b732d6c69737429207c207c0a0a652074657374", "31 73ed628f"],
  [{ [QUALITY]: 3 }, "7c4f00000000000000555527000000000000000000", "20 f318d844"],
  [{ [QUALITY]: 11 }, "adad350c340c0c340d34a60e34356f3488adad0cadadadadadadadadadad34ada734ad34", "31 9b0c354a"],
  [{ [QUALITY]: 11 }, "6a177c7c7c7c7c7c0b0b0b0b6a6a6a0b0b6a0b6a6a6a6a6a6a6a0b", "24 950aa4c3"],
  [{ [QUALITY]: 11 }, "00000000000000000000000000000000000000190000000000000000000000000019", "14 27e113d4"],
  [{ [QUALITY]: 11 }, "a5dbf44060006040a54060404060e04060604040e0009f40e0e00000000000000000", "33 f83bc92c"],
  [
    { [QUALITY]: 11 },
    "020202020202020202020202020202018a020202020202020202024500018a020202020202020202024500018a",
    "25 99a76119",
  ],
  [
    { [QUALITY]: 11 },
    "111100424211002111110042424211002110444b10444b10211044444b1042110010421100421100bf544211116fbf1111a5a5",
    "50 0a63cc4c",
  ],
  [
    { [QUALITY]: 11 },
    "161c16161c1629391c16169eb19e5c399e5c399e29295c399e29295c399e5c399e5c299e5c399e5c39689e5c3939399e5c292929392929292a62298a29292939",
    "65 ec545c4b",
  ],
  [
    { [QUALITY]: 7, [SIZE_HINT]: 1 << 20 },
    "6162636465666768696a6b6c6d6162636465ffffffffff515758ffffffffff00000000",
    "33 370c8a12",
  ],
  [
    { [QUALITY]: 6 },
    "636794ed6794ed6c0064636363616562626264656268666763666167636361666165616565686864686364676864636363616562626264656268666763666167",
    "47 bd5a2daa",
  ],
  [
    { [QUALITY]: 6, [SIZE_HINT]: 1 << 20 },
    "6f6fd66dc7726f6f7072726feb976fb96f6cd1727070701a30706f6f6f0a727272c26c72727272726f306f6f72686f706f707272c76f726f70706cde6c93706f302f70726f64196fb908",
    "64 dfbbdbe4",
  ],
  [
    { [QUALITY]: 7, [SIZE_HINT]: 1 << 20 },
    "f3bacee76239997f3cab7bedc057e3abd7b22b507b2e69e4b2eb9bff76781d5615df38ece521eda0352d6ca8a66ca1c5e3abd7b22b5023bacee76239997f3cab7bedc057e3abd7b22b",
    "77 d9dc05c0",
  ],
  [
    { [QUALITY]: 3, [LGWIN]: 28, [LARGE_WINDOW]: 1 },
    "01010101010101010b9c448f14eae492dc3bd15b813dd6b6dcf1ec16aad550f7bfeee7ebe67ddd31000000000000000000000000000000000b9c448f42eae492f13bd15bf53dd6b635f1ec16f0d550f767eee7ebc87ddd31",
    "92 7b413bd0",
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
      "10016 c9d2cc3f,9779 15b2a6b5",
      "9995 8dc5dc8c,9646 3c820d3b",
      "9954 3c580c99,9554 be67f426",
      "9951 824a7fb6,9582 b5a7e49e",
      "9956 8d5f1c82,9602 8d0b2ea2",
    ]);
  });

  it("may be as long as a block of input", () => {
    expect([7, 8].map(quality => roundTrip(allBases, { [QUALITY]: quality }))).toEqual([
      "19608 84a74f4e",
      "19476 e92c4993",
    ]);
  });

  it("stays without words once they were given up", () => {
    const input = Buffer.concat([noise.subarray(0, 300), bases.subarray(0, 9000), text.subarray(0, 9000)]);
    expect([7, 8, 9].map(quality => roundTrip(input, { [QUALITY]: quality }))).toEqual([
      "6100 644e3a15",
      "6100 644e3a15",
      "6088 a8746804",
    ]);
  });

  it("may have them without matches", () => {
    const records = gap => Array.from(window(alike, 4), (four, i) => [four, noise.subarray(gap * i, gap * (i + 1))]);
    const inputs = [
      Buffer.concat([noise.subarray(0, 1800), ...records(6).flat(), text.subarray(0, 8000)]),
      // Searches end up 17 bytes apart.
      Buffer.concat([...records(13).flat(), text.subarray(0, 8000)]).subarray(15),
    ];
    expect(inputs.map(input => roundTrip(input, { [QUALITY]: 8 }))).toEqual(["6751 8762648d", "7759 6ac1f53b"]);
  });

  it("keeps the last hash apart from the first", () => {
    const last = Buffer.from(Int32Array.of(-0x22b54b95).buffer);
    const input = Buffer.concat([last, alike.subarray(0, 64), Buffer.from("12345"), last, Buffer.alloc(100)]);
    expect(roundTrip(input, { [QUALITY]: 5 })).toBe("103 d6036a47");
  });

  it("goes on looking for matches in what follows", () => {
    // Searches begin to skip bytes shortly before each match.
    const records = Array.from(window(alike, 96), part => [part, part.subarray(-16)]);
    const input = Buffer.concat([...records.flat(), Buffer.alloc(10000)]);
    expect([7, 8].map(quality => roundTrip(input, { [QUALITY]: quality }))).toEqual(Array(2).fill("1312 a585dbc7"));
  });
});

it("compresses runs that end in one of a few values", () => {
  const runs = Buffer.alloc(70000, "f");
  for (let at = 40; at < runs.length; at += 41) runs[at] = noise[at & 0xffff] % 9;
  const inputs = [...Array.from({ length: 41 }, (_, i) => runs.subarray(0, 1000 + i)), runs];
  expect([5, 6, 7, 9].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
    "4342 c39f9c65",
    "4284 d27a50c0",
    "4242 01212015",
    "4079 b17e6a6e",
  ]);
  expect(roundTrips(inputs, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("4044 3fa6e178");
});

it("compresses a short period that now and then gets out of step", () => {
  const parts = [700, 4, 900, 9, 1101, 1, 800, 2, 333, 1, 64].map((length, i) =>
    Buffer.alloc(length, i & 1 ? "\x01" : "xA"),
  );
  const inputs = parts.map((_, i) => Buffer.concat(parts.slice(0, i + 1)));
  inputs.push(Buffer.concat(Array(20).fill(inputs.at(-1))));
  expect([5, 6, 7, 9].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
    "421 d259e3c6",
    "419 a93eea33",
    "417 44ab96bc",
    "409 232a9887",
  ]);
  expect([5, 9].map(quality => roundTrips(inputs, { [QUALITY]: quality, [LGWIN]: 16 }))).toEqual([
    "418 b384f292",
    "415 8fdc16f3",
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
  expect([10, 11].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual(["214 bcf6f7be", "212 849837b5"]);
});

it("compresses about 32 KiB at quality 9", () => {
  const answers = [32767, 32768, 32769].map(length => roundTrip(mixed.subarray(0, length), { [QUALITY]: 9 }));
  expect(answers).toEqual(["9090 5dfd1970", "9091 969466ea", "9091 a2170551"]);
});

it("compresses about 64 KiB", () => {
  const input = Buffer.concat([text, samples, text]);
  const answers = [65535, 65536, 65537].map(length =>
    [5, 6, 7, 9].map(quality => roundTrip(input.subarray(0, length), { [QUALITY]: quality })).join(),
  );
  expect(answers).toEqual([
    "13232 defb0db3,12990 04e511ea,12689 cc00c593,12634 f65eecea",
    "13232 8c9f02f1,12990 f3f42c22,12689 b32b7e1a,12634 003a35ff",
    "13232 60122f35,12990 a31ec9db,12690 c32ab6db,12634 e501a3a5",
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
    "7034b946b5650303,b565030000083103,6503080008313903,0310000831393803",
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
    "block 17": "26012 02d810aa,25197 e68f0263",
    "font": "7192 90527b60,6867 06a17fae,6541 36e487e2",
    "no contexts": "7189 a638e271,6865 8407afb0,6791 760c41f7",
    "postfix 1, direct 3": "7189 a638e271,6865 8407afb0,6537 2fa041b1",
    "postfix 3, direct 120": "7193 c8c03561,6873 02d0fcdc,6576 413a8312",
    "window 17": "7189 bca8261b,6865 625ba800",
    "window 40": "7189 e5d6d89b,6865 5ab83687",
    "window 5": "7287 49bef762,7007 53654a24",
  });
});

it.each([
  [NPOSTFIX, "1272 9526d7e6"],
  [NDIRECT, "1282 ef91b9d8"],
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
  expect(roundTrip(input, { [QUALITY]: 5, [NDIRECT]: 15 })).toBe("2095 b6505fe0");
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
      "120821 4c88cd18",
      "120816 45629e6d",
    ]);
  });

  it("has a hash table for each length of the input", () => {
    const inputs = around(...[8, 9, 10, 11, 12, 13, 14, 15, 16].map(bits => 2 ** bits)).map(length =>
      Buffer.alloc(length, text),
    );
    expect([0, 1].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
      "141168 eecb820e",
      "131793 99b0c7de",
    ]);
  });

  it("closes a gap among 16 or more kinds of literals", () => {
    const inputs = around(15, 27).map(count =>
      Buffer.from(noise.subarray(0, 200).map((byte, i) => (i === 99 ? 0 : 2 + (byte % (count - 1))))),
    );
    expect(roundTrips(inputs, { [QUALITY]: 4 })).toBe("983 67e9329a");
  });

  it("has prefix codes for each number of commands that are alike", () => {
    const record = i => Buffer.concat([noise.subarray(0, 20), unique.subarray(i * 4, i * 4 + 4)]);
    const inputs = around(2, 126, 130).map(length => Buffer.concat(Array.from({ length }, (_, i) => record(i))));
    expect([0, 1, 2, 3, 4].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toEqual([
      "6745 4c165e65",
      "4106 87a2a2a1",
      "4190 5899991c",
      "3453 1bc405c7",
      "3415 b555377a",
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
    [10, 4096, "44025 5e27e5ef"],
    [22, 12287, "136171 4ad653fc"],
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
      "1203 6a9e1cd2",
      "901 c9e21065",
      "889 dd4cff02",
      "876 cf2302ea",
      "876 cf2302ea",
      "876 cf2302ea",
      "876 cf2302ea",
      "876 cf2302ea",
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
      "26093 6664c012",
      "20786 1c44bcc9",
      "13747 ef45309b",
    ]);
  });

  it("has a header for each length of a meta-block", () => {
    const inputs = [...around(2 ** 16, 3 * 2 ** 15, 2 ** 20), 1250000].map(length => Buffer.alloc(length, text));
    const row = quality => inputs.map(input => roundTrip(input, { [QUALITY]: quality })).join();
    expect([0, 5].map(row)).toEqual([
      "10982 dd133af6,10982 ce1036b0,10982 61536006,10982 08c636fc,10976 a16d7472,10976 b785038d,10978 032115e7,10979 5e10c5f4,42184 8f895f98,42184 ed5e4cbc,42350 7927a4c8,42350 39f56438,44238 5794a09d",
      "8989 904b00de,8989 7f096cb0,8990 c02a1b09,8990 307c5fcf,8990 6f603e36,8990 d2fedbfb,8990 fb2f0f40,8990 0b794b86,8990 0c7d27d2,8919 88661a86,8919 9e65b0ff,8919 fbd8096e,8919 b9efbb7f",
    ]);
  });
});

it("ends a meta-block after 32768 commands in a window of 17 bits", () => {
  const input = bytesOf(132000, i => noise[i % 6 < 3 ? i % 894 : 900 + (i % 912)]);
  input.copyWithin(894, 0, 12).copyWithin(932, 20, 32);
  expect(roundTrip(input, { [QUALITY]: 5, [LGWIN]: 17 })).toBe("11869 4bc7b085");
});

it("counts the literals that the last block of input left over at quality 11", () => {
  const input = Buffer.concat([Buffer.alloc(65531), noise.subarray(0, 25), text.subarray(0, 300)]);
  expect(roundTrip(input, { [QUALITY]: 11, [LGWIN]: 16 })).toBe("249 c4919db5");
});

it.each([
  [0, "388 a671d8a1"],
  [1008, "392 09f256cb"],
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
  [[1, 2, 3, 4, 5, 6, 8], "2779 7c6b4b3c"],
  [[8, 10], "1136 51e78bb8"],
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
  expect(roundTrips(inputs, { [QUALITY]: 3 })).toBe("49531 adb616fb");
});

it("extends a copy from a dictionary into the next block of input", () => {
  const input = Buffer.concat([Buffer.alloc(65536 - 20), noise.subarray(0, 40)]);
  expect(roundTrip(input, { [QUALITY]: 5, [LGWIN]: 10 }, noise.subarray(0, 50))).toBe("18 2823d86c");
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
  [1, "a copy that ends after five bytes", [Buffer.alloc(5), Buffer.alloc(200, noise.subarray(0, 20))], "69 9d6df367"],
  [
    2,
    "a word after many literals",
    ["ta", noise.subarray(0, 510), "throughout the", Buffer.alloc(900)],
    "645 ddd57f22",
  ],
  [2, "a long copy after many literals", [noise.subarray(0, 23000), Buffer.alloc(3000)], "23048 42ff4e0c"],
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
    "115900 027ee563",
  ],
  [
    5,
    "better and better matches at the end",
    ["ABCD!", Buffer.alloc(16500), "BCDE!", Buffer.alloc(300), "CDEFABCDEF"],
    "32 ce0b810e",
  ],
  [
    7,
    "the same hash for another start",
    [Buffer.alloc(70000), "aV234567.1323!x132?.........x13234567~~~~~~~~"],
    "51 cb142f73",
  ],
  [
    7,
    "a last distance that leads to a byte less than what is left",
    [Buffer.alloc(70000), "0123qrstu?qrst#", text.subarray(0, 300), "0123qrstu!qrstu"],
    "210 6e6ae43b",
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
    "225 80a8f4ec",
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
    "297 43697430",
  ],
  [
    10,
    "the longest that a word can get, which is nearly all there already",
    [" the document.getElementById( of the!", Buffer.alloc(300), " the document.getElementById( of the ", "0123456789"],
    "39 db90457c",
  ],
  [
    10,
    "a better second to last distance at the end",
    ["01234567.abcdefgh,wxyzABCDEFGH;ijklmnop:wxy$", Buffer.alloc(130), "01234567!ijklmnop?wxyz"],
    "62 602749a3",
  ],
  [10, "a better second to last distance at the start", ["012345601xy0123456", Buffer.alloc(100)], "24 ee388244"],
  [10, "a copy of more than 64 KiB", [Buffer.alloc(66000, noise.subarray(0, 100))], "154 cf7a0def"],
  [10, "more than 64 KiB of literals", [noise, "wxyz.wxyz", noise.subarray(100, 1100)], "65565 b1496d4f"],
])("at quality %d, handles %s", (quality, _, parts, expected) => {
  expect(roundTrip(Buffer.concat(parts.map(part => Buffer.from(part))), { [QUALITY]: quality })).toBe(expected);
});

it.each([
  [
    "other bytes with its hash",
    0,
    ["#inf!", Buffer.alloc(300), [0x69, 0x6e, 0xd1, 0x23], "rmat?%"],
    "37 701e35b0,37 701e35b0",
  ],
  [
    "three of its bytes with the hash of five",
    1 << 20,
    ["#info!", Buffer.alloc(300), "inf", [0xca, 0xe6], "?%"],
    "78 f1857286,78 f1857286",
  ],
  [
    "four of its bytes that are too far",
    0,
    ["-infoz-", Buffer.alloc(33000), "#inf!0123456789abcdefg"],
    "50 b4dcf536,50 b4dcf536",
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
  [5, 40000, [400, 401], "40008 5c2b970e,39622 2db06d3d"],
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
  [5, "365 3944acad"],
  [10, "294 2de54237"],
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
  [2 ** 20, "1201 ff0d2cb7"],
  [2 ** 21, "1201 ff0d2cb7"],
  [2 ** 21 + 1, "1158 f24d7b97"],
  [2 ** 26 + 1, "1088 68179a84"],
])("finds what is not crowded out of the table for a dictionary of %d bytes", (size, expected) => {
  const dictionary = Buffer.alloc(size).fill(noise.subarray(4000, 34000), size - 2 ** 20);
  noise.copy(dictionary, size - 2 ** 20, 0, 4000);
  const input = Buffer.concat(Array.from(window(noise.subarray(0, 4000), 10)).toReversed());
  expect(roundTrip(input, { [QUALITY]: 5 }, dictionary)).toBe(expected);
});

it.each([
  [5, "26 005f6835"],
  [10, "25 267291c2"],
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
  expect(roundTripInSteps([...steps, [FINISH, first]], { [QUALITY]: 5, [LGWIN]: 10 }, dictionary)).toBe("102 76f95d4d");
});

it("takes the most recent of the distances that reach into a dictionary", () => {
  const entries = ["wxyz", "wxyz", "wxyz", "", "WXYZ", "WXYZ", "", ""].map((start, i) =>
    Buffer.concat([Buffer.from(start), noise.subarray(20 * i, 20 * i + 20)]),
  );
  const parts = [...entries.slice(0, 4), "wxyz", ...entries.slice(4), "WXYZ"].flatMap((part, i) => [part, [i]]);
  const input = Buffer.concat([Buffer.alloc(1100), ...parts.map(part => Buffer.from(part)), Buffer.alloc(9, 255)]);
  expect(roundTrip(input, { [QUALITY]: 5, [LGWIN]: 10 }, Buffer.concat(entries))).toBe("52 3e87d3c3");
});

it.each([
  [5, "ABCDE01234567890123456789ABCDxxxxxxx", "13 7b85eb27"],
  [10, "ABCDExxxxxxxxxxx", "14 5fa1dc31"],
  [10, "ABCxxxxxxxxxxx", "16 eb6724ff"],
  [11, "ABCxxxxxxxxxxx", "16 eb6724ff"],
])("weighs the distances it starts with at quality %d", (quality, dictionary, expected) => {
  const input = Buffer.concat([Buffer.from("ABCDE"), Buffer.alloc(40)]);
  expect(roundTrip(input, { [QUALITY]: quality }, Buffer.from(dictionary))).toBe(expected);
});

it("copies all of a dictionary of two bytes at quality 10", () => {
  const input = Buffer.concat([noise.subarray(0, 32), Buffer.alloc(60)]);
  expect(roundTrip(input, { [QUALITY]: 10 }, noise.subarray(0, 2))).toBe("70 c42d5a67");
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
    "2322 2aee05d8",
    "2325 7226e06e",
    "2289 dac07752",
    "2288 72880e0c",
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
    "12397 e34ab9ca",
    "12234 78226631",
    "12208 497d9baf",
    "12208 497d9baf",
    "12208 497d9baf",
    "12208 497d9baf",
    "12208 497d9baf",
    "12195 37d40741",
    "12218 35a29c58",
    "12218 35a29c58",
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
    "24990 eeccbfe0,43152 6c2375d4,71379 a581c662",
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
      "44743 91718df3",
    ]);
  });

  it("get their lengths next to one that occurs more than 65536 times", () => {
    const input = Buffer.from(new Uint16Array(Buffer.alloc(70000, noise)).buffer);
    expect(roundTrip(input, { [QUALITY]: 4, [LGWIN]: 10, [LGBLOCK]: 21 })).toBe("87181 f4707601");
  });

  it("are left alone if they are the last seven", () => {
    const input = shuffled(runs([...Array(7).fill(12), ...Array.from({ length: 149 }, (_, i) => 8 + (i & 1))]));
    expect(roundTrip(input, { [QUALITY]: 4 })).toBe("1259 de42c134");
  });

  it("are not evened out with one that is just too rare after 175 of them", () => {
    const counts = Array.from({ length: 178 }, (_, i) => (i === 175 ? 0 : i < 53 ? 4 + (i % 2) : 4 + (i % 3)));
    expect(counts.slice(0, 175).reduce((a, b) => a + b)).toBe(848);
    const input = shuffled(Buffer.concat(counts.map((count, i) => Buffer.alloc(count, i))));
    expect(roundTrip(input, { [QUALITY]: 4 })).toBe("828 44ef99b2");
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
    "1186 91906af2",
    "958 8a611a65",
    "912 24990ba2",
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
    "22568 3411b319",
  ]);
});

it("keeps distance parameters that beat those it tries", () => {
  let at = 0;
  const periods = Array.from({ length: 300 }, (_, i) => [67, 75, 83, 91, 99, 107, 115, 119][(i * 3) % 8]);
  const input = Buffer.concat(periods.map(period => Buffer.alloc(period + 12, noise.subarray(at, (at += period)))));
  expect(roundTrip(input, { [QUALITY]: 10, [NPOSTFIX]: 3, [NDIRECT]: 120 })).toBe("28756 cf45c2d1");
});

it("stores a block that would grow by more than four bytes", () => {
  const digits = Buffer.from(noise.hexSlice(0, 30)).subarray(21);
  const flushed = size => [
    [FLUSH, digits.subarray(0, size)],
    [FINISH, Buffer.alloc(0)],
  ];
  expect([19, 20].map(size => roundTripInSteps(flushed(size), { [QUALITY]: 3 }))).toEqual([
    "26 0358b792",
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
    "65540 d16de234",
    "64894 a0dbf6a8",
    "65540 613dd660",
    "65334 0a04016d",
    "65540 9534a03b",
  ]);
});

it("remembers more than a block of input at quality 10", () => {
  const [first, second] = [0, 20].map(at => Buffer.concat([Buffer.from("wxyz"), noise.subarray(at, at + 20)]));
  const input = Buffer.concat([first, second, Buffer.alloc(65500), noise.subarray(100, 130), first, Buffer.alloc(130)]);
  expect(roundTrip(input, { [QUALITY]: 10, [LGBLOCK]: 16 })).toBe("117 65bd9d05");
});

it("finds matches after 16 MiB at quality 9 in a small window", () => {
  const input = Buffer.concat([Buffer.alloc(16 << 20, noise.subarray(-100)), text.subarray(0, 600)]);
  expect(roundTrip(input, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("2089 0cc1a156");
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
  expect(roundTripInSteps(steps, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("1614 ea49b2a8");
});

it("has 512 links for the hashes that share them at quality 9", () => {
  const records = Array.from({ length: 490 }, (_, i) => ["lgax", noise.subarray(2 * i, 2 * i + 2)]);
  const input = Buffer.concat(
    ["qzvk0#qzvk!", ...records.flat(), "qzvk0", Buffer.alloc(20)].map(part => Buffer.from(part)),
  );
  expect(roundTrip(input, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("1177 eaa654f9");
});

it.each([
  [42, ["91 a8b6072f", "212 e1cd70b0"]],
  [43, ["94 033c7a0f", "223 f3df6450"]],
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
  expect(roundTrip(input, { [QUALITY]: 9, [LGWIN]: 16 })).toBe("54 058c784d");
});

it("tries all recent distances shortly before its buffer wraps around", () => {
  // The last two distances lead to two and three bytes of the last "ijk".
  const steps = [
    [FLUSH, Buffer.alloc(2 ** 18 - 200)],
    [FINISH, Buffer.from("0123456789abcdefghijklmnopqrsijtuvwxyzAB01234567!klmnopqr?ijk~~~~~~~~")],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 5, [LGWIN]: 17 })).toBe("70 9708f418");
});

it("stops trying recent distances where its buffer wraps around", () => {
  // The last two distances lead to five and nine bytes of what follows.
  const before = "01234567tuvwxyzABCijklminop#abcdefgh-ijklm$01234567!abcdefgh?";
  const steps = [
    [FLUSH, Buffer.alloc(2 ** 18 - before.length - 5)],
    [FINISH, Buffer.from(`${before}ijklminop~~~~~~~~`)],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 5, [LGWIN]: 17 })).toBe("78 58b7ac26");
});

it.each([
  [5, "39 02ed03e6"],
  [10, "42 9ac2e0cb"],
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
    "95727 88fe3138",
    "12880 3b9bd3ec",
    "12858 7669b072",
  ]);
});

it("splits tens of thousands of commands into blocks", () => {
  const input = Buffer.alloc(193312);
  for (let [i, at] = [0, 0]; i < 30000; i++) {
    const start = (noise[i] % (2 + ((i >> 8) % 61))) * 8;
    at += noise.copy(input, at, start, start + 4 + ((i >> 10) & 3));
    input[at++] = noise.at(-1 - i);
  }
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("64650 0bf18b0d");
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
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("27436 24356973");
});

it.each([
  ["all at once", 500, "33828 7f91fc2f"],
  // Changes with that step. Checked against google/brotli with the same step added.
  ["in larger batches first", 400, "28077 d85580ba"],
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
  [4, 260, 512, 15, "74898 4d9ce146"],
  [10, 280, 120, 15, "23253 465263cd"],
  [10, 67, 200, 15, "8162 956341ac"],
  [10, 64, 608, 31, "26109 3826d4eb"],
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
  expect(roundTrip(input, { [QUALITY]: 10, [NO_CONTEXTS]: 1, [LGBLOCK]: 19 })).toBe("201038 88bb46c5");
});

it("counts on codes of no more than 15 bits when it merges blocks", () => {
  const input = bytesOf(48000, i => (noise[i] < 128 ? noise[i] & 15 : noise[i] - 64));
  for (let i = 0; i < 166; i++) input[47999 - 7 * i] = 0;
  for (let i = 0; i < 3; i++) input[47970 - 49 * i] = 200 + i;
  expect(roundTrip(input, { [QUALITY]: 10, [NO_CONTEXTS]: 1, [LGWIN]: 16 })).toBe("38985 cd128258");
});

it.each([
  [513, 102, 87, "5080 dc549cae"],
  [514, 134, 78, "5052 9cd394a8"],
  [514, 134, 29, "4711 7f2356f2"],
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
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("207 804c70f8");
});

it("counts more unused literals between others than there are literals", () => {
  const record = (_, i) => (i < 86 ? "abcdefgh" : "ijklmnop") + String.fromCharCode(3 * (i % 86));
  const input = Buffer.from("001011100" + Array.from({ length: 128 }, record).join(""), "latin1");
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("199 059333a3");
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
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("5653 33c9d353");
});

it("prices distances from 256 KiB on at quality 10", () => {
  const bytes = bytesOf(5100, i => noise[i] & 63);
  const records = Array.from({ length: 20 }, (_, i) => {
    const at = 13 * ((i * 7) % 20);
    return [bytes.subarray(at, at + (i & 1 ? 5 : 8)), bytes.subarray(5000 + 3 * i, 5003 + 3 * i)];
  });
  const input = Buffer.concat([bytes.subarray(0, 260), Buffer.alloc(1 << 18), ...records.flat()]);
  expect(roundTrip(input, { [QUALITY]: 10, [LGWIN]: 19 })).toBe("325 b09d5ffe");
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
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe("2668 87249011");
});

it("finds what a flush cut in two", () => {
  const [steps, repeated] = [[], []];
  for (let [i, at] = [0, 0]; i < 36; i++) {
    repeated.push(noise.subarray(at + 19 - (i % 3), at + 33), noise.subarray(9000 + i, 9001 + i));
    for (const size of [20, 1 + Math.floor(i / 3), 20]) steps.push([FLUSH, noise.subarray(at, (at += size))]);
  }
  steps.push([FINISH, Buffer.concat(repeated)]);
  expect(roundTripInSteps(steps, { [QUALITY]: 3, [LARGE_WINDOW]: 1, [LGWIN]: 25 })).toBe("2195 3db833ac");
  expect([2, 4, 5, 7, 10].map(quality => roundTripInSteps(steps, { [QUALITY]: quality }))).toEqual([
    "2271 78c57018",
    "2183 e0a3bd58",
    "2130 c2739381",
    "2130 c2739381",
    "2142 d7744e8c",
  ]);
});

it.each([
  [3, 10, [noise.subarray(0, 128), noise.subarray(128, 131), noise.subarray(1, 40)], "151 b62cfff5"],
  [32, 5, [noise.subarray(3000, 4024), noise.subarray(3600, 3632)], "1041 6b1b5492"],
])("does not skip a flush of %d bytes at quality %d", (_, quality, parts, expected) => {
  const params = { [QUALITY]: quality, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: quality < 10 ? 25 : 16 };
  expect(roundTripInSteps([...parts.map(part => [FLUSH, part]), [FINISH, Buffer.alloc(0)]], params)).toBe(expected);
});

it("finds nothing in a first flush of 127 bytes at quality 10", () => {
  const steps = [
    [FLUSH, noise.subarray(0, 127)],
    [FINISH, noise.subarray(1, 40)],
  ];
  expect(roundTripInSteps(steps, { [QUALITY]: 10 })).toBe("173 29298c25");
});

it.each([
  [127, "161 ea19970e"],
  [128, "170 deac51f8"],
  [129, "174 bc389f42"],
])("prefers the older match that has all of the last %d bytes at quality 10", (length, expected) => {
  const seen = noise.subarray(0, length);
  const input = Buffer.concat([seen, Buffer.alloc(70), seen.subarray(0, -1), Buffer.alloc(200), seen]);
  expect(roundTrip(input, { [QUALITY]: 10 })).toBe(expected);
});

it.each([
  [0, "194 c57ad425"],
  [1, "193 08ce2209"],
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
  expect(roundTripInSteps(steps, { [QUALITY]: 10 })).toBe("78 4cdb1e1d");
});

it.each([
  [16383, 10, 0, [1005, 1011], "20221 f793bea5"],
  [16384, 10, 0, [1005, 1011], "20237 d06b3c25"],
  [16384, 10, 0, [1004, 1074], "20237 53ad7ebc"],
  [16383, 10, 1, [1005, 1011], "20221 f793bea5"],
  [16384, 10, 1, [1005, 1011], "20237 d06b3c25"],
  [16384, 11, 0, [1005, 1011], "20222 e2c2b958"],
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
  expect(roundTrip(input, { [QUALITY]: 10, [LGWIN]: 16 })).toBe("40068 a0f1f981");
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
  ]).toEqual(["4714 cea91ad0", "3933 9684aa10", "3347 5bb54dcc"]);
});

it.each([
  [5, 10, false, "2456 6ca347a7"],
  [5, 17, false, "2452 e9e98c2a"],
  [9, 10, false, "2456 6ca347a7"],
  [5, 10, true, "2091 7947fde9"],
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
  expect(roundTripInSteps(steps, { [QUALITY]: 7, [LGWIN]: 17 })).toBe("1051 2b9331cc");
  expect(roundTripInSteps(steps, { [QUALITY]: 9, [LGWIN]: 10 })).toBe("1171 f4b14828");
});

it.each([
  [4, 0, [4, 0, 4, 4, 7, 8, -3], "106 505eea87,100 a89f6f8c,97 e97d4c38"],
  [7, 5, [0, 0, 0, 0, 0, 0, 0], "114 982f7ad7,109 a5433c9e,108 b2c8afc4"],
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
  expect(roundTrip(input, { [QUALITY]: 3, [LARGE_WINDOW]: 1, [LGWIN]: 25 })).toBe("33309 59ef5cec");
});

it("reaches more than 16 MiB back", () => {
  const input = Buffer.concat([noise, Buffer.alloc(16 << 20), noise.subarray(1001)]);
  const params = { [QUALITY]: 5, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: 25 };
  expect(roundTrip(input, params)).toBe("65627 7282b59f");
});

it.each([
  [2, 27, "317 43e3e9c2"],
  [3, 13, "321 c29bb538"],
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
    "358 14b78292",
    "358 f00fb92c",
  ]);
});

it("tells UTF-8 from other bytes", () => {
  const limits = "01 7f c280 dfbf e0a080 e0bfbf e18080 efbfbf f0908080 f0bfbfbf f1808080 f3bfbfbf f4808080 f48fbfbf";
  const neighbors = bytes => [bytes, ...bytes.flatMap((byte, i) => [bytes.with(i, byte - 1), bytes.with(i, byte + 1)])];
  const inputs = `${limits} 61626380`
    .split(" ")
    .flatMap(hex => neighbors([...Buffer.from(hex, "hex")]))
    .map(bytes => Buffer.alloc(60, Buffer.from(bytes)));
  expect(roundTrips(inputs, { [QUALITY]: 10, [LGWIN]: 10 })).toBe("1431 2dc5b076");
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
  expect(roundTripInSteps(steps, { [QUALITY]: 10, [LGWIN]: 10 })).toBe("514 9269dfc1");
});

it("has costs for the bytes of UTF-8 sequences once there are 25 of them", () => {
  const ascii = text.toString().replace(/[^\0-\x7f]/gu, "");
  const inputs = Object.entries({ é: 24, 中: 12 }).flatMap(([letter, enough]) =>
    [enough - 1, enough].flatMap(count => {
      const some = Buffer.from(ascii.slice(0, 1500).replaceAll("e", e => (count-- > 0 ? letter : e)));
      return [[], letter, [0xbf], [0xc0]].map(first => Buffer.concat([Buffer.from(first), some]));
    }),
  );
  expect(roundTrips(inputs, { [QUALITY]: 10, [LGWIN]: 12 })).toBe("9325 d871ac85");
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
    "28154 bc955bf2",
    "26631 f320ee55",
    "26026 4e3c59da",
    "26000 fd3775fb",
    "24904 97459de0",
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
  expect(answers).toEqual(["1518 48488fba", "1312 61a50cfa", "1319 47c56c48", "1225 b341962b"]);
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
  expect(digest(zlib.brotliCompressSync(input, { params }))).toBe("5345 16f2efab");
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
  [0, 2 ** 16 + 10, "81 25ede941"],
  [1, 31, "83 524f1e8d"],
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
    "4294967294: 131 2c64e382",
    "1: 131 2c64e382",
    "15: 131 2c64e382",
    "16: 131 2c64e382",
    "17: 128 6452833c",
    "18: 127 4914b699",
    "25: 246 f2052f5c",
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
  expect(digest(drive(zlib.createBrotliCompress({ params: { [QUALITY]: 4 } }), steps, 1 << 16))).toBe("10437 ce10dd78");
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
  ]).toEqual(["79695 5ff26661", "61532 717e322a", "47771 5b4369f1", "21257 d88eaf94"]);
});

it.each([
  [4, "136288 2c9bbe95", "30426 6e8da1bf"],
  [44, "122784 f88c78a5", "35349 7c8b52f5"],
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
    "32149 284dd15d",
    "18845 191ba459",
  ]);
});

it("finds words with what little follows them before a flush at quality 10", () => {
  const ends =
    " 2020|\u00a0time|e time |.com/time| the time|Information,|INFORMATION. | information,| information, |" +
    " the information of | the information of the |experiencing |government and #|government and #~|" +
    " the document.getElementById( of the ~";
  const steps = ends.split("|").map(end => [FLUSH, Buffer.concat([Buffer.alloc(40), Buffer.from(end)])]);
  expect(roundTripInSteps([...steps, [FINISH, Buffer.alloc(0)]], { [QUALITY]: 10, [LGWIN]: 10 })).toBe("220 eb81e7b1");
});

it("takes the more recent of two distances that both match up to the end", () => {
  const input = Buffer.from(noise.subarray(100, 465));
  for (const at of [156, 206]) input.copyWithin(at, 356);
  input[165] = 0;
  [200, 150, 90, 60].forEach((distance, i) => {
    const at = 300 + 14 * i;
    input.copyWithin(at, at - distance, at - distance + 10);
  });
  expect(roundTrip(input, { [QUALITY]: 9 })).toBe("337 6c4338d9");
});

it("finds a word for every transform", () => {
  expect(qualities.map(quality => roundTrip(transformedWords(), { [QUALITY]: quality }))).toEqual([
    "17351 2df44e89",
    "16968 f8acc7a0",
    "16105 50126157",
    "16101 3d5eed2e",
    "14416 1e280d4c",
    "13464 96057d7a",
    "13456 b16d08f0",
    "12938 8d0355e5",
    "12938 5e364ea8",
    "12926 d61f2eaf",
    "5812 0099e7d2",
    "5799 223bf2eb",
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
    [1, "769 94 20787859,1561 340 54dfc55e"],
    [2, "566 73660 987944c1,2822 93834 65f0444b,4480 1048 8c86e391,4834 3221 f80378dc"],
    [
      3,
      "29 73 11efc811,423 20510 e128b156,507 150124 7081e8f1,543 947 67790447,1071 1215 b9c64930,3138 1238 aeca0176,6413 1455 b3124700,7203 34234 b68c9ca7,8593 12391 282a0f0a",
    ],
    [
      4,
      "676 101492 9085d0c2,3027 3244 c0d9396b,6793 2700 ccafa1f0,8350 1725 85994f0e,8739 2694 35d78dde,9467 16476 00936da1,10116 17 40285a12",
    ],
    [
      5,
      "1193 114921 aef81daf,2165 19602 78c5ce0c,2418 1888 7ea4a36d,2765 126341 827eb612,2777 15929 bd0d9360,3185 52821 60963fe0",
    ],
    [
      6,
      "1242 159754 34db3b7b,1602 8027 91377b3f,1926 217422 fbf421ff,1986 17112 7853dc95,2346 5969 6573e240,2454 2924 f2039918,5590 67072 8e5087e3",
    ],
    [7, "2707 2399 d4706d50,2995 40290 0a8fb442,3499 9217 7f7bb05d,6756 1966 f856f056,6857 132692 eb8f1c1b"],
    [8, "104 18460 cc554eac,500 14356 83ad36fe,584 652 3009b31c,1148 169571 02ea013c,2192 10105 ff86c07f"],
    [
      9,
      "165 84083 b241feb2,741 8568 1a993106,1089 275 b2d56f15,1293 69502 cad3b846,1437 31527 696d05cb,1497 32124 cbe78615,2361 37726 d42a310f,2445 51406 4ac722e8,8993 3369 bfac8ab2",
    ],
    [
      10,
      "430 23527 a0f459bd,1486 1279 483d2115,1940 39 1929c141,2038 19101 faa4a6bf,2542 8760 7d17efd8,2590 321 6912eeb3,3418 33571 883fdfd8,3526 76 25281d97,3930 151 da16b5a8,4542 2568 214d3422,4940 718 a6b816e3,7522 92 8e15910f,9327 9743 1f66d528",
    ],
    [
      10,
      "9335 22094 82f0a9f7,9375 59303 46520861,9578 10708 a840554c,9919 21965 7ca894db,10458 8992 1b40848f,10475 8667 faa106cb,10507 47 9b4213c6",
    ],
    [
      10,
      "2745 2024 280e9ec9,5448 55 51ed0309,10528 18213 00d65ced,11336 23 792dd208,12042 844 0112dbfb,14366 4181 762cd56b",
    ],
    [
      11,
      "227 12714 a14d6e0e,755 47 0e0f8fd2,1079 19 3748fe47,1134 130 6d826795,1665 147 7598e134,1932 1602 43b817d0,2041 1196 59ed4dfa,2426 236 c139314e,3203 6988 096c0842,3227 1361 97185fca,3299 639 efba7476,3828 1795 cf37645b,4285 672 76e26809,5853 643 2a48de50,11605 41 b706142a,12145 186 1a212103,12182 3635 cd3d256d,12250 174 d179d622,12483 8898 b7d49e27,12723 8194 d4c5ea9f,13815 694 3ffe7ec9,13877 8538 941e4719",
    ],
    [
      11,
      "10588 768 db852201,12281 437 4c95e27b,14240 160 170ebbdb,16267 1015 97cea338,16278 199 59d3f9bd,16342 766 21d84450",
    ],
  ])("compresses at quality %d (%#)", (quality, expected) => {
    expect(answers(quality, expected, false)).toBe(expected);
  });

  it.each([
    [10, "8793 2043 6493a656"],
    [11, "1189 135 f43658cd,8705 154 14a3da27"],
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
  const stream = zlib.brotliCompressSync(
    Buffer.concat([text.subarray(0, 700), Buffer.alloc(900, samples.subarray(0, 24))]),
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

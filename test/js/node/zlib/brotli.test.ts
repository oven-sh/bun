// The expected values are what google/brotli 1.2 does, so they are never to be updated.
import { describe, expect, it } from "bun:test";
import { createCipheriv } from "node:crypto";
import * as zlib from "node:zlib";

const {
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

function* window(buffer, size) {
  for (let at = 0; at <= buffer.length; at += size) yield buffer.subarray(at, at + size);
}

function once(compute) {
  let value;
  return () => (value ??= compute());
}

const digest = bytes => `${bytes.length} ${zlib.crc32(bytes).toString(16).padStart(8, "0")}`;

function roundTrip(input, params, dictionary) {
  const compressed = zlib.brotliCompressSync(input, { params, dictionary });
  const options = { params: { [DECODER_LARGE_WINDOW]: params[LARGE_WINDOW] ?? 0 }, dictionary };
  expect(digest(zlib.brotliDecompressSync(compressed, options))).toBe(digest(input));
  return digest(compressed);
}

function roundTrips(inputs, params) {
  const streams = inputs.map(input => zlib.brotliCompressSync(input, { params }));
  expect(streams.map(stream => zlib.brotliDecompressSync(stream))).toEqual(inputs);
  return digest(Buffer.concat(streams));
}

/** Runs `[operation, input]` pairs on one stream, with `room` bytes of output at a time. */
function drive(engine, steps, room) {
  const chunks = [];
  const out = Buffer.alloc(room);
  let error;
  engine._handle.onerror = (message, errno, code) => (error = { message, errno, code });
  for (const [operation, input] of steps) {
    let [availOut, availIn] = [0, input.length];
    while (availOut === 0 && !error) {
      engine._handle.writeSync(operation, input, input.length - availIn, availIn, out, 0, room);
      [availOut, availIn] = engine._writeState;
      chunks.push(Buffer.from(out.subarray(0, room - availOut)));
    }
  }
  engine.close();
  return error ?? Buffer.concat(chunks);
}

function roundTripInSteps(steps, params, dictionary) {
  const compressed = drive(zlib.createBrotliCompress({ params, dictionary }), steps, 1 << 16);
  const options = { params: { [DECODER_LARGE_WINDOW]: params[LARGE_WINDOW] ?? 0 }, dictionary };
  const input = Buffer.concat(steps.map(step => step[1]));
  expect(digest(zlib.brotliDecompressSync(compressed, options))).toBe(digest(input));
  return digest(compressed);
}

const shortDistance = (last, code) =>
  code < 4 ? last[code] : last[+(code > 9)] + [-1, 1, -2, 2, -3, 3][(code - 4) % 6];

it("has the inputs that the answers are for", () => {
  expect([text, samples, mixed].map(digest)).toMatchInlineSnapshot(`
    [
      "32231 e1fc2f33",
      "5000 9d6ad7d7",
      "141131 fda6fcc3",
    ]
  `);
});

it("has the constants", () => {
  const constants = Object.entries(zlib.constants).filter(([name]) => name.startsWith("BROTLI_"));
  expect(Object.fromEntries(constants)).toMatchInlineSnapshot(`
    {
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
    }
  `);
});

it("compresses short inputs", () => {
  const lengths = [0, 1, 2, 3, 4, 15, 16, 17, 64, 200, 1000, 3000];
  const row = quality => lengths.map(length => roundTrip(text.subarray(0, length), { [QUALITY]: quality }));
  expect(qualities.map(quality => row(quality).join())).toMatchInlineSnapshot(`
    [
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
    ]
  `);
});

it("compresses with the default window", () => {
  expect(qualities.map(quality => roundTrip(mixed, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
    [
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
    ]
  `);
});

it("compresses with a window of 10 bits", () => {
  expect(qualities.map(quality => roundTrip(mixed, { [QUALITY]: quality, [LGWIN]: 10 }))).toMatchInlineSnapshot(`
    [
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
    ]
  `);
});

it("compresses with a window of 16 bits", () => {
  expect(qualities.map(quality => roundTrip(mixed, { [QUALITY]: quality, [LGWIN]: 16 }))).toMatchInlineSnapshot(`
    [
      "41431 e053673e",
      "38563 3b734689",
      "33304 429b481a",
      "33354 f928af25",
      "31701 00fbdb37",
      "31001 4f1de949",
      "30627 d8432195",
      "30346 c3e36fe6",
      "30244 7b96a706",
      "30167 1c5633aa",
      "28392 b7fc139f",
      "28065 6dbd769b",
    ]
  `);
});

it("stores what does not compress", () => {
  expect(qualities.map(quality => roundTrip(noise, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
    [
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
    ]
  `);
});

it("compresses with the hint of a large input", () => {
  const params = quality => ({ [QUALITY]: quality, [SIZE_HINT]: 1 << 20 });
  expect([4, 5, 6, 7, 9].map(quality => roundTrip(mixed, params(quality)))).toMatchInlineSnapshot(`
    [
      "27177 0504fffc",
      "28502 50fd6c5b",
      "28321 3e4fd6b9",
      "28079 b32316d6",
      "27921 03540c11",
    ]
  `);
});

it("compresses with a large window", () => {
  const params = quality => ({ [QUALITY]: quality, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: 25 });
  expect([2, 3, 4, 5, 6, 9, 10].map(quality => roundTrip(mixed, params(quality)))).toMatchInlineSnapshot(`
    [
      "27376 5f478bae",
      "27387 0899932c",
      "27179 58ddf1be",
      "28503 9191c487",
      "28322 0de4657d",
      "27923 ab893317",
      "23434 5e2facf8",
    ]
  `);
});

it("compresses with a dictionary", () => {
  const [dictionary, input] = [text.subarray(0, 15000), mixed.subarray(10000, 45000)];
  expect(qualities.map(quality => roundTrip(input, { [QUALITY]: quality }, dictionary))).toMatchInlineSnapshot(`
    [
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
    ]
  `);
});

it("compresses with a dictionary of more than 64 KiB", () => {
  const dictionary = Buffer.concat([noise, text, samples]);
  const input = Buffer.concat(Array.from(window(dictionary, 2500), part => part.subarray(0, 40)));
  expect([5, 9, 11].map(quality => roundTrip(input, { [QUALITY]: quality }, dictionary))).toMatchInlineSnapshot(`
    [
      "151 d3cce7d8",
      "151 d3cce7d8",
      "148 bdba310a",
    ]
  `);
});

it("compresses about 2 and 4 KiB", () => {
  const answers = [2047, 2048, 2049, 4095, 4096, 4097].map(length =>
    [2, 3, 4].map(quality => roundTrip(text.subarray(0, length), { [QUALITY]: quality })).join(),
  );
  expect(answers).toMatchInlineSnapshot(`
    [
      "923 99dc8a57,884 0cfb4011,815 3bb0fd1f",
      "922 c1ee5295,884 f8c94da1,814 c1539c38",
      "922 57d90c74,884 4ecc2954,814 7bef9b58",
      "1591 2669b27d,1568 874b0df4,1499 1ddad14c",
      "1592 86aacd98,1569 4ffa73a0,1499 d787c166",
      "1587 108b07f5,1564 5dea45ad,1495 b2669815",
    ]
  `);
});

it("compresses about 32 KiB at quality 9", () => {
  const answers = [32767, 32768, 32769].map(length => roundTrip(mixed.subarray(0, length), { [QUALITY]: 9 }));
  expect(answers).toMatchInlineSnapshot(`
    [
      "9090 5dfd1970",
      "9091 969466ea",
      "9091 a2170551",
    ]
  `);
});

it("compresses about 64 KiB", () => {
  const input = Buffer.concat([text, samples, text]);
  const answers = [65535, 65536, 65537].map(length =>
    [5, 6, 7, 9].map(quality => roundTrip(input.subarray(0, length), { [QUALITY]: quality })).join(),
  );
  expect(answers).toMatchInlineSnapshot(`
    [
      "13232 defb0db3,12990 04e511ea,12689 cc00c593,12634 f65eecea",
      "13232 8c9f02f1,12990 f3f42c22,12689 b32b7e1a,12634 003a35ff",
      "13232 60122f35,12990 a31ec9db,12690 c32ab6db,12634 e501a3a5",
    ]
  `);
});

it("finishes with up to three bytes after a flush", () => {
  const answers = [0, 1, 2, 5, 11].map(quality =>
    [0, 1, 2, 3].map(length => {
      const steps = [
        [FLUSH, text.subarray(0, 100)],
        [FINISH, text.subarray(0, length)],
      ];
      return drive(zlib.createBrotliCompress({ params: { [QUALITY]: quality } }), steps, 1024)
        .subarray(-8)
        .toString("hex");
    }),
  );
  expect(answers.map(String)).toMatchInlineSnapshot(`
    [
      "656470656f706c03,6f706c0000083103,706c080008313903,6c10000831393803",
      "656470656f706c03,6f706c0000083103,706c080008313903,6c10000831393803",
      "656470656f706c03,6f706c0000083103,706c080008313903,6c10000831393803",
      "7034b946b5650303,b565030000083103,6503080008313903,0310000831393803",
      "cd55325e0e030303,0e03030000083103,0303080008313903,0310000831393803",
    ]
  `);
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
    answers[name] = [4, 7, 10].map(quality => roundTrip(input, { ...params, [QUALITY]: quality })).join();
  }
  answers["block 17"] = [4, 7, 10].map(quality => roundTrip(mixed, { [QUALITY]: quality, [LGBLOCK]: 17 })).join();
  expect(answers).toMatchInlineSnapshot(`
    {
      "block 17": "26012 02d810aa,25197 e68f0263,23433 1427ab98",
      "font": "7192 90527b60,6867 06a17fae,6541 36e487e2",
      "no contexts": "7189 a638e271,6865 8407afb0,6791 760c41f7",
      "postfix 1, direct 3": "7189 a638e271,6865 8407afb0,6537 2fa041b1",
      "postfix 3, direct 120": "7193 c8c03561,6873 02d0fcdc,6576 413a8312",
      "window 17": "7189 bca8261b,6865 625ba800,6537 cbbd202d",
      "window 40": "7189 e5d6d89b,6865 5ab83687,6537 7e3e2333",
      "window 5": "7287 49bef762,7007 53654a24,6776 68f95124",
    }
  `);
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
    const inputs = [...short, ...around(194, 322, 578, 1090, 2114, 6210, 22594)].map(length =>
      Buffer.concat([Buffer.alloc(1000 + length), unique.subarray(0, length)]),
    );
    expect([0, 1, 2].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
      [
        "152985 7fafab02",
        "127791 cc0a1a60",
        "127757 3d75e0ce",
      ]
    `);
  });

  it("has a hash table for each length of the input", () => {
    const inputs = around(...[8, 9, 10, 11, 12, 13, 14, 15, 16].map(bits => 2 ** bits)).map(length =>
      Buffer.alloc(length, text),
    );
    expect([0, 1].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
      [
        "141168 eecb820e",
        "131793 99b0c7de",
      ]
    `);
  });

  it("closes a gap among 16 or more kinds of literals", () => {
    const inputs = around(15, 27).map(count =>
      Buffer.from(noise.subarray(0, 200).map((byte, i) => (i === 99 ? 0 : 2 + (byte % (count - 1))))),
    );
    expect(roundTrips(inputs, { [QUALITY]: 4 })).toMatchInlineSnapshot(`"983 67e9329a"`);
  });

  it("has prefix codes for each number of commands that are alike", () => {
    const record = i => Buffer.concat([noise.subarray(0, 20), unique.subarray(i * 4, i * 4 + 4)]);
    const inputs = around(2, 126, 130).map(length => Buffer.concat(Array.from({ length }, (_, i) => record(i))));
    expect([0, 1, 2, 3, 4].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
      [
        "6745 4c165e65",
        "4106 87a2a2a1",
        "4190 5899991c",
        "3453 1bc405c7",
        "3415 b555377a",
      ]
    `);
  });

  it("stores a long run of literals that follows little else at quality 0", () => {
    const inputs = [124, 125, 126, 98404].flatMap(zeros =>
      [3000, 6209, 6210, 6250, 20000].map(length => Buffer.concat([Buffer.alloc(zeros), noise.subarray(0, length)])),
    );
    expect(inputs.map(input => roundTrip(input, { [QUALITY]: 0 })).join()).toMatchInlineSnapshot(
      `"3110 2ad34680,6301 d5e37a0f,6338 3147b62c,6378 b292f6aa,20128 56d62187,3110 88cba62a,6301 09bc4db3,6302 26f27a80,6379 7fbd3774,20129 d8011453,3110 b378eba4,6301 eabb1a45,6302 c4d9eda4,6344 81ab6c1c,20130 9a8cf559,3442 b5e4e95a,6360 724805d0,6391 d871e7c0,6431 5532a496,20181 da5d3ac0"`,
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
      .slice(5, 26)
      .map(length => Buffer.concat([Buffer.alloc(200), ...better, noise.subarray(0, length)]));
    expect(qualities.slice(2, 10).map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
      [
        "3159 230c5c00",
        "2367 92626abc",
        "2331 56506507",
        "2278 418c9fdb",
        "2278 418c9fdb",
        "2278 418c9fdb",
        "2278 418c9fdb",
        "2278 418c9fdb",
      ]
    `);
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
    expect([0, 1, 2, 5, 10].map(quality => roundTrip(input, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
      [
        "29966 77ba463f",
        "27712 45bff5e8",
        "26093 6664c012",
        "20786 1c44bcc9",
        "13747 ef45309b",
      ]
    `);
  });

  it("has a header for each length of a meta-block", () => {
    const inputs = [...around(2 ** 16, 3 * 2 ** 15, 2 ** 17, 2 ** 20), 1250000].map(length =>
      Buffer.alloc(length, text),
    );
    const row = quality => inputs.map(input => roundTrip(input, { [QUALITY]: quality })).join();
    expect([0, 1, 5].map(row)).toMatchInlineSnapshot(`
      [
        "10982 dd133af6,10982 ce1036b0,10982 61536006,10982 08c636fc,10976 a16d7472,10976 b785038d,10978 032115e7,10979 5e10c5f4,10996 1b22d7ac,10996 cfe0a3c3,10996 95f635d1,10996 8d29de35,42184 8f895f98,42184 ed5e4cbc,42350 7927a4c8,42350 39f56438,44238 5794a09d",
        "10529 d307656b,10529 d80720b5,10495 31ca13b4,10495 0d5c11ba,10495 c3859cd8,10495 88d15ead,10495 a5bca7b5,10495 992aa5bb,10495 ef4f4fbc,10495 a41b8dc9,10499 e2d5c328,10500 de45a0b7,31041 c1ae3be1,31041 cfe9c991,31045 bc21fbe4,31046 e79a99f4,41602 0654148b",
        "8989 904b00de,8989 7f096cb0,8990 c02a1b09,8990 307c5fcf,8990 6f603e36,8990 d2fedbfb,8990 fb2f0f40,8990 0b794b86,8990 e5839aed,8990 581d7f20,8990 e28805da,8990 12de411c,8990 0c7d27d2,8919 88661a86,8919 9e65b0ff,8919 fbd8096e,8919 b9efbb7f",
      ]
    `);
  });
});

it("ends a meta-block after 32768 commands in a window of 17 bits", () => {
  const input = Buffer.from(Array.from({ length: 132000 }, (_, i) => noise[i % 6 < 3 ? i % 894 : 900 + (i % 912)]));
  input.copyWithin(894, 0, 12).copyWithin(932, 20, 32);
  expect(roundTrip(input, { [QUALITY]: 5, [LGWIN]: 17 })).toMatchInlineSnapshot(`"11869 4bc7b085"`);
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
  expect(roundTrips(inputs, { [QUALITY]: 3 })).toMatchInlineSnapshot(`"49531 adb616fb"`);
});

it.each([
  [0, "one kind of literal after many", [Buffer.alloc(98304, text), Buffer.alloc(1000, 255)], "11056 cc3117fe"],
  [1, "a copy that ends after five bytes", [Buffer.alloc(5), Buffer.alloc(200, noise.subarray(0, 20))], "69 9d6df367"],
  [
    2,
    "a word after many literals",
    ["ta", noise.subarray(0, 510), "throughout the", Buffer.alloc(900)],
    "645 ddd57f22",
  ],
])("at quality %d, handles %s", (quality, _, parts, expected) => {
  expect(roundTrip(Buffer.concat(parts.map(part => Buffer.from(part))), { [QUALITY]: quality })).toBe(expected);
});

it("stores some blocks and compresses others at quality 1", () => {
  const random = createCipheriv("aes-128-ctr", Buffer.alloc(16, 2), Buffer.alloc(16)).update(Buffer.alloc(3 << 17));
  const block = (kind, i) => (kind === "s" ? random.subarray(i << 17, (i + 1) << 17) : Buffer.alloc(1 << 17, text));
  const compress = kinds => `${kinds}: ${roundTrip(Buffer.concat(Array.from(kinds, block)), { [QUALITY]: 1 })}`;
  expect(["s", "ss", "sss", "sc", "ssc", "scs", "css", "csc"].map(compress)).toMatchInlineSnapshot(`
    [
      "s: 131077 3741cc0d",
      "ss: 262149 53c9b22e",
      "sss: 393221 58cad9fb",
      "sc: 141571 846a1d5d",
      "ssc: 272646 30a8988e",
      "scs: 272646 7f434bb8",
      "css: 272646 349d5bf4",
      "csc: 152071 da863d26",
    ]
  `);
});

it("stores what repeats too late for quality 0", () => {
  const input = Buffer.concat([noise.subarray(0, 30000), noise.subarray(0, 30000)]);
  expect(roundTrip(input, { [QUALITY]: 0 })).toBe("30075 16afea95");
});

const largestInReach = once(() => Buffer.alloc(2 ** 26 - 4).fill(noise, 0, 400));

it.each([
  [5, 0, "287 1cc0c81e"],
  [10, 0, "218 0312e472"],
  [10, 3, "188 5e4366fb"],
])("reaches as far into a dictionary as quality %d and postfix %d have codes for", (quality, bits, expected) => {
  // The distances go from four below the size of the dictionary to four above.
  const copied = Array.from({ length: 9 }, (_, i) => [Buffer.alloc(20), noise.subarray(39 * i + 24, 39 * i + 44)]);
  const input = Buffer.concat([...copied.flat(), Buffer.alloc(20), text.subarray(0, 200)]);
  expect(roundTrip(input, { [QUALITY]: quality, [NPOSTFIX]: bits }, largestInReach())).toBe(expected);
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

it("reaches into a dictionary with short distance codes", () => {
  const [dictionary, parts] = [noise.subarray(0, 4000), [Buffer.alloc(5000)]];
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
  expect([5, 9, 10, 11].map(quality => roundTrip(input, { [QUALITY]: quality, [LGWIN]: 10 }, dictionary)))
    .toMatchInlineSnapshot(`
    [
      "2322 2aee05d8",
      "2325 7226e06e",
      "2289 dac07752",
      "2288 72880e0c",
    ]
  `);
});

it("reaches as far back as the window allows", () => {
  const answers = qualities.map(quality => {
    const [size, limit, reach] = quality < 2 ? [22, 2 ** 18 - 16, [95000]] : [12, 2 ** 12 - 16, []];
    const inputs = [...reach, limit - 1, limit, limit + 1].map(distance =>
      Buffer.concat([noise.subarray(0, 3000), Buffer.alloc(distance - 3000), noise.subarray(0, 3020)]),
    );
    return roundTrips(inputs, { [QUALITY]: quality, [LGWIN]: size });
  });
  expect(answers).toMatchInlineSnapshot(`
    [
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
    ]
  `);
});

it("copies 2118 bytes from 250000 bytes back at quality 0", () => {
  const far = Buffer.concat([noise.subarray(0, 8), text.subarray(0, 2110).toReversed()]);
  const input = Buffer.concat([far, Buffer.alloc(250000 - far.length, text), far, noise.subarray(100, 120)]);
  expect(roundTrip(input, { [QUALITY]: 0 })).toMatchInlineSnapshot(`"12053 31c6890d"`);
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
  expect([0, 1, 2, 3, 5].map(quality => inputs.map(input => twice(input, quality)).join())).toMatchInlineSnapshot(`
    [
      "54747 0e42aabd,92658 5c2251f6,153076 1b8667ff",
      "50813 44c45294,88749 b74adfa0,147413 aeb53f23",
      "24990 eeccbfe0,43152 6c2375d4,71379 a581c662",
      "24932 fb379d89,43031 cbb8f127,71270 ef2005b6",
      "24915 9aae75cf,42879 68780c3b,71099 81ea39b7",
    ]
  `);
});

it("keeps distance parameters that beat those it tries", () => {
  let at = 0;
  const periods = Array.from({ length: 300 }, (_, i) => [67, 75, 83, 91, 99, 107, 115, 119][(i * 3) % 8]);
  const input = Buffer.concat(periods.map(period => Buffer.alloc(period + 12, noise.subarray(at, (at += period)))));
  expect(roundTrip(input, { [QUALITY]: 10, [NPOSTFIX]: 3, [NDIRECT]: 120 })).toMatchInlineSnapshot(`"28756 cf45c2d1"`);
});

it("stores what hardly compresses", () => {
  let letters = noise.latin1Slice();
  const inputs = Array.from({ length: 40 }, (_, i) => {
    letters = letters.replaceAll(String.fromCharCode(255 - i), String.fromCharCode(40 + i));
    return Buffer.from(letters, "latin1");
  });
  expect([0, 1].map(quality => roundTrips(inputs, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
    [
      "2601789 c701b98e",
      "2572318 fafe4393",
    ]
  `);
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
    Buffer.from(noise.map((byte, i) => (i % 13 ? byte & 127 : byte))),
  ];
  expect(inputs.map(input => roundTrip(input, { [QUALITY]: 9 }))).toMatchInlineSnapshot(`
    [
      "65540 d16de234",
      "64894 a0dbf6a8",
      "65540 613dd660",
      "65334 0a04016d",
      "65540 9534a03b",
    ]
  `);
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
  expect([5, 6, 7].map(quality => roundTripInSteps(steps, { [QUALITY]: quality, [LGWIN]: 18 }))).toMatchInlineSnapshot(`
    [
      "95727 88fe3138",
      "12880 3b9bd3ec",
      "12858 7669b072",
    ]
  `);
});

it("splits tens of thousands of commands into blocks", () => {
  const input = Buffer.alloc(193312);
  for (let [i, at] = [0, 0]; i < 30000; i++) {
    const start = (noise[i] % (2 + ((i >> 8) % 61))) * 8;
    at += noise.copy(input, at, start, start + 4 + ((i >> 10) & 3));
    input[at++] = noise.at(-1 - i);
  }
  expect(roundTrip(input, { [QUALITY]: 10 })).toMatchInlineSnapshot(`"64650 0bf18b0d"`);
});

it("makes do with 256 prefix codes for literals", () => {
  const [starts, sizes] = [
    [1, 16, 64, 128, 192, 240],
    [15, 48, 64, 64, 48, 15],
  ];
  let context = 0;
  // Each eighth has bytes of its own, and the last two bytes narrow them down to twelve.
  const input = noise.subarray(0, 56000).map((byte, i) => {
    const part = Math.floor(i / 7000);
    const range = byte % 6;
    const share = Math.max(2, sizes[range] >> 3);
    const choice = noise[(part * 36 + context) * 12 + range * 2 + (byte >> 7)] % share;
    context = range * 6 + Math.floor(context / 6);
    return starts[range] + ((part * share + choice) % sizes[range]);
  });
  expect(roundTrip(input, { [QUALITY]: 10 })).toMatchInlineSnapshot(`"27436 24356973"`);
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
  expect(roundTrip(input, { [QUALITY]: 10 })).toMatchInlineSnapshot(`"2668 87249011"`);
});

it("finds what a flush cut in two", () => {
  const [steps, repeated] = [[], []];
  for (let [i, at] = [0, 0]; i < 36; i++) {
    repeated.push(noise.subarray(at + 19 - (i % 3), at + 33), noise.subarray(9000 + i, 9001 + i));
    for (const size of [20, 1 + Math.floor(i / 3), 20]) steps.push([FLUSH, noise.subarray(at, (at += size))]);
  }
  steps.push([FINISH, Buffer.concat(repeated)]);
  expect([2, 4, 5, 7, 10].map(quality => roundTripInSteps(steps, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
    [
      "2271 78c57018",
      "2183 e0a3bd58",
      "2130 c2739381",
      "2130 c2739381",
      "2142 d7744e8c",
    ]
  `);
});

it.each([
  [3, 10, [noise.subarray(0, 128), noise.subarray(128, 131), noise.subarray(1, 40)], "151 b62cfff5"],
  [32, 5, [noise.subarray(3000, 4024), noise.subarray(3600, 3632)], "1041 6b1b5492"],
])("does not skip a flush of %d bytes at quality %d", (_, quality, parts, expected) => {
  const params = { [QUALITY]: quality, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: quality < 10 ? 25 : 16 };
  expect(roundTripInSteps([...parts.map(part => [FLUSH, part]), [FINISH, Buffer.alloc(0)]], params)).toBe(expected);
});

it.each([
  [16383, "20185 cced41ce"],
  [16384, "20195 e87883b5"],
])("takes %d bytes from the last distance at quality 10", (length, expected) => {
  const [seen, gap] = [noise.subarray(0, 20000), Buffer.alloc(20000)];
  const changed = Buffer.from(seen);
  for (const at of [1003, 1004 + length]) changed[at] ^= 1;
  const slices = Array.from({ length: 16 }, (_, i) => seen.subarray(5000 + 301 * i, 5012 + 301 * i));
  const input = Buffer.concat([seen, gap, seen, gap, changed, gap, gap, ...slices]);
  expect(roundTrip(input, { [QUALITY]: 10, [LGWIN]: 16 })).toBe(expected);
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
  ]).toMatchInlineSnapshot(`
    [
      "4714 cea91ad0",
      "3933 9684aa10",
      "3347 5bb54dcc",
    ]
  `);
});

it.each([
  [5, 10, false, "2456 6ca347a7"],
  [5, 17, false, "2452 e9e98c2a"],
  [5, 10, true, "2091 7947fde9"],
  [10, 10, true, "2543 d88c07b1"],
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

it("reaches more than 16 MiB back", () => {
  const input = Buffer.concat([noise, Buffer.alloc(16 << 20), noise.subarray(1001)]);
  const params = quality => ({ [QUALITY]: quality, [SIZE_HINT]: 1 << 20, [LARGE_WINDOW]: 1, [LGWIN]: 25 });
  expect([3, 5].map(quality => roundTrip(input, params(quality)))).toMatchInlineSnapshot(`
    [
      "65590 70fd67cd",
      "65627 7282b59f",
    ]
  `);
});

it.each([
  [2, 27, "317 43e3e9c2"],
  [3, 13, "321 c29bb538"],
])("has %d groups of contexts if the sample is just so", (_, start, expected) => {
  const kind = (byte, i) => (i & 1 && byte & 7 ? 0x80 : byte < 128 ? 0x61 : 0xc3);
  const input = Buffer.concat([noise.subarray(start, start + 64).map(kind), text.subarray(0, 600)]);
  expect(roundTrip(input, { [QUALITY]: 7 })).toBe(expected);
});

it("tells UTF-8 from other bytes", () => {
  const limits = "01 7f c280 dfbf e0a080 e0bfbf e18080 efbfbf f0908080 f0bfbfbf f1808080 f3bfbfbf f4808080 f48fbfbf";
  const neighbors = bytes => [bytes, ...bytes.flatMap((byte, i) => [bytes.with(i, byte - 1), bytes.with(i, byte + 1)])];
  const inputs = `${limits} 61626380`
    .split(" ")
    .flatMap(hex => neighbors([...Buffer.from(hex, "hex")]))
    .map(bytes => Buffer.alloc(24, Buffer.from(bytes)));
  expect(roundTrips(inputs, { [QUALITY]: 10, [LGWIN]: 10 })).toMatchInlineSnapshot(`"1374 b962c54e"`);
});

it("tells UTF-8 from other bytes where its buffer wraps around", () => {
  // Three quarters are valid, which is just not enough.
  const unit = Buffer.concat([Buffer.from("a😀é中bc"), Buffer.alloc(4, 255)]);
  const steps = [];
  for (let [i, at] = [0, 0]; i < 32; i++) {
    const [start, piece] = [(i + 1) * 2 ** 17 - 1 - (i >> 1), Buffer.alloc(64 + (i & 1), unit)];
    steps.push([FLUSH, Buffer.alloc(start - at)], [FLUSH, piece]);
    at = start + piece.length;
  }
  steps.push([FINISH, Buffer.alloc(0)]);
  expect(roundTripInSteps(steps, { [QUALITY]: 10, [LGWIN]: 10 })).toMatchInlineSnapshot(`"2050 b05d3fe1"`);
});

it("has costs for the bytes of UTF-8 sequences once there are 25 of them", () => {
  const ascii = text.toString().replace(/[^\0-\x7f]/gu, "");
  const inputs = Object.entries({ é: 24, 中: 12 }).flatMap(([letter, enough]) =>
    [enough - 1, enough, enough + 1].flatMap(count => {
      const some = Buffer.from(ascii.slice(0, 1500).replaceAll("e", e => (count-- > 0 ? letter : e)));
      return [[], letter, [0xbf], [0xc0]].map(first => Buffer.concat([Buffer.from(first), some]));
    }),
  );
  expect(roundTrips(inputs, { [QUALITY]: 10, [LGWIN]: 12 })).toMatchInlineSnapshot(`"14010 241711d3"`);
});

it("flushes and emits metadata", () => {
  let at = 0;
  const steps = [0, 1, 2, 5, 300, 0, 40000, 7, 30000, 66000].flatMap((size, i) => [
    [i % 4 === 3 ? PROCESS : FLUSH, mixed.subarray(at, (at += size))],
    ...(i % 3 === 1 ? [[METADATA, noise.subarray(0, i * i * 9)]] : []),
  ]);
  steps.push([FINISH, mixed.subarray(at)]);
  const answers = qualities.map(quality => {
    const compressed = drive(zlib.createBrotliCompress({ params: { [QUALITY]: quality } }), steps, 1 << 18);
    expect(digest(zlib.brotliDecompressSync(compressed))).toBe(digest(mixed));
    return digest(compressed);
  });
  expect(answers).toMatchInlineSnapshot(`
    [
      "42022 bb038424",
      "38158 119d842e",
      "28154 bc955bf2",
      "28049 24719021",
      "26631 f320ee55",
      "26026 4e3c59da",
      "25784 8a34a7ed",
      "26000 fd3775fb",
      "25895 f3ad826b",
      "25828 6dc7bc05",
      "24904 97459de0",
      "24727 d26e2d17",
    ]
  `);
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
  expect(answers).toMatchInlineSnapshot(`
    [
      "1518 48488fba",
      "1312 61a50cfa",
      "1319 47c56c48",
      "1225 b341962b",
    ]
  `);
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

it("clamps the block size", () => {
  // The end of a block cuts a match in two.
  const input = Buffer.alloc(2 ** 24 + 64);
  for (let bits = 14; bits <= 24; bits++) {
    noise.copy(input, 2 ** bits - 40, bits * 100 + 1, bits * 100 + 9);
    noise.copy(input, 2 ** bits - 3, bits * 100, bits * 100 + 9);
  }
  const compress = bits => `${bits}: ${roundTrip(input, { [QUALITY]: 5, [LGWIN]: 24, [LGBLOCK]: bits })}`;
  expect([1, 15, 16, 17, 23, 24, 25].map(compress)).toMatchInlineSnapshot(`
    [
      "1: 264 fe7dcba2",
      "15: 264 fe7dcba2",
      "16: 264 fe7dcba2",
      "17: 262 e8ef0d51",
      "23: 251 09dc256c",
      "24: 246 f2052f5c",
      "25: 246 f2052f5c",
    ]
  `);
});

it("holds the header back until something follows", () => {
  const engine = zlib.createBrotliCompress({ params: { [LARGE_WINDOW]: 1 } });
  expect(drive(engine, [[PROCESS, text.subarray(0, 10)]], 64)).toHaveLength(0);
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

it.each([1, 2, 5, 11])("decodes a stream of quality %d in pieces of any size", quality => {
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
  const compressed = zlib.brotliCompressSync(text.subarray(0, 400));
  const codes = new Set();
  for (let length = 1; length < compressed.length; length++) {
    codes.add(drive(zlib.createBrotliDecompress(), [[FINISH, compressed.subarray(0, length)]], 1024).code);
  }
  expect([...codes]).toEqual(["Z_BUF_ERROR"]);
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
    for (const [count, value] of fields) {
      this.pending |= value << this.count;
      for (this.count += count; this.count >= 8; this.count -= 8) {
        this.bytes.push(this.pending & 255);
        this.pending >>>= 8;
      }
    }
    return this;
  }

  /** The highest bit comes first. */
  code(length, code) {
    let reversed = 0;
    for (let i = 0; i < length; i++) reversed = (reversed << 1) | ((code >> i) & 1);
    return this.put([length, reversed]);
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
    this.bytes.push(...bytes);
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

  /** What `copy` and `distance` use: the codes of quality 2 for short inputs. The first 448 commands have 9 bits. */
  fixedCodes() {
    return this.simpleCode(8, 0).put([24, 0x307003], [24, 0x624416], [11, 0x92]).sixBitCode();
  }

  copy(length) {
    const extraBits = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24];
    let [index, base] = [0, 2];
    while (length >= base + 2 ** extraBits[index]) base += 2 ** extraBits[index++];
    return this.code(9, [128, 192, 384][index >> 3] + (index & 7)).put([extraBits[index], length - base]);
  }

  distance(distance) {
    const extraBits = 30 - Math.clz32(distance + 3);
    this.code(6, 12 + 2 * extraBits + ((distance + 3) >> extraBits));
    return this.put([extraBits, (distance + 3) & ((1 << extraBits) - 1)]);
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
  for (const [length, index, transform] of words) {
    bits.copy(length).distance(fullWindow.length + 1 + index + (transform << WORD_INDEX_BITS[length - 4]));
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
  ]).toMatchInlineSnapshot(`
    [
      "79695 5ff26661",
      "61532 717e322a",
      "47771 5b4369f1",
      "21257 d88eaf94",
    ]
  `);
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
  expect(digest(decodeWords(words, 79752))).toMatchInlineSnapshot(`"79752 aee2cea4"`);
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
  expect([2, 5].map(quality => roundTripInSteps(steps, { [QUALITY]: quality }))).toMatchInlineSnapshot(`
    [
      "32149 284dd15d",
      "18845 191ba459",
    ]
  `);
});

it("finds a word for every transform", () => {
  expect(qualities.map(quality => roundTrip(transformedWords(), { [QUALITY]: quality }))).toMatchInlineSnapshot(`
    [
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
    ]
  `);
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

  function roundTripOf(quality, seed) {
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
    return roundTripInSteps([...steps, [FINISH, input.subarray(at)]], params, dictionary);
  }

  // Each seed leads to a decision of the encoder that no other test depends on.
  it.each([
    [0, "12 159942 eed5d9d1,3240 37762 7a379a87,5071 80840 8eb31fde,8745 191 379cc8a7"],
    [1, "769 94 20787859,1561 340 54dfc55e"],
    [2, "566 73660 987944c1,2822 93834 65f0444b,2870 327 fc8b4974,4480 1048 8c86e391,4834 3221 f80378dc"],
    [
      3,
      "423 20510 e128b156,507 150124 7081e8f1,543 947 67790447,651 131 69582a7d,1071 1215 b9c64930,1575 91513 2fa02636,2259 5401 5f363f70,6413 1455 b3124700,6582 13 eec0876b,7203 34234 b68c9ca7",
    ],
    [4, "172 784 c1cd3ab7,676 101492 9085d0c2,8350 1725 85994f0e,8739 2694 35d78dde,9467 16476 00936da1"],
    [
      5,
      "173 53360 111c296c,437 370 e92c8cdc,1193 114921 aef81daf,2165 19602 78c5ce0c,2285 864 e60775ce,2765 126341 827eb612,2777 15929 bd0d9360,3185 52821 60963fe0",
    ],
    [
      6,
      "834 63 7ece8e66,1242 159754 34db3b7b,1602 8027 91377b3f,1926 217422 fbf421ff,1986 17112 7853dc95,2346 5969 6573e240,2454 2924 f2039918,5590 67072 8e5087e3",
    ],
    [7, "2707 2399 d4706d50,2995 40290 0a8fb442,3499 9217 7f7bb05d,6756 1966 f856f056,6857 132692 eb8f1c1b"],
    [
      8,
      "104 18460 cc554eac,500 14356 83ad36fe,584 652 3009b31c,1148 169571 02ea013c,1196 54420 c8cd91d6,2192 10105 ff86c07f",
    ],
    [
      9,
      "9 5934 8434bcb6,165 84083 b241feb2,741 8568 1a993106,1089 275 b2d56f15,1293 69502 cad3b846,1437 31527 696d05cb,1497 32124 cbe78615,2361 37726 d42a310f,2445 51406 4ac722e8,2769 45961 c8e1cacf,8993 3369 bfac8ab2",
    ],
    [
      10,
      "430 23527 a0f459bd,718 2013 eb83ab4a,1486 1279 483d2115,2038 19101 faa4a6bf,2542 8760 7d17efd8,2590 321 6912eeb3,3382 6383 d0e859b9,3418 33571 883fdfd8,3526 76 25281d97,9327 9743 1f66d528",
    ],
    [10, "9335 22094 82f0a9f7,9375 59303 46520861,9578 10708 a840554c"],
    [10, "9919 21965 7ca894db,10458 8992 1b40848f,10475 8667 faa106cb,10528 18213 00d65ced,11336 23 792dd208"],
    [10, "11500 18564 a623757c"],
    [
      11,
      "227 12714 a14d6e0e,755 47 0e0f8fd2,947 27 633f4862,1079 19 3748fe47,1355 9268 619de682,3203 6988 096c0842,3299 639 efba7476,3335 705 86fa09fd,12182 3635 cd3d256d,12483 8898 b7d49e27",
    ],
    [11, "12723 8194 d4c5ea9f,13877 8538 941e4719"],
  ])("compresses at quality %d (%#)", (quality, expected) => {
    const seeds = expected.split(",").map(answer => parseInt(answer));
    expect(seeds.map(seed => `${seed} ${roundTripOf(quality, seed)}`).join()).toBe(expected);
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
  expect(answers).toMatchInlineSnapshot(`
    [
      "2560 2dabbf67",
      "2560 95f42902",
      "2560 79080a22",
      "2560 65e3dadc",
    ]
  `);
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
  expect(digest(zlib.brotliDecompressSync(bits.finish()))).toMatchInlineSnapshot(`"340 9c0bc6cf"`);
});

it("copies byte by byte where source and target overlap", () => {
  const expected = [];
  const bits = windowOf(10);
  for (let distance = 1; distance <= 34; distance++) {
    const lengths = [2, 3, 8, 15, 16, 17, 31, 32, 33, 64, 100];
    const fresh = noise.subarray(distance * 40, distance * 40 + 40);
    for (const length of lengths) {
      bits.uncompressed(fresh).plainHeader(length).fixedCodes().copy(length).distance(distance);
      expected.push(...fresh);
      for (let i = 0; i < length; i++) expected.push(expected.at(-distance));
    }
  }
  expect(zlib.brotliDecompressSync(bits.put([2, 3]).finish())).toEqual(Buffer.from(expected));
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
    return digest(drive(zlib.createBrotliDecompress(), [...steps, [FINISH, Buffer.alloc(0)]], room));
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

it.each([9, 10, 11, 12, 13, 14, 15])("decodes commands of 48 + %d bits at each alignment", length => {
  // The code of one bit is for a literal and two bytes from the last distance.
  const lengths = Array(704).fill(0).fill(length, 702);
  lengths.splice(8, length - 1, ...upTo15.slice(0, length - 1));
  const out = Buffer.alloc(1 << 18, "a");
  function write(total) {
    const bits = windowOf(20).uncompressed(noise.subarray(0, 40)).plainLastHeader(total);
    bits.simpleCode(8, 97).complexCode(lengths).sixBitCode();
    let [at, last] = [noise.copy(out, 0, 0, 40), 4];
    for (let i = 0; i < 8; i++) {
      for (; bits.count !== i; at += 3) {
        bits.put([1, 0]);
        out.copyWithin(at + 1, at + 1 - last, at + 3 - last);
      }
      last = at += 22594 + 37 * i;
      bits
        .code(length, 2 ** length - 1)
        .put([24, 37 * i], [24, 800 - 99 * i])
        .distance(last);
      out.copyWithin(at, 0, 2118 + 800 - 99 * i);
      at += 2118 + 800 - 99 * i;
    }
    return [bits.finish(), at];
  }
  const [stream, end] = write(write(1 << 17)[1] - 40);
  expect(decodeInPieces(stream, [stream.length, 1], 1 << 18)).toEqual(Array(2).fill(digest(out.subarray(0, end))));
});

it.each([
  [0xff0000, 5],
  [5, 0xff0000],
])("decodes a command with lengths of %d and %d in its extra bits", (insert, copy) => {
  const total = 22594 + insert + 2118 + copy;
  const bits = windowOf(16).plainLastHeader(total).simpleCode(8, 97);
  bits.complexCode([...Array(688).fill(0), ...upTo15]).simpleCode(6, 0);
  const stream = bits.code(15, 0x7fff).put([24, insert], [24, copy]).finish();
  expect(decodeInPieces(stream, [stream.length, 1], 1 << 20)).toEqual(Array(2).fill(digest(Buffer.alloc(total, "a"))));
});

it.each([
  [[3, 1, 1], [], "3294 0dae9afc"],
  [[3, 1, 1], [1], "3294 155c1ee4"],
  [[1, 3, 1], [0], "3299 51017558"],
  [[1, 1, 3], [], "3171 cb48c33e"],
  [[3, 3, 3], [0, 2], "3597 6cd4667a"],
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

it.each([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])("finds the words behind a window of %d bits", size => {
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
      const answer = drive(zlib.createBrotliDecompress(allowingLarge), [[FINISH, bits.finish()]], 64);
      if (answer.toString() === "b") count += step;
    }
    return count;
  }
  expect([0, 1, 2, 3].map(postfix => [0, 1, 15].map(direct => countCodes(postfix, direct)).join()))
    .toMatchInlineSnapshot(`
    [
      "74,74,88",
      "128,130,156",
      "232,236,288",
      "432,440,544",
    ]
  `);
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

it("accepts metadata as the last meta-block", () => {
  const bits = windowOf(16).uncompressed([97]).put([2, 1], [2, 3], [1, 0], [2, 1], [8, 1]).align();
  expect(zlib.brotliDecompressSync(bits.put([16, 0xffff]).finish()).toString()).toBe("a");
});

it.each([
  [1, "10121 e05b5c74", text.subarray(0, 300)],
  [5, "9671 cadfd1e7", Buffer.concat([text.subarray(0, 250), samples.subarray(0, 40)])],
  [11, "10228 e9269d46", Buffer.concat([text.subarray(0, 700), Buffer.alloc(900, samples.subarray(0, 24))])],
])("has an answer for flipped bits in a stream of quality %d", (quality, expected, input) => {
  const stream = zlib.brotliCompressSync(input, { params: { [QUALITY]: quality } });
  const [out, state, answers] = [Buffer.alloc(4096), new Uint32Array(2), []];
  const { constructor: Handle } = zlib.createBrotliDecompress()._handle;
  for (let bit = 0; bit < stream.length * 8; bit += bit < 1200 ? 1 : 3) {
    const handle = new Handle(zlib.constants.BROTLI_DECODE);
    let answer;
    handle.onerror = (_, errno) => (answer = errno);
    handle.init(new Uint32Array(0), state, () => {});
    stream[bit >> 3] ^= 1 << (bit & 7);
    handle.writeSync(FINISH, stream, 0, stream.length, out, 0, out.length);
    stream[bit >> 3] ^= 1 << (bit & 7);
    handle.close();
    answers.push(answer ?? [state[1], zlib.crc32(out.subarray(0, out.length - state[0]))]);
  }
  expect(digest(Buffer.from(answers.join()))).toBe(expected);
});

const zeroLengths = count => Array(count).fill([2, 0]);

it.each([
  ["FORMAT_EXUBERANT_NIBBLE", -1, windowOf(16).put([1, 0], [2, 1], [20, 0xffff])],
  ["FORMAT_EXUBERANT_NIBBLE", -1, windowOf(16).put([1, 0], [2, 2], [24, 0xfffff])],
  ["FORMAT_RESERVED", -2, windowOf(16).put([1, 0], [2, 3], [1, 1])],
  ["FORMAT_EXUBERANT_META_NIBBLE", -3, windowOf(16).put([1, 0], [2, 3], [1, 0], [2, 2], [16, 0xff])],
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
    windowOf(16).uncompressed([0]).plainLastHeader(4).fixedCodes().copy(2).distance(1).copy(2).code(6, 4),
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

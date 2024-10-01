import btest from "bun:test";
import { tmpdirSync } from "harness";

type Fn = () => unknown;
type AsyncFn = () => Promise<unknown>;

const promise_test = (fn: AsyncFn, label: string) => btest.test(label, fn);
const assert_equals = (actual: any, expected: any, message?: string) => btest.expect(actual, message).toEqual(expected);
const assert_array_equals = assert_equals;
const assert_true = (actual: any, message: string) => btest.expect(actual, message).toBeTrue();
const test = (fn: Fn, label: string) => btest.test(label, fn);
const assert_throws_js = (C: Function, fn: Fn, message: string) => btest.expect(fn, message).toThrowError(C);
const promise_rejects_js = (C: Function, fn: Promise<unknown>, message: string) => {
  expect("TODO").toBeNull();
};
const assert_less_than = (actual: any, expected: any, message?: string) =>
  btest.expect(actual, message).toBeLessThan(expected);

// Read all the chunks from a stream that returns BufferSource objects and concatenate them into a single Uint8Array.
async function concatenateStream(readableStream: ReadableStream) {
  const reader = readableStream.getReader();
  let totalSize = 0;
  const buffers = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffers.push(value);
    totalSize += value.byteLength;
  }
  reader.releaseLock();
  const concatenated = new Uint8Array(totalSize);
  let offset = 0;
  for (const buffer of buffers) {
    concatenated.set(buffer, offset);
    offset += buffer.byteLength;
  }
  return concatenated;
}

// compression/decompression-with-detach.tentative.window.js
blk: {
  break blk;
  const kInputLength = 1000000;

  async function createLargeCompressedInput() {
    const cs = new CompressionStream("deflate");
    // The input has to be large enough that it won't fit in a single chunk when
    // decompressed.
    const writer = cs.writable.getWriter();
    writer.write(new Uint8Array(kInputLength));
    writer.close();
    return concatenateStream(cs.readable);
  }

  promise_test(async () => {
    const input = await createLargeCompressedInput();
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(input);
    writer.close();
    // Object.prototype.then will be looked up synchronously when the promise
    // returned by read() is resolved.
    Object.defineProperty(Object.prototype, "then", {
      get() {
        // Cause input to become detached and unreferenced.
        try {
          postMessage(undefined, "nowhere", [input.buffer]);
        } catch (e) {
          // It's already detached.
        }
      },
    });
    const output = await concatenateStream(ds.readable);
    // If output successfully decompressed and gave the right length, we can be
    // reasonably confident that no data corruption happened.
    assert_equals(output.byteLength, kInputLength, "output should be the right length");
  }, "data should be correctly decompressed even if input is detached partway");
}

// compression/decompression-uint8array-output.tentative.any.js
{
  const deflateChunkValue = new Uint8Array([
    120, 156, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 48, 173, 6, 36,
  ]);
  const gzipChunkValue = new Uint8Array([
    31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 176, 1, 57,
    179, 15, 0, 0, 0,
  ]);

  promise_test(async () => {
    const ds = new DecompressionStream("deflate");
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(deflateChunkValue);
    const { value } = await reader.read();
    assert_equals(value.constructor, Uint8Array, "type should match");
    await writePromise;
  }, "decompressing deflated output should give Uint8Array chunks");

  promise_test(async () => {
    const ds = new DecompressionStream("gzip");
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(gzipChunkValue);
    const { value } = await reader.read();
    assert_equals(value.constructor, Uint8Array, "type should match");
    await writePromise;
  }, "decompressing gzip output should give Uint8Array chunks");
}

// compression/decompression-split-chunk.tentative.any.js
{
  const compressedBytesWithDeflate = new Uint8Array([
    120, 156, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 48, 173, 6, 36,
  ]);
  const compressedBytesWithGzip = new Uint8Array([
    31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 176, 1, 57,
    179, 15, 0, 0, 0,
  ]);
  const compressedBytesWithDeflateRaw = new Uint8Array([
    0x4b, 0xad, 0x28, 0x48, 0x4d, 0x2e, 0x49, 0x4d, 0x51, 0xc8, 0x2f, 0x2d, 0x29, 0x28, 0x2d, 0x01, 0x00,
  ]);
  const expectedChunkValue = new TextEncoder().encode("expected output");

  async function decompressArrayBuffer(input, format, chunkSize) {
    const ds = new DecompressionStream(format);
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    for (let beginning = 0; beginning < input.length; beginning += chunkSize) {
      writer.write(input.slice(beginning, beginning + chunkSize));
    }
    writer.close();
    const out = [];
    let totalSize = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
      totalSize += value.byteLength;
    }
    const concatenated = new Uint8Array(totalSize);
    let offset = 0;
    for (const array of out) {
      concatenated.set(array, offset);
      offset += array.byteLength;
    }
    return concatenated;
  }

  for (let chunkSize = 1; chunkSize < 16; ++chunkSize) {
    promise_test(async () => {
      const decompressedData = await decompressArrayBuffer(compressedBytesWithDeflate, "deflate", chunkSize);
      assert_array_equals(decompressedData, expectedChunkValue, "value should match");
    }, `decompressing splitted chunk into pieces of size ${chunkSize} should work in deflate`);

    promise_test(async () => {
      const decompressedData = await decompressArrayBuffer(compressedBytesWithGzip, "gzip", chunkSize);
      assert_array_equals(decompressedData, expectedChunkValue, "value should match");
    }, `decompressing splitted chunk into pieces of size ${chunkSize} should work in gzip`);

    promise_test(async () => {
      const decompressedData = await decompressArrayBuffer(compressedBytesWithDeflateRaw, "deflate-raw", chunkSize);
      assert_array_equals(decompressedData, expectedChunkValue, "value should match");
    }, `decompressing splitted chunk into pieces of size ${chunkSize} should work in deflate-raw`);
  }
}

// compression/decompression-empty-input.tentative.any.js
{
  const gzipEmptyValue = new Uint8Array([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const deflateEmptyValue = new Uint8Array([120, 156, 3, 0, 0, 0, 0, 1]);
  const deflateRawEmptyValue = new Uint8Array([1, 0, 0, 255, 255]);

  promise_test(async () => {
    const ds = new DecompressionStream("gzip");
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(gzipEmptyValue);
    writer.close();
    const { value, done } = await reader.read();
    assert_true(done, "read() should set done");
    assert_equals(value, undefined, "value should be undefined");
    await writePromise;
  }, "decompressing gzip empty input should work");

  promise_test(async () => {
    const ds = new DecompressionStream("deflate");
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(deflateEmptyValue);
    writer.close();
    const { value, done } = await reader.read();
    assert_true(done, "read() should set done");
    assert_equals(value, undefined, "value should be undefined");
    await writePromise;
  }, "decompressing deflate empty input should work");

  promise_test(async () => {
    const ds = new DecompressionStream("deflate-raw");
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(deflateRawEmptyValue);
    writer.close();
    const { value, done } = await reader.read();
    assert_true(done, "read() should set done");
    assert_equals(value, undefined, "value should be undefined");
    await writePromise;
  }, "decompressing deflate-raw empty input should work");
}

// compression/decompression-corrupt-input.tentative.any.js
{
  // The many different cases are summarised in this data structure.
  const expectations = [
    {
      format: "deflate",
      // Decompresses to 'expected output'.
      baseInput: [120, 156, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 48, 173, 6, 36],

      // See RFC1950 for the definition of the various fields used by deflate: https://tools.ietf.org/html/rfc1950.
      fields: [
        {
          // The function of this field. This matches the name used in the RFC.
          name: "CMF",
          // The offset of the field in bytes from the start of the input.
          offset: 0,
          // The length of the field in bytes.
          length: 1,
          cases: [
            {
              // The value to set the field to. If the field contains multiple bytes, all the bytes will be set to this value.
              value: 0,
              // The expected result. 'success' means the input is decoded successfully. 'error' means that the stream will be errored.
              result: "error",
            },
          ],
        },
        {
          name: "FLG",
          offset: 1,
          length: 1,
          // FLG contains a 4-bit checksum (FCHECK) which is calculated in such a way that there are 4 valid values for this field.
          cases: [
            { value: 218, result: "success" },
            { value: 1, result: "success" },
            { value: 94, result: "success" },
            {
              // The remaining 252 values cause an error.
              value: 157,
              result: "error",
            },
          ],
        },
        {
          name: "DATA",
          // In general, changing any bit of the data will trigger a checksum error. Only the last byte does anything else.
          offset: 18,
          length: 1,
          cases: [
            { value: 4, result: "success" },
            { value: 5, result: "error" },
          ],
        },
        {
          name: "ADLER",
          offset: -4,
          length: 4,
          cases: [{ value: 255, result: "error" }],
        },
      ],
    },
    {
      format: "gzip",

      // Decompresses to 'expected output'.
      baseInput: [
        31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 176, 1, 57,
        179, 15, 0, 0, 0,
      ],

      // See RFC1952 for the definition of the various fields used by gzip: https://tools.ietf.org/html/rfc1952.
      fields: [
        {
          name: "ID",
          offset: 0,
          length: 2,
          cases: [{ value: 255, result: "error" }],
        },
        {
          name: "CM",
          offset: 2,
          length: 1,
          cases: [{ value: 0, result: "error" }],
        },
        {
          name: "FLG",
          offset: 3,
          length: 1,
          cases: [
            {
              value: 1, // FTEXT
              result: "success",
            },
            {
              value: 2, // FHCRC
              result: "error",
            },
          ],
        },
        {
          name: "MTIME",
          offset: 4,
          length: 4,
          cases: [
            {
              // Any value is valid for this field.
              value: 255,
              result: "success",
            },
          ],
        },
        {
          name: "XFL",
          offset: 8,
          length: 1,
          cases: [
            {
              // Any value is accepted.
              value: 255,
              result: "success",
            },
          ],
        },
        {
          name: "OS",
          offset: 9,
          length: 1,
          cases: [
            {
              // Any value is accepted.
              value: 128,
              result: "success",
            },
          ],
        },
        {
          name: "DATA",

          // The last byte of the data is the most interesting.
          offset: 26,
          length: 1,
          cases: [
            { value: 3, result: "error" },
            { value: 4, result: "success" },
          ],
        },
        {
          name: "CRC",
          offset: -8,
          length: 4,
          cases: [
            {
              // Any change will error the stream.
              value: 0,
              result: "error",
            },
          ],
        },
        {
          name: "ISIZE",
          offset: -4,
          length: 4,
          cases: [
            {
              // A mismatch will error the stream.
              value: 1,
              result: "error",
            },
          ],
        },
      ],
    },
  ] as const;

  async function tryDecompress(input: Uint8Array, format: CompressionFormat) {
    const ds = new DecompressionStream(format);
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    writer.write(input).catch(() => {});
    writer.close().catch(() => {});
    let out = [];
    while (true) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        out = out.concat(Array.from(value));
      } catch (e) {
        if (e instanceof TypeError) {
          return { result: "error" };
        } else {
          return { result: e.name };
        }
      }
    }
    const expectedOutput = "expected output";
    if (out.length !== expectedOutput.length) {
      return { result: "corrupt" };
    }
    for (let i = 0; i < out.length; ++i) {
      if (out[i] !== expectedOutput.charCodeAt(i)) {
        return { result: "corrupt" };
      }
    }
    return { result: "success" };
  }

  function corruptInput(input: readonly number[], offset: number, length: number, value: number) {
    const output = new Uint8Array(input);
    if (offset < 0) {
      offset += input.length;
    }
    for (let i = offset; i < offset + length; ++i) {
      output[i] = value;
    }
    return output;
  }

  for (const { format, baseInput, fields } of expectations) {
    promise_test(async () => {
      const { result } = await tryDecompress(new Uint8Array(baseInput), format);
      assert_equals(result, "success", "decompression should succeed");
    }, `the unchanged input for '${format}' should decompress successfully`);

    promise_test(async () => {
      const truncatedInput = new Uint8Array(baseInput.slice(0, -1));
      const { result } = await tryDecompress(truncatedInput, format);
      assert_equals(result, "error", "decompression should fail");
    }, `truncating the input for '${format}' should give an error`);

    promise_test(async () => {
      const extendedInput = new Uint8Array(baseInput.concat([0]));
      const { result } = await tryDecompress(extendedInput, format);
      assert_equals(result, "error", "decompression should fail");
    }, `trailing junk for '${format}' should give an error`);

    for (const { name, offset, length, cases } of fields) {
      for (const { value, result } of cases) {
        promise_test(async () => {
          const corruptedInput = corruptInput(baseInput, offset, length, value);
          const { result: actual } = await tryDecompress(corruptedInput, format);
          assert_equals(actual, result, "result should match");
        }, `format '${format}' field ${name} should be ${result} for ${value}`);
      }
    }
  }

  promise_test(async () => {
    // Data generated in Python:
    // ```py
    // h = b"thequickbrownfoxjumped\x00"
    // words = h.split()
    // zdict = b''.join(words)
    // co = zlib.compressobj(zdict=zdict)
    // cd = co.compress(h) + co.flush()
    // ```
    const { result } = await tryDecompress(
      new Uint8Array([0x78, 0xbb, 0x74, 0xee, 0x09, 0x59, 0x2b, 0xc1, 0x2e, 0x0c, 0x00, 0x74, 0xee, 0x09, 0x59]),
      "deflate",
    );
    assert_equals(result, "error", "Data compressed with a dictionary should throw TypeError");
  }, "the deflate input compressed with dictionary should give an error");
}

// compression/decompression-correct-input.tentative.any.js
{
  const deflateChunkValue = new Uint8Array([
    120, 156, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 48, 173, 6, 36,
  ]);
  const gzipChunkValue = new Uint8Array([
    31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 176, 1, 57,
    179, 15, 0, 0, 0,
  ]);
  const deflateRawChunkValue = new Uint8Array([
    0x4b, 0xad, 0x28, 0x48, 0x4d, 0x2e, 0x49, 0x4d, 0x51, 0xc8, 0x2f, 0x2d, 0x29, 0x28, 0x2d, 0x01, 0x00,
  ]);
  const trueChunkValue = new TextEncoder().encode("expected output");

  promise_test(async () => {
    const ds = new DecompressionStream("deflate");
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(deflateChunkValue);
    const { done, value } = await reader.read();
    assert_array_equals(Array.from(value), trueChunkValue, "value should match");
  }, "decompressing deflated input should work");

  promise_test(async () => {
    const ds = new DecompressionStream("gzip");
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(gzipChunkValue);
    const { done, value } = await reader.read();
    assert_array_equals(Array.from(value), trueChunkValue, "value should match");
  }, "decompressing gzip input should work");

  promise_test(async () => {
    const ds = new DecompressionStream("deflate-raw");
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(deflateRawChunkValue);
    const { done, value } = await reader.read();
    assert_array_equals(Array.from(value), trueChunkValue, "value should match");
  }, "decompressing deflated (with -raw) input should work");
}

// compression/decompression-constructor-error.tentative.any.js
{
  test(() => {
    assert_throws_js(TypeError, () => new DecompressionStream("a"), "constructor should throw");
  }, '"a" should cause the constructor to throw');

  test(() => {
    assert_throws_js(TypeError, () => new DecompressionStream(), "constructor should throw");
  }, "no input should cause the constructor to throw");

  test(() => {
    assert_throws_js(
      Error,
      () =>
        new DecompressionStream({
          toString() {
            throw Error();
          },
        }),
      "constructor should throw",
    );
  }, "non-string input should cause the constructor to throw");
}

// compression/decompression-buffersource.tentative.any.js
{
  const compressedBytesWithDeflate = [120, 156, 75, 52, 48, 52, 50, 54, 49, 53, 3, 0, 8, 136, 1, 199];
  const compressedBytesWithGzip = [
    31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 52, 48, 52, 2, 0, 216, 252, 63, 136, 4, 0, 0, 0,
  ];
  const compressedBytesWithDeflateRaw = [
    0x00, 0x06, 0x00, 0xf9, 0xff, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x01, 0x00, 0x00, 0xff, 0xff,
  ];
  // These chunk values below were chosen to make the length of the compressed
  // output be a multiple of 8 bytes.
  const deflateExpectedChunkValue = new TextEncoder().encode("a0123456");
  const gzipExpectedChunkValue = new TextEncoder().encode("a012");
  const deflateRawExpectedChunkValue = new TextEncoder().encode("ABCDEF");

  const bufferSourceChunksForDeflate = [
    {
      name: "ArrayBuffer",
      value: new Uint8Array(compressedBytesWithDeflate).buffer,
    },
    {
      name: "Int8Array",
      value: new Int8Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Uint8Array",
      value: new Uint8Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Uint8ClampedArray",
      value: new Uint8ClampedArray(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Int16Array",
      value: new Int16Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Uint16Array",
      value: new Uint16Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Int32Array",
      value: new Int32Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Uint32Array",
      value: new Uint32Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Float16Array",
      value: () => new Float16Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Float32Array",
      value: new Float32Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "Float64Array",
      value: new Float64Array(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
    {
      name: "DataView",
      value: new DataView(new Uint8Array(compressedBytesWithDeflate).buffer),
    },
  ];

  const bufferSourceChunksForGzip = [
    {
      name: "ArrayBuffer",
      value: new Uint8Array(compressedBytesWithGzip).buffer,
    },
    {
      name: "Int8Array",
      value: new Int8Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Uint8Array",
      value: new Uint8Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Uint8ClambedArray",
      value: new Uint8ClampedArray(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Int16Array",
      value: new Int16Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Uint16Array",
      value: new Uint16Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Int32Array",
      value: new Int32Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Uint32Array",
      value: new Uint32Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Float16Array",
      value: () => new Float16Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Float32Array",
      value: new Float32Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "Float64Array",
      value: new Float64Array(new Uint8Array(compressedBytesWithGzip).buffer),
    },
    {
      name: "DataView",
      value: new DataView(new Uint8Array(compressedBytesWithGzip).buffer),
    },
  ];

  const bufferSourceChunksForDeflateRaw = [
    {
      name: "ArrayBuffer",
      value: new Uint8Array(compressedBytesWithDeflateRaw).buffer,
    },
    {
      name: "Int8Array",
      value: new Int8Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Uint8Array",
      value: new Uint8Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Uint8ClampedArray",
      value: new Uint8ClampedArray(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Int16Array",
      value: new Int16Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Uint16Array",
      value: new Uint16Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Int32Array",
      value: new Int32Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Uint32Array",
      value: new Uint32Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Float16Array",
      value: () => new Float16Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Float32Array",
      value: new Float32Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "Float64Array",
      value: new Float64Array(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
    {
      name: "DataView",
      value: new DataView(new Uint8Array(compressedBytesWithDeflateRaw).buffer),
    },
  ];

  for (const chunk of bufferSourceChunksForDeflate) {
    promise_test(async () => {
      const ds = new DecompressionStream("deflate");
      const reader = ds.readable.getReader();
      const writer = ds.writable.getWriter();
      const writePromise = writer.write(typeof chunk.value === "function" ? chunk.value() : chunk.value);
      writer.close();
      const { value } = await reader.read();
      assert_array_equals(Array.from(value), deflateExpectedChunkValue, "value should match");
    }, `chunk of type ${chunk.name} should work for deflate`);
  }

  for (const chunk of bufferSourceChunksForGzip) {
    promise_test(async () => {
      const ds = new DecompressionStream("gzip");
      const reader = ds.readable.getReader();
      const writer = ds.writable.getWriter();
      const writePromise = writer.write(typeof chunk.value === "function" ? chunk.value() : chunk.value);
      writer.close();
      const { value } = await reader.read();
      assert_array_equals(Array.from(value), gzipExpectedChunkValue, "value should match");
    }, `chunk of type ${chunk.name} should work for gzip`);
  }

  for (const chunk of bufferSourceChunksForDeflateRaw) {
    promise_test(async () => {
      const ds = new DecompressionStream("deflate-raw");
      const reader = ds.readable.getReader();
      const writer = ds.writable.getWriter();
      const writePromise = writer.write(typeof chunk.value === "function" ? chunk.value() : chunk.value);
      writer.close();
      const { value } = await reader.read();
      assert_array_equals(Array.from(value), deflateRawExpectedChunkValue, "value should match");
    }, `chunk of type ${chunk.name} should work for deflate-raw`);
  }
}

// compression/decompression-bad-chunks.tentative.any.js
{
  const badChunks = [
    {
      name: "undefined",
      value: undefined,
    },
    {
      name: "null",
      value: null,
    },
    {
      name: "numeric",
      value: 3.14,
    },
    {
      name: "object, not BufferSource",
      value: {},
    },
    {
      name: "array",
      value: [65],
    },
    {
      name: "SharedArrayBuffer",
      // Use a getter to postpone construction so that all tests don't fail where
      // SharedArrayBuffer is not yet implemented.
      get value() {
        // See https://github.com/whatwg/html/issues/5380 for why not `new SharedArrayBuffer()`
        return new WebAssembly.Memory({ shared: true, initial: 1, maximum: 1 }).buffer;
      },
    },
    {
      name: "shared Uint8Array",
      get value() {
        // See https://github.com/whatwg/html/issues/5380 for why not `new SharedArrayBuffer()`
        return new Uint8Array(new WebAssembly.Memory({ shared: true, initial: 1, maximum: 1 }).buffer);
      },
    },
    {
      name: "invalid deflate bytes",
      value: new Uint8Array([
        0, 156, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 48, 173, 6, 36,
      ]),
    },
    {
      name: "invalid gzip bytes",
      value: new Uint8Array([
        0, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 173, 40, 72, 77, 46, 73, 77, 81, 200, 47, 45, 41, 40, 45, 1, 0, 176, 1, 57,
        179, 15, 0, 0, 0,
      ]),
    },
  ] as const;

  // Test Case Design
  // We need to wait until after we close the writable stream to check if the decoded stream is valid.
  // We can end up in a state where all reads/writes are valid, but upon closing the writable stream an error is detected.
  // (Example: A zlib encoded chunk w/o the checksum).

  async function decompress(chunk: (typeof badChunks)[number], format: CompressionFormat) {
    const ds = new DecompressionStream(format);
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();

    writer.write(chunk.value).then(
      () => {},
      () => {},
    );
    reader.read().then(
      () => {},
      () => {},
    );

    await promise_rejects_js(TypeError, writer.close(), "writer.close() should reject");
    await promise_rejects_js(TypeError, writer.closed, "write.closed should reject");

    await promise_rejects_js(TypeError, reader.read(), "reader.read() should reject");
    await promise_rejects_js(TypeError, reader.closed, "read.closed should reject");
  }

  for (const chunk of badChunks) {
    promise_test(async () => {
      await decompress(chunk, "gzip");
    }, `chunk of type ${chunk.name} should error the stream for gzip`);

    promise_test(async () => {
      await decompress(chunk, "deflate");
    }, `chunk of type ${chunk.name} should error the stream for deflate`);

    promise_test(async () => {
      await decompress(chunk, "deflate-raw");
    }, `chunk of type ${chunk.name} should error the stream for deflate-raw`);
  }
}

// compression/compression-with-detach.tentative.window.js
blk: {
  break blk;
  const kInputLength = 500000;

  function createLargeRandomInput() {
    const buffer = new ArrayBuffer(kInputLength);
    // The getRandomValues API will only let us get 65536 bytes at a time, so call it multiple times.
    const kChunkSize = 65536;
    for (let offset = 0; offset < kInputLength; offset += kChunkSize) {
      const length = offset + kChunkSize > kInputLength ? kInputLength - offset : kChunkSize;
      const view = new Uint8Array(buffer, offset, length);
      crypto.getRandomValues(view);
    }
    return new Uint8Array(buffer);
  }

  function decompress(view: ArrayBufferView) {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(view);
    writer.close();
    return concatenateStream(ds.readable);
  }

  promise_test(async () => {
    const input = createLargeRandomInput();
    const inputCopy = input.slice(0, input.byteLength);
    const cs = new CompressionStream("deflate");
    const writer = cs.writable.getWriter();
    writer.write(input);
    writer.close();
    // Object.prototype.then will be looked up synchronously when the promise returned by read() is resolved.
    Object.defineProperty(Object.prototype, "then", {
      get() {
        // Cause input to become detached and unreferenced.
        try {
          postMessage(undefined, "nowhere", [input.buffer]);
        } catch (e) {
          // It's already detached.
        }
      },
    });
    const output = await concatenateStream(cs.readable);
    // Perform the comparison as strings since this is reasonably fast even when JITted JavaScript is running under an emulator.
    assert_equals(
      inputCopy.toString(),
      (await decompress(output)).toString(),
      "decompressing the output should return the input",
    );
  }, "data should be correctly compressed even if input is detached partway");
}

// compression/compression-stream.tentative.any.js
{
  const SMALL_FILE = "/media/foo.vtt";
  const LARGE_FILE = "/media/test-av-384k-44100Hz-1ch-320x240-30fps-10kfr.webm";

  async function compressArrayBuffer(input: ArrayBufferView, format: CompressionFormat) {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    writer.write(input);
    const closePromise = writer.close();
    const out = [];
    const reader = cs.readable.getReader();
    let totalSize = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
      totalSize += value.byteLength;
    }
    await closePromise;
    const concatenated = new Uint8Array(totalSize);
    let offset = 0;
    for (const array of out) {
      concatenated.set(array, offset);
      offset += array.byteLength;
    }
    return concatenated;
  }

  test(() => {
    assert_throws_js(
      TypeError,
      () => {
        const transformer = new CompressionStream("nonvalid");
      },
      "non supported format should throw",
    );
  }, "CompressionStream constructor should throw on invalid format");

  promise_test(async () => {
    const buffer = new ArrayBuffer(0);
    const bufferView = new Uint8Array(buffer);
    const compressedData = await compressArrayBuffer(bufferView, "deflate");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(bufferView, pako.inflate(compressedData));
  }, "deflated empty data should be reinflated back to its origin");

  promise_test(async () => {
    const response = await fetch(SMALL_FILE);
    const buffer = await response.arrayBuffer();
    const bufferView = new Uint8Array(buffer);
    const compressedData = await compressArrayBuffer(bufferView, "deflate");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(bufferView, pako.inflate(compressedData));
  }, "deflated small amount data should be reinflated back to its origin");

  promise_test(async () => {
    const response = await fetch(LARGE_FILE);
    const buffer = await response.arrayBuffer();
    const bufferView = new Uint8Array(buffer);
    const compressedData = await compressArrayBuffer(bufferView, "deflate");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(bufferView, pako.inflate(compressedData));
  }, "deflated large amount data should be reinflated back to its origin");

  promise_test(async () => {
    const buffer = new ArrayBuffer(0);
    const bufferView = new Uint8Array(buffer);
    const compressedData = await compressArrayBuffer(bufferView, "gzip");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(bufferView, pako.inflate(compressedData));
  }, "gzipped empty data should be reinflated back to its origin");

  promise_test(async () => {
    const response = await fetch(SMALL_FILE);
    const buffer = await response.arrayBuffer();
    const bufferView = new Uint8Array(buffer);
    const compressedData = await compressArrayBuffer(bufferView, "gzip");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(bufferView, pako.inflate(compressedData));
  }, "gzipped small amount data should be reinflated back to its origin");

  promise_test(async () => {
    const response = await fetch(LARGE_FILE);
    const buffer = await response.arrayBuffer();
    const bufferView = new Uint8Array(buffer);
    const compressedData = await compressArrayBuffer(bufferView, "gzip");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(bufferView, pako.inflate(compressedData));
  }, "gzipped large amount data should be reinflated back to its origin");
}

// compression/compression-output-length.tentative.any.js
{
  const LARGE_FILE = "/media/test-av-384k-44100Hz-1ch-320x240-30fps-10kfr.webm";

  async function compressArrayBuffer(input: ArrayBufferView, format: CompressionFormat) {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    writer.write(input);
    const closePromise = writer.close();
    const out = [];
    const reader = cs.readable.getReader();
    let totalSize = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
      totalSize += value.byteLength;
    }
    await closePromise;
    const concatenated = new Uint8Array(totalSize);
    let offset = 0;
    for (const array of out) {
      concatenated.set(array, offset);
      offset += array.byteLength;
    }
    return concatenated;
  }

  promise_test(async () => {
    const response = await fetch(LARGE_FILE);
    const buffer = await response.arrayBuffer();
    const bufferView = new Uint8Array(buffer);
    const originalLength = bufferView.length;
    const compressedData = await compressArrayBuffer(bufferView, "deflate");
    const compressedLength = compressedData.length;
    assert_less_than(compressedLength, originalLength, "output should be smaller");
  }, "the length of deflated data should be shorter than that of the original data");

  promise_test(async () => {
    const response = await fetch(LARGE_FILE);
    const buffer = await response.arrayBuffer();
    const bufferView = new Uint8Array(buffer);
    const originalLength = bufferView.length;
    const compressedData = await compressArrayBuffer(bufferView, "gzip");
    const compressedLength = compressedData.length;
    assert_less_than(compressedLength, originalLength, "output should be smaller");
  }, "the length of gzipped data should be shorter than that of the original data");

  promise_test(async () => {
    const response = await fetch(LARGE_FILE);
    const buffer = await response.arrayBuffer();
    const bufferView = new Uint8Array(buffer);
    const originalLength = bufferView.length;
    const compressedData = await compressArrayBuffer(bufferView, "deflate-raw");
    const compressedLength = compressedData.length;
    assert_less_than(compressedLength, originalLength, "output should be smaller");
  }, "the length of deflated (with -raw) data should be shorter than that of the original data");
}

// compression/compression-multiple-chunks.tentative.any.js
{
  // Example: ('Hello', 3) => TextEncoder().encode('HelloHelloHello')
  function makeExpectedChunk(input: string, numberOfChunks: number) {
    const expectedChunk = input.repeat(numberOfChunks);
    return new TextEncoder().encode(expectedChunk);
  }

  // Example: ('Hello', 3, 'deflate') => compress ['Hello', 'Hello', Hello']
  async function compressMultipleChunks(input: string, numberOfChunks: number, format: CompressionFormat) {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    const chunk = new TextEncoder().encode(input);
    for (let i = 0; i < numberOfChunks; ++i) {
      writer.write(chunk);
    }
    const closePromise = writer.close();
    const out = [];
    const reader = cs.readable.getReader();
    let totalSize = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
      totalSize += value.byteLength;
    }
    await closePromise;
    const concatenated = new Uint8Array(totalSize);
    let offset = 0;
    for (const array of out) {
      concatenated.set(array, offset);
      offset += array.byteLength;
    }
    return concatenated;
  }

  const hello = "Hello";

  for (let numberOfChunks = 2; numberOfChunks <= 16; ++numberOfChunks) {
    promise_test(async () => {
      const compressedData = await compressMultipleChunks(hello, numberOfChunks, "deflate");
      const expectedValue = makeExpectedChunk(hello, numberOfChunks);
      // decompress with pako, and check that we got the same result as our original string
      assert_array_equals(expectedValue, pako.inflate(compressedData), "value should match");
    }, `compressing ${numberOfChunks} chunks with deflate should work`);

    promise_test(async () => {
      const compressedData = await compressMultipleChunks(hello, numberOfChunks, "gzip");
      const expectedValue = makeExpectedChunk(hello, numberOfChunks);
      // decompress with pako, and check that we got the same result as our original string
      assert_array_equals(expectedValue, pako.inflate(compressedData), "value should match");
    }, `compressing ${numberOfChunks} chunks with gzip should work`);

    promise_test(async () => {
      const compressedData = await compressMultipleChunks(hello, numberOfChunks, "deflate-raw");
      const expectedValue = makeExpectedChunk(hello, numberOfChunks);
      // decompress with pako, and check that we got the same result as our original string
      assert_array_equals(expectedValue, pako.inflateRaw(compressedData), "value should match");
    }, `compressing ${numberOfChunks} chunks with deflate-raw should work`);
  }
}

// compression/compression-large-flush-output.any.js
{
  async function compressData(chunk: Uint8Array, format: CompressionFormat) {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    writer.write(chunk);
    writer.close();
    return await concatenateStream(cs.readable);
  }

  // JSON-encoded array of 10 thousands numbers ("[0,1,2,...]"). This produces 48_891 bytes of data.
  const fullData = new TextEncoder().encode(JSON.stringify(Array.from({ length: 10_000 }, (_, i) => i)));
  const data = fullData.subarray(0, 35_579);
  const expectedValue = data;

  promise_test(async () => {
    const compressedData = await compressData(data, "deflate");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(expectedValue, pako.inflate(compressedData), "value should match");
  }, `deflate compression with large flush output`);

  promise_test(async () => {
    const compressedData = await compressData(data, "gzip");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(expectedValue, pako.inflate(compressedData), "value should match");
  }, `gzip compression with large flush output`);

  promise_test(async () => {
    const compressedData = await compressData(data, "deflate-raw");
    // decompress with pako, and check that we got the same result as our original string
    assert_array_equals(expectedValue, pako.inflateRaw(compressedData), "value should match");
  }, `deflate-raw compression with large flush output`);
}

// compression/compression-including-empty-chunk.tentative.any.js
{
  async function compressChunkList(chunkList, format) {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    for (const chunk of chunkList) {
      const chunkByte = new TextEncoder().encode(chunk);
      writer.write(chunkByte);
    }
    const closePromise = writer.close();
    const out = [];
    const reader = cs.readable.getReader();
    let totalSize = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
      totalSize += value.byteLength;
    }
    await closePromise;
    const concatenated = new Uint8Array(totalSize);
    let offset = 0;
    for (const array of out) {
      concatenated.set(array, offset);
      offset += array.byteLength;
    }
    return concatenated;
  }

  const chunkLists = [
    ["", "Hello", "Hello"],
    ["Hello", "", "Hello"],
    ["Hello", "Hello", ""],
  ];
  const expectedValue = new TextEncoder().encode("HelloHello");

  for (const chunkList of chunkLists) {
    promise_test(async () => {
      const compressedData = await compressChunkList(chunkList, "deflate");
      // decompress with pako, and check that we got the same result as our original string
      assert_array_equals(expectedValue, pako.inflate(compressedData), "value should match");
    }, `the result of compressing [${chunkList}] with deflate should be 'HelloHello'`);

    promise_test(async () => {
      const compressedData = await compressChunkList(chunkList, "gzip");
      // decompress with pako, and check that we got the same result as our original string
      assert_array_equals(expectedValue, pako.inflate(compressedData), "value should match");
    }, `the result of compressing [${chunkList}] with gzip should be 'HelloHello'`);

    promise_test(async () => {
      const compressedData = await compressChunkList(chunkList, "deflate-raw");
      // decompress with pako, and check that we got the same result as our original string
      assert_array_equals(expectedValue, pako.inflateRaw(compressedData), "value should match");
    }, `the result of compressing [${chunkList}] with deflate-raw should be 'HelloHello'`);
  }
}

// compression/compression-constructor-error.tentative.any.js
{
  test(() => {
    assert_throws_js(TypeError, () => new CompressionStream("a"), "constructor should throw");
  }, '"a" should cause the constructor to throw');

  test(() => {
    assert_throws_js(TypeError, () => new CompressionStream(), "constructor should throw");
  }, "no input should cause the constructor to throw");

  test(() => {
    assert_throws_js(
      Error,
      () =>
        new CompressionStream({
          toString() {
            throw Error();
          },
        }),
      "constructor should throw",
    );
  }, "non-string input should cause the constructor to throw");
}

// compression/compression-bad-chunks.tentative.any.js
{
  const badChunks = [
    {
      name: "undefined",
      value: undefined,
    },
    {
      name: "null",
      value: null,
    },
    {
      name: "numeric",
      value: 3.14,
    },
    {
      name: "object, not BufferSource",
      value: {},
    },
    {
      name: "array",
      value: [65],
    },
    {
      name: "SharedArrayBuffer",
      // Use a getter to postpone construction so that all tests don't fail where SharedArrayBuffer is not yet implemented.
      get value() {
        // See https://github.com/whatwg/html/issues/5380 for why not `new SharedArrayBuffer()`
        return new WebAssembly.Memory({ shared: true, initial: 1, maximum: 1 }).buffer;
      },
    },
    {
      name: "shared Uint8Array",
      get value() {
        // See https://github.com/whatwg/html/issues/5380 for why not `new SharedArrayBuffer()`
        return new Uint8Array(new WebAssembly.Memory({ shared: true, initial: 1, maximum: 1 }).buffer);
      },
    },
  ];

  for (const chunk of badChunks) {
    promise_test(async () => {
      const cs = new CompressionStream("gzip");
      const reader = cs.readable.getReader();
      const writer = cs.writable.getWriter();
      const writePromise = writer.write(chunk.value);
      const readPromise = reader.read();
      await promise_rejects_js(TypeError, writePromise, "write should reject");
      await promise_rejects_js(TypeError, readPromise, "read should reject");
    }, `chunk of type ${chunk.name} should error the stream for gzip`);

    promise_test(async () => {
      const cs = new CompressionStream("deflate");
      const reader = cs.readable.getReader();
      const writer = cs.writable.getWriter();
      const writePromise = writer.write(chunk.value);
      const readPromise = reader.read();
      await promise_rejects_js(TypeError, writePromise, "write should reject");
      await promise_rejects_js(TypeError, readPromise, "read should reject");
    }, `chunk of type ${chunk.name} should error the stream for deflate`);

    promise_test(async () => {
      const cs = new CompressionStream("deflate-raw");
      const reader = cs.readable.getReader();
      const writer = cs.writable.getWriter();
      const writePromise = writer.write(chunk.value);
      const readPromise = reader.read();
      await promise_rejects_js(TypeError, writePromise, "write should reject");
      await promise_rejects_js(TypeError, readPromise, "read should reject");
    }, `chunk of type ${chunk.name} should error the stream for deflate-raw`);
  }
}
